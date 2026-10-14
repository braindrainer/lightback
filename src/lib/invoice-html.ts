// Rechnungslayout (A4, DIN 5008 Form B) für Light of Creation: Markenschriften, Goldlinien, Anschrift im Fensterbereich.
// Pflichtangaben nach § 11 UStG und § 14 UGB (Firmenbuch, Sitz, Geschäftsführung) in der Fußzeile, Seitenzahlen im PDF.
import QRCode from 'qrcode';
import type { Settings } from '@prisma/client';
import { fmtDatum } from './dates';
import { formatEur, formatNumber } from './money';
import { invoiceTotals } from './invoice-calc';
import { zerlegen } from './ledger';
import { epcPayload } from './finanzen/epc';
import { bild, esc, schriftCss, SCHRIFT_TEXT, SCHRIFT_TITEL, type Modus } from './marke';

export type Empfaenger = { name?: string | null; company?: string | null; street?: string | null; zip?: string | null; city?: string | null; country?: string | null; vatId?: string | null; email?: string | null };
export type Position = { title: string; quantity: number; unitCents: number; vatRate: number };
export type RechnungDoc = {
  number: string; kind: string; status: string; issueDate: Date; serviceDate: Date | null; dueDate: Date | null;
  recipient: Empfaenger; items: Position[]; netCents: number; vatCents: number; grossCents: number; note: string;
  /** Bestellrechnungen (Tickets) haben Bruttopreise, manuelle Rechnungen Nettopreise */
  bruttoPreise: boolean;
  storniert?: { number: string; issueDate: Date } | null;
  /** Bestellrechnungen: Bestellnummer, Kontakt, Zusatzzeile je Position (Termin, Plätze), Zahlungen */
  bestellung?: { number: string; email?: string | null } | null;
  details?: (string | null)[];
  zahlungen?: { art: string; datum: Date | null; ref?: string | null; cents: number }[];
};

/** Bei Layoutänderungen erhöhen – zwischengespeicherte PDFs werden dann neu erzeugt */
export const RECHNUNG_VORLAGE = 2;
/** Beilagen, die das Rechnungs-PDF braucht (siehe marke.pdfBeilagen) */
export const RECHNUNG_BILDER = ['logo-wortmarke-dunkel.svg'];

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


const nl2br = (s: string) => esc(s).replace(/\n/g, '<br>');
const eur = (c: number) => formatEur(c);
const ibanFmt = (s: string) => s.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();

