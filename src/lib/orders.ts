// Bestellablauf: Reservierung → Bestellung → Zahlung → Tickets, Rechnung, Buchung, E-Mail.
// Storno (ganz oder einzelne Tickets), Umbuchung und Absage einer Vorstellung.
import type { Prisma } from '@prisma/client';
import { db, getSettings } from './db';
import { fmtDatum, fmtZeit } from './dates';
import { renderNumber, nextSequence } from './invoice-calc';
import { bucheGutscheinverkauf, bucheStorno, bucheTicketverkauf, zerlegen } from './ledger';
import { fussText, fuellen, layout, senden, vorlage, type Anhang } from './mail';
import { formatEur } from './money';
import { erstatten } from './payments';
import { preis, SITZ, sitzName, TICKET_UST, type Kat, type Preise } from './saal';
import { zuSperren } from './seats';
import { neuerCode, qrInhalt, qrPng } from './tickets';

type Tx = Prisma.TransactionClient;
export type KundeEingabe = { email: string; firstName: string; lastName: string; phone?: string; company?: string; vatId?: string; street?: string; zip?: string; city?: string; country?: string; newsletter?: boolean; locale?: string };

/** Kulanz laut AGB: Storno/Umbuchung bis 24 h vor Beginn */
export const STORNO_FRIST_H = 24;
export const stornoMoeglich = (startsAt: Date, jetzt = new Date()) => startsAt.getTime() - jetzt.getTime() >= STORNO_FRIST_H * 3600e3;

