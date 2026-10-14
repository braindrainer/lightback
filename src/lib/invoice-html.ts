// Rechnungslayout (A4, DIN 5008 Form B) für Light of Creation – Grundlage aus skillfinance, angepasst an
// die GmbH: Pflichtangaben nach § 11 UStG und § 14 UGB (Firmenbuch, Sitz, Geschäftsführung) in der Fußzeile.
import QRCode from 'qrcode';
import type { Settings } from '@prisma/client';
import { fmtDatum } from './dates';
import { formatEur, formatNumber } from './money';
import { invoiceTotals } from './invoice-calc';
import { zerlegen } from './ledger';
import { epcPayload } from './finanzen/epc';

export type Empfaenger = { name?: string | null; company?: string | null; street?: string | null; zip?: string | null; city?: string | null; country?: string | null; vatId?: string | null; email?: string | null };
export type Position = { title: string; quantity: number; unitCents: number; vatRate: number };
export type RechnungDoc = {
  number: string; kind: string; status: string; issueDate: Date; serviceDate: Date | null; dueDate: Date | null;
  recipient: Empfaenger; items: Position[]; netCents: number; vatCents: number; grossCents: number; note: string;
  /** Bestellrechnungen (Tickets) haben Bruttopreise, manuelle Rechnungen Nettopreise */
  bruttoPreise: boolean;
  storniert?: { number: string; issueDate: Date } | null;
};

/** Grenze Kleinbetragsrechnung (§ 11 Abs. 6 UStG) und Pflicht zur UID des Empfängers (§ 11 Abs. 1 Z 3 lit. i) */
export const KLEINBETRAG_CENT = 40000;
export const UID_PFLICHT_CENT = 1000000;

/** Netto und USt je Steuersatz */
export function steuerAufstellung(d: Pick<RechnungDoc, 'items' | 'bruttoPreise' | 'netCents' | 'vatCents' | 'grossCents'>) {
  if (d.bruttoPreise) {
    const je = new Map<number, number>();
    for (const i of d.items) je.set(i.vatRate, (je.get(i.vatRate) ?? 0) + i.quantity * i.unitCents);
    const g = zerlegen(je).map((z) => ({ rate: z.satz, net: z.netto, vat: z.ust, gross: z.brutto })).sort((a, b) => b.rate - a.rate);
    return { gruppen: g, net: d.netCents, vat: d.vatCents, gross: d.grossCents };
  }
  const t = invoiceTotals(d.items.map((i) => ({ ...i, discountPct: 0 })), 'domestic');
  return { gruppen: t.groups.map((x) => ({ rate: x.rate, net: x.net, vat: x.vat, gross: x.net + x.vat })), net: t.net, vat: t.vat, gross: t.gross };
}