/** Rechnung als HTML. modus 'pdf' für Gotenberg (Beilagen: marke.pdfBeilagen(RECHNUNG_BILDER)), 'web' für die Vorschau im Browser. */
export async function rechnungHtml(d: RechnungDoc, s: Settings, opt: { modus?: Modus } = {}): Promise<string> {
  const modus = opt.modus ?? 'pdf';
  const st = steuerAufstellung(d);
  const storno = d.kind === 'storno';
  const r = d.recipient;
  const offen = !storno && d.status === 'offen';
  const klein = Math.abs(d.grossCents) <= KLEINBETRAG_CENT;
  const art = storno ? 'Stornorechnung' : 'Rechnung';
  let qr = '';
  if (offen && s.iban && d.grossCents > 0) {
    qr = await QRCode.toString(epcPayload({ name: s.companyName, iban: s.iban, bic: s.bic, cents: d.grossCents, text: d.number }), { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#121a2b', light: '#ffffff00' } });
  }
  const leistung = d.serviceDate ? fmtDatum(d.serviceDate) : `${fmtDatum(d.issueDate)} (= Rechnungsdatum)`;
  const meta: [string, string][] = [
    [storno ? 'Storno-Nr.' : 'Rechnungs-Nr.', d.number],
    ...(d.storniert ? [['Zu Rechnung', d.storniert.number] as [string, string]] : []),
    ['Rechnungsdatum', fmtDatum(d.issueDate)],
    ['Leistungsdatum', leistung],
    ...(d.bestellung ? [['Bestellung', d.bestellung.number] as [string, string]] : []),
    ...(d.bestellung?.email || r.email ? [['Kund:in', (d.bestellung?.email || r.email)!] as [string, string]] : []),
    ...(d.dueDate && offen ? [['Fällig am', fmtDatum(d.dueDate)] as [string, string]] : []),
    ...(r.vatId ? [['UID Empfänger:in', r.vatId] as [string, string]] : []),
  ];
  const zeilen = d.items.map((it, i) => {
    const detail = d.details?.[i];
    return `<tr>
      <td class="pos">${i + 1}</td>
      <td class="bez">${esc(it.title)}${detail ? `<span class="detail">${esc(detail)}</span>` : ''}</td>
      <td class="num">${formatNumber(it.quantity, Number.isInteger(it.quantity) ? 0 : 2)}</td>
      <td class="num">${eur(it.unitCents)}</td>
      <td class="num">${it.vatRate} %</td>
      <td class="num strong">${eur(Math.round(it.quantity * it.unitCents))}</td>
    </tr>`;
  }).join('');
  const summen = `
    <tr><td>Summe netto</td><td class="num">${eur(st.net)}</td></tr>
    ${st.gruppen.map((g) => `<tr><td>USt ${g.rate} %${st.gruppen.length > 1 ? ` auf ${eur(g.net)}` : ''}</td><td class="num">${eur(g.vat)}</td></tr>`).join('')}
    <tr class="gesamt"><td>${storno ? 'Gutschrift gesamt' : 'Gesamtbetrag'}<small>${d.bruttoPreise ? 'inkl. Umsatzsteuer' : 'brutto'}</small></td><td class="num">${eur(st.gross)}</td></tr>`;
  const adresse = [r.company, r.name && r.name !== r.company ? (r.company ? `z. H. ${r.name}` : r.name) : '', r.street, [r.zip, r.city].filter(Boolean).join(' '), r.country && !/^(AT|Österreich)$/i.test(r.country) ? r.country : ''].filter(Boolean);
  const nullSatz = st.gruppen.some((g) => g.rate === 0);
  const bezahltAm = (d.zahlungen ?? []).filter((z) => z.cents > 0);
  const zahlung = storno
    ? `<div class="zahlung neutral"><p class="zk">Storno</p><p>Diese Stornorechnung hebt die Rechnung <b>${esc(d.storniert?.number ?? '')}</b>${d.storniert ? ` vom ${fmtDatum(d.storniert.issueDate)}` : ''} im angeführten Umfang auf.</p></div>`
    : offen
      ? `<div class="zahlung offen"><div class="ztext"><p class="zk">Zahlung</p><p>Bitte überweisen Sie <b>${eur(d.grossCents)}</b>${d.dueDate ? ` bis <b>${fmtDatum(d.dueDate)}</b>` : ''} unter Angabe der Rechnungsnummer.</p>
          ${s.iban ? `<table class="bank"><tr><td>Empfänger</td><td>${esc(s.companyName)}</td></tr><tr><td>IBAN</td><td class="mono">${esc(ibanFmt(s.iban))}</td></tr>${s.bic ? `<tr><td>BIC</td><td class="mono">${esc(s.bic)}</td></tr>` : ''}<tr><td>Verwendungszweck</td><td><b>${esc(d.number)}</b></td></tr></table>` : ''}</div>
          ${qr ? `<div class="qr"><div class="code" role="img" aria-label="QR-Code zur Überweisung (EPC/GiroCode)">${qr}</div><p>Mit der Banking-App scannen</p></div>` : ''}</div>`
      : `<div class="zahlung bezahlt"><p class="zk"><span class="haken" aria-hidden="true">✓</span> Bezahlt</p><p>${bezahltAm.length
          ? bezahltAm.map((z) => `${eur(z.cents)} ${z.datum ? `am ${fmtDatum(z.datum)} ` : ''}per ${esc(z.art)}${z.ref ? ` <span class="ref">(Referenz ${esc(z.ref)})</span>` : ''}`).join('<br>')
          : 'Der Rechnungsbetrag ist bereits beglichen.'}</p><p class="danke">Vielen Dank für Ihre Zahlung.</p></div>`;
  const hinweise = [
    klein && !storno && d.bruttoPreise ? 'Kleinbetragsrechnung gemäß § 11 Abs. 6 UStG.' : '',
    nullSatz ? 'Für Positionen mit 0 % wird keine Umsatzsteuer verrechnet.' : '',
    storno && /^Storno zu Rechnung/.test(d.note) ? '' : d.note,
  ].filter(Boolean);
  const unter = storno && d.storniert
    ? `Storno zu Rechnung ${esc(d.storniert.number)} vom ${fmtDatum(d.storniert.issueDate)}`
    : d.bestellung ? 'Vielen Dank für Ihre Buchung bei Light of Creation. Wir verrechnen Ihnen:' : 'Wir erlauben uns, folgende Leistungen in Rechnung zu stellen:';
  const web = s.email.includes('@') ? s.email.split('@')[1] : '';

  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${art} ${esc(d.number)} – ${esc(s.companyName)}</title>
<meta name="author" content="${esc(s.companyName)}"><meta name="description" content="${art} ${esc(d.number)} vom ${fmtDatum(d.issueDate)}">
<style>
${schriftCss(modus)}
@page { size: A4; margin: 0 0 9mm 0;
  @bottom-right { content: "Seite " counter(page) " von " counter(pages); font: 500 6.8pt ${SCHRIFT_TEXT}; color: #5b6275; margin-right: 18mm; vertical-align: top; }
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: ${SCHRIFT_TEXT}; font-size: 9pt; color: #121a2b; line-height: 1.45; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-variant-numeric: tabular-nums; }
p { margin: 0; }
.blatt { position: relative; padding: 0 18mm 0 25mm; }
.band { position: absolute; left: 0; right: 0; top: 0; height: 2.2mm; background: #070b14; }
.band::after { content: ""; position: absolute; left: 0; right: 0; bottom: -.8mm; height: .8mm; background: #d9b877; }
.falz { position: absolute; left: 0; width: 6mm; border-top: .5pt solid #a7a294; }
.falz.loch { width: 4mm; }
.logo { position: absolute; top: 14mm; left: 25mm; width: 56mm; height: auto; }
.firma { position: absolute; top: 15mm; right: 18mm; text-align: right; font-size: 7.6pt; line-height: 1.5; color: #4b5366; }
.firma b { display: block; color: #121a2b; font-size: 8.4pt; font-weight: 650; margin-bottom: .6mm; }
.fenster { position: absolute; top: 45mm; left: 20mm; width: 85mm; height: 45mm; padding: 0 5mm; }
.ruecksende { position: absolute; left: 5mm; right: 0; top: 11mm; font-size: 6.4pt; color: #5b6275; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-bottom: .4pt solid #c9bfa8; padding-bottom: .6mm; }
.empf { position: absolute; left: 5mm; right: 0; top: 17.7mm; font-size: 10pt; line-height: 1.42; }
.empf .name { font-weight: 650; }
.info { position: absolute; top: 50mm; left: 118mm; right: 18mm; }
.info h2 { margin: 0 0 1.6mm; font-size: 6.6pt; letter-spacing: .16em; text-transform: uppercase; color: #7a5a1c; font-weight: 700; padding-bottom: 1.2mm; border-bottom: .8pt solid #d9b877; }
.info table { width: 100%; border-collapse: collapse; }
.info td { padding: .55mm 0; vertical-align: top; font-size: 7.8pt; }
.info td.k { color: #5b6275; padding-right: 3mm; }
.info td.v { text-align: right; font-weight: 600; overflow-wrap: anywhere; }
.info td.k { white-space: nowrap; }
table.layout { width: 100%; border-collapse: collapse; }
table.layout > thead td { height: 14mm; padding: 0; }
table.layout > tfoot td { height: 27mm; padding: 0; }
table.layout > tbody > tr > td { padding: 0; }
.start { height: 80mm; }
h1 { margin: 0; font-family: ${SCHRIFT_TITEL}; font-weight: 600; font-size: 27pt; line-height: 1; letter-spacing: .005em; }
h1 .nr { font-family: ${SCHRIFT_TEXT}; font-size: 11pt; font-weight: 600; color: #7a5a1c; letter-spacing: .04em; margin-left: 3mm; }
.unter { margin: 2.2mm 0 5mm; color: #4b5366; font-size: 9pt; }
table.pos { width: 100%; border-collapse: collapse; }
table.pos thead { display: table-header-group; }
table.pos th { text-align: left; font-size: 6.6pt; text-transform: uppercase; letter-spacing: .12em; color: #4b5366; font-weight: 700; border-bottom: 1pt solid #d9b877; padding: 0 1.6mm 1.8mm; }
table.pos td { padding: 2.3mm 1.6mm; border-bottom: .4pt solid #e6dfd0; vertical-align: top; }
table.pos tr { page-break-inside: avoid; break-inside: avoid; }
table.pos .pos { width: 8mm; color: #5b6275; padding-left: 0; }
table.pos .bez { font-weight: 600; }
table.pos .detail { display: block; font-weight: 400; color: #4b5366; font-size: 7.8pt; margin-top: .8mm; line-height: 1.4; }
table.pos .num, table.pos th.num { text-align: right; white-space: nowrap; }
table.pos .strong { font-weight: 650; }
table.pos th:last-child, table.pos td:last-child { padding-right: 0; }
.abschluss { display: flex; justify-content: flex-end; margin-top: 4mm; page-break-inside: avoid; break-inside: avoid; }
table.summen { width: 82mm; border-collapse: collapse; }
table.summen td { padding: 1.1mm 0; font-size: 8.8pt; color: #2b3142; }
table.summen .num { text-align: right; white-space: nowrap; }
table.summen tr.gesamt td { padding-top: 2.6mm; border-top: 1.2pt solid #121a2b; font-size: 12.5pt; font-weight: 700; color: #121a2b; vertical-align: bottom; }
table.summen tr.gesamt small { display: block; font-size: 7pt; font-weight: 500; color: #5b6275; letter-spacing: .02em; }
.zahlung { margin-top: 6mm; padding: 3.4mm 4.4mm; border-radius: 2mm; background: #f8f5ef; border-left: 1.4mm solid #d9b877; page-break-inside: avoid; break-inside: avoid; display: flex; gap: 0 6mm; align-items: flex-start; flex-wrap: wrap; }
.zahlung > p, .zahlung .ztext { flex: 1 1 100%; }
.zahlung.offen .ztext { flex: 1 1 0; }
.zahlung p + p { margin-top: 1mm; }
.zahlung .zk { font-size: 6.8pt; letter-spacing: .14em; text-transform: uppercase; font-weight: 700; color: #7a5a1c; margin-bottom: 1.2mm; }
.zahlung.bezahlt { border-left-color: #1d7a47; background: #f1f7f2; }
.zahlung.bezahlt .zk { color: #14532d; }
.haken { display: inline-block; width: 3.6mm; height: 3.6mm; line-height: 3.6mm; text-align: center; border-radius: 50%; background: #1d7a47; color: #fff; font-size: 7pt; margin-right: .8mm; letter-spacing: 0; }
.ref { color: #4b5366; }
.danke { color: #4b5366; }
.bank { border-collapse: collapse; margin-top: 2mm; font-size: 8.6pt; }
.bank td { padding: .5mm 5mm .5mm 0; }
.bank td:first-child { color: #5b6275; }
.mono { font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace; font-size: 8.4pt; }
.qr { flex: none; width: 34mm; text-align: center; font-size: 6.6pt; color: #4b5366; }
.qr .code { width: 28mm; height: 28mm; margin: 0 auto 1.4mm; padding: 1.6mm; background: #fff; border-radius: 1.4mm; }
.qr .code svg { width: 100%; height: 100%; display: block; }
.hinweise { margin-top: 5mm; font-size: 8pt; color: #4b5366; page-break-inside: avoid; }
.hinweise p + p { margin-top: .8mm; }
.gruss { margin-top: 6mm; font-family: ${SCHRIFT_TITEL}; font-size: 13pt; font-style: italic; color: #2b3142; }
.fuss { position: fixed; left: 25mm; right: 18mm; bottom: 0; padding-top: 2.6mm; border-top: .8pt solid #d9b877; display: flex; justify-content: space-between; gap: 5mm; font-size: 6.6pt; line-height: 1.55; color: #4b5366; background: #fff; }
.fuss b { color: #121a2b; font-weight: 650; }
@media screen {
  html, body { background: #e7e2d8; }
  .blatt { width: 210mm; min-height: 297mm; margin: 6mm auto; background: #fff; box-shadow: 0 1px 3px rgba(7,11,20,.12), 0 10px 30px rgba(7,11,20,.12); padding-bottom: 36mm; }
  .fuss { position: absolute; bottom: 9mm; }
  table.layout > tfoot { display: none; }
  .falz { display: none; }
}
@media screen and (max-width: 820px) { html { zoom: .9; } }
@media screen and (max-width: 740px) { html { zoom: .8; } }
@media screen and (max-width: 660px) { html { zoom: .7; } }
@media screen and (max-width: 580px) { html { zoom: .6; } }
@media screen and (max-width: 500px) { html { zoom: .5; } }
@media screen and (max-width: 420px) { html { zoom: .44; } .blatt { margin: 2mm auto; } }
@media screen and (max-width: 360px) { html { zoom: .4; } }
</style></head><body><div class="blatt">
  <div class="band" aria-hidden="true"></div>
  <div class="falz" style="top:105mm" aria-hidden="true"></div><div class="falz loch" style="top:148.5mm" aria-hidden="true"></div><div class="falz" style="top:210mm" aria-hidden="true"></div>
  <img class="logo" src="${bild('logo-wortmarke-dunkel.svg', modus)}" alt="Light of Creation – Votivkirche">
  <div class="firma"><b>${esc(s.companyName)}</b>${esc(s.street)}<br>${esc(s.zip)} ${esc(s.city)}<br>${esc(s.email)}<br>${esc(s.phone)}${web ? `<br>${esc(web)}` : ''}</div>
  <div class="fenster" aria-label="Empfänger:in">
    <div class="ruecksende">${esc(s.companyName)} · ${esc(s.street)} · ${esc(s.zip)} ${esc(s.city)}</div>
    <div class="empf">${adresse.length ? adresse.map((z, i) => `<div${i === 0 ? ' class="name"' : ''}>${esc(z)}</div>`).join('') : '<div class="name">Barverkauf</div>'}</div>
  </div>
  <section class="info" aria-label="Rechnungsdaten"><h2>Rechnungsdaten</h2><table>${meta.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td class="v">${esc(v)}</td></tr>`).join('')}</table></section>
  <table class="layout" role="presentation"><thead><tr><td></td></tr></thead><tfoot><tr><td></td></tr></tfoot><tbody><tr><td>
  <div class="start" aria-hidden="true"></div>
  <h1>${art}<span class="nr">${esc(d.number)}</span></h1>
  <p class="unter">${unter}</p>
  <table class="pos">
    <thead><tr><th class="pos">Pos.</th><th>Bezeichnung</th><th class="num">Menge</th><th class="num">Einzelpreis ${d.bruttoPreise ? 'brutto' : 'netto'}</th><th class="num">USt</th><th class="num">Gesamt ${d.bruttoPreise ? 'brutto' : 'netto'}</th></tr></thead>
    <tbody>${zeilen}</tbody>
  </table>
  <div class="abschluss"><table class="summen">${summen}</table></div>
  ${zahlung}
  ${hinweise.length ? `<div class="hinweise">${hinweise.map((h) => `<p>${nl2br(h)}</p>`).join('')}</div>` : ''}
  ${!storno ? `<p class="gruss">${d.bestellung ? 'Wir wünschen Ihnen einen besonderen Abend in der Votivkirche.' : 'Vielen Dank für die gute Zusammenarbeit.'}</p>` : ''}
  </td></tr></tbody></table>
  <footer class="fuss">
    <div><b>${esc(s.companyName)}</b><br>${esc(s.street)}, ${esc(s.zip)} ${esc(s.city)}<br>Sitz: ${esc(s.city)}</div>
    <div>${esc(s.fn)}, ${esc(s.court)}<br>UID: ${esc(s.uid)}<br>Geschäftsführung: ${esc(s.managingDirector)}</div>
    <div>${esc(s.email)}<br>${esc(s.phone)}</div>
    ${s.iban ? `<div>IBAN ${esc(ibanFmt(s.iban))}${s.bic ? `<br>BIC ${esc(s.bic)}` : ''}</div>` : ''}
  </footer>
</div></body></html>`;
}