async function bestellnummer(tx: Tx) {
  const s = await tx.settings.findUniqueOrThrow({ where: { id: 1 } });
  const jahr = new Date().getFullYear();
  const prefix = `${s.orderPrefix}-${jahr}-`;
  const letzte = await tx.order.findFirst({ where: { number: { startsWith: prefix } }, orderBy: { number: 'desc' }, select: { number: true } });
  const n = letzte ? Number(letzte.number.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(6, '0')}`;
}

async function kundeAnlegen(tx: Tx, k: KundeEingabe) {
  return tx.customer.create({ data: { ...k, email: k.email.trim().toLowerCase(), newsletter: !!k.newsletter, locale: k.locale ?? 'de' } });
}

/** Ticketpositionen aus einer Reservierung samt Preisen */
export function positionen(seats: { seatId: string; art: string }[], prices: Preise) {
  return seats.map((s) => {
    const kat = SITZ[s.seatId].kat as Kat;
    const art = kat === 'R' ? 'rollstuhl' : s.art === 'ermaessigt' ? 'ermaessigt' : s.art === 'frei' ? 'frei' : 'normal';
    return { seatId: s.seatId, kat, art, priceCents: preis(prices, kat, art) };
  });
}

/** Bestellung aus einer Reservierung anlegen (noch unbezahlt). Gutschein wird hier nur geprüft. */
export async function bestellungAnlegen(p: { holdToken: string; kunde?: KundeEingabe; customerId?: string; channel?: string; partnerId?: string; partnerRef?: string; voucherCode?: string; createdById?: string; locale?: string; note?: string }) {
  const hold = await db.hold.findUnique({ where: { token: p.holdToken } });
  if (!hold || hold.expiresAt < new Date()) throw new Error('Die Reservierung ist abgelaufen. Bitte wählen Sie die Plätze erneut.');
  const show = await db.show.findUniqueOrThrow({ where: { id: hold.showId } });
  const pos = positionen(hold.seats as { seatId: string; art: string }[], show.prices as Preise);
  const total = pos.reduce((s, x) => s + x.priceCents, 0);
  let voucherCents = 0;
  if (p.voucherCode) {
    const v = await gutscheinPruefen(p.voucherCode);
    voucherCents = Math.min(v.remainingCents, total);
  }
  return db.$transaction(async (tx) => {
    const kunde = p.kunde ? await kundeAnlegen(tx, p.kunde) : null;
    // Reservierung für die Dauer der Zahlung verlängern
    const bis = new Date(Math.max(hold.expiresAt.getTime(), Date.now() + 10 * 60e3));
    await tx.hold.update({ where: { id: hold.id }, data: { expiresAt: bis } });
    await tx.seatLock.updateMany({ where: { holdId: hold.id }, data: { expiresAt: bis } });
    return tx.order.create({
      data: {
        number: await bestellnummer(tx), channel: p.channel ?? 'web', showId: show.id, customerId: kunde?.id ?? p.customerId, totalCents: total, voucherCents,
        partnerId: p.partnerId, partnerRef: p.partnerRef, createdById: p.createdById, voucherCode: voucherCents ? p.voucherCode!.trim().toUpperCase() : null, locale: p.locale ?? 'de', note: p.note ?? '', holdId: hold.id,
      },
    });
  });
}

export async function gutscheinPruefen(code: string) {
  const v = await db.voucher.findUnique({ where: { code: code.trim().toUpperCase() } });
  if (!v || !v.active || v.remainingCents <= 0 || (v.validUntil && v.validUntil < new Date())) throw new Error('Diesen Gutschein kennen wir nicht oder er ist bereits eingelöst.');
  return v;
}

/**
 * Zahlung ist eingegangen: Tickets ausstellen, Plätze fest vergeben, Gutschein abbuchen,
 * Rechnung, Buchungssatz. Idempotent (zweiter Aufruf tut nichts).
 */
export async function bezahlt(orderId: string, z: { provider: string; providerRef: string; amountCents: number; feeCents?: number; raw?: unknown; commissionCents?: number }) {
  const fertig = await db.$transaction(async (tx) => {
    const o = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { show: true } });
    if (o.status !== 'offen') return null;
    const hold = o.holdId ? await tx.hold.findUnique({ where: { id: o.holdId } }) : null;
    if (!hold) throw new Error('Reservierung nicht mehr vorhanden – Zahlung muss erstattet werden');
    const pos = positionen(hold.seats as { seatId: string; art: string }[], o.show.prices as Preise);
    const jetzt = new Date();
    for (const x of pos) {
      const t = await tx.ticket.create({ data: { orderId: o.id, showId: o.showId, seatId: x.seatId, kat: x.kat, art: x.art, priceCents: x.priceCents, vatRate: TICKET_UST, code: neuerCode() } });
      // Reservierung → verkauft (inkl. Konfliktsitze bei Rollstuhlplätzen)
      await tx.seatLock.updateMany({ where: { holdId: hold.id, seatId: { in: zuSperren([x.seatId]) } }, data: { kind: 'ticket', ticketId: t.id, holdId: null, expiresAt: null } });
    }
    await tx.hold.delete({ where: { id: hold.id } });
    if (o.voucherCents > 0) {
      const red = await gutscheinAbbuchen(tx, o.id, o.voucherCents);
      if (!red) throw new Error('Gutschein nicht mehr gültig');
    }
    const zahl = o.totalCents - o.voucherCents;
    if (zahl > 0) await tx.payment.create({ data: { orderId: o.id, provider: z.provider, status: 'bezahlt', amountCents: zahl, feeCents: z.feeCents ?? 0, providerRef: z.providerRef, raw: (z.raw ?? undefined) as object | undefined, paidAt: jetzt } });
    const neu = await tx.order.update({ where: { id: o.id }, data: { status: 'bezahlt', paidAt: jetzt, paidCents: zahl, holdId: null } });
    await rechnungFuerBestellung(tx, neu.id);
    await bucheTicketverkauf(tx, { id: o.id, number: o.number, paidAt: jetzt, totalCents: o.totalCents, voucherCents: o.voucherCents, provider: z.provider, partner: !!o.partnerId, feeCommissionCents: z.commissionCents });
    return neu;
  });
  if (fertig) await ticketMail(orderId).catch(() => {});
  return fertig;
}

async function gutscheinAbbuchen(tx: Tx, orderId: string, betrag: number) {
  const o = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  const v = o.voucherCode ? await tx.voucher.findUnique({ where: { code: o.voucherCode } }) : null;
  if (!v || v.remainingCents < betrag) return null;
  await tx.voucher.update({ where: { id: v.id }, data: { remainingCents: { decrement: betrag } } });
  return tx.voucherRedemption.create({ data: { voucherId: v.id, orderId, amountCents: betrag } });
}

/** Rechnung zur Bestellung (Kleinbetragsrechnung bzw. Rechnung mit UID, wenn Firma angegeben) */
export async function rechnungFuerBestellung(tx: Tx, orderId: string) {
  const o = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { tickets: true, customer: true, show: true, invoices: true } });
  if (o.invoices.some((i) => i.kind === 'rechnung')) return null;
  const s = await tx.settings.findUniqueOrThrow({ where: { id: 1 } });
  const datum = new Date();
  const vorhandene = (await tx.invoice.findMany({ where: { number: { startsWith: renderNumber(s.invoiceNumberFmt.split('{N')[0], s.invoicePrefix, datum, 0) } }, select: { number: true } })).map((i) => i.number);
  const number = renderNumber(s.invoiceNumberFmt, s.invoicePrefix, datum, nextSequence(s.invoiceNumberFmt, s.invoicePrefix, datum, vorhandene, 1));
  const gruppen = new Map<string, { title: string; quantity: number; unitCents: number; vatRate: number }>();
  for (const t of o.tickets) {
    const title = `Ticket ${t.kat === 'R' ? 'Rollstuhlplatz inkl. Begleitperson' : `Kategorie ${t.kat} ${t.art === 'ermaessigt' ? 'ermäßigt' : t.art === 'frei' ? 'Freikarte' : 'Vollpreis'}`} – ${fmtDatum(o.show.startsAt)} ${fmtZeit(o.show.startsAt)}`;
    const k = `${title}|${t.priceCents}`;
    const g = gruppen.get(k) ?? { title, quantity: 0, unitCents: t.priceCents, vatRate: t.vatRate };
    g.quantity++;
    gruppen.set(k, g);
  }
  const z = zerlegen(new Map([[TICKET_UST, o.totalCents]]))[0] ?? { netto: 0, ust: 0, brutto: 0 };
  const c = o.customer;
  return tx.invoice.create({
    data: {
      number, kind: 'rechnung', status: 'bezahlt', orderId: o.id, issueDate: datum, serviceDate: o.show.startsAt,
      recipient: c ? { name: `${c.firstName} ${c.lastName}`, company: c.company, street: c.street, zip: c.zip, city: c.city, country: c.country, vatId: c.vatId, email: c.email } : { name: 'Barverkauf' },
      items: [...gruppen.values()], netCents: z.netto, vatCents: z.ust, grossCents: o.totalCents,
      note: o.voucherCents ? `Davon mit Gutschein bezahlt: ${formatEur(o.voucherCents)}` : '',
    },
  });
}

/** Buchungsbestätigung mit QR-Codes (inline) senden */
export async function ticketMail(orderId: string) {
  const o = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { tickets: { where: { status: { not: 'storniert' } } }, customer: true, show: true } });
  if (!o.customer?.email) return null;
  const app = process.env.PUBLIC_ORIGIN ?? '';
  const anhaenge: Anhang[] = [];
  const zeilen: string[] = [];
  for (const t of o.tickets) {
    const cid = `qr-${t.code}@loc`;
    anhaenge.push({ filename: `ticket-${t.code}.png`, content: await qrPng(qrInhalt(t.code, t.showId)), contentType: 'image/png', cid });
    zeilen.push(`<tr><td style="padding:12px 0;border-top:1px solid #e2dacb"><img src="cid:${cid}" width="140" height="140" alt="QR-Code Ticket ${t.code}" style="display:block"></td>
<td style="padding:12px 0 12px 16px;border-top:1px solid #e2dacb;vertical-align:middle"><strong>${sitzName(t.seatId)}</strong><br>${t.kat === 'R' ? 'inkl. Begleitperson' : `Kategorie ${t.kat}`} · ${formatEur(t.priceCents)}<br><span style="font-family:monospace">${t.code}</span></td></tr>`);
  }
  const v = await vorlage('buchung');
  const werte = {
    vorname: o.customer.firstName, nachname: o.customer.lastName, datum: fmtDatum(o.show.startsAt), uhrzeit: fmtZeit(o.show.startsAt),
    bestellnummer: o.number, summe: formatEur(o.totalCents), verwalten_url: `${app}/de/buchung/${o.manageToken}`,
    tickets_html: `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0">${zeilen.join('')}</table>`,
  };
  return senden({ to: o.customer.email, subject: fuellen(v.subject, werte), html: layout(fuellen(v.subject, werte), fuellen(v.body, werte), await fussText()), template: 'buchung', orderId: o.id, anhaenge });
}

