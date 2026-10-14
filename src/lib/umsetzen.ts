// Vor-Ort-Korrekturen an einem Ticket: anderen Platz zuweisen (Umsetzen) und/oder Tarif ändern (ermäßigt → Vollpreis).
// Der neue Platz wird über SeatLock (showId, seatId) gesperrt – der eindeutige Schlüssel verhindert Doppelvergabe.
// Preisunterschied nach den Listenpreisen der Vorstellung:
//   höher  → Aufpreis an der Kassa (Kassabeleg, Erlös 13 % auf 4000, siehe kassa.aufpreisKassieren) oder Kulanz (nur Leitung)
//   tiefer → standardmäßig kein Ausgleich; optional Gutschein über die Differenz (gebucht wie ein Storno als Gutschein,
//            der Ticketpreis sinkt entsprechend, damit die Leistungsabgrenzung stimmt)
import { Prisma } from '@prisma/client';
import { protokoll } from './audit';
import { hat, type Nutzer } from './auth';
import { db } from './db';
import { aufpreisKassieren, type Zahlart } from './kassa';
import { bucheStorno } from './ledger';
import { formatEur } from './money';
import { neuerCode } from './tickets';
import { preis, SITZ, sitzName, type Kat, type Preise } from './saal';
import { cacheVerwerfen, PlatzBelegt, zuSperren } from './seats';

export type Aenderung = {
  ticketId: string;
  /** neuer Platz (leer = Platz bleibt) */
  seatId?: string;
  /** neuer Tarif in Kat. I/II (leer = wie bisher; Rollstuhl und Freikarte bleiben) */
  art?: 'normal' | 'ermaessigt';
  /** Ausgleich bei günstigerem Ziel */
  ausgleich?: 'keine' | 'gutschein';
  /** Aufpreis erlassen (nur Leitung) */
  kulanz?: boolean;
  /** Aufpreis an der Kassa kassieren */
  kassa?: { registerId: string; sessionId: string; payment: Zahlart; givenCents?: number | null };
  grund?: string;
};

/** Vorschau: neuer Platz/Tarif und Preisunterschied (für Formulare und Prüfung) */
export async function vorschau(p: Pick<Aenderung, 'ticketId' | 'seatId' | 'art'>) {
  const t = await db.ticket.findUniqueOrThrow({ where: { id: p.ticketId }, include: { show: true, order: true } });
  const seatId = p.seatId ?? t.seatId;
  if (!SITZ[seatId]) throw new Error('Unbekannter Platz');
  const kat = SITZ[seatId].kat as Kat;
  const art = t.art === 'frei' ? 'frei' : kat === 'R' ? 'rollstuhl' : (p.art ?? (t.art === 'rollstuhl' ? 'normal' : t.art));
  const prices = t.show.prices as Preise;
  const diff = preis(prices, kat, art) - preis(prices, t.kat as Kat, t.art);
  return { t, seatId, kat, art, diff };
}

