// Rechnungen: manuelle B2B-Rechnungen mit Buchung, Zahlungseingang, Storno, PDF (zwischengespeichert), Versand.
import type { Invoice, Prisma } from '@prisma/client';
import { db, getSettings } from '../db';
import { fmtDatum } from '../dates';
import { invoiceTotals, nextSequence, renderNumber } from '../invoice-calc';
import { rechnungHtml, type Empfaenger, type Position, type RechnungDoc } from '../invoice-html';
import { buchen, ERLOESKONTO, ust, STEUERCODES, type Zeile } from '../ledger';
import { fussText, layout, senden, vorlage, fuellen } from '../mail';
import { formatEur } from '../money';
import { htmlToPdf } from '../pdf';
import { ablegen, lesen } from './dateien';

type Tx = Prisma.TransactionClient;

/** Erlöse 0 % fehlen im Grundkontenplan – wird bei Bedarf angelegt */
export const ERLOES_NULL = { number: '4290', name: 'Erlöse 0 % (steuerfrei / nicht steuerbar)', type: 'ertrag' };
export const erloesKonto = (satz: number) => (satz === 0 ? ERLOES_NULL.number : ERLOESKONTO[satz] ?? '4200');

async function nullKontoSicherstellen(tx: Tx) {
  await tx.account.upsert({ where: { number: ERLOES_NULL.number }, update: {}, create: { ...ERLOES_NULL, system: true } });
}

export async function naechsteNummer(tx: Tx, datum: Date) {
  const s = await tx.settings.findUniqueOrThrow({ where: { id: 1 } });
  const kopf = renderNumber(s.invoiceNumberFmt.split('{N')[0], s.invoicePrefix, datum, 0);
  const vorhandene = (await tx.invoice.findMany({ where: { number: { startsWith: kopf } }, select: { number: true } })).map((i) => i.number);
  return renderNumber(s.invoiceNumberFmt, s.invoicePrefix, datum, nextSequence(s.invoiceNumberFmt, s.invoicePrefix, datum, vorhandene, 1));
}

/** Rechnung als Dokument für das Layout */
export async function rechnungDoc(inv: Invoice): Promise<RechnungDoc> {
  const storniert = inv.cancelsId ? await db.invoice.findUnique({ where: { id: inv.cancelsId }, select: { number: true, issueDate: true } }) : null;
  return {
    number: inv.number, kind: inv.kind, status: inv.status, issueDate: inv.issueDate, serviceDate: inv.serviceDate, dueDate: inv.dueDate,
    recipient: inv.recipient as Empfaenger, items: inv.items as Position[], netCents: inv.netCents, vatCents: inv.vatCents, grossCents: inv.grossCents,
    note: inv.note, bruttoPreise: !!inv.orderId, storniert,
  };
}

/** PDF erzeugen oder aus dem Zwischenspeicher holen (neu, sobald sich der Status ändert – QR-Code nur bei offenen Rechnungen) */
export async function rechnungPdf(id: string): Promise<{ pdf: Buffer; name: string }> {
  const inv = await db.invoice.findUniqueOrThrow({ where: { id } });
  const name = `${inv.number}.pdf`;
  const rel = `rechnungen/${inv.issueDate.getUTCFullYear()}/${inv.number.replace(/[^\w-]/g, '_')}-${inv.status}.pdf`;
  if (inv.pdfPath === rel) {
    try { return { pdf: await lesen(rel), name }; } catch { /* neu erzeugen */ }
  }
  const pdf = await htmlToPdf(await rechnungHtml(await rechnungDoc(inv), await getSettings()));
  await ablegen(rel, pdf);
  await db.invoice.update({ where: { id }, data: { pdfPath: rel } });
  return { pdf, name };
}

export async function rechnungVorschauHtml(id: string) {
  const inv = await db.invoice.findUniqueOrThrow({ where: { id } });
  return rechnungHtml(await rechnungDoc(inv), await getSettings());
}

export type NeueRechnung = {
  recipient: Empfaenger; items: Position[]; issueDate: Date; serviceDate: Date | null; dueDate: Date | null; note: string;
};

/** Buchungszeilen Forderung an Erlöse + USt je Satz (sg = −1 für Storno) */
export function rechnungsZeilen(items: Position[], sg = 1, forderung = '2000'): Zeile[] {
  const t = invoiceTotals(items.map((i) => ({ ...i, discountPct: 0 })), 'domestic');
  return [
    { konto: forderung, soll: sg * t.gross },
    ...t.groups.flatMap((g) => {
      const code = ust(g.rate);
      return [
        { konto: erloesKonto(g.rate), haben: sg * g.net, vatCode: code, base: code ? sg * g.net : null },
        ...(g.vat && code ? [{ konto: STEUERCODES[code].konto, haben: sg * g.vat }] : []),
      ];
    }),
  ];
}

