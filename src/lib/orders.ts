// Bestellablauf: Reservierung → Bestellung → Zahlung → Tickets, Rechnung, Buchung, E-Mail.
// Storno (ganz oder einzelne Tickets), Umbuchung und Absage einer Vorstellung.
import type { Prisma } from '@prisma/client';
import { protokoll, protokollMehrere, type Eintrag } from './audit';
import { db, getSettings } from './db';
import { fmtDatum, fmtZeit } from './dates';
import { renderNumber, nextSequence } from './invoice-calc';
import { bucheGutscheinverkauf, bucheStorno, bucheTicketverkauf, zerlegen } from './ledger';
import { fussText, fuellen, layout, senden, vorlage, type Anhang } from './mail';
import { formatEur } from './money';
import { erstatten } from './payments';
import { preis, SITZ, sitzName, TICKET_UST, type Kat, type Preise } from './saal';
import { cacheVerwerfen, holdSichern, zuSperren } from './seats';
import { neuerCode, qrInhalt, qrPng } from './tickets';

type Tx = Prisma.TransactionClient;
export type KundeEingabe = { email: string; firstName: string; lastName: string; phone?: string; company?: string; vatId?: string; street?: string; zip?: string; city?: string; country?: string; newsletter?: boolean; locale?: string };

/** Kulanz laut AGB: Storno/Umbuchung bis 24 h vor Beginn */
export const STORNO_FRIST_H = 24;
export const stornoMoeglich = (startsAt: Date, jetzt = new Date()) => startsAt.getTime() - jetzt.getTime() >= STORNO_FRIST_H * 3600e3;

// Nummernkreise (Bestellung, Rechnung) je Transaktion serialisieren, sonst kollidieren gleichzeitige Käufe
const NUMMER_LOCK = 7_401_001;
const nummernSperre = (tx: Tx) => tx.$executeRaw`SELECT pg_advisory_xact_lock(${NUMMER_LOCK}::bigint)`;
const TX_OPT = { maxWait: 10_000, timeout: 20_000 };

/** Wer handelt, wenn niemand angemeldet ist (Shop, Partner-API, Zahlungsrückmeldung) */
async function akteur(o: { channel: string; partnerId?: string | null }) {
  if (o.partnerId) {
    const p = await db.partner.findUnique({ where: { id: o.partnerId }, select: { name: true } });
    return `Partner ${p?.name ?? o.partnerId}`;
  }
  return o.channel === 'web' ? 'Webshop' : 'System';
}
const ticketInfo = (t: { id: string; code: string; seatId: string; kat: string; art: string; priceCents: number }) => ({ id: t.id, code: t.code, platz: sitzName(t.seatId), kat: t.kat, art: t.art, preisCents: t.priceCents });

