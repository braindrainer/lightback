// Umbuchung auf eine andere Vorstellung: alte Tickets gegen Gutschein stornieren, neue Plätze
// mit diesem Gutschein buchen. Ein Restbetrag wird bar, am Terminal oder per Rechnung kassiert.
import { protokoll, protokollMehrere } from './audit';
import { db } from './db';
import { fmtDatum, fmtZeit } from './dates';
import { bestellungAnlegen, bezahlt, stornieren } from './orders';
import { sitzName } from './saal';
import { freigeben, reservieren } from './seats';

export type Nachzahlung = 'bar' | 'terminal' | 'rechnung';

export async function umbuchen(p: { orderId: string; ticketIds?: string[]; showId: string; seats: { seatId: string; art: string }[]; nachzahlung: Nachzahlung; userId?: string; fristIgnorieren?: boolean; vorOrt?: boolean; channel?: string; akteur?: string }) {
  const wer = p.akteur ? { user: null, akteur: p.akteur } : {};
  const alt = await db.order.findUniqueOrThrow({ where: { id: p.orderId }, include: { show: true, tickets: true } });
  const altTickets = alt.tickets.filter((t) => t.status === 'gueltig' && (!p.ticketIds || p.ticketIds.includes(t.id)));
  const neueShow = await db.show.findUniqueOrThrow({ where: { id: p.showId } });
  // Zuerst die neuen Plätze sichern – sind sie weg, bleibt die alte Buchung unverändert
  const hold = await reservieren(p.showId, p.seats, { vorOrt: p.vorOrt });
  let voucherCode: string | undefined;
  try {
    const storno = await stornieren({
      orderId: alt.id, ticketIds: p.ticketIds, methode: 'gutschein', grund: 'umbuchung', userId: p.userId, mail: false, fristIgnorieren: p.fristIgnorieren, akteur: p.akteur,
      notiz: `Umbuchung auf ${fmtDatum(neueShow.startsAt)} ${fmtZeit(neueShow.startsAt)}`,
    });
    if (storno.voucherId) voucherCode = (await db.voucher.findUniqueOrThrow({ where: { id: storno.voucherId } })).code;
  } catch (e) {
    await freigeben(hold.token);
    throw e;
  }
  try {
    const neu = await bestellungAnlegen({ holdToken: hold.token, customerId: alt.customerId ?? undefined, channel: p.channel ?? 'telefon', voucherCode, createdById: p.userId, locale: alt.locale, note: `Umbuchung von ${alt.number}` });
    await db.order.update({ where: { id: neu.id }, data: { rebookedFromId: alt.id } });
    const offen = neu.totalCents - neu.voucherCents;
    await bezahlt(neu.id, offen > 0
      ? { provider: p.nachzahlung, providerRef: `umbuchung-${alt.number}`, amountCents: offen }
      : { provider: 'gutschein', providerRef: voucherCode ?? '', amountCents: 0 });
    const v = voucherCode ? await db.voucher.findUnique({ where: { code: voucherCode } }) : null;
    const neueTickets = await db.ticket.findMany({ where: { orderId: neu.id }, select: { id: true, code: true, seatId: true } });
    const vorher = { vorstellung: alt.show.startsAt, plaetze: altTickets.map((t) => sitzName(t.seatId)), tickets: altTickets.map((t) => t.code) };
    const nachher = { vorstellung: neueShow.startsAt, plaetze: neueTickets.map((t) => sitzName(t.seatId)), tickets: neueTickets.map((t) => t.code), bestellung: neu.number };
    await protokollMehrere([
      { ...wer, action: 'umbuchung', entity: 'order', entityId: alt.id, data: { alteShowId: alt.showId, neueShowId: neueShow.id, neueBestellung: neu.number, neueOrderId: neu.id, gutschein: voucherCode, nachzahlungCents: Math.max(0, offen), nachzahlung: offen > 0 ? p.nachzahlung : undefined, restGutscheinCents: v?.remainingCents ?? 0, fristIgnoriert: p.fristIgnorieren || undefined }, vorher, nachher },
      { ...wer, action: 'umbuchung_von', entity: 'order', entityId: neu.id, data: { alteBestellung: alt.number, alteOrderId: alt.id, gutschein: voucherCode }, vorher, nachher },
    ]);
    return { neu: await db.order.findUniqueOrThrow({ where: { id: neu.id } }), voucherCode, restGutschein: v?.remainingCents ?? 0, nachzahlung: Math.max(0, offen) };
  } catch (e) {
    await freigeben(hold.token);
    await protokoll({ ...wer, action: 'umbuchung_fehlgeschlagen', entity: 'order', entityId: alt.id, data: { fehler: (e as Error).message, gutschein: voucherCode, zielShowId: p.showId, plaetze: p.seats.map((s) => sitzName(s.seatId)) } });
    throw new Error(`Die alten Tickets sind storniert${voucherCode ? ` (Gutschein ${voucherCode})` : ''}, die neue Buchung ist fehlgeschlagen: ${(e as Error).message}`);
  }
}
