// Abläufe rund um eine Vorstellung: Nachricht an alle Gäste, Abbruch während des Spiels,
// offene Reservierungen vor Beginn, No-Show-Auswertung.
import { protokoll } from './audit';
import type { Nutzer } from './auth';
import { db, getSettings } from './db';
import { fmtDatum, fmtZeit } from './dates';
import { fuellen, fussText, layout, senden, vorlage } from './mail';
import { formatEur } from './money';
import { stornieren } from './orders';
import { cacheVerwerfen } from './seats';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** Freitext → Absätze (maskiert, Zeilenumbrüche bleiben) */
export const textHtml = (t: string) => t.trim().split(/\n\s*\n/).map((a) => `<p>${esc(a.trim()).replace(/\n/g, '<br>')}</p>`).join('');

// ─────────── Nachricht an alle Gäste ───────────

/** Empfänger: bezahlte Bestellungen mit gültigen Tickets und E-Mail-Adresse, jede Adresse einmal */
export async function empfaenger(showId: string) {
  const orders = await db.order.findMany({
    where: { showId, status: { in: ['bezahlt', 'teilstorniert'] }, tickets: { some: { status: { not: 'storniert' } } }, customer: { email: { not: '' } } },
    include: { customer: true }, orderBy: { createdAt: 'asc' },
  });
  const gesehen = new Set<string>();
  return orders.filter((o) => {
    const e = o.customer!.email.trim().toLowerCase();
    if (!e || gesehen.has(e)) return false;
    gesehen.add(e);
    return true;
  });
}

export const NACHRICHT_SPERRE_MIN = 5;

export async function nachrichtAnGaeste(showId: string, betreff: string, text: string, user: Nutzer) {
  const show = await db.show.findUniqueOrThrow({ where: { id: showId } });
  if (show.status === 'abgesagt') throw new Error('Die Vorstellung ist abgesagt – die Gäste wurden bereits informiert.');
  // Schutz gegen Doppelversand (Doppelklick, zweites Gerät)
  const zuletzt = await db.auditLog.findFirst({ where: { action: 'nachricht_an_gaeste', entity: 'show', entityId: showId, createdAt: { gt: new Date(Date.now() - NACHRICHT_SPERRE_MIN * 60e3) } }, select: { createdAt: true } });
  if (zuletzt) throw new Error(`Vor weniger als ${NACHRICHT_SPERRE_MIN} Minuten wurde schon eine Nachricht verschickt (${fmtZeit(zuletzt.createdAt)} Uhr). Bitte kurz warten.`);
  const liste = await empfaenger(showId);
  if (!liste.length) throw new Error('Für diese Vorstellung gibt es keine Gäste mit E-Mail-Adresse.');
  const v = await vorlage('info');
  const fuss = await fussText();
  let ok = 0;
  const fehler: string[] = [];
  // Protokoll vorab, damit ein zweiter Klick während des Versands schon gesperrt ist
  await protokoll({ user, action: 'nachricht_an_gaeste', entity: 'show', entityId: showId, data: { betreff, text, empfaenger: liste.length, termin: show.startsAt } });
  for (const o of liste) {
    const werte = { betreff, text_html: textHtml(text), vorname: o.customer!.firstName, nachname: o.customer!.lastName, datum: fmtDatum(show.startsAt), uhrzeit: fmtZeit(show.startsAt), bestellnummer: o.number };
    const r = await senden({ to: o.customer!.email, subject: fuellen(v.subject, werte), html: layout(fuellen(v.subject, werte), fuellen(v.body, werte), fuss), template: 'info', orderId: o.id }).catch((e) => ({ ok: false, fehler: (e as Error).message }));
    if (r.ok) ok++;
    else fehler.push(`${o.number}: ${'fehler' in r ? r.fehler : ''}`);
  }
  if (fehler.length) await protokoll({ user, action: 'nachricht_an_gaeste_fehler', entity: 'show', entityId: showId, data: { fehler } });
  return { ok, fehler, gesamt: liste.length };
}

// ─────────── Abbruch während der Vorstellung ───────────

/** Abbrechen ist ab Einlassbeginn (30 Min. vor Beginn) bis 2 Stunden nach Ende möglich */
export function abbruchMoeglich(show: { startsAt: Date; durationMin: number; status: string; abgebrochenAt: Date | null }, jetzt = Date.now()) {
  return show.status !== 'abgesagt' && !show.abgebrochenAt && jetzt >= show.startsAt.getTime() - 30 * 60e3 && jetzt <= show.startsAt.getTime() + (show.durationMin + 120) * 60e3;
}

/**
 * Vorstellung abgebrochen (Technik, Notfall): alle gültigen und eingelassenen Tickets stornieren und als
 * Kulanz einen Gutschein über prozent % des Ticketwerts ausstellen. Buchhaltung über orders.stornieren
 * (nach der Leistungsabgrenzung gegen 4000, sonst gegen 3480; Einbehalt bleibt Erlös).
 */
