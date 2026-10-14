// Umbuchung auf eine andere Vorstellung: alte Tickets gegen Gutschein stornieren, neue Plätze
// mit diesem Gutschein buchen. Ein Restbetrag wird bar, am Terminal oder per Rechnung kassiert.
import { db } from './db';
import { fmtDatum, fmtZeit } from './dates';
import { bestellungAnlegen, bezahlt, stornieren } from './orders';
import { freigeben, reservieren } from './seats';

export type Nachzahlung = 'bar' | 'terminal' | 'rechnung';

export async function umbuchen(p: { orderId: string; ticketIds?: string[]; showId: string; seats: { seatId: string; art: string }[]; nachzahlung: Nachzahlung; userId?: string; fristIgnorieren?: boolean }) {
  const alt = await db.order.findUniqueOrThrow({ where: { id: p.orderId }, include: { show: true } });
  const neueShow = await db.show.findUniqueOrThrow({ where: { id: p.showId } });
  // Zuerst die neuen Plätze sichern – sind sie weg, bleibt die alte Buchung unverändert
  const hold = await reservieren(p.showId, p.seats);
  let voucherCode: string | undefined;
  try {
    const storno = await stornieren({
      orderId: alt.id, ticketIds: p.ticketIds, methode: 'gutschein', grund: 'umbuchung', userId: p.userId, mail: false, fristIgnorieren: p.fristIgnorieren,
      notiz: `Umbuchung auf ${fmtDatum(neueShow.startsAt)} ${fmtZeit(neueShow.startsAt)}`,
    });
    if (storno.voucherId) voucherCode = (await db.voucher.findUniqueOrThrow({ where: { id: storno.voucherId } })).code;
  } catch (e) {
    await freigeben(hold.token);
    throw e;
  }
  try {
    const neu = await bestellungAnlegen({ holdToken: hold.token, customerId: alt.customerId ?? undefined, channel: 'telefon', voucherCode, createdById: p.userId, locale: alt.locale, note: `Umbuchung von ${alt.number}` });
    await db.order.update({ where: { id: neu.id }, data: { rebookedFromId: alt.id } });
    const offen = neu.totalCents - neu.voucherCents;
    await bezahlt(neu.id, offen > 0
      ? { provider: p.nachzahlung, providerRef: `umbuchung-${alt.number}`, amountCents: offen }
      : { provider: 'gutschein', providerRef: voucherCode ?? '', amountCents: 0 });
    const v = voucherCode ? await db.voucher.findUnique({ where: { code: voucherCode } }) : null;
    return { neu: await db.order.findUniqueOrThrow({ where: { id: neu.id } }), voucherCode, restGutschein: v?.remainingCents ?? 0, nachzahlung: Math.max(0, offen) };
  } catch (e) {
    await freigeben(hold.token);
    throw new Error(`Die alten Tickets sind storniert${voucherCode ? ` (Gutschein ${voucherCode})` : ''}, die neue Buchung ist fehlgeschlagen: ${(e as Error).message}`);
  }
}
