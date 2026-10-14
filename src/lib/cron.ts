// Regelmäßige Aufgaben (alle 5 Minuten über POST /api/cron):
// Reservierungen aufräumen, Leistungsabgrenzung, Erinnerungsmails, unbezahlte Web-Bestellungen schließen.
import { db } from './db';
import { fmtDatum, fmtZeit } from './dates';
import { vorstellungenAbrechnen } from './ledger';
import { fuellen, fussText, layout, senden, vorlage } from './mail';
import { aufraeumen } from './seats';

export const UNBEZAHLT_MIN = 30;

export async function erinnerungenSenden(jetzt = new Date()) {
  const shows = await db.show.findMany({ where: { startsAt: { gte: new Date(jetzt.getTime() + 20 * 3600e3), lte: new Date(jetzt.getTime() + 28 * 3600e3) }, status: { not: 'abgesagt' } }, select: { id: true } });
  if (!shows.length) return 0;
  const orders = await db.order.findMany({
    where: { showId: { in: shows.map((s) => s.id) }, status: { in: ['bezahlt', 'teilstorniert'] }, customer: { email: { not: '' } }, emails: { none: { template: 'erinnerung' } } },
    include: { customer: true, show: true },
  });
  if (!orders.length) return 0;
  const v = await vorlage('erinnerung');
  const fuss = await fussText();
  const shop = (process.env.PUBLIC_ORIGIN ?? '').replace(/\/$/, '');
  let n = 0;
  for (const o of orders) {
    const werte = { vorname: o.customer!.firstName, nachname: o.customer!.lastName, datum: fmtDatum(o.show.startsAt), uhrzeit: fmtZeit(o.show.startsAt), bestellnummer: o.number, verwalten_url: `${shop}/${o.locale === 'en' ? 'en' : 'de'}/buchung/${o.manageToken}` };
    await senden({ to: o.customer!.email, subject: fuellen(v.subject, werte), html: layout(fuellen(v.subject, werte), fuellen(v.body, werte), fuss), template: 'erinnerung', orderId: o.id });
    n++;
  }
  return n;
}

/** Web-Bestellungen, deren Zahlung nie abgeschlossen wurde: schließen und Plätze freigeben */
export async function unbezahlteSchliessen(jetzt = new Date()) {
  const alt = await db.order.findMany({ where: { status: 'offen', channel: 'web', createdAt: { lt: new Date(jetzt.getTime() - UNBEZAHLT_MIN * 60e3) } }, select: { id: true, holdId: true } });
  for (const o of alt) {
    await db.$transaction(async (tx) => {
      const n = await tx.order.updateMany({ where: { id: o.id, status: 'offen' }, data: { status: 'storniert', cancelledAt: jetzt, holdId: null, note: `Nicht bezahlt – nach ${UNBEZAHLT_MIN} Min. geschlossen` } });
      if (!n.count) return;
      await tx.payment.updateMany({ where: { orderId: o.id, status: 'offen' }, data: { status: 'fehlgeschlagen' } });
      if (o.holdId) await tx.hold.deleteMany({ where: { id: o.holdId } });
    });
  }
  return alt.length;
}

export async function cronLauf() {
  const t0 = Date.now();
  const erg: Record<string, number | string> = {};
  const schritt = async (name: string, f: () => Promise<number | void>) => {
    try { erg[name] = (await f()) ?? 'ok'; } catch (e) { erg[name] = `Fehler: ${(e as Error).message}`; console.error('cron', name, e); }
  };
  await schritt('unbezahlteGeschlossen', () => unbezahlteSchliessen());
  await schritt('reservierungenAufgeraeumt', async () => { const vor = await db.hold.count(); await aufraeumen(); return vor - (await db.hold.count()); });
  await schritt('vorstellungenAbgerechnet', () => vorstellungenAbrechnen());
  await schritt('erinnerungenGesendet', () => erinnerungenSenden());
  return { ...erg, dauerMs: Date.now() - t0 };
}
