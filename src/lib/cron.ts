// Regelmäßige Aufgaben (alle 5 Minuten über POST /api/cron):
// Reservierungen aufräumen, Leistungsabgrenzung, Erinnerungsmails, unbezahlte Web-Bestellungen schließen.
import { bmdTaeglich } from './finanzen/bmd-uebergabe';
import { protokollMehrere } from './audit';
import { db, getSettings } from './db';
import { fmtDatum, fmtZeit } from './dates';
import { vorstellungenAbrechnen } from './ledger';
import { fuellen, fussText, layout, senden, vorlage } from './mail';
import { aufraeumen, cacheVerwerfen } from './seats';

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
  const geschlossen: string[] = [];
  for (const o of alt) {
    await db.$transaction(async (tx) => {
      const n = await tx.order.updateMany({ where: { id: o.id, status: 'offen' }, data: { status: 'storniert', cancelledAt: jetzt, holdId: null, note: `Nicht bezahlt – nach ${UNBEZAHLT_MIN} Min. geschlossen` } });
      if (!n.count) return;
      geschlossen.push(o.id);
      await tx.payment.updateMany({ where: { orderId: o.id, status: 'offen' }, data: { status: 'fehlgeschlagen' } });
      if (o.holdId) await tx.hold.deleteMany({ where: { id: o.holdId } });
    });
  }
  await protokollMehrere(geschlossen.map((id) => ({ user: null, akteur: 'System (Cron)', action: 'bestellung_verfallen', entity: 'order', entityId: id, data: { grund: `Nicht bezahlt – nach ${UNBEZAHLT_MIN} Min. geschlossen` }, vorher: { status: 'offen' }, nachher: { status: 'storniert' } })));
  return alt.length;
}

/**
 * Unbezahlte Reservierungen (Telefon, Rechnung, Zahlungslink – alles außer Webshop) verfallen
 * Settings.reservierungVerfallMin Minuten vor Beginn: Plätze gehen an die Abendkasse.
 * Nur Vorstellungen, die noch nicht vorbei sind (ältere offene Bestellungen bleiben für die Leitung sichtbar).
 * showId: nur diese Vorstellung (für Tests und manuelles Auslösen).
 */
export async function reservierungenVerfallen(jetzt = new Date(), showId?: string) {
  const s = await getSettings();
  const grenze = new Date(jetzt.getTime() + s.reservierungVerfallMin * 60e3);
  const orders = await db.order.findMany({
    where: { status: 'offen', channel: { not: 'web' }, ...(showId ? { showId } : {}), show: { startsAt: { lte: grenze, gt: new Date(jetzt.getTime() - 3 * 3600e3) }, status: { not: 'abgesagt' } } },
    include: { customer: true, show: true },
  });
  const verfallen: typeof orders = [];
  for (const o of orders) {
    const frist = fmtZeit(new Date(o.show.startsAt.getTime() - s.reservierungVerfallMin * 60e3));
    const note = [o.note, `Reservierung verfallen (nicht bezahlt bis ${frist} Uhr)`].filter(Boolean).join(' · ');
    await db.$transaction(async (tx) => {
      const n = await tx.order.updateMany({ where: { id: o.id, status: 'offen' }, data: { status: 'storniert', cancelledAt: jetzt, holdId: null, note } });
      if (!n.count) return;
      verfallen.push(o);
      await tx.payment.updateMany({ where: { orderId: o.id, status: 'offen' }, data: { status: 'fehlgeschlagen' } });
      if (o.holdId) await tx.hold.deleteMany({ where: { id: o.holdId } });
    });
  }
  await protokollMehrere(verfallen.map((o) => ({ user: null, akteur: 'System (Cron)', action: 'bestellung_verfallen', entity: 'order', entityId: o.id, data: { grund: `Reservierung ${s.reservierungVerfallMin} Min. vor Beginn verfallen`, bestellung: o.number, kanal: o.channel, mail: s.reservierungVerfallMail && !!o.customer?.email }, vorher: { status: 'offen' }, nachher: { status: 'storniert' } })));
  for (const sid of new Set(verfallen.map((o) => o.showId))) cacheVerwerfen(sid);
  if (s.reservierungVerfallMail) {
    const v = await vorlage('reservierung_verfallen');
    const fuss = await fussText();
    for (const o of verfallen) {
      if (!o.customer?.email) continue;
      const werte = { vorname: o.customer.firstName, nachname: o.customer.lastName, datum: fmtDatum(o.show.startsAt), uhrzeit: fmtZeit(o.show.startsAt), bestellnummer: o.number, frist: fmtZeit(new Date(o.show.startsAt.getTime() - s.reservierungVerfallMin * 60e3)) };
      await senden({ to: o.customer.email, subject: fuellen(v.subject, werte), html: layout(fuellen(v.subject, werte), fuellen(v.body, werte), fuss), template: 'reservierung_verfallen', orderId: o.id }).catch(() => {});
    }
  }
  return verfallen.length;
}

export async function cronLauf() {
  const t0 = Date.now();
  const erg: Record<string, number | string> = {};
  const schritt = async (name: string, f: () => Promise<number | void>) => {
    try { erg[name] = (await f()) ?? 'ok'; } catch (e) { erg[name] = `Fehler: ${(e as Error).message}`; console.error('cron', name, e); }
  };
  await schritt('unbezahlteGeschlossen', () => unbezahlteSchliessen());
  await schritt('reservierungenVerfallen', () => reservierungenVerfallen());
  await schritt('reservierungenAufgeraeumt', async () => { const vor = await db.hold.count(); await aufraeumen(); return vor - (await db.hold.count()); });
  await schritt('vorstellungenAbgerechnet', () => vorstellungenAbrechnen());
  await schritt('erinnerungenGesendet', () => erinnerungenSenden());
  await schritt('bmdLauf', () => bmdTaeglich());
  return { ...erg, dauerMs: Date.now() - t0 };
}