async function bestellnummer(tx: Tx) {
  await nummernSperre(tx);
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
  const order = await db.$transaction(async (tx) => {
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
      include: { customer: true },
    });
  }, TX_OPT);
  await protokoll({
    akteur: await akteur(order), action: 'bestellung_angelegt', entity: 'order', entityId: order.id,
    data: { vorstellung: show.startsAt, showId: show.id, plaetze: pos.map((x) => ({ platz: sitzName(x.seatId), seatId: x.seatId, kat: x.kat, art: x.art, preisCents: x.priceCents })), reservierungBis: hold.expiresAt },
    nachher: {
      number: order.number, channel: order.channel, status: order.status, totalCents: order.totalCents, voucherCents: order.voucherCents, voucherCode: order.voucherCode, partnerRef: order.partnerRef, note: order.note || undefined,
      kunde: order.customer ? { id: order.customer.id, name: `${order.customer.firstName} ${order.customer.lastName}`.trim(), email: order.customer.email } : null,
    },
  });
  return order;
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
  // Zahlung kam nach Ablauf der Reservierung: dieselben Plätze erneut sperren, wenn sie noch frei sind.
  // Sind sie inzwischen vergeben, bleibt die Bestellung offen und das Geld geht automatisch zurück.
  const vor = await db.order.findUnique({ where: { id: orderId }, select: { status: true, holdId: true } });
  if (vor?.status === 'offen' && vor.holdId && !(await holdSichern(vor.holdId))) {
    await zahlungOhnePlaetze(orderId, z);
    return null;
  }
  const info: { tickets: Parameters<typeof ticketInfo>[0][]; rechnung?: { id: string; number: string; netCents: number; vatCents: number; grossCents: number } | null; gutschein?: { id: string; code: string; vorher: number; nachher: number } | null; o?: { number: string; channel: string; partnerId: string | null } } = { tickets: [] };
  const fertig = await db.$transaction(async (tx) => {
    info.tickets = [];
    const o = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { show: true } });
    if (o.status !== 'offen') return null;
    info.o = o;
    const hold = o.holdId ? await tx.hold.findUnique({ where: { id: o.holdId } }) : null;
    if (!hold) throw new Error('Reservierung nicht mehr vorhanden – Zahlung muss erstattet werden');
    const pos = positionen(hold.seats as { seatId: string; art: string }[], o.show.prices as Preise);
    const jetzt = new Date();
    for (const x of pos) {
      const t = await tx.ticket.create({ data: { orderId: o.id, showId: o.showId, seatId: x.seatId, kat: x.kat, art: x.art, priceCents: x.priceCents, vatRate: TICKET_UST, code: neuerCode() } });
      info.tickets.push(t);
      // Reservierung → verkauft (inkl. Konfliktsitze bei Rollstuhlplätzen)
      await tx.seatLock.updateMany({ where: { holdId: hold.id, seatId: { in: zuSperren([x.seatId]) } }, data: { kind: 'ticket', ticketId: t.id, holdId: null, expiresAt: null } });
    }
    await tx.hold.delete({ where: { id: hold.id } });
    if (o.voucherCents > 0) {
      const red = await gutscheinAbbuchen(tx, o.id, o.voucherCents);
      if (!red) throw new Error('Gutschein nicht mehr gültig');
      info.gutschein = red.info;
    }
    const zahl = o.totalCents - o.voucherCents;
    if (zahl > 0) {
      // Beim Start angelegte offene Zahlung (hobex/Stripe/PayPal) abschließen statt doppelt anzulegen
      const daten = { provider: z.provider, status: 'bezahlt', amountCents: zahl, feeCents: z.feeCents ?? 0, providerRef: z.providerRef, raw: (z.raw ?? undefined) as object | undefined, paidAt: jetzt };
      const offen = await tx.payment.findFirst({ where: { orderId: o.id, status: 'offen' }, orderBy: { createdAt: 'desc' } });
      if (offen) await tx.payment.update({ where: { id: offen.id }, data: daten });
      else await tx.payment.create({ data: { orderId: o.id, ...daten } });
    }
    const neu = await tx.order.update({ where: { id: o.id }, data: { status: 'bezahlt', paidAt: jetzt, paidCents: zahl, holdId: null } });
    info.rechnung = await rechnungFuerBestellung(tx, neu.id);
    await bucheTicketverkauf(tx, { id: o.id, number: o.number, paidAt: jetzt, totalCents: o.totalCents, voucherCents: o.voucherCents, provider: z.provider, partner: !!o.partnerId, feeCommissionCents: z.commissionCents, voucherKonto: await gutscheinKonto(tx, o.voucherCode) });
    return neu;
  }, TX_OPT);
  if (fertig) {
    const wer = await akteur({ channel: info.o!.channel, partnerId: info.o!.partnerId });
    const e: Eintrag[] = [{
      akteur: wer, action: 'bezahlt', entity: 'order', entityId: orderId,
      data: { provider: z.provider, providerRef: z.providerRef, betragCents: z.amountCents, gebuehrCents: z.feeCents, provisionCents: z.commissionCents, tickets: info.tickets.map(ticketInfo), rechnung: info.rechnung?.number },
      vorher: { status: 'offen', paidCents: 0 }, nachher: { status: 'bezahlt', paidCents: fertig.paidCents, paidAt: fertig.paidAt },
    }];
    if (info.rechnung) e.push({ akteur: wer, action: 'rechnung_erstellt', entity: 'invoice', entityId: info.rechnung.id, data: { bestellung: info.o!.number, orderId }, nachher: { number: info.rechnung.number, kind: 'rechnung', netCents: info.rechnung.netCents, vatCents: info.rechnung.vatCents, grossCents: info.rechnung.grossCents } });
    if (info.gutschein) e.push({ akteur: wer, action: 'gutschein_eingeloest', entity: 'voucher', entityId: info.gutschein.id, data: { code: info.gutschein.code, bestellung: info.o!.number, orderId, betragCents: info.gutschein.vorher - info.gutschein.nachher }, vorher: { remainingCents: info.gutschein.vorher }, nachher: { remainingCents: info.gutschein.nachher } });
    await protokollMehrere(e);
    cacheVerwerfen(fertig.showId);
    // Mail im Hintergrund: QR-Bilder und SMTP sollen die Antwort an den Shop nicht verzögern
    void ticketMail(orderId).catch(() => {});
  }
  return fertig;
}