export async function rechnungAnlegen(r: NeueRechnung, userId?: string) {
  const t = invoiceTotals(r.items.map((i) => ({ ...i, discountPct: 0 })), 'domestic');
  if (t.gross <= 0) throw new Error('Der Rechnungsbetrag muss größer als 0 sein.');
  return db.$transaction(async (tx) => {
    if (r.items.some((i) => i.vatRate === 0)) await nullKontoSicherstellen(tx);
    const number = await naechsteNummer(tx, r.issueDate);
    const inv = await tx.invoice.create({
      data: { number, kind: 'rechnung', status: 'offen', recipient: r.recipient as object, issueDate: r.issueDate, serviceDate: r.serviceDate, dueDate: r.dueDate, items: r.items, netCents: t.net, vatCents: t.vat, grossCents: t.gross, note: r.note },
    });
    await buchen({ date: buchTag(r.issueDate), text: `Ausgangsrechnung ${number} ${r.recipient.company || r.recipient.name || ''}`.trim(), docRef: number, source: 'invoice', sourceId: inv.id, createdById: userId, zeilen: rechnungsZeilen(r.items) }, tx);
    return inv;
  });
}

/** Kalendertag (Wien) eines Zeitpunkts als @db.Date-Wert */
export const buchTag = (d: Date) => new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna' }).format(d)}T00:00:00Z`);

export async function rechnungBezahlt(id: string, datum: Date, userId?: string, gegenkonto = '2800', quelle: { source: string; sourceId: string } | null = null) {
  const inv = await db.invoice.findUniqueOrThrow({ where: { id } });
  if (inv.kind !== 'rechnung' || inv.status !== 'offen') throw new Error('Nur offene Rechnungen können als bezahlt markiert werden.');
  if (inv.orderId) throw new Error('Rechnungen aus Bestellungen werden über die Bestellung bezahlt.');
  return db.$transaction(async (tx) => {
    const e = await buchen({ date: datum, text: `Zahlungseingang ${inv.number}`, docRef: inv.number, source: quelle?.source ?? 'invoice-paid', sourceId: quelle?.sourceId ?? inv.id, createdById: userId, zeilen: [{ konto: gegenkonto, soll: inv.grossCents }, { konto: '2000', haben: inv.grossCents }] }, tx);
    await tx.invoice.update({ where: { id }, data: { status: 'bezahlt' } });
    return e;
  });
}

export async function rechnungStornieren(id: string, userId?: string) {
  const inv = await db.invoice.findUniqueOrThrow({ where: { id } });
  if (inv.orderId) throw new Error('Rechnungen aus Bestellungen werden über die Bestellung storniert.');
  if (inv.kind !== 'rechnung' || inv.status === 'storniert') throw new Error('Diese Rechnung kann nicht storniert werden.');
  const items = (inv.items as Position[]).map((i) => ({ ...i, quantity: -i.quantity }));
  const jetzt = new Date();
  return db.$transaction(async (tx) => {
    const number = await naechsteNummer(tx, jetzt);
    const st = await tx.invoice.create({
      data: { number, kind: 'storno', status: 'bezahlt', cancelsId: inv.id, recipient: inv.recipient as object, issueDate: jetzt, serviceDate: inv.serviceDate, items, netCents: -inv.netCents, vatCents: -inv.vatCents, grossCents: -inv.grossCents, note: `Storno zu Rechnung ${inv.number} vom ${fmtDatum(inv.issueDate)}` },
    });
    await buchen({ date: buchTag(jetzt), text: `Stornorechnung ${number} zu ${inv.number}`, docRef: number, source: 'invoice', sourceId: st.id, createdById: userId, zeilen: rechnungsZeilen(inv.items as Position[], -1) }, tx);
    await tx.invoice.update({ where: { id }, data: { status: 'storniert' } });
    return st;
  });
}

const STANDARD_MAIL = {
  subject: 'Rechnung {{nummer}} – Light of Creation',
  body: `<p>Guten Tag,</p>
<p>anbei erhalten Sie unsere {{art}} <strong>{{nummer}}</strong> vom {{datum}} über <strong>{{betrag}}</strong>.</p>
<p>{{zahlung}}</p>
<p>Bei Fragen antworten Sie einfach auf diese E-Mail.</p>
<p>Mit freundlichen Grüßen<br>{{firma}}</p>`,
};

export async function rechnungSenden(id: string, an: string) {
  const inv = await db.invoice.findUniqueOrThrow({ where: { id } });
  const s = await getSettings();
  const { pdf, name } = await rechnungPdf(id);
  const v = await vorlage('rechnung');
  const tpl = v.subject && v.body ? v : STANDARD_MAIL;
  const werte = {
    nummer: inv.number, art: inv.kind === 'storno' ? 'Stornorechnung' : 'Rechnung', datum: fmtDatum(inv.issueDate), betrag: formatEur(inv.grossCents), firma: s.companyName,
    zahlung: inv.status === 'offen' ? `Bitte überweisen Sie den Betrag${inv.dueDate ? ` bis ${fmtDatum(inv.dueDate)}` : ''} unter Angabe der Rechnungsnummer.` : 'Der Betrag ist bereits beglichen. Vielen Dank.',
  };
  const betreff = fuellen(tpl.subject, werte);
  const r = await senden({ to: an, subject: betreff, html: layout(betreff, fuellen(tpl.body, werte), await fussText()), template: 'rechnung', orderId: inv.orderId ?? undefined, anhaenge: [{ filename: name, content: pdf, contentType: 'application/pdf' }] });
  if (r.ok) await db.invoice.update({ where: { id }, data: { sentAt: new Date() } });
  return r;
}