/**
 * Storno ganzer Bestellungen oder einzelner Tickets.
 * methode: zahlungsmittel (Erstattung über den Anbieter) | gutschein (Wertgutschein) | keine (verfällt)
 */
export async function stornieren(p: { orderId: string; ticketIds?: string[]; methode: 'zahlungsmittel' | 'gutschein' | 'keine'; grund: string; gebuehrCents?: number; notiz?: string; userId?: string; mail?: boolean; fristIgnorieren?: boolean }) {
  const o = await db.order.findUniqueOrThrow({ where: { id: p.orderId }, include: { tickets: true, show: true, payments: true, customer: true } });
  if (!['bezahlt', 'teilstorniert'].includes(o.status)) throw new Error('Nur bezahlte Bestellungen können storniert werden');
  if (!p.fristIgnorieren && !stornoMoeglich(o.show.startsAt)) throw new Error(`Storno ist nur bis ${STORNO_FRIST_H} Stunden vor Beginn möglich`);
  const ziel = o.tickets.filter((t) => t.status === 'gueltig' && (!p.ticketIds || p.ticketIds.includes(t.id)));
  if (!ziel.length) throw new Error('Keine stornierbaren Tickets ausgewählt');
  const brutto = ziel.reduce((s, t) => s + t.priceCents, 0);
  const gebuehr = Math.min(p.gebuehrCents ?? 0, brutto);
  let auszahlen = brutto - gebuehr;
  // Gutscheinanteil geht immer als Gutschein zurück, nur der bezahlte Teil übers Zahlungsmittel
  const nochBezahlt = o.paidCents - o.refundedCents;
  const ueberAnbieter = p.methode === 'zahlungsmittel' ? Math.min(auszahlen, nochBezahlt) : 0;
  const zahlung = o.payments.find((x) => x.status === 'bezahlt' || x.status === 'teilerstattet');
  let providerRef: string | undefined;
  if (ueberAnbieter > 0 && zahlung && !['bar', 'terminal', 'rechnung', 'partner', 'gutschein'].includes(zahlung.provider)) {
    const r = await erstatten(zahlung.provider, zahlung.providerRef ?? '', ueberAnbieter);
    if (!r.ok) throw new Error(`Erstattung fehlgeschlagen: ${r.fehler}`);
    providerRef = r.ref;
  }
  const alsGutschein = p.methode === 'gutschein' ? auszahlen : p.methode === 'zahlungsmittel' ? auszahlen - ueberAnbieter : 0;
  if (p.methode === 'keine') auszahlen = 0;
  const erg = await db.$transaction(async (tx) => {
    let voucherId: string | undefined;
    if (alsGutschein > 0) {
      const v = await tx.voucher.create({ data: { code: `LOC-${neuerCode(8)}`, kind: 'wert', issuer: 'storno', valueCents: alsGutschein, remainingCents: alsGutschein, validUntil: new Date(Date.now() + 3 * 365 * 864e5), note: `Storno ${o.number}` } });
      voucherId = v.id;
    }
    await tx.ticket.updateMany({ where: { id: { in: ziel.map((t) => t.id) } }, data: { status: 'storniert' } });
    await tx.seatLock.deleteMany({ where: { ticketId: { in: ziel.map((t) => t.id) } } });
    const rest = o.tickets.filter((t) => t.status === 'gueltig' && !ziel.some((z) => z.id === t.id)).length + o.tickets.filter((t) => t.status === 'eingelassen').length;
    await tx.order.update({ where: { id: o.id }, data: { status: rest ? 'teilstorniert' : 'storniert', cancelledAt: rest ? null : new Date(), refundedCents: { increment: ueberAnbieter } } });
    if (zahlung && ueberAnbieter) await tx.payment.update({ where: { id: zahlung.id }, data: { refundedCents: { increment: ueberAnbieter }, status: zahlung.refundedCents + ueberAnbieter >= zahlung.amountCents ? 'erstattet' : 'teilerstattet' } });
    const refund = await tx.refund.create({ data: { orderId: o.id, ticketIds: ziel.map((t) => t.id), amountCents: auszahlen, feeCents: gebuehr, method: p.methode, reason: p.grund, note: p.notiz ?? '', paymentId: zahlung?.id, voucherId, providerRef, createdById: p.userId } });
    // Buchhaltung: Zahlungsmittel-Anteil und Gutschein-Anteil getrennt
    if (ueberAnbieter > 0 || gebuehr > 0 || p.methode === 'keine') {
      const anteil = ueberAnbieter + gebuehr + (p.methode === 'keine' ? brutto - gebuehr : 0);
      await bucheStorno(tx, { id: `${refund.id}-z`, date: new Date(), orderNumber: o.number, bruttoCents: anteil, feeCents: p.methode === 'keine' ? anteil : gebuehr, method: p.methode === 'keine' ? 'keine' : 'zahlungsmittel', provider: zahlung?.provider ?? 'bar' });
    }
    if (alsGutschein > 0) await bucheStorno(tx, { id: `${refund.id}-g`, date: new Date(), orderNumber: o.number, bruttoCents: alsGutschein, feeCents: 0, method: 'gutschein', provider: '' });
    await stornoRechnung(tx, o.id, ziel.map((t) => t.id));
    return { refund, voucherId };
  });
  if (p.mail !== false && o.customer?.email) {
    const v = erg.voucherId ? await db.voucher.findUnique({ where: { id: erg.voucherId } }) : null;
    const erstattung = [
      ueberAnbieter ? `Wir erstatten ${formatEur(ueberAnbieter)} auf Ihr ursprüngliches Zahlungsmittel. Das kann einige Tage dauern.` : '',
      v ? `Sie erhalten einen Gutschein über ${formatEur(v.valueCents)}: Code ${v.code}, gültig bis ${fmtDatum(v.validUntil!)}.` : '',
      gebuehr ? `Einbehaltene Stornogebühr: ${formatEur(gebuehr)}.` : '',
    ].filter(Boolean).join(' ');
    const vl = await vorlage('storno');
    const werte = { vorname: o.customer.firstName, nachname: o.customer.lastName, bestellnummer: o.number, plaetze: ziel.map((t) => sitzName(t.seatId)).join(', '), erstattung };
    await senden({ to: o.customer.email, subject: fuellen(vl.subject, werte), html: layout(fuellen(vl.subject, werte), fuellen(vl.body, werte), await fussText()), template: 'storno', orderId: o.id });
  }
  return erg;
}