/** Plätze nach Ablauf der Reservierung vergeben: Zahlung erstatten, Kund:in informieren, protokollieren */
async function zahlungOhnePlaetze(orderId: string, z: { provider: string; providerRef: string; amountCents: number; raw?: unknown }) {
  const o = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { customer: true } });
  const automatisch = z.amountCents > 0 && !['bar', 'rechnung', 'partner', 'gutschein'].includes(z.provider);
  const r = automatisch ? await erstatten(z.provider, z.providerRef, z.amountCents) : { ok: false, ref: '', fehler: 'keine automatische Erstattung' };
  const daten = { provider: z.provider, status: r.ok ? 'erstattet' : 'bezahlt', amountCents: z.amountCents, refundedCents: r.ok ? z.amountCents : 0, providerRef: z.providerRef, raw: { anbieter: (z.raw ?? null) as object, erstattung: r }, paidAt: new Date() };
  const offen = await db.payment.findFirst({ where: { orderId, status: 'offen' } });
  if (offen) await db.payment.update({ where: { id: offen.id }, data: daten });
  else if (z.amountCents > 0) await db.payment.create({ data: { orderId, ...daten } });
  await db.order.update({ where: { id: orderId }, data: { holdId: null, refundedCents: r.ok ? z.amountCents : 0, note: r.ok ? `Plätze nach Ablauf der Reservierung vergeben – ${formatEur(z.amountCents)} automatisch erstattet` : `Plätze nach Ablauf der Reservierung vergeben – Zahlung ${formatEur(z.amountCents)} bitte manuell erstatten (${r.fehler ?? ''})` } });
  await protokoll({ user: null, akteur: 'System', action: r.ok ? 'zahlung_erstattet_plaetze_weg' : 'zahlung_ohne_plaetze', entity: 'order', entityId: orderId, data: { provider: z.provider, providerRef: z.providerRef, amountCents: z.amountCents, erstattung: r }, vorher: { refundedCents: o.refundedCents, note: o.note }, nachher: { refundedCents: r.ok ? z.amountCents : 0 } });
  if (o.customer?.email) {
    const text = fuellen(`<h1 style="font-size:24px;margin:0 0 12px">Ihre Plätze waren leider nicht mehr frei</h1><p>Guten Tag {{vorname}} {{nachname}},</p><p>Ihre Zahlung für die Buchung {{nummer}} kam erst nach Ablauf der Reservierung bei uns an, und die Plätze waren inzwischen vergeben. ${r.ok ? `Wir haben ${formatEur(z.amountCents)} auf Ihr Zahlungsmittel zurückgebucht.` : 'Wir erstatten Ihnen den Betrag umgehend.'}</p><p>Bitte buchen Sie gerne erneut oder antworten Sie auf diese E-Mail.</p>`, { vorname: o.customer.firstName, nachname: o.customer.lastName, nummer: o.number });
    await senden({ to: o.customer.email, subject: `Buchung ${o.number}: Plätze nicht mehr verfügbar`, html: layout('Plätze nicht mehr verfügbar', text, await fussText()), template: 'zahlung_erstattet', orderId }).catch(() => {});
  }
}

/**
 * Gegenkonto für eingelöste Gutscheine:
 * verkaufte oder aus Storno entstandene Gutscheine → 3490 (Verbindlichkeit wurde gebucht),
 * Partner-Gutscheine (Tiqets …) → 2010 (Partner schuldet uns den Betrag),
 * verschenkte eigene Gutscheine → 7650 Werbung (keine Verbindlichkeit gebucht) – mit Steuerberatung abstimmen.
 */
async function gutscheinKonto(tx: Tx, code: string | null) {
  if (!code) return '3490';
  const v = await tx.voucher.findUnique({ where: { code } });
  if (!v) return '3490';
  if (v.kind === 'partner') return '2010';
  if (v.issuer === 'storno') return '3490';
  const verkauft = await tx.journalEntry.findFirst({ where: { source: 'voucher', sourceId: v.id }, select: { id: true } });
  return verkauft ? '3490' : '7650';
}

