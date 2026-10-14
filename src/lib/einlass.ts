// Einlasskontrolle: Ticket prüfen und atomar entwerten. Online über den signierten QR-Inhalt,
// offline in der App über die Codeliste der Vorstellung (die Codes sind nicht erratbar).
import { audit, protokoll, protokollMehrere, type Eintrag } from './audit';
import type { Nutzer } from './auth';
import { db } from './db';
import { fmtDatumZeit } from './dates';
import { gastMeta } from './gaeste';
import { bestePlaetze } from './kassa';
import { formatEur } from './money';
import { preis, sitzName, type Kat, type Preise } from './saal';
import { qrPruefen } from './tickets';
import { umbuchen } from './umbuchung';

export type Ergebnis = 'ok' | 'doppelt' | 'falsche_vorstellung' | 'storniert' | 'unbekannt' | 'ungueltig';
export const RUECKNAHME_MIN = 2;

export type ScanAntwort = {
  result: Ergebnis;
  checkInId?: string;
  code?: string;
  ticket?: { code: string; seatId: string; sitz: string; kat: string; art: string };
  vorher?: { am: string; von: string | null };
  vorstellung?: string;
  /** bei falscher Vorstellung: Umbuchung auf die gescannte Vorstellung möglich? */
  umbuchbar?: boolean;
};

/** Code aus QR-Inhalt oder Handeingabe. null = Signatur falsch / unlesbar. */
export function codeAus(eingabe: string): { code: string; showId?: string } | null {
  const s = eingabe.trim();
  if (s.startsWith('LOC1.')) return qrPruefen(s);
  const code = s.toUpperCase().replace(/[\s-]/g, '');
  return /^[A-Z0-9]{6,16}$/.test(code) ? { code } : null;
}

export async function scannen(p: { eingabe: string; showId: string; user: Nutzer; offline?: boolean; scannedAt?: Date; deviceId?: string }): Promise<ScanAntwort> {
  const c = codeAus(p.eingabe);
  // Jeder Scan landet in CheckIn und knapp im revisionssicheren Protokoll
  const merken = async (result: Ergebnis, code: string, ticketId?: string) => {
    const ci = await db.checkIn.create({ data: { result, code: code.slice(0, 80), ticketId, showId: p.showId, userId: p.user.id, deviceId: p.deviceId, offline: !!p.offline, createdAt: p.scannedAt } });
    await protokoll({
      user: p.user, action: `einlass_${result}`, entity: ticketId ? 'ticket' : 'checkIn', entityId: ticketId ?? ci.id,
      data: { code: code.slice(0, 40), showId: p.showId, checkInId: ci.id, geraet: p.deviceId, offline: p.offline || undefined, gescannt: p.scannedAt },
      ...(result === 'ok' ? { vorher: { status: 'gueltig' }, nachher: { status: 'eingelassen' } } : {}),
    });
    return ci;
  };
  if (!c) {
    await merken('ungueltig', p.eingabe);
    return { result: 'ungueltig' };
  }
  const t = await db.ticket.findUnique({ where: { code: c.code }, include: { show: true } });
  if (!t) {
    await merken('unbekannt', c.code);
    return { result: 'unbekannt', code: c.code };
  }
  const ticket = { code: t.code, seatId: t.seatId, sitz: sitzName(t.seatId), kat: t.kat, art: t.art };
  if (t.showId !== p.showId) {
    await merken('falsche_vorstellung', t.code, t.id);
    return { result: 'falsche_vorstellung', code: t.code, ticket, vorstellung: fmtDatumZeit(t.show.startsAt), umbuchbar: t.status === 'gueltig' };
  }
  if (t.status === 'storniert') {
    await merken('storniert', t.code, t.id);
    return { result: 'storniert', code: t.code, ticket };
  }
  // Atomar: nur ein Gerät gewinnt, auch bei gleichzeitigen Scans
  const am = p.scannedAt ?? new Date();
  const n = await db.ticket.updateMany({ where: { id: t.id, status: 'gueltig' }, data: { status: 'eingelassen', checkedInAt: am, checkedInBy: p.user.name } });
  if (!n.count) {
    const jetzt = await db.ticket.findUniqueOrThrow({ where: { id: t.id } });
    const r: Ergebnis = jetzt.status === 'storniert' ? 'storniert' : 'doppelt';
    await merken(r, t.code, t.id);
    return { result: r, code: t.code, ticket, vorher: jetzt.checkedInAt ? { am: jetzt.checkedInAt.toISOString(), von: jetzt.checkedInBy } : undefined };
  }
  const ci = await merken('ok', t.code, t.id);
  return { result: 'ok', code: t.code, ticket, checkInId: ci.id };
}

