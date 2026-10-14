// Ticket-Layout für alle Ausgaben: PDF (A4 mit Karte oder A6), Handy-Ansicht, Vorschau im Backend, Ticketseite.
// variante 'digital' = Nachtblau mit Gold (Bildschirm), 'druck' = hell mit Gold (Papier). QR immer schwarz auf weiß.
import { createHash } from 'node:crypto';
import { readdir, unlink } from 'node:fs/promises';
import type { Customer, Order, Show, Ticket } from '@prisma/client';
import { db } from './db';
import { fmtDatumZeit, fmtZeit, TZ } from './dates';
import { ablegen, absolut, lesen } from './finanzen/dateien';
import { bild, esc, pdfBeilagen, schriftCss, SCHRIFT_TEXT, SCHRIFT_TITEL, type Modus } from './marke';
import { formatEur } from './money';
import { htmlToPdf } from './pdf';
import { SITZ, SITZE, sitzName, type Sitz } from './saal';
import { qrInhalt, qrSvg } from './tickets';

export type Variante = 'digital' | 'druck';
export type Format = 'a4' | 'a6';

/** Bei Layoutänderungen erhöhen – zwischengespeicherte PDFs werden dann neu erzeugt */
export const TICKET_VORLAGE = 5;
export const ORT = { name: 'Votivkirche', adresse: 'Rooseveltplatz', plzOrt: '1090 Wien', karte: 'https://www.google.com/maps/search/?api=1&query=Votivkirche%2C+Rooseveltplatz%2C+1090+Wien' };
export const EINLASS_MIN = 30;

export type TicketDaten = {
  id: string; code: string; showId: string; seatId: string; kat: string; art: string; priceCents: number; vatRate: number;
  status: string; checkedInAt: Date | null; startsAt: Date; durationMin: number; titel: string; bestellnummer: string; name: string;
  /** Nummer unter den nicht stornierten Tickets der Bestellung (0 = storniert) */
  nr: number; von: number;
};

type BestellungMitTickets = Order & { customer: Customer | null; tickets: (Ticket & { show: Show })[] };

const sitzSort = (a: string, b: string) => {
  const x = SITZ[a], y = SITZ[b];
  if (!x || !y) return a.localeCompare(b);
  return (x.rollstuhl ? 1 : 0) - (y.rollstuhl ? 1 : 0) || x.reihe - y.reihe || x.platz - y.platz;
};

/** Tickets einer Bestellung in Platzreihenfolge, nummeriert („Ticket 2 von 4“) */
export function ticketsAusBestellung(o: BestellungMitTickets): TicketDaten[] {
  const sortiert = [...o.tickets].sort((a, b) => (a.status === 'storniert' ? 1 : 0) - (b.status === 'storniert' ? 1 : 0) || sitzSort(a.seatId, b.seatId));
  const aktiv = sortiert.filter((t) => t.status !== 'storniert').length;
  const name = o.customer ? `${o.customer.firstName} ${o.customer.lastName}`.trim() : '';
  let n = 0;
  return sortiert.map((t) => ({
    id: t.id, code: t.code, showId: t.showId, seatId: t.seatId, kat: t.kat, art: t.art, priceCents: t.priceCents, vatRate: t.vatRate,
    status: t.status, checkedInAt: t.checkedInAt, startsAt: t.show.startsAt, durationMin: t.show.durationMin, titel: t.show.title,
    bestellnummer: o.number, name, nr: t.status === 'storniert' ? 0 : ++n, von: aktiv,
  }));
}

export async function bestellungMitTickets(where: { id: string } | { manageToken: string }) {
  return db.order.findUnique({ where, include: { customer: true, tickets: { include: { show: true } }, show: true } });
}