export async function vorstellungAbbrechen(showId: string, grund: string, prozent: number, user: Nutzer) {
  const show = await db.show.findUniqueOrThrow({ where: { id: showId } });
  if (!abbruchMoeglich(show)) throw new Error(show.abgebrochenAt ? 'Die Vorstellung wurde bereits abgebrochen.' : 'Abbrechen ist erst ab Einlassbeginn (30 Minuten vor Beginn) möglich.');
  if (prozent < 0 || prozent > 100) throw new Error('Gutschein: 0 bis 100 %');
  const jetzt = new Date();
  await db.show.update({ where: { id: showId }, data: { abgebrochenAt: jetzt, abbruchGrund: grund, status: show.status === 'verkauf' ? 'pausiert' : show.status } });
  // Warenkörbe der Vorstellung verwerfen (Reservierungen offener Bestellungen bleiben)
  const inZahlung = (await db.order.findMany({ where: { showId, status: 'offen', holdId: { not: null } }, select: { holdId: true } })).map((o) => o.holdId!);
  await db.hold.deleteMany({ where: { showId, id: { notIn: inZahlung } } });
  cacheVerwerfen(showId);
  await protokoll({ user, action: 'vorstellung_abgebrochen', entity: 'show', entityId: showId, data: { termin: show.startsAt, prozent }, vorher: { status: show.status, abgebrochenAt: null }, nachher: { status: show.status === 'verkauf' ? 'pausiert' : show.status, abgebrochenAt: jetzt, abbruchGrund: grund } });

  const orders = await db.order.findMany({ where: { showId, status: { in: ['bezahlt', 'teilstorniert'] }, tickets: { some: { status: { in: ['gueltig', 'eingelassen'] } } } }, select: { id: true, number: true } });
  const erg = { ok: 0, gutscheinCents: 0, mails: 0, fehler: [] as string[] };
  for (const o of orders) {
    try {
      const r = await stornieren({ orderId: o.id, methode: 'gutschein', grund: 'kulanz', notiz: `Abbruch der Vorstellung: ${grund}`, userId: user.id, mail: false, fristIgnorieren: true, mitEingelassen: true, gutscheinProzent: prozent });
      erg.ok++;
      if (r.gutschein) {
        erg.gutscheinCents += r.gutschein.valueCents;
        if (await abbruchMail(o.id, grund, r.gutschein)) erg.mails++;
      }
    } catch (e) {
      erg.fehler.push(`${o.number}: ${(e as Error).message}`);
    }
  }
  await protokoll({ user, action: 'vorstellung_abgebrochen_ergebnis', entity: 'show', entityId: showId, data: { bestellungen: erg.ok, gutscheineCents: erg.gutscheinCents, mails: erg.mails, fehler: erg.fehler } });
  return erg;
}

async function abbruchMail(orderId: string, grund: string, v: { code: string; valueCents: number; validUntil: Date | null }) {
  const o = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { customer: true, show: true } });
  if (!o.customer?.email) return false;
  const vl = await vorlage('abbruch');
  const werte = { vorname: o.customer.firstName, nachname: o.customer.lastName, datum: fmtDatum(o.show.startsAt), uhrzeit: fmtZeit(o.show.startsAt), grund, erstattung: `Sie erhalten einen Gutschein über ${formatEur(v.valueCents)}: Code ${v.code}${v.validUntil ? `, gültig bis ${fmtDatum(v.validUntil)}` : ''}.` };
  const r = await senden({ to: o.customer.email, subject: fuellen(vl.subject, werte), html: layout(fuellen(vl.subject, werte), fuellen(vl.body, werte), await fussText()), template: 'abbruch', orderId: o.id });
  return r.ok;
}

// ─────────── Offene Reservierungen vor Beginn ───────────

/** Unbezahlte Bestellungen außer Webshop (der hat eigene 30 Minuten): Telefon, Rechnung, Zahlungslink */
export const verfallendeKanaele = { notIn: ['web'] };

export async function offeneReservierungen(showId: string) {
  const [show, s, orders] = await Promise.all([
    db.show.findUniqueOrThrow({ where: { id: showId }, select: { startsAt: true } }),
    getSettings(),
    db.order.findMany({ where: { showId, status: 'offen', channel: verfallendeKanaele, holdId: { not: null } }, select: { id: true, number: true, holdId: true } }),
  ]);
  const holds = await db.hold.findMany({ where: { id: { in: orders.map((o) => o.holdId!) } }, select: { id: true, seats: true } });
  const plaetze = holds.reduce((n, h) => n + (h.seats as unknown[]).length, 0);
  return { bestellungen: orders.length, plaetze, verfallAm: new Date(show.startsAt.getTime() - s.reservierungVerfallMin * 60e3), minuten: s.reservierungVerfallMin };
}

// ─────────── No-Show nach der Vorstellung ───────────

export async function noShow(showId: string) {
  const rows = await db.ticket.groupBy({ by: ['kat', 'status'], where: { showId, status: { not: 'storniert' } }, _count: { _all: true } });
  const kanal = await db.$queryRaw<{ channel: string; verkauft: number; ein: number }[]>`
    SELECT o.channel, COUNT(*)::int AS verkauft, COUNT(*) FILTER (WHERE t.status = 'eingelassen')::int AS ein
    FROM "Ticket" t JOIN "Order" o ON o.id = t."orderId" WHERE t."showId" = ${showId} AND t.status <> 'storniert' GROUP BY 1 ORDER BY 2 DESC`;
  const z = (kat?: string) => {
    const r = rows.filter((x) => !kat || x.kat === kat);
    const verkauft = r.reduce((n, x) => n + x._count._all, 0);
    const ein = r.filter((x) => x.status === 'eingelassen').reduce((n, x) => n + x._count._all, 0);
    return { verkauft, eingelassen: ein, noShow: verkauft - ein };
  };
  return { gesamt: z(), jeKat: { I: z('I'), II: z('II'), R: z('R') }, jeKanal: kanal.map((k) => ({ ...k, noShow: k.verkauft - k.ein })) };
}