/** Letzten Einlass zurücknehmen (Fehlscan), nur innerhalb von RUECKNAHME_MIN Minuten und nur eigene Scans */
export async function zuruecknehmen(checkInId: string, user: Nutzer) {
  const ci = await db.checkIn.findUnique({ where: { id: checkInId } });
  if (!ci || ci.result !== 'ok' || !ci.ticketId) throw new Error('Dieser Einlass kann nicht zurückgenommen werden.');
  if (ci.userId !== user.id && !user.roles.includes('admin')) throw new Error('Nur eigene Scans können zurückgenommen werden.');
  if (Date.now() - ci.createdAt.getTime() > RUECKNAHME_MIN * 60e3) throw new Error(`Rücknahme ist nur ${RUECKNAHME_MIN} Minuten lang möglich.`);
  const n = await db.ticket.updateMany({ where: { id: ci.ticketId, status: 'eingelassen' }, data: { status: 'gueltig', checkedInAt: null, checkedInBy: null } });
  if (!n.count) throw new Error('Ticket ist nicht mehr als eingelassen markiert.');
  await db.checkIn.update({ where: { id: ci.id }, data: { result: 'zurueckgenommen' } });
  await audit(user, 'einlass_zuruecknehmen', 'ticket', ci.ticketId, { checkInId, code: ci.code, eingelassenAm: ci.createdAt }, { vorher: { status: 'eingelassen' }, nachher: { status: 'gueltig' } });
  return true;
}

/** Leitung: Einlass eines Tickets ohne Zeitlimit zurücknehmen (z. B. versehentlich entwertet) */
export async function einlassZuruecknehmenLeitung(ticketId: string, grund: string, user: Nutzer) {
  const t = await db.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  if (t.status !== 'eingelassen') throw new Error('Das Ticket ist nicht als eingelassen markiert.');
  const n = await db.ticket.updateMany({ where: { id: ticketId, status: 'eingelassen' }, data: { status: 'gueltig', checkedInAt: null, checkedInBy: null } });
  if (!n.count) throw new Error('Das Ticket ist nicht mehr als eingelassen markiert.');
  // Neue Zeile statt die alte zu ändern: der ursprüngliche Scan bleibt sichtbar
  const ci = await db.checkIn.create({ data: { ticketId, showId: t.showId, code: t.code, result: 'zurueckgenommen', userId: user.id, deviceId: 'backend' } });
  await audit(user, 'einlass_zuruecknehmen', 'ticket', ticketId, { checkInId: ci.id, code: t.code, grund, durch: 'leitung' }, { vorher: { status: 'eingelassen', checkedInAt: t.checkedInAt, checkedInBy: t.checkedInBy }, nachher: { status: 'gueltig', checkedInAt: null, checkedInBy: null } });
}

/**
 * Zähler für Scanner und Vorstellungsseite. eingelassen = Tickets mit Status „eingelassen“ (Rücknahmen sind
 * dabei schon abgezogen, weil sie den Status zurücksetzen). imSaal = Personen: Rollstuhlplatz-Tickets zählen
 * doppelt (Begleitperson) – wichtig für Evakuierung und Brandschutz.
 */
export async function stand(showId: string) {
  const [eingelassen, verkauft, rollstuhl] = await Promise.all([
    db.ticket.count({ where: { showId, status: 'eingelassen' } }),
    db.ticket.count({ where: { showId, status: { not: 'storniert' } } }),
    db.ticket.count({ where: { showId, status: 'eingelassen', kat: 'R' } }),
  ]);
  return { eingelassen, verkauft, imSaal: eingelassen + rollstuhl };
}