const wochentag = (d: Date) => new Intl.DateTimeFormat('de-AT', { timeZone: TZ, weekday: 'long' }).format(d);
const datumLang = (d: Date) => new Intl.DateTimeFormat('de-AT', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' }).format(d);
export const terminText = (d: Date) => `${wochentag(d)}, ${datumLang(d)}, ${fmtZeit(d)} Uhr`;

/** „Reihe 5, Platz 3“ bzw. „Rollstuhlplatz 2 mit Begleitsitz“ – für Beschriftungen */
export const platzText = sitzName;
export const ticketLabel = (t: TicketDaten) => `${t.nr ? `Ticket ${t.nr} von ${t.von}` : 'Storniertes Ticket'}, ${sitzName(t.seatId)}`;

export const ART_TEXT: Record<string, string> = { normal: 'Vollpreis', ermaessigt: 'Ermäßigt', frei: 'Freikarte' };

export async function qrFuer(t: { code: string; showId: string }) {
  const svg = await qrSvg(qrInhalt(t.code, t.showId));
  return svg.replace('<svg ', '<svg aria-hidden="true" focusable="false" width="100%" height="100%" shape-rendering="crispEdges" ');
}

function symbol(kat: string) {
  if (kat === 'R') return '<svg class="lt-sym" viewBox="0 0 16 12" aria-hidden="true"><rect x="1" y="1" width="14" height="10" rx="3" class="lt-sym-r"/></svg>';
  if (kat === 'II') return '<svg class="lt-sym" viewBox="0 0 12 12" aria-hidden="true"><rect x="1" y="1" width="10" height="10" rx="1.5" class="lt-sym-2"/></svg>';
  return '<svg class="lt-sym" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5" class="lt-sym-1"/></svg>';
}

/** Eine Ticketkarte (HTML-Fragment). qr = SVG aus qrFuer() */
export function ticketKarte(t: TicketDaten, o: { variante: Variante; modus: Modus; qr: string; ueberschrift?: 'h1' | 'h2' | 'h3' | 'p' }) {
  const s = SITZ[t.seatId];
  const storniert = t.status === 'storniert';
  const einlass = new Date(t.startsAt.getTime() - EINLASS_MIN * 60e3);
  const H = o.ueberschrift ?? 'h2';
  const katName = t.kat === 'R' ? 'Rollstuhl' : `Kat. ${t.kat}`;
  const platz = s?.rollstuhl
    ? `<div class="lt-feld lt-breit"><span class="lt-k">Rollstuhlplatz</span><span class="lt-w">${s.stellplatz}</span><span class="lt-z">mit Begleitsitz</span></div>`
    : s
      ? `<div class="lt-feld"><span class="lt-k">Reihe</span><span class="lt-w">${s.reihe}</span></div><div class="lt-feld"><span class="lt-k">Platz</span><span class="lt-w">${s.platz}</span></div>`
      : `<div class="lt-feld lt-breit"><span class="lt-k">Platz</span><span class="lt-w lt-w-klein">${esc(t.seatId)}</span></div>`;
  const preis = t.art === 'frei' || t.priceCents === 0
    ? '<span class="lt-preis">kostenlos</span>'
    : `<span class="lt-preis">${formatEur(t.priceCents)}</span> <span class="lt-ust">inkl. ${t.vatRate} % USt</span>`;
  const art = t.kat === 'R' && t.art !== 'frei' ? 'Rollstuhl + Begleitung' : ART_TEXT[t.art] ?? t.art;
  const status = storniert
    ? '<p class="lt-status lt-status-storno">Storniert – berechtigt nicht zum Einlass</p>'
    : t.status === 'eingelassen'
      ? `<p class="lt-status lt-status-ein">Eingelassen${t.checkedInAt ? ` am ${fmtDatumZeit(t.checkedInAt)} Uhr` : ''}</p>`
      : '';
  return `<article class="lt lt-${o.variante}${storniert ? ' lt-storniert' : ''}" aria-label="${esc(ticketLabel(t))}">
  <header class="lt-kopf" style="background-image:linear-gradient(180deg,rgba(7,11,20,.25),rgba(7,11,20,.55) 70%,rgba(7,11,20,.92)),url('${bild('hero-streifen.jpg', o.modus)}')">
    <img class="lt-logo" src="${bild('logo-wortmarke.svg', o.modus)}" alt="Light of Creation">
    <span class="lt-nr">${t.nr ? `Ticket ${t.nr}&thinsp;/&thinsp;${t.von}` : 'Storniert'}</span>
  </header>
  <div class="lt-haupt">
    <${H} class="lt-titel">${esc(t.titel)}</${H}>
    <p class="lt-unter">${ORT.name} · ${ORT.adresse} · <span class="lt-nw">${ORT.plzOrt}</span></p>
    <div class="lt-termin">
      <p class="lt-datum"><span class="lt-wt">${esc(wochentag(t.startsAt))}</span><span class="lt-dt">${esc(datumLang(t.startsAt))}</span></p>
      <p class="lt-zeiten"><span><span class="lt-k">Beginn</span><b>${fmtZeit(t.startsAt)}</b></span><span><span class="lt-k">Einlass ab</span><b>${fmtZeit(einlass)}</b></span></p>
    </div>
    <div class="lt-platz">${platz}<div class="lt-feld lt-kat"><span class="lt-k">Kategorie</span><span class="lt-w lt-w-kat">${symbol(t.kat)}${t.kat === 'R' ? '<span class="lt-katname">Rollstuhl</span>' : esc(t.kat)}</span></div></div>
    <p class="lt-legende" aria-hidden="true"><span${t.kat === 'I' ? ' class="lt-akt"' : ''}>${symbol('I')}Kat. I</span><span${t.kat === 'II' ? ' class="lt-akt"' : ''}>${symbol('II')}Kat. II</span><span${t.kat === 'R' ? ' class="lt-akt"' : ''}>${symbol('R')}Rollstuhl</span></p>
    <p class="lt-sr">Kategorie: ${esc(katName)}</p>
    <div class="lt-art"><span class="lt-artname">${esc(art)}</span><span>${preis}</span></div>
    ${t.art === 'ermaessigt' ? '<p class="lt-nachweis">Ermäßigung: Nachweis beim Einlass erforderlich</p>' : ''}
  </div>
  <div class="lt-perf" aria-hidden="true"><i></i><i></i></div>
  <div class="lt-abschnitt">
    ${status}
    ${storniert ? '' : `<div class="lt-qr" role="img" aria-label="QR-Code für Ticket ${esc(t.code)}">${o.qr}</div>`}
    <p class="lt-code"><span class="lt-k">Ticketcode</span><span class="lt-codewert">${esc(t.code)}</span></p>
    <dl class="lt-meta">
      <div><dt>Bestellung</dt><dd>${esc(t.bestellnummer)}</dd></div>
      ${t.name ? `<div><dt>Name</dt><dd>${esc(t.name)}</dd></div>` : ''}
    </dl>
  </div>
  <footer class="lt-hinweise">
    <p><b>Hinweis:</b> Die Show enthält Stroboskop- und Blitzlichteffekte. Kein Zutritt für Kinder unter 6 Jahren.</p>
    <p>Storno und Umbuchung bis 24 Stunden vor Beginn über „Buchung verwalten“. Es gelten unsere AGB.</p>
  </footer>
</article>`;
}

/** Stile der Karte. Größen in em – die Größe der Karte bestimmt font-size am .lt (bzw. am Umfeld). */
export function ticketCss(modus: Modus) {
  return `${schriftCss(modus)}
.lt{--b:#070b14;--t:#f4efe6;--m:#c4bfb3;--a:#d9b877;--a2:#ecd3a0;--l:#2a3654;--fl:#121b2e;--grund:#0c1322;--s1:#d9b877;--s2:#b3a6ff;--sr:#7cc4ff;
  position:relative;display:flex;flex-direction:column;box-sizing:border-box;width:100%;background:var(--b);color:var(--t);border-radius:1.1em;overflow:hidden;
  font-family:${SCHRIFT_TEXT};font-size:1em;line-height:1.35;-webkit-print-color-adjust:exact;print-color-adjust:exact;text-align:left}
.lt *{box-sizing:border-box}
.lt p,.lt dl,.lt dd,.lt h1,.lt h2,.lt h3{margin:0}
.lt-druck{--b:#fff;--t:#121a2b;--m:#4b5366;--a:#7a5a1c;--a2:#121a2b;--l:#e2dacb;--fl:#f8f4ec;--grund:#fff;--s1:#8a6a1f;--s2:#6a58d8;--sr:#2a6fae;border:.06em solid #d8cfbd}
.lt-kopf{position:relative;height:7.2em;background-size:cover;background-position:center;display:flex;align-items:center;justify-content:center}
.lt-logo{width:11.5em;height:auto;display:block;margin-top:.4em}
.lt-nr{position:absolute;top:.8em;right:.95em;font-size:.68em;letter-spacing:.14em;text-transform:uppercase;color:#ecd3a0;background:rgba(7,11,20,.6);border:.08em solid rgba(217,184,119,.55);border-radius:99em;padding:.3em .8em}
.lt-haupt{padding:1.05em 1.35em .95em}
.lt-titel{font-family:${SCHRIFT_TITEL};font-weight:600;font-size:1.95em;line-height:1;letter-spacing:.01em;color:var(--a2)}
.lt-druck .lt-titel{color:var(--t)}
.lt-nw{white-space:nowrap}
.lt-unter{margin-top:.35em !important;font-size:.72em;letter-spacing:.09em;text-transform:uppercase;color:var(--a)}
.lt-termin{display:flex;justify-content:space-between;align-items:flex-end;gap:.8em;margin-top:.95em !important;padding-top:.85em;border-top:.06em solid var(--l)}
.lt-datum{display:flex;flex-direction:column}
.lt-wt{font-size:.8em;color:var(--m)}
.lt-dt{font-size:1.18em;font-weight:650;letter-spacing:.005em}
.lt-zeiten{display:flex;gap:.95em;text-align:right}
.lt-zeiten>span{display:flex;flex-direction:column}
.lt-zeiten b{font-size:1.18em;font-weight:650;font-variant-numeric:tabular-nums}
.lt-k{display:block;font-size:.62em;letter-spacing:.16em;text-transform:uppercase;color:var(--m);font-weight:600}
.lt-platz{display:flex;gap:.6em;margin-top:.9em !important}
.lt-feld{flex:1 1 0;background:var(--fl);border:.06em solid var(--l);border-radius:.6em;padding:.5em .7em .45em;display:flex;flex-direction:column;min-width:0}
.lt-breit{flex:2.1 1 0}
.lt-w{font-family:${SCHRIFT_TITEL};font-weight:650;font-size:2.7em;line-height:.95;color:var(--a2);font-variant-numeric:lining-nums}
.lt-w-klein{font-size:1.6em}
.lt-z{font-size:.74em;color:var(--m);margin-top:.15em}
.lt-w-kat{display:flex;align-items:center;gap:.16em}
.lt-w-kat .lt-sym{width:.42em;height:.42em}
.lt-katname{font-family:${SCHRIFT_TEXT};font-size:.36em;font-weight:650;letter-spacing:.02em}
.lt-sym{display:inline-block;width:.85em;height:.85em;vertical-align:-.08em;margin-right:.3em;flex:none}
.lt-sym-1{fill:var(--s1)}.lt-sym-2{fill:var(--s2)}.lt-sym-r{fill:var(--sr)}
.lt-legende{display:flex;gap:1em;margin-top:.5em !important;font-size:.66em;color:var(--m)}
.lt-legende .lt-akt{color:var(--t);font-weight:700}
.lt-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.lt-art{display:flex;justify-content:space-between;align-items:baseline;gap:.6em;margin-top:.8em !important;padding-top:.7em;border-top:.06em solid var(--l);font-size:.92em}
.lt-artname{font-weight:650}
.lt-preis{font-weight:700}
.lt-ust{font-size:.82em;color:var(--m)}
.lt-nachweis{margin-top:.3em !important;font-size:.76em;color:var(--a);font-weight:600}
.lt-perf{position:relative;height:1.3em;flex:none}
.lt-perf::before{content:"";position:absolute;left:1.1em;right:1.1em;top:50%;border-top:.12em dashed var(--l)}
.lt-perf i{position:absolute;top:50%;width:1.3em;height:1.3em;margin-top:-.65em;border-radius:50%;background:var(--grund)}
.lt-perf i:first-child{left:-.65em}.lt-perf i:last-child{right:-.65em}
.lt-druck .lt-perf i{border:.06em solid #d8cfbd}
.lt-druck .lt-perf::before{border-top-color:#bdb3a0}
.lt-abschnitt{padding:.55em 1.35em 1em;display:flex;flex-direction:column;align-items:center}
.lt-qr{width:13em;height:13em;background:#fff;border-radius:.7em;padding:.75em;box-shadow:0 0 0 .06em rgba(217,184,119,.45)}
.lt-druck .lt-qr{box-shadow:0 0 0 .06em #cfc5b2}
.lt-qr svg{display:block;width:100%;height:100%}
.lt-code{margin-top:.6em !important;text-align:center}
.lt-codewert{display:block;font-family:ui-monospace,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;font-size:1.28em;font-weight:700;letter-spacing:.2em;padding-left:.2em}
.lt-meta{display:flex;justify-content:center;flex-wrap:wrap;gap:.25em 1.4em;margin-top:.55em !important;font-size:.76em;text-align:center}
.lt-meta dt{font-size:.82em;letter-spacing:.14em;text-transform:uppercase;color:var(--m);font-weight:600}
.lt-meta dd{font-weight:600}
.lt-status{width:100%;text-align:center;font-weight:700;font-size:.88em;border-radius:.5em;padding:.45em .6em;margin-bottom:.6em !important}
.lt-status-storno{background:#3a1416;color:#ffc9c9;border:.06em solid #ff8a8a}
.lt-druck .lt-status-storno{background:#fdecec;color:#8c1d18;border-color:#b3261e}
.lt-status-ein{background:#0f2a1f;color:#b9f0cf;border:.06em solid #7fe0a8}
.lt-druck .lt-status-ein{background:#e9f6ee;color:#14532d;border-color:#1d7a47}
.lt-storniert .lt-kopf{filter:grayscale(1)}
.lt-storniert .lt-codewert{text-decoration:line-through}
.lt-hinweise{margin-top:auto;padding:.7em 1.35em .85em;background:var(--fl);border-top:.06em solid var(--l);font-size:.66em;line-height:1.45;color:var(--m)}
.lt-hinweise b{color:var(--t)}
.lt-hinweise p+p{margin-top:.25em}
`;
}

/** Kleiner Saalplan (SVG-Text) mit markiertem Platz – gleiche Geometrie wie MiniSaalplan */
export function saalplanSvg(seatId: string) {
  const px = (x: number) => (x - 262) * 2.15;
  const py = (y: number) => (y - 90) * 1.65;
  const pos = (s: Sitz) => (s.reihe === 0 ? { x: s.x, y: s.rollstuhl ? 192 : 175 } : { x: s.x, y: s.y });
  const z = SITZ[seatId];
  const teile: string[] = [];
  teile.push(`<rect x="${px(360)}" y="${py(142) - 15}" width="${px(470) - px(360)}" height="30" rx="10" fill="#f6ecd4" stroke="#8a6a1f"/><text x="${(px(360) + px(470)) / 2}" y="${py(142) + 6}" text-anchor="middle" font-size="17" font-weight="600" fill="#6e5118" font-family="${SCHRIFT_TEXT.replace(/"/g, "'")}">ALTAR</text>`);
  for (const s of SITZE) {
    if (s.id === seatId) continue;
    const p = pos(s);
    teile.push(s.rollstuhl ? `<rect x="${px(p.x) - 8}" y="${py(p.y) - 6}" width="16" height="12" rx="3" fill="#cfe0f0"/>` : s.kat === 'II' ? `<rect x="${px(p.x) - 4.5}" y="${py(p.y) - 4.5}" width="9" height="9" rx="1.5" fill="#c3b9f0"/>` : `<circle cx="${px(p.x)}" cy="${py(p.y)}" r="5" fill="#dccb9f"/>`);
  }
  if (z) {
    const p = pos(z);
    teile.push(`<circle cx="${px(p.x)}" cy="${py(p.y)}" r="24" fill="none" stroke="#b3261e" stroke-width="6"/><circle cx="${px(p.x)}" cy="${py(p.y)}" r="10" fill="#121a2b"/>`);
  }
  return `<svg viewBox="-20 -30 ${px(590) + 40} ${py(925) + 50}" role="img" aria-label="Saalplan der Votivkirche, Altar oben. Markiert: ${esc(sitzName(seatId))}">${teile.join('')}</svg>`;
}

/** Seitenformat und Karte je Druckseite (.seite) */
export function seitenCss(format: Format) {
  const a6 = format === 'a6';
  return a6
    ? `@page{size:105mm 148mm;margin:0}.seite{width:105mm;height:148mm;padding:3.2mm}.seite .lt{font-size:2.62mm;height:100%;border-radius:2.6mm}
       .seite .lt-kopf{height:5.3em}.seite .lt-logo{width:9.5em}.seite .lt-haupt{padding:.75em 1.15em .6em}.seite .lt-termin{margin-top:.6em !important;padding-top:.6em}
       .seite .lt-platz{margin-top:.6em !important}.seite .lt-art{margin-top:.55em !important;padding-top:.5em}.seite .lt-perf{height:1em}
       .seite .lt-abschnitt{padding:.2em 1.15em .55em}.seite .lt-qr{width:15.5em;height:15.5em;padding:.6em}
       .seite .lt-code{margin-top:.35em !important}.seite .lt-meta{margin-top:.3em !important;width:100%}.seite .lt-hinweise{padding:.5em 1.15em .6em;font-size:.62em}`
    : `@page{size:A4;margin:0}.seite{width:210mm;height:297mm;padding:14mm 0 0;display:flex;flex-direction:column;align-items:center}
       .seite .lt{flex:none;width:124mm;font-size:3.85mm;border-radius:4.2mm}
       .seite .lt-kopf{height:8.2em}.seite .lt-qr{width:14.5em;height:14.5em}
       .plan{margin-top:7mm;padding:0 4mm;box-sizing:border-box;width:124mm;display:flex;gap:6mm;align-items:center;font:8.5pt/1.45 ${SCHRIFT_TEXT};color:#2b3142}
       .plan svg{height:60mm;width:auto;flex:none}.plan h2{font:600 13pt/1.1 ${SCHRIFT_TITEL};margin:0 0 1.5mm;color:#121a2b}.plan p{margin:0 0 1.2mm}
       .schnitt{margin-top:auto;margin-bottom:9mm;width:124mm;display:flex;justify-content:space-between;font:7.5pt/1.4 ${SCHRIFT_TEXT};color:#6b7183}`;
}

/** Vollständiges HTML-Dokument (eine Karte je Seite) für PDF oder Browser */
export function ticketDokument(karten: { html: string; seatId: string }[], o: { modus: Modus; format: Format; titel: string }) {
  const a6 = o.format === 'a6';
  const seite = seitenCss(o.format);
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.titel)}</title>
<style>${ticketCss(o.modus)}
html,body{margin:0;padding:0;background:#fff}
.seite{box-sizing:border-box;page-break-after:always;break-after:page;overflow:hidden}
.seite:last-child{page-break-after:auto;break-after:auto}
${seite}
@media screen{body{background:#e9e5dc}.seite{background:#fff;margin:6mm auto;box-shadow:0 1px 6px rgba(0,0,0,.18)}}
</style></head><body>${karten.map((k) => `<section class="seite">${k.html}${a6 ? '' : `<div class="plan">${saalplanSvg(k.seatId)}<div><h2>Ihr Platz im Saal</h2><p><b>${esc(sitzName(k.seatId))}</b> – im Plan rot markiert, der Altar ist oben.</p><p>Einlass ab ${EINLASS_MIN} Minuten vor Beginn. Bitte halten Sie den QR-Code bereit – ausgedruckt oder am Handy.</p><p>${ORT.name}, ${ORT.adresse}, ${ORT.plzOrt}</p></div></div>`}${a6 ? '' : '<p class="schnitt"><span>Parnassus Immersive GmbH · Light of Creation</span><span>light-of-creation.com</span></p>'}</section>`).join('')}</body></html>`;
}

/** Fingerabdruck aller Angaben, die auf dem Ticket stehen */
function fingerabdruck(o: BestellungMitTickets, liste: TicketDaten[], format: Format, variante: Variante) {
  const daten = [TICKET_VORLAGE, format, variante, o.number, liste.map((t) => [t.id, t.code, t.seatId, t.showId, t.status, t.art, t.priceCents, t.vatRate, t.startsAt.toISOString(), t.titel, t.name, t.checkedInAt?.toISOString() ?? '', t.nr, t.von])];
  return createHash('sha256').update(JSON.stringify(daten)).digest('hex').slice(0, 20);
}

/**
 * Tickets einer Bestellung als PDF (ohne stornierte). Zwischengespeichert unter DATA_DIR/tickets/<Bestellung>/<Fingerabdruck>.pdf –
 * ändert sich etwas (Storno, Umsetzen, Einlass, Layout), entsteht ein neues PDF und die alten Dateien werden entfernt.
 */
export async function ticketsPdf(o: BestellungMitTickets, opt: { format?: Format; variante?: Variante } = {}): Promise<{ pdf: Buffer; name: string } | null> {
  const format = opt.format ?? 'a4';
  const variante = opt.variante ?? 'druck';
  const liste = ticketsAusBestellung(o).filter((t) => t.status !== 'storniert');
  if (!liste.length) return null;
  const name = `Tickets-${o.number}${format === 'a6' ? '-A6' : ''}.pdf`;
  const ordner = `tickets/${o.id.replace(/[^\w-]/g, '')}`;
  const rel = `${ordner}/${format}-${variante}-${fingerabdruck(o, liste, format, variante)}.pdf`;
  try { return { pdf: await lesen(rel), name }; } catch { /* neu erzeugen */ }
  const karten = await Promise.all(liste.map(async (t) => ({ html: ticketKarte(t, { variante, modus: 'pdf', qr: await qrFuer(t) }), seatId: t.seatId })));
  const html = ticketDokument(karten, { modus: 'pdf', format, titel: `Tickets ${o.number} – Light of Creation` });
  const pdf = await htmlToPdf(html, await pdfBeilagen(['hero-streifen.jpg', 'logo-wortmarke.svg']));
  await ablegen(rel, pdf);
  // Ältere Fassungen derselben Ausführung entfernen
  try {
    const vorne = `${format}-${variante}-`;
    for (const f of await readdir(absolut(ordner))) if (f.startsWith(vorne) && `${ordner}/${f}` !== rel) await unlink(absolut(`${ordner}/${f}`)).catch(() => {});
  } catch { /* egal */ }
  return { pdf, name };
}

/** Kalendereintrag (.ics) für die Vorstellung */
export function kalenderIcs(o: { number: string; manageToken: string }, t: { startsAt: Date; durationMin: number; titel: string }, plaetze: string[], basis: string) {
  const z = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const txt = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`);
  const falten = (zeile: string) => {
    const teile: string[] = [];
    let rest = zeile;
    while (Buffer.byteLength(rest) > 74) {
      let n = 74;
      while (Buffer.byteLength(rest.slice(0, n)) > 74) n--;
      teile.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    teile.push(rest);
    return teile.join('\r\n ');
  };
  const url = `${basis}/t/${o.manageToken}`;
  const ende = new Date(t.startsAt.getTime() + (t.durationMin || 30) * 60e3);
  const zeilen = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Parnassus Immersive GmbH//Light of Creation//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${o.number}@light-of-creation.com`, `DTSTAMP:${z(new Date())}`, `DTSTART:${z(t.startsAt)}`, `DTEND:${z(ende)}`,
    `SUMMARY:${txt(t.titel)}`, `LOCATION:${txt(`${ORT.name}, ${ORT.adresse}, ${ORT.plzOrt}`)}`,
    `DESCRIPTION:${txt(`Bestellung ${o.number}\n${plaetze.join('\n')}\nEinlass ab ${EINLASS_MIN} Minuten vor Beginn.\nTickets: ${url}`)}`,
    `URL:${url}`,
    'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', `DESCRIPTION:${txt(t.titel)}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return zeilen.map(falten).join('\r\n') + '\r\n';
}

/** Öffentliche Adresse des Backends (Links in Mails) */
export const backendUrl = () => (process.env.APP_ORIGIN ?? '').replace(/\/$/, '');
export const shopUrl = () => (process.env.PUBLIC_ORIGIN ?? '').replace(/\/$/, '');