async function stornoRechnung(tx: Tx, orderId: string, ticketIds: string[]) {
  const re = await tx.invoice.findFirst({ where: { orderId, kind: 'rechnung' } });
  if (!re) return null;
  const tickets = await tx.ticket.findMany({ where: { id: { in: ticketIds } } });
  const brutto = tickets.reduce((s, t) => s + t.priceCents, 0);
  const z = zerlegen(new Map([[TICKET_UST, brutto]]))[0] ?? { netto: 0, ust: 0 };
  const s = await tx.settings.findUniqueOrThrow({ where: { id: 1 } });
  const d = new Date();
  const vorhandene = (await tx.invoice.findMany({ where: { number: { startsWith: renderNumber(s.invoiceNumberFmt.split('{N')[0], s.invoicePrefix, d, 0) } }, select: { number: true } })).map((i) => i.number);
  return tx.invoice.create({
    data: {
      number: renderNumber(s.invoiceNumberFmt, s.invoicePrefix, d, nextSequence(s.invoiceNumberFmt, s.invoicePrefix, d, vorhandene, 1)),
      kind: 'storno', status: 'bezahlt', orderId, cancelsId: re.id, recipient: re.recipient as object, issueDate: d, serviceDate: re.serviceDate,
      items: tickets.map((t) => ({ title: `Storno ${sitzName(t.seatId)}`, quantity: -1, unitCents: t.priceCents, vatRate: t.vatRate })),
      netCents: -z.netto, vatCents: -z.ust, grossCents: -brutto, note: `Storno zu Rechnung ${re.number}`,
    },
  });
}

