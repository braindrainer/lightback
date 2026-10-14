// Platzverfügbarkeit, Warenkorb-Reservierungen und Sperren.
// Doppelverkauf verhindert der eindeutige Schlüssel SeatLock(showId, seatId).
// Lesen schreibt nicht: abgelaufene Reservierungen werden beim Lesen ignoriert und
// vom Cron bzw. höchstens alle 30 s nebenbei gelöscht.
import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from './db';
import { SITZ, SITZE, type Kat } from './saal';

export const HOLD_MIN = 15;
export const VERLAENGERUNG_MIN = 10;
export const MAX_VERLAENGERUNGEN = 2;
export const MAX_TICKETS = 10;

/** Sperre gilt, wenn sie nicht abläuft (Ticket, Sperre) oder noch nicht abgelaufen ist */
export const aktiv = (jetzt = new Date()): Prisma.SeatLockWhereInput => ({ OR: [{ expiresAt: null }, { expiresAt: { gt: jetzt } }] });

/**
 * Abgelaufene Reservierungen freigeben. Die Sperren gehen sofort weg; die Reservierung selbst bleibt
 * erhalten, solange eine offene Bestellung darauf zeigt (Zahlung läuft noch – siehe orders.bezahlt).
 */
export async function aufraeumen() {
  const jetzt = new Date();
  await db.seatLock.deleteMany({ where: { kind: 'hold', expiresAt: { lt: jetzt } } });
  const inZahlung = (await db.order.findMany({ where: { status: 'offen', holdId: { not: null } }, select: { holdId: true } })).map((o) => o.holdId!);
  await db.hold.deleteMany({ where: { OR: [{ expiresAt: { lt: jetzt }, id: { notIn: inZahlung } }, { expiresAt: { lt: new Date(jetzt.getTime() - 2 * 3600e3) } }] } });
  cacheVerwerfen();
}

let zuletztAufgeraeumt = 0;
/** Nebenbei aufräumen, höchstens alle 30 s je Prozess, ohne auf das Ergebnis zu warten */
export function gelegentlichAufraeumen() {
  if (Date.now() - zuletztAufgeraeumt < 30_000) return;
  zuletztAufgeraeumt = Date.now();
  aufraeumen().catch((e) => console.error('aufraeumen', e));
}

export type Status = 'frei' | 'reserviert' | 'verkauft' | 'gesperrt' | 'eingelassen';

/** Status aller Sitze einer Vorstellung (inkl. Sperren durch Rollstuhl-/Zusatzsitz-Konflikte) */
export async function platzStatus(showId: string): Promise<Record<string, Status>> {
  gelegentlichAufraeumen();
  const [locks, ein] = await Promise.all([
    db.seatLock.findMany({ where: { showId, ...aktiv() }, select: { seatId: true, kind: true } }),
    db.ticket.findMany({ where: { showId, status: 'eingelassen' }, select: { seatId: true } }),
  ]);
  const eingelassen = new Set(ein.map((t) => t.seatId));
  const st: Record<string, Status> = {};
  for (const s of SITZE) st[s.id] = 'frei';
  for (const l of locks) st[l.seatId] = l.kind === 'hold' ? 'reserviert' : l.kind === 'block' ? 'gesperrt' : eingelassen.has(l.seatId) ? 'eingelassen' : 'verkauft';
  // Rollstuhlplatz ist weg, sobald einer der beiden Zusatzsitze am Stellplatz vergeben ist
  for (const s of SITZE) if (s.rollstuhl && st[s.id] === 'frei' && (st[`0-${2 * s.stellplatz! - 1}`] !== 'frei' || st[`0-${2 * s.stellplatz!}`] !== 'frei')) st[s.id] = 'gesperrt';
  return st;
}

// ───────── Kurzzeit-Cache für den Sitzstatus (Shop fragt alle 5–10 s) ─────────
const CACHE_MS = 2000;
const cache = new Map<string, { at: number; status: Record<string, Status>; etag: string }>();
export function cacheVerwerfen(showId?: string) {
  if (showId) cache.delete(showId);
  else cache.clear();
}
const laufend = new Map<string, Promise<{ at: number; status: Record<string, Status>; etag: string }>>();
export async function platzStatusGecacht(showId: string) {
  const c = cache.get(showId);
  if (c && Date.now() - c.at < CACHE_MS) return c;
  // Gleichzeitige Anfragen teilen sich eine Datenbankabfrage
  let p = laufend.get(showId);
  if (!p) {
    p = platzStatus(showId).then((status) => {
      const neu = { at: Date.now(), status, etag: createHash('sha1').update(JSON.stringify(status)).digest('base64url').slice(0, 20) };
      cache.set(showId, neu);
      return neu;
    }).finally(() => laufend.delete(showId));
    laufend.set(showId, p);
  }
  return p;
}