// ─────────── Namenssuche am Eingang (Handy vergessen, Gruppe, Schulklasse) ───────────

/** Bestellungen der Vorstellung nach Name, E-Mail, Firma, Bestellnummer oder Ticketcode */
export async function suchen(showId: string, q: string) {
  const woerter = q.trim().split(/\s+/).filter((w) => w.length >= 2).slice(0, 4);
  if (!woerter.length) return [];
  const code = q.trim().toUpperCase().replace(/[\s-]/g, '');
  const orders = await db.order.findMany({
    where: {
      showId, status: { in: ['bezahlt', 'teilstorniert'] },
      OR: [
        { number: { contains: q.trim(), mode: 'insensitive' } },
        { tickets: { some: { code } } },
        { AND: woerter.map((w) => ({ customer: { OR: [{ firstName: { contains: w, mode: 'insensitive' as const } }, { lastName: { contains: w, mode: 'insensitive' as const } }, { email: { contains: w, mode: 'insensitive' as const } }, { company: { contains: w, mode: 'insensitive' as const } }] } })) },
      ],
    },
    include: { customer: true, tickets: { orderBy: { seatId: 'asc' } } },
    take: 25,
  });
  return orders.map((o) => {
    const g = gastMeta(o.meta);
    return {
      id: o.id, number: o.number, channel: o.channel,
      name: o.customer ? `${o.customer.firstName} ${o.customer.lastName}`.trim() : '', firma: o.customer?.company ?? '', email: o.customer?.email ?? '',
      gast: g ? { grund: g.grund, hinterlegt: g.hinterlegt, abgeholt: !!g.abgeholtAm } : null,
      tickets: o.tickets.map((t) => ({ id: t.id, code: t.code, seatId: t.seatId, sitz: sitzName(t.seatId), kat: t.kat, art: t.art, status: t.status, checkedInAt: t.checkedInAt?.toISOString() ?? null })),
    };
  });
}

/** Einlass ohne Scan (Namenssuche): je Ticket atomar, jede Zeile als CheckIn mit method „manuell“ */
export async function manuellEinlassen(p: { ticketIds: string[]; showId: string; user: Nutzer; deviceId?: string; method?: 'manuell' | 'umbuchung' }) {
  const tickets = await db.ticket.findMany({ where: { id: { in: p.ticketIds } } });
  const ok: string[] = [];
  const abgelehnt: { code: string; grund: string }[] = [];
  const eintraege: Eintrag[] = [];
  for (const t of tickets) {
    if (t.showId !== p.showId) { abgelehnt.push({ code: t.code, grund: 'andere Vorstellung' }); continue; }
    const am = new Date();
    const n = await db.ticket.updateMany({ where: { id: t.id, status: 'gueltig' }, data: { status: 'eingelassen', checkedInAt: am, checkedInBy: p.user.name } });
    if (!n.count) { abgelehnt.push({ code: t.code, grund: t.status === 'storniert' ? 'storniert' : 'bereits eingelassen' }); continue; }
    const ci = await db.checkIn.create({ data: { ticketId: t.id, showId: p.showId, code: t.code, result: 'ok', method: p.method ?? 'manuell', userId: p.user.id, deviceId: p.deviceId } });
    ok.push(t.code);
    eintraege.push({ user: p.user, action: 'einlass_ok', entity: 'ticket', entityId: t.id, data: { code: t.code, showId: p.showId, checkInId: ci.id, geraet: p.deviceId, methode: p.method ?? 'manuell' }, vorher: { status: 'gueltig' }, nachher: { status: 'eingelassen' } });
  }
  await protokollMehrere(eintraege);
  return { ok, abgelehnt };
}

export const VERWEIGERUNGSGRUENDE = [
  'Kind unter 6 Jahren',
  'Alkohol oder Drogen (laut AGB)',
  'Hausverbot',
  'Ermäßigung ohne Nachweis – an der Kassa aufzahlen',
  'Sonstiges',
] as const;