/** Vorstellung absagen: Verkauf stoppen, alle Tickets stornieren und erstatten (bzw. Gutschein) */
export async function vorstellungAbsagen(showId: string, grund: string, methode: 'zahlungsmittel' | 'gutschein', userId?: string) {
  await db.show.update({ where: { id: showId }, data: { status: 'abgesagt', cancelReason: grund } });
  await db.hold.deleteMany({ where: { showId } });
  // Unbezahlte Bestellungen (Rechnung, Zahlungslink) verfallen mit der Reservierung
  await db.order.updateMany({ where: { showId, status: 'offen' }, data: { status: 'storniert', cancelledAt: new Date(), holdId: null } });
  const orders = await db.order.findMany({ where: { showId, status: { in: ['bezahlt', 'teilstorniert'] } }, select: { id: true } });
  const ergebnis = { ok: 0, fehler: [] as string[] };
  for (const o of orders) {
    try {
      await stornieren({ orderId: o.id, methode, grund: 'absage', notiz: grund, userId, fristIgnorieren: true, mail: false });
      await absageMail(o.id, grund);
      ergebnis.ok++;
    } catch (e) {
      ergebnis.fehler.push(`${o.id}: ${(e as Error).message}`);
    }
  }
  return ergebnis;
}

async function absageMail(orderId: string, grund: string) {
  const o = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { customer: true, show: true, refunds: { orderBy: { createdAt: 'desc' }, take: 1 } } });
  if (!o.customer?.email) return;
  const r = o.refunds[0];
  const v = r?.voucherId ? await db.voucher.findUnique({ where: { id: r.voucherId } }) : null;
  const erstattung = v ? `Sie erhalten einen Gutschein über ${formatEur(v.valueCents)}: Code ${v.code}.` : `Wir erstatten ${formatEur(r?.amountCents ?? 0)} auf Ihr ursprüngliches Zahlungsmittel.`;
  const vl = await vorlage('absage');
  const werte = { vorname: o.customer.firstName, nachname: o.customer.lastName, datum: fmtDatum(o.show.startsAt), uhrzeit: fmtZeit(o.show.startsAt), grund, erstattung };
  await senden({ to: o.customer.email, subject: fuellen(vl.subject, werte), html: layout(fuellen(vl.subject, werte), fuellen(vl.body, werte), await fussText()), template: 'absage', orderId: o.id });
}

/** Gutschein verkaufen (Kasse oder Telefon) */
export async function gutscheinVerkaufen(p: { cents: number; provider: string; note?: string; validYears?: number }) {
  return db.$transaction(async (tx) => {
    const v = await tx.voucher.create({ data: { code: `LOC-${neuerCode(8)}`, valueCents: p.cents, remainingCents: p.cents, validUntil: new Date(Date.now() + (p.validYears ?? 3) * 365 * 864e5), note: p.note ?? '' } });
    await bucheGutscheinverkauf(tx, { id: v.id, code: v.code, date: new Date(), cents: p.cents, provider: p.provider });
    return v;
  });
}

export async function einstellungen() { return getSettings(); }