export async function auslastung(showId: string) {
  const st = await platzStatus(showId);
  const z = { frei: 0, reserviert: 0, verkauft: 0, gesperrt: 0, eingelassen: 0 } as Record<Status, number>;
  const jeKat: Record<Kat, Record<Status, number>> = { I: { ...z }, II: { ...z }, R: { ...z } };
  for (const [id, s] of Object.entries(st)) {
    z[s]++;
    jeKat[SITZ[id].kat][s]++;
  }
  return { gesamt: z, jeKat };
}

/**
 * Alle Sitz-IDs, die für diese Auswahl gesperrt werden: Sitz + bei Rollstuhlplätzen die beiden Zusatzsitze.
 * Zusatzsitze sperren den Rollstuhlplatz nicht selbst – das ergibt sich, weil der Rollstuhlplatz beide
 * Zusatzsitze braucht. So können zwei Kund:innen die beiden Zusatzsitze eines Stellplatzes getrennt kaufen.
 */
export function zuSperren(seatIds: string[]): string[] {
  return [...new Set(seatIds.flatMap((id) => (SITZ[id]?.rollstuhl ? [id, `0-${2 * SITZ[id].stellplatz! - 1}`, `0-${2 * SITZ[id].stellplatz!}`] : [id])))];
}

export class PlatzBelegt extends Error { constructor(public seats: string[]) { super('Platz nicht mehr frei'); } }
export class ReservierungAbgelaufen extends Error { constructor() { super('Die Reservierung ist abgelaufen'); } }

/** Unter Last warten Transaktionen länger auf eine freie Verbindung statt sofort abzubrechen */
export const TX_OPT = { maxWait: 10_000, timeout: 15_000 };

const istDoppelt = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/** Abgelaufene Reservierungen löschen, die diese Sitze noch blockieren. true = es wurde etwas frei. */
async function abgelaufeneLoesen(showId: string, seatIds: string[]) {
  const n = await db.seatLock.deleteMany({ where: { showId, seatId: { in: seatIds }, kind: 'hold', expiresAt: { lt: new Date() } } });
  return n.count > 0;
}
async function belegteSitze(showId: string, seatIds: string[], ohneHold?: string) {
  const b = await db.seatLock.findMany({ where: { showId, seatId: { in: seatIds }, ...aktiv(), ...(ohneHold ? { NOT: { holdId: ohneHold } } : {}) }, select: { seatId: true } });
  return b.map((x) => x.seatId);
}

/** Einmal versuchen; bei Konflikt mit abgelaufener Reservierung diese löschen und ein zweites Mal versuchen */
async function mitWiederholung<T>(showId: string, seatIds: string[], f: () => Promise<T>, ohneHold?: string): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if (!istDoppelt(e)) throw e;
    if (await abgelaufeneLoesen(showId, seatIds)) {
      try { return await f(); } catch (e2) { if (!istDoppelt(e2)) throw e2; }
    }
    throw new PlatzBelegt(await belegteSitze(showId, seatIds, ohneHold));
  }
}

async function showPruefen(showId: string) {
  const show = await db.show.findUnique({ where: { id: showId }, select: { status: true, startsAt: true } });
  if (!show || show.status !== 'verkauf' || show.startsAt < new Date()) throw new Error('Für diese Vorstellung ist kein Verkauf möglich');
}

/** Reservierung anlegen (alle Sitze oder keiner) */
export async function reservieren(showId: string, seats: { seatId: string; art: string }[]) {
  if (!seats.length || seats.length > MAX_TICKETS) throw new Error(`1 bis ${MAX_TICKETS} Plätze`);
  for (const s of seats) if (!SITZ[s.seatId]) throw new Error(`Unbekannter Platz ${s.seatId}`);
  await showPruefen(showId);
  gelegentlichAufraeumen();
  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + HOLD_MIN * 60e3);
  const ids = zuSperren(seats.map((s) => s.seatId));
  const hold = await mitWiederholung(showId, ids, () => db.$transaction(async (tx) => {
    const h = await tx.hold.create({ data: { token, showId, seats, expiresAt } });
    await tx.seatLock.createMany({ data: ids.map((seatId) => ({ showId, seatId, kind: 'hold', holdId: h.id, expiresAt })) });
    return h;
  }, TX_OPT));
  cacheVerwerfen(showId);
  return hold;
}

/**
 * Reservierung ändern: Plätze hinzufügen/entfernen, Ticketart ändern – atomar.
 * Ergebnis: neue Reservierung oder null, wenn danach kein Platz mehr übrig ist (dann gelöscht).
 */
