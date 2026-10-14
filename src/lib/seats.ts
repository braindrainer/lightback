// Platzverfügbarkeit, Warenkorb-Reservierungen und Sperren.
// Doppelverkauf verhindert der eindeutige Schlüssel SeatLock(showId, seatId).
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from './db';
import { konflikte, SITZ, SITZE, type Kat } from './saal';

export const HOLD_MIN = 15;
export const VERLAENGERUNG_MIN = 10;
export const MAX_VERLAENGERUNGEN = 2;
export const MAX_TICKETS = 10;

/** Abgelaufene Reservierungen freigeben */
export async function aufraeumen() {
  await db.hold.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}

export type Status = 'frei' | 'reserviert' | 'verkauft' | 'gesperrt' | 'eingelassen';

/** Status aller Sitze einer Vorstellung (inkl. Sperren durch Rollstuhl-/Zusatzsitz-Konflikte) */
export async function platzStatus(showId: string): Promise<Record<string, Status>> {
  await aufraeumen();
  const locks = await db.seatLock.findMany({ where: { showId }, select: { seatId: true, kind: true, ticketId: true } });
  const eingelassen = new Set((await db.ticket.findMany({ where: { showId, status: 'eingelassen' }, select: { seatId: true } })).map((t) => t.seatId));
  const st: Record<string, Status> = {};
  for (const s of SITZE) st[s.id] = 'frei';
  for (const l of locks) st[l.seatId] = l.kind === 'hold' ? 'reserviert' : l.kind === 'block' ? 'gesperrt' : eingelassen.has(l.seatId) ? 'eingelassen' : 'verkauft';
  return st;
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

/** Alle Sitz-IDs, die für diese Auswahl gesperrt werden (Sitz + Konflikte) */
export function zuSperren(seatIds: string[]): string[] {
  return [...new Set(seatIds.flatMap((id) => [id, ...konflikte(id)]))];
}

export class PlatzBelegt extends Error { constructor(public seats: string[]) { super('Platz nicht mehr frei'); } }

/** Reservierung anlegen (alle Sitze oder keiner) */
export async function reservieren(showId: string, seats: { seatId: string; art: string }[]) {
  if (!seats.length || seats.length > MAX_TICKETS) throw new Error(`1 bis ${MAX_TICKETS} Plätze`);
  for (const s of seats) if (!SITZ[s.seatId]) throw new Error(`Unbekannter Platz ${s.seatId}`);
  const show = await db.show.findUnique({ where: { id: showId } });
  if (!show || show.status !== 'verkauf' || show.startsAt < new Date()) throw new Error('Für diese Vorstellung ist kein Verkauf möglich');
  await aufraeumen();
  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + HOLD_MIN * 60e3);
  try {
    return await db.$transaction(async (tx) => {
      const hold = await tx.hold.create({ data: { token, showId, seats, expiresAt } });
      await tx.seatLock.createMany({ data: zuSperren(seats.map((s) => s.seatId)).map((seatId) => ({ showId, seatId, kind: 'hold', holdId: hold.id, expiresAt })) });
      return hold;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const belegt = await db.seatLock.findMany({ where: { showId, seatId: { in: zuSperren(seats.map((s) => s.seatId)) } }, select: { seatId: true } });
      throw new PlatzBelegt(belegt.map((b) => b.seatId));
    }
    throw e;
  }
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
  await db.hold.deleteMany({ where: { token } });
}

/** Sitze sperren (Presse, Technik, Kontingent) */
export async function sperren(showId: string, seatIds: string[], reason: string) {
  await db.seatLock.createMany({ data: seatIds.map((seatId) => ({ showId, seatId, kind: 'block', reason })), skipDuplicates: true });
}
export async function entsperren(showId: string, seatIds: string[]) {
  await db.seatLock.deleteMany({ where: { showId, seatId: { in: seatIds }, kind: 'block' } });
}

/** Reservierung einer offenen Bestellung (Rechnung, Zahlungslink) bis zu einem Zeitpunkt halten */
export async function haltenBis(holdId: string, bis: Date) {
  await db.$transaction([db.hold.update({ where: { id: holdId }, data: { expiresAt: bis } }), db.seatLock.updateMany({ where: { holdId }, data: { expiresAt: bis } })]);
}