/**
 * Einlass verweigern: das Ticket bleibt gültig (z. B. Aufzahlung an der Kassa, später erneut scannen).
 * Wurde es mit diesem Scan gerade eingelassen (checkInId), wird der Einlass zurückgenommen.
 */
export async function verweigern(p: { ticketId: string; showId: string; grund: string; notiz?: string; checkInId?: string; user: Nutzer; deviceId?: string }) {
  const t = await db.ticket.findUniqueOrThrow({ where: { id: p.ticketId } });
  if (t.showId !== p.showId) throw new Error('Das Ticket gehört zu einer anderen Vorstellung.');
  let zurueck = false;
  if (p.checkInId) {
    const ci = await db.checkIn.findUnique({ where: { id: p.checkInId } });
    if (ci && ci.ticketId === t.id && ci.result === 'ok') {
      const n = await db.ticket.updateMany({ where: { id: t.id, status: 'eingelassen' }, data: { status: 'gueltig', checkedInAt: null, checkedInBy: null } });
      if (n.count) {
        await db.checkIn.update({ where: { id: ci.id }, data: { result: 'zurueckgenommen' } });
        zurueck = true;
      }
    }
  }
  const grund = [p.grund, p.notiz?.trim()].filter(Boolean).join(': ').slice(0, 300);
  const ci = await db.checkIn.create({ data: { ticketId: t.id, showId: p.showId, code: t.code, result: 'verweigert', method: 'manuell', reason: grund, userId: p.user.id, deviceId: p.deviceId } });
  await protokoll({
    user: p.user, action: 'einlass_verweigert', entity: 'ticket', entityId: t.id,
    data: { code: t.code, showId: p.showId, checkInId: ci.id, grund, einlassZurueckgenommen: zurueck || undefined },
    ...(zurueck ? { vorher: { status: 'eingelassen' }, nachher: { status: 'gueltig' } } : {}),
  });
  return { zurueck };
}

/**
 * Falsche Vorstellung erwischt: Ticket auf die gescannte Vorstellung umbuchen (gleiche Kategorie, beste freie Plätze)
 * und gleich einlassen. Nur ohne Aufzahlung – ist die Zielvorstellung teurer, an die Kassa verweisen.
 */
export async function umbuchenAmEinlass(p: { code: string; showId: string; user: Nutzer; deviceId?: string }) {
  const c = codeAus(p.code);
  if (!c) throw new Error('Ungültiger Code.');
  const t = await db.ticket.findUnique({ where: { code: c.code }, include: { order: true, show: true } });
  if (!t) throw new Error('Ticket nicht gefunden.');
  if (t.showId === p.showId) throw new Error('Das Ticket gilt bereits für diese Vorstellung.');
  if (t.status !== 'gueltig') throw new Error(t.status === 'storniert' ? 'Das Ticket ist storniert.' : 'Das Ticket wurde bereits eingelassen.');
  const ziel = await db.show.findUniqueOrThrow({ where: { id: p.showId } });
  const kat = t.kat as Kat;
  const art = t.art === 'rollstuhl' ? 'normal' : t.art;
  const neuPreis = preis(ziel.prices as Preise, kat, art);
  if (neuPreis > t.priceCents) throw new Error(`Diese Vorstellung kostet ${formatEur(neuPreis - t.priceCents)} mehr – bitte an die Kassa verweisen.`);
  const seats = await bestePlaetze(p.showId, [{ kat, art, anzahl: 1 }]);
  const r = await umbuchen({ orderId: t.orderId, ticketIds: [t.id], showId: p.showId, seats, nachzahlung: 'bar', userId: p.user.id, fristIgnorieren: true, vorOrt: true });
  const neu = await db.ticket.findMany({ where: { orderId: r.neu.id, status: 'gueltig' } });
  await manuellEinlassen({ ticketIds: neu.map((x) => x.id), showId: p.showId, user: p.user, deviceId: p.deviceId, method: 'umbuchung' });
  return { bestellung: r.neu.number, plaetze: neu.map((x) => sitzName(x.seatId)), restGutschein: r.restGutschein, gutschein: r.voucherCode };
}