export async function holdAendern(token: string, p: { add?: { seatId: string; art: string }[]; remove?: string[]; art?: Record<string, string> }) {
  const h0 = await db.hold.findUnique({ where: { token } });
  if (!h0 || h0.expiresAt < new Date()) throw new ReservierungAbgelaufen();
  await showPruefen(h0.showId);
  for (const s of p.add ?? []) if (!SITZ[s.seatId]) throw new Error(`Unbekannter Platz ${s.seatId}`);
  const neueIds = zuSperren((p.add ?? []).map((s) => s.seatId));
  const erg = await mitWiederholung(h0.showId, neueIds, () => db.$transaction(async (tx) => {
    // Zeile sperren, damit parallele Änderungen derselben Reservierung nacheinander laufen
    await tx.$queryRaw`SELECT id FROM "Hold" WHERE id = ${h0.id} FOR UPDATE`;
    const h = await tx.hold.findUnique({ where: { id: h0.id } });
    if (!h || h.expiresAt < new Date()) throw new ReservierungAbgelaufen();
    let seats = (h.seats as { seatId: string; art: string }[]).filter((s) => !(p.remove ?? []).includes(s.seatId));
    const weg = zuSperren((h.seats as { seatId: string }[]).map((s) => s.seatId).filter((id) => !seats.some((s) => s.seatId === id)));
    const dazu = (p.add ?? []).filter((a) => !seats.some((s) => s.seatId === a.seatId));
    seats = [...seats, ...dazu];
    if (p.art) seats = seats.map((s) => (p.art![s.seatId] ? { ...s, art: p.art![s.seatId] } : s));
    if (seats.length > MAX_TICKETS) throw new Error(`Höchstens ${MAX_TICKETS} Plätze je Reservierung`);
    if (weg.length) await tx.seatLock.deleteMany({ where: { holdId: h.id, seatId: { in: weg } } });
    if (!seats.length) {
      await tx.hold.delete({ where: { id: h.id } });
      return null;
    }
    const vorhanden = new Set((await tx.seatLock.findMany({ where: { holdId: h.id }, select: { seatId: true } })).map((l) => l.seatId));
    const neu = zuSperren(dazu.map((s) => s.seatId)).filter((id) => !vorhanden.has(id));
    if (neu.length) await tx.seatLock.createMany({ data: neu.map((seatId) => ({ showId: h.showId, seatId, kind: 'hold', holdId: h.id, expiresAt: h.expiresAt })) });
    return tx.hold.update({ where: { id: h.id }, data: { seats } });
  }, TX_OPT), h0.id);
  cacheVerwerfen(h0.showId);
  return erg;
}

export async function verlaengern(token: string) {
  const h = await db.hold.findUnique({ where: { token } });
  if (!h || h.expiresAt < new Date()) throw new Error('Reservierung abgelaufen');
  if (h.extensions >= MAX_VERLAENGERUNGEN) throw new Error('Nicht weiter verlängerbar');
  const expiresAt = new Date(h.expiresAt.getTime() + VERLAENGERUNG_MIN * 60e3);
  await db.$transaction([db.hold.update({ where: { id: h.id }, data: { expiresAt, extensions: { increment: 1 } } }), db.seatLock.updateMany({ where: { holdId: h.id }, data: { expiresAt } })]);
  return expiresAt;
}

export async function freigeben(token: string) {
  const h = await db.hold.findUnique({ where: { token }, select: { id: true, showId: true } });
  if (!h) return;
  await db.hold.deleteMany({ where: { id: h.id } });
  cacheVerwerfen(h.showId);
}

/**
 * Für die Zahlung: Sind die Plätze der Reservierung noch gesperrt? Falls die Reservierung inzwischen
 * abgelaufen ist, dieselben Plätze erneut sperren, wenn sie noch frei sind. false = vergeben.
 */
export async function holdSichern(holdId: string): Promise<boolean> {
  const h = await db.hold.findUnique({ where: { id: holdId } });
  if (!h) return false;
  const ids = zuSperren((h.seats as { seatId: string }[]).map((s) => s.seatId));
  const jetzt = new Date();
  if (h.expiresAt > jetzt && (await db.seatLock.count({ where: { holdId } })) === ids.length) return true;
  const bis = new Date(jetzt.getTime() + 10 * 60e3);
  try {
    await mitWiederholung(h.showId, ids, () => db.$transaction(async (tx) => {
      await tx.seatLock.deleteMany({ where: { holdId } });
      await tx.seatLock.createMany({ data: ids.map((seatId) => ({ showId: h.showId, seatId, kind: 'hold', holdId, expiresAt: bis })) });
      await tx.hold.update({ where: { id: holdId }, data: { expiresAt: bis } });
    }, TX_OPT), holdId);
    cacheVerwerfen(h.showId);
    return true;
  } catch (e) {
    if (e instanceof PlatzBelegt) return false;
    throw e;
  }
}

/** Sitze sperren (Presse, Technik, Kontingent) */
export async function sperren(showId: string, seatIds: string[], reason: string) {
  await abgelaufeneLoesen(showId, seatIds);
  await db.seatLock.createMany({ data: seatIds.map((seatId) => ({ showId, seatId, kind: 'block', reason })), skipDuplicates: true });
  cacheVerwerfen(showId);
}
export async function entsperren(showId: string, seatIds: string[]) {
  await db.seatLock.deleteMany({ where: { showId, seatId: { in: seatIds }, kind: 'block' } });
  cacheVerwerfen(showId);
}
