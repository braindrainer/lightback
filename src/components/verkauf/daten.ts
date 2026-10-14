// Gemeinsame Abfragen für die Verkaufsseiten (nur serverseitig verwenden)
import { db } from '@/lib/db';
import { SITZE, sitzName, type Kat } from '@/lib/saal';
import { aufraeumen, platzStatus, type Status } from '@/lib/seats';

export type PlatzInfo = { orderId?: string; bestellung?: string; grund?: string; durch?: string };
export type PlatzDaten = { status: Record<string, Status>; info: Record<string, PlatzInfo> };

/** Status jedes Sitzes + Bestellung bzw. Sperrgrund */
export async function platzDaten(showId: string): Promise<PlatzDaten> {
  const status = await platzStatus(showId);
  const locks = await db.seatLock.findMany({ where: { showId, kind: { in: ['ticket', 'block'] } }, select: { seatId: true, kind: true, reason: true, ticketId: true } });
  const ids = locks.map((l) => l.ticketId).filter((x): x is string => !!x);
  const tickets = ids.length ? await db.ticket.findMany({ where: { id: { in: ids } }, select: { id: true, seatId: true, order: { select: { id: true, number: true } } } }) : [];
  const t = new Map(tickets.map((x) => [x.id, x]));
  const info: Record<string, PlatzInfo> = {};
  for (const l of locks) {
    if (l.kind === 'block') info[l.seatId] = { grund: l.reason ?? 'Sonstiges' };
    else if (l.ticketId && t.has(l.ticketId)) {
      const x = t.get(l.ticketId)!;
      info[l.seatId] = { orderId: x.order.id, bestellung: x.order.number, durch: x.seatId !== l.seatId ? sitzName(x.seatId) : undefined };
    }
  }
  return { status, info };
}

export const KAT_KAPAZITAET: Record<Kat, number> = { I: 0, II: 0, R: 0 };
for (const s of SITZE) KAT_KAPAZITAET[s.kat]++;
const KAT2 = SITZE.filter((s) => s.kat === 'II').map((s) => s.id);

export type Zahlen = { verkauft: number; eingelassen: number; belegt: number; gesperrt: number; reserviert: number; frei: number; umsatz: number };
const leer = (): Zahlen => ({ verkauft: 0, eingelassen: 0, belegt: 0, gesperrt: 0, reserviert: 0, frei: 0, umsatz: 0 });

/**
 * Auslastung vieler Vorstellungen mit zwei Abfragen (statt platzStatus je Vorstellung).
 * verkauft = Tickets (gültig + eingelassen); frei = Kapazität − alle belegten Sitze (inkl. Konfliktsitze).
 */
export async function auslastungListe(showIds: string[]) {
  const erg = new Map<string, { gesamt: Zahlen; jeKat: Record<Kat, Zahlen> }>();
  for (const id of showIds) erg.set(id, { gesamt: leer(), jeKat: { I: leer(), II: leer(), R: leer() } });
  if (!showIds.length) return erg;
  await aufraeumen();
  const [locks, tickets] = await Promise.all([
    db.$queryRaw<{ showId: string; kat: Kat; kind: string; n: number }[]>`
      SELECT "showId", CASE WHEN "seatId" LIKE 'R-%' THEN 'R' WHEN "seatId" = ANY(${KAT2}) THEN 'II' ELSE 'I' END AS kat, kind, count(*)::int AS n
      FROM "SeatLock" WHERE "showId" = ANY(${showIds}) GROUP BY 1, 2, 3`,
    db.ticket.groupBy({ by: ['showId', 'kat', 'status'], where: { showId: { in: showIds }, status: { not: 'storniert' } }, _count: { _all: true }, _sum: { priceCents: true } }),
  ]);
  for (const l of locks) {
    const e = erg.get(l.showId)!;
    for (const z of [e.gesamt, e.jeKat[l.kat]]) {
      z.belegt += l.n;
      if (l.kind === 'block') z.gesperrt += l.n;
      if (l.kind === 'hold') z.reserviert += l.n;
    }
  }
  for (const t of tickets) {
    const e = erg.get(t.showId)!;
    for (const z of [e.gesamt, e.jeKat[t.kat as Kat]]) {
      if (!z) continue;
      z.verkauft += t._count._all;
      if (t.status === 'eingelassen') z.eingelassen += t._count._all;
      z.umsatz += t._sum.priceCents ?? 0;
    }
  }
  for (const e of erg.values()) {
    for (const k of ['I', 'II', 'R'] as Kat[]) e.jeKat[k].frei = KAT_KAPAZITAET[k] - e.jeKat[k].belegt;
    e.gesamt.frei = e.jeKat.I.frei + e.jeKat.II.frei + e.jeKat.R.frei;
  }
  return erg;
}

/** Alle Datensätze derselben Person (gleiche E-Mail) – im Shop entsteht je Bestellung ein Datensatz */
export async function gleichePerson(id: string) {
  const c = await db.customer.findUniqueOrThrow({ where: { id } });
  if (!c.email) return [c];
  return db.customer.findMany({ where: { email: { equals: c.email, mode: 'insensitive' } } });
}