/** Fehlende Pflichtangaben (Hinweis in der Oberfläche, nicht auf dem PDF) */
export function pflichtHinweise(d: RechnungDoc, s: Settings): string[] {
  const h: string[] = [];
  const r = d.recipient;
  const brutto = Math.abs(d.grossCents);
  if (!s.uid) h.push('Eigene UID-Nummer fehlt in den Einstellungen.');
  if (brutto > KLEINBETRAG_CENT && !(r.name || r.company)) h.push('Name der Empfänger:in fehlt (über 400 € Pflicht).');
  if (brutto > KLEINBETRAG_CENT && !(r.street && r.city)) h.push('Anschrift der Empfänger:in fehlt (über 400 € Pflicht).');
  if (brutto > UID_PFLICHT_CENT && !r.vatId) h.push('UID-Nummer der Empfänger:in fehlt (über 10.000 € brutto Pflicht).');
  return h;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const nl2br = (s: string) => esc(s).replace(/\n/g, '<br>');
const eur = (c: number) => formatEur(c);
const ibanFmt = (s: string) => s.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();

export async function rechnungHtml(d: RechnungDoc, s: Settings): Promise<string> {
  const st = steuerAufstellung(d);
  const storno = d.kind === 'storno';
  const r = d.recipient;
  const offen = !storno && d.status === 'offen';
  const klein = Math.abs(d.grossCents) <= KLEINBETRAG_CENT;
  let qr = '';
  if (offen && s.iban && d.grossCents > 0) {
    qr = await QRCode.toString(epcPayload({ name: s.companyName, iban: s.iban, bic: s.bic, cents: d.grossCents, text: d.number }), { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#121a2b', light: '#ffffff00' } });
  }
  const leistung = d.serviceDate ? fmtDatum(d.serviceDate) : `${fmtDatum(d.issueDate)} (= Rechnungsdatum)`;
  const meta: [string, string][] = [
    [storno ? 'Storno-Nr.' : 'Rechnungs-Nr.', d.number],
    ...(d.storniert ? [['Zu Rechnung', `${d.storniert.number} vom ${fmtDatum(d.storniert.issueDate)}`] as [string, string]] : []),
    ['Rechnungsdatum', fmtDatum(d.issueDate)],
    ['Leistungsdatum', leistung],
    ...(d.dueDate && offen ? [['Fällig am', fmtDatum(d.dueDate)] as [string, string]] : []),
    ...(r.vatId ? [['UID Empfänger', r.vatId] as [string, string]] : []),
    ['Unsere UID', s.uid],
  ];
  const mehrereSaetze = new Set(d.items.map((i) => i.vatRate)).size > 1;
  const zeilen = d.items.map((it, i) => `<tr>
      <td class="pos">${i + 1}</td>
      <td>${esc(it.title)}</td>
      <td class="num">${formatNumber(it.quantity, Number.isInteger(it.quantity) ? 0 : 2)}</td>
      <td class="num">${eur(it.unitCents)}</td>
      <td class="num">${it.vatRate} %</td>
      <td class="num">${eur(Math.round(it.quantity * it.unitCents))}</td>
    </tr>`).join('');
  const summen = d.bruttoPreise
    ? `<tr class="grand"><td colspan="5">Gesamtbetrag</td><td class="num">${eur(st.gross)}</td></tr>
       ${st.gruppen.map((g) => `<tr class="sub"><td colspan="5">darin enthalten ${g.rate} % USt von ${eur(g.net)} netto</td><td class="num">${eur(g.vat)}</td></tr>`).join('')}`
    : `<tr class="sum"><td colspan="5">Summe netto</td><td class="num">${eur(st.net)}</td></tr>
       ${st.gruppen.map((g) => `<tr class="sub"><td colspan="5">zzgl. ${g.rate} % USt${st.gruppen.length > 1 || mehrereSaetze ? ` auf ${eur(g.net)}` : ''}</td><td class="num">${eur(g.vat)}</td></tr>`).join('')}
       <tr class="grand"><td colspan="5">Gesamtbetrag brutto</td><td class="num">${eur(st.gross)}</td></tr>`;
  const adresse = [r.company, r.name && r.name !== r.company ? (r.company ? `z. H. ${r.name}` : r.name) : '', r.street, [r.zip, r.city].filter(Boolean).join(' '), r.country && !/^(AT|Österreich)$/i.test(r.country) ? r.country : ''].filter(Boolean);
  const nullSatz = st.gruppen.some((g) => g.rate === 0);
  const zahlung = storno
    ? `Diese Stornorechnung hebt die Rechnung ${esc(d.storniert?.number ?? '')} im angegebenen Umfang auf.`
    : offen
      ? `Bitte überweisen Sie ${eur(d.grossCents)}${d.dueDate ? ` bis ${fmtDatum(d.dueDate)}` : ''} unter Angabe der Rechnungsnummer ${esc(d.number)}${s.iban ? ` auf unser Konto IBAN ${esc(ibanFmt(s.iban))}${s.bic ? `, BIC ${esc(s.bic)}` : ''}` : ''}.`
      : 'Der Rechnungsbetrag ist bereits bezahlt. Vielen Dank.';

  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${storno ? 'Stornorechnung' : 'Rechnung'} ${esc(d.number)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif; font-size: 9pt; color: #121a2b; line-height: 1.45; }
  .page { position: relative; padding: 0 18mm 0 25mm; }
  .fold { position: absolute; left: 0; width: 5mm; border-top: .5pt solid #8a8f9c; }
  table.layout { width: 100%; border-collapse: collapse; }
  table.layout > thead td { height: 12mm; padding: 0; }
  table.layout > tfoot td { height: 30mm; padding: 0; }
  table.layout > tbody > tr > td { padding: 0; }
  .kopf { display: flex; justify-content: space-between; align-items: flex-start; height: 33mm; }
  .marke { font-family: Georgia, "Times New Roman", serif; font-size: 20pt; letter-spacing: .04em; color: #121a2b; }
  .marke small { display: block; font-family: inherit; font-size: 8pt; letter-spacing: .02em; color: #6e5118; }
  .zone { display: flex; justify-content: space-between; min-height: 45mm; }
  .fenster { width: 85mm; }
  .absender { font-size: 6.8pt; color: #59617a; border-bottom: .4pt solid #c9c2b3; padding-bottom: 1mm; margin-bottom: 3mm; white-space: nowrap; }
  .empf { font-size: 9.5pt; line-height: 1.5; }
  .meta { width: 72mm; }
  .meta table { border-collapse: collapse; width: 100%; }
  .meta td { padding: .5mm 0; vertical-align: top; font-size: 8pt; }
  .meta td.k { color: #59617a; padding-right: 3mm; white-space: nowrap; }
  .meta td.v { font-weight: 700; text-align: right; }
  h1 { font-size: 15pt; margin: 6mm 0 1mm; font-weight: 700; }
  .unter { color: #59617a; margin: 0 0 6mm; font-size: 8.5pt; }
  table.pos { width: 100%; border-collapse: collapse; margin-bottom: 6mm; }
  table.pos thead { display: table-header-group; }
  table.pos th { text-align: left; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .06em; color: #59617a; border-bottom: 1pt solid #121a2b; padding: 1.8mm 1.5mm; }
  table.pos td { padding: 2mm 1.5mm; border-bottom: .4pt solid #e3dccd; vertical-align: top; }
  table.pos tr { page-break-inside: avoid; }
  table.pos .pos { width: 7mm; color: #59617a; }
  table.pos .num, table.pos th.num { text-align: right; white-space: nowrap; }
  table.pos tr.sum td { border-bottom: none; padding-top: 3mm; }
  table.pos tr.sub td { border-bottom: none; color: #3d4457; padding-top: .6mm; padding-bottom: .6mm; }
  table.pos tr.grand td { font-weight: 700; font-size: 10.5pt; border-top: 1pt solid #121a2b; border-bottom: none; padding-top: 2.4mm; }
  .abschluss { display: flex; gap: 8mm; align-items: flex-start; page-break-inside: avoid; }
  .abschluss .text { flex: 1; }
  .hinweis { margin: 0 0 3mm; padding: 2.4mm 3mm; background: #f7f4ee; border-left: 2pt solid #8a6a1f; }
  .qr { flex: none; width: 44mm; padding: 3mm; border: .5pt solid #e3dccd; border-radius: 1.5mm; text-align: center; font-size: 7pt; line-height: 1.35; }
  .qr .code { width: 26mm; height: 26mm; margin: 1.5mm auto 2mm; }
  .qr .code svg { width: 100%; height: 100%; }
  .qr .cap { font-size: 6.5pt; letter-spacing: .06em; text-transform: uppercase; color: #59617a; }
  .fuss { position: fixed; left: 25mm; right: 18mm; bottom: 9mm; padding-top: 2.5mm; border-top: .4pt solid #c9c2b3; display: flex; justify-content: space-between; gap: 5mm; font-size: 6.6pt; line-height: 1.5; color: #3d4457; background: #fff; }
  .fuss b { color: #121a2b; }
</style></head><body><div class="page">
  <div class="fold" style="top:105mm"></div><div class="fold" style="top:148.5mm"></div><div class="fold" style="top:210mm"></div>
  <table class="layout"><thead><tr><td></td></tr></thead><tfoot><tr><td></td></tr></tfoot><tbody><tr><td>
  <div class="kopf">
    <div class="marke">Light of Creation<small>${esc(s.companyName)}</small></div>
  </div>
  <div class="zone">
    <div class="fenster">
      <div class="absender">${esc(s.companyName)} · ${esc(s.street)} · ${esc(s.zip)} ${esc(s.city)}</div>
      <div class="empf">${adresse.map(esc).join('<br>') || 'Barverkauf'}</div>
    </div>
    <div class="meta"><table>${meta.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td class="v">${esc(v)}</td></tr>`).join('')}</table></div>
  </div>
  <h1>${storno ? 'Stornorechnung' : 'Rechnung'} ${esc(d.number)}</h1>
  <p class="unter">${storno && d.storniert ? `Storno zu Rechnung ${esc(d.storniert.number)} vom ${fmtDatum(d.storniert.issueDate)}` : klein ? 'Kleinbetragsrechnung (§ 11 Abs. 6 UStG)' : 'Rechnung gemäß § 11 UStG'}</p>
  <table class="pos">
    <thead><tr><th>Pos.</th><th>Bezeichnung</th><th class="num">Menge</th><th class="num">Einzelpreis ${d.bruttoPreise ? 'brutto' : 'netto'}</th><th class="num">USt</th><th class="num">Gesamt ${d.bruttoPreise ? 'brutto' : 'netto'}</th></tr></thead>
    <tbody>${zeilen}</tbody>
    <tbody style="page-break-inside:avoid">${summen}</tbody>
  </table>
  <div class="abschluss">
    <div class="text">
      ${nullSatz ? '<p class="hinweis">Für Positionen mit 0 % wird keine Umsatzsteuer verrechnet.</p>' : ''}
      ${d.note ? `<p class="hinweis">${nl2br(d.note)}</p>` : ''}
      <p>${zahlung}</p>
    </div>
    ${qr ? `<div class="qr"><div class="cap">Zahlen mit Code</div><div class="code" role="img" aria-label="QR-Code zur Überweisung">${qr}</div>Mit der Banking-App scannen.<br>Verwendungszweck: <strong>${esc(d.number)}</strong></div>` : ''}
  </div>
  </td></tr></tbody></table>
  <div class="fuss">
    <div><b>${esc(s.companyName)}</b><br>${esc(s.street)}, ${esc(s.zip)} ${esc(s.city)}<br>Sitz: ${esc(s.city)}</div>
    <div>${esc(s.fn)}, ${esc(s.court)}<br>UID: ${esc(s.uid)}<br>Geschäftsführung: ${esc(s.managingDirector)}</div>
    <div>${esc(s.email)}<br>${esc(s.phone)}</div>
    <div>${s.iban ? `IBAN ${esc(ibanFmt(s.iban))}${s.bic ? `<br>BIC ${esc(s.bic)}` : ''}` : ''}</div>
  </div>
</div></body></html>`;
}