async function gutscheinAbbuchen(tx: Tx, orderId: string, betrag: number) {
  const o = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  const v = o.voucherCode ? await tx.voucher.findUnique({ where: { code: o.voucherCode } }) : null;
  if (!v || v.remainingCents < betrag) return null;
  const neu = await tx.voucher.update({ where: { id: v.id }, data: { remainingCents: { decrement: betrag } } });
  const red = await tx.voucherRedemption.create({ data: { voucherId: v.id, orderId, amountCents: betrag } });
  return { red, info: { id: v.id, code: v.code, vorher: v.remainingCents, nachher: neu.remainingCents } };
}

/** Rechnung zur Bestellung (Kleinbetragsrechnung bzw. Rechnung mit UID, wenn Firma angegeben) */
export async function rechnungFuerBestellung(tx: Tx, orderId: string) {
  const o = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { tickets: true, customer: true, show: true, invoices: true } });
  if (o.invoices.some((i) => i.kind === 'rechnung')) return null;
  await nummernSperre(tx);
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
export async function stornieren(p: { orderId: string; ticketIds?: string[]; methode: 'zahlungsmittel' | 'gutschein' | 'keine'; grund: string; gebuehrCents?: number; notiz?: string; userId?: string; mail?: boolean; fristIgnorieren?: boolean; akteur?: string }) {
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
    let gutschein: { id: string; code: string; valueCents: number; validUntil: Date | null } | undefined;
    if (alsGutschein > 0) {
      const v = await tx.voucher.create({ data: { code: `LOC-${neuerCode(8)}`, kind: 'wert', issuer: 'storno', valueCents: alsGutschein, remainingCents: alsGutschein, validUntil: new Date(Date.now() + 3 * 365 * 864e5), note: `Storno ${o.number}` } });
      voucherId = v.id;
      gutschein = v;
    }
    await tx.ticket.updateMany({ where: { id: { in: ziel.map((t) => t.id) } }, data: { status: 'storniert' } });
    await tx.seatLock.deleteMany({ where: { ticketId: { in: ziel.map((t) => t.id) } } });
    const rest = o.tickets.filter((t) => t.status === 'gueltig' && !ziel.some((z) => z.id === t.id)).length + o.tickets.filter((t) => t.status === 'eingelassen').length;
    const neuerStatus = rest ? 'teilstorniert' : 'storniert';
    await tx.order.update({ where: { id: o.id }, data: { status: rest ? 'teilstorniert' : 'storniert', cancelledAt: rest ? null : new Date(), refundedCents: { increment: ueberAnbieter } } });
    if (zahlung && ueberAnbieter) await tx.payment.update({ where: { id: zahlung.id }, data: { refundedCents: { increment: ueberAnbieter }, status: zahlung.refundedCents + ueberAnbieter >= zahlung.amountCents ? 'erstattet' : 'teilerstattet' } });
    const refund = await tx.refund.create({ data: { orderId: o.id, ticketIds: ziel.map((t) => t.id), amountCents: auszahlen, feeCents: gebuehr, method: p.methode, reason: p.grund, note: p.notiz ?? '', paymentId: zahlung?.id, voucherId, providerRef, createdById: p.userId } });
    // Buchhaltung: Zahlungsmittel-Anteil und Gutschein-Anteil getrennt
    if (ueberAnbieter > 0 || gebuehr > 0 || p.methode === 'keine') {
      const anteil = ueberAnbieter + gebuehr + (p.methode === 'keine' ? brutto - gebuehr : 0);
      await bucheStorno(tx, { id: `${refund.id}-z`, date: new Date(), orderNumber: o.number, bruttoCents: anteil, feeCents: p.methode === 'keine' ? anteil : gebuehr, method: p.methode === 'keine' ? 'keine' : 'zahlungsmittel', provider: zahlung?.provider ?? 'bar' });
    }
    if (alsGutschein > 0) await bucheStorno(tx, { id: `${refund.id}-g`, date: new Date(), orderNumber: o.number, bruttoCents: alsGutschein, feeCents: 0, method: 'gutschein', provider: '' });
    const stornoRe = await stornoRechnung(tx, o.id, ziel.map((t) => t.id));
    return { refund, voucherId, gutschein, stornoRe, neuerStatus };
  }, TX_OPT);
  cacheVerwerfen(o.showId);
  const wer = p.akteur ?? (await akteur(o));
  const eintraege: Eintrag[] = [
    {
      akteur: wer, action: 'storno', entity: 'order', entityId: o.id,
      data: {
        refundId: erg.refund.id, tickets: ziel.map(ticketInfo), methode: p.methode, grund: p.grund, notiz: p.notiz || undefined, gebuehrCents: gebuehr, bruttoCents: brutto, erstattungCents: auszahlen,
        ueberZahlungsmittelCents: ueberAnbieter, alsGutscheinCents: alsGutschein, provider: zahlung?.provider, providerRef, gutschein: erg.gutschein?.code, stornorechnung: erg.stornoRe?.number, fristIgnoriert: !!p.fristIgnorieren || undefined,
      },
      vorher: { status: o.status, refundedCents: o.refundedCents }, nachher: { status: erg.neuerStatus, refundedCents: o.refundedCents + ueberAnbieter },
    },
    ...ziel.map((t): Eintrag => ({ akteur: wer, action: 'ticket_storniert', entity: 'ticket', entityId: t.id, data: { code: t.code, platz: sitzName(t.seatId), bestellung: o.number, orderId: o.id, refundId: erg.refund.id, grund: p.grund }, vorher: { status: 'gueltig' }, nachher: { status: 'storniert' } })),
  ];
  if (erg.gutschein) eintraege.push({ akteur: wer, action: 'gutschein_ausgestellt', entity: 'voucher', entityId: erg.gutschein.id, data: { herkunft: 'storno', bestellung: o.number, orderId: o.id }, nachher: { code: erg.gutschein.code, valueCents: erg.gutschein.valueCents, validUntil: erg.gutschein.validUntil } });
  if (erg.stornoRe) eintraege.push({ akteur: wer, action: 'stornorechnung_erstellt', entity: 'invoice', entityId: erg.stornoRe.id, data: { bestellung: o.number, orderId: o.id, storniert: erg.stornoRe.cancelsId }, nachher: { number: erg.stornoRe.number, kind: 'storno', netCents: erg.stornoRe.netCents, vatCents: erg.stornoRe.vatCents, grossCents: erg.stornoRe.grossCents } });
  await protokollMehrere(eintraege);
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
  await nummernSperre(tx);
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
  const vorher = await db.show.findUniqueOrThrow({ where: { id: showId }, select: { status: true, cancelReason: true, startsAt: true } });
  await db.show.update({ where: { id: showId }, data: { status: 'abgesagt', cancelReason: grund } });
  await db.hold.deleteMany({ where: { showId } });
  // Unbezahlte Bestellungen (Rechnung, Zahlungslink) verfallen mit der Reservierung
  const offene = await db.order.findMany({ where: { showId, status: 'offen' }, select: { id: true, number: true } });
  await db.order.updateMany({ where: { id: { in: offene.map((x) => x.id) } }, data: { status: 'storniert', cancelledAt: new Date(), holdId: null } });
  await protokollMehrere([
    { action: 'vorstellung_absagen', entity: 'show', entityId: showId, data: { termin: vorher.startsAt, methode, userId }, vorher: { status: vorher.status, cancelReason: vorher.cancelReason }, nachher: { status: 'abgesagt', cancelReason: grund } },
    ...offene.map((x): Eintrag => ({ action: 'bestellung_verfallen', entity: 'order', entityId: x.id, data: { grund: 'Vorstellung abgesagt', bestellung: x.number }, vorher: { status: 'offen' }, nachher: { status: 'storniert' } })),
  ]);
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
  await protokoll({ action: 'vorstellung_absagen_ergebnis', entity: 'show', entityId: showId, data: { storniert: ergebnis.ok, fehler: ergebnis.fehler } });
  // Vertriebspartner per Webhook informieren (läuft im Hintergrund, Fehler nur im Log)
  import('./partner').then((m) => m.absageMelden(showId, grund)).catch((e) => console.error('Partner-Webhook', e));
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
  const v = await db.$transaction(async (tx) => {
    const v = await tx.voucher.create({ data: { code: `LOC-${neuerCode(8)}`, valueCents: p.cents, remainingCents: p.cents, validUntil: new Date(Date.now() + (p.validYears ?? 3) * 365 * 864e5), note: p.note ?? '' } });
    await bucheGutscheinverkauf(tx, { id: v.id, code: v.code, date: new Date(), cents: p.cents, provider: p.provider });
    return v;
  });
  await protokoll({ action: 'gutschein_verkauft', entity: 'voucher', entityId: v.id, data: { provider: p.provider, note: p.note || undefined }, nachher: { code: v.code, valueCents: v.valueCents, validUntil: v.validUntil, active: true } });
  return v;
}

export async function einstellungen() { return getSettings(); }