export async function ticketAendern(p: Aenderung, user: Nutzer) {
  const { t, seatId, kat, art, diff } = await vorschau(p);
  if (t.status === 'storniert') throw new Error('Das Ticket ist storniert.');
  if (!['bezahlt', 'teilstorniert'].includes(t.order.status)) throw new Error('Die Bestellung ist nicht bezahlt.');
  if (t.show.status === 'abgesagt') throw new Error('Die Vorstellung ist abgesagt.');
  const ende = t.show.startsAt.getTime() + t.show.durationMin * 60e3;
  if (Date.now() > ende) throw new Error('Die Vorstellung ist vorbei.');
  const platzNeu = seatId !== t.seatId;
  if (!platzNeu && art === t.art) throw new Error('Es ändert sich nichts – bitte einen anderen Platz oder Tarif wählen.');
  if (diff > 0 && !p.kassa && !p.kulanz) throw new Error(`Aufpreis ${formatEur(diff)} – bitte an der Kassa kassieren oder (Leitung) als Kulanz erlassen.`);
  if (p.kulanz && diff > 0 && !hat(user, 'leitung')) throw new Error('Einen Aufpreis erlassen darf nur die Leitung.');
  const gutschein = diff < 0 && p.ausgleich === 'gutschein' ? Math.min(-diff, t.priceCents) : 0;
  if (gutschein && !hat(user, 'leitung', 'kassa')) throw new Error('Einen Gutschein über die Differenz stellen Leitung oder Kassa aus.');

  const vorher = { seatId: t.seatId, platz: sitzName(t.seatId), kat: t.kat, art: t.art, priceCents: t.priceCents };
  const nachher = { seatId, platz: sitzName(seatId), kat, art, priceCents: t.priceCents - gutschein };

  // 1. Platz und Tarif umstellen (alte Sperren weg, neue anlegen – alles oder nichts)
  if (platzNeu) {
    const neu = zuSperren([seatId]);
    // abgelaufene Warenkorb-Reservierungen blockieren nicht
    await db.seatLock.deleteMany({ where: { showId: t.showId, seatId: { in: neu }, kind: 'hold', expiresAt: { lt: new Date() } } });
    try {
      await db.$transaction(async (tx) => {
        await tx.seatLock.deleteMany({ where: { ticketId: t.id } });
        await tx.seatLock.createMany({ data: neu.map((s) => ({ showId: t.showId, seatId: s, kind: 'ticket', ticketId: t.id })) });
        await tx.ticket.update({ where: { id: t.id }, data: { seatId, kat, art } });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const belegt = await db.seatLock.findMany({ where: { showId: t.showId, seatId: { in: neu }, NOT: { ticketId: t.id } }, select: { seatId: true } });
        throw new PlatzBelegt(belegt.map((b) => b.seatId));
      }
      throw e;
    }
  } else {
    await db.ticket.update({ where: { id: t.id }, data: { art } });
  }
  cacheVerwerfen(t.showId);

  // 2. Aufpreis kassieren – schlägt der Beleg fehl, Änderung zurücknehmen
  let beleg: { id: string; number: number; totalCents: number } | null = null;
  if (diff > 0 && p.kassa && !p.kulanz) {
    try {
      beleg = await aufpreisKassieren({
        ...p.kassa, user,
        position: {
          name: platzNeu ? `Aufpreis Kategorie ${kat === 'R' ? 'Rollstuhl' : kat} (${sitzName(seatId)}, vorher ${sitzName(t.seatId)})` : `Aufpreis Vollpreis statt ermäßigt (${sitzName(seatId)})`,
          quantity: 1, unitCents: diff, vatRate: 13, category: 'ticket-aufpreis', ticketIds: [t.id],
          aufpreis: { ticketId: t.id, artVorher: t.art, artNachher: art, seatVorher: t.seatId, seatNachher: seatId },
        },
      });
    } catch (e) {
      await zuruecksetzen(t.id, t.showId, vorher.seatId, vorher.kat, vorher.art).catch((x) => console.error('umsetzen zurück', x));
      throw e;
    }
  }

  // 3. Gutschein über die Differenz (günstigere Kategorie)
  let voucher: { id: string; code: string; valueCents: number } | null = null;
  if (gutschein) {
    voucher = await db.$transaction(async (tx) => {
      const nachLeistung = !!(await tx.journalEntry.findFirst({ where: { source: 'leistung', sourceId: t.showId }, select: { id: true } }));
      const v = await tx.voucher.create({ data: { code: `LOC-${neuerCode(8)}`, kind: 'wert', issuer: 'storno', valueCents: gutschein, remainingCents: gutschein, validUntil: new Date(Date.now() + 3 * 365 * 864e5), note: `Umsetzen ${t.code} (${t.order.number})` } });
      await tx.ticket.update({ where: { id: t.id }, data: { priceCents: { decrement: gutschein } } });
      await bucheStorno(tx, { id: `umsetzen-${t.id}-${v.id}`, date: new Date(), orderNumber: t.order.number, bruttoCents: gutschein, feeCents: 0, method: 'gutschein', provider: '', nachLeistung });
      return v;
    });
  }

  await protokoll({
    user, action: platzNeu ? 'ticket_umgesetzt' : 'ticket_tarif_geaendert', entity: 'ticket', entityId: t.id,
    data: { code: t.code, bestellung: t.order.number, orderId: t.orderId, differenzCents: diff, aufpreisBeleg: beleg?.id, kulanz: (p.kulanz && diff > 0) || undefined, gutschein: voucher?.code, grund: p.grund || undefined },
    vorher, nachher,
  });
  if (voucher) await protokoll({ user, action: 'gutschein_ausgestellt', entity: 'voucher', entityId: voucher.id, data: { herkunft: 'umsetzen', ticket: t.code, bestellung: t.order.number }, nachher: { code: voucher.code, valueCents: voucher.valueCents } });
  return { diff, beleg, voucher, platz: sitzName(seatId), art };
}

async function zuruecksetzen(ticketId: string, showId: string, seatId: string, kat: string, art: string) {
  await db.$transaction(async (tx) => {
    await tx.seatLock.deleteMany({ where: { ticketId } });
    await tx.seatLock.createMany({ data: zuSperren([seatId]).map((s) => ({ showId, seatId: s, kind: 'ticket', ticketId })) });
    await tx.ticket.update({ where: { id: ticketId }, data: { seatId, kat, art } });
  });
  cacheVerwerfen(showId);
}
