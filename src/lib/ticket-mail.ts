// Buchungsbestätigung im Ticket-Look: dunkler Kopf, Gold, jedes Ticket als Karte mit QR.
// Mailtauglich: Tabellen, Inline-Stile, max. 600 px, Webschriften nur als Zusatz (Georgia/Arial als Ersatz).
import { fmtZeit } from './dates';
import { esc } from './marke';
import { formatEur } from './money';
import { SITZ } from './saal';
import { ART_TEXT, EINLASS_MIN, ORT, terminText, type TicketDaten } from './ticket-html';

const SERIF = "Inter,'Helvetica Neue',Helvetica,Arial,sans-serif";
const SANS = "Inter,'Helvetica Neue',Helvetica,Arial,sans-serif";

/** Ticketkarten + Knöpfe; ersetzt {{tickets_html}} in der Vorlage „buchung“ */
export function ticketKartenMail(liste: { t: TicketDaten; cid: string }[], links: { mobil: string; pdf: string; verwalten: string }) {
  const knopf = (href: string, text: string, gold: boolean) =>
    `<a href="${esc(href)}" style="display:inline-block;padding:13px 22px;border-radius:999px;font:700 15px/1.2 ${SANS};text-decoration:none;${gold ? 'background:#d9b877;color:#070b14;border:1px solid #d9b877' : 'background:#ffffff;color:#121a2b;border:1px solid #b9ae98'}">${text}</a>`;
  const karten = liste.map(({ t, cid }) => {
    const s = SITZ[t.seatId];
    const einlass = new Date(t.startsAt.getTime() - EINLASS_MIN * 60e3);
    const zelle = (k: string, w: string | number, breit = false) =>
      `<td valign="top" style="padding:10px 12px;background:#121b2e;border:1px solid #2a3654;border-radius:10px;${breit ? '' : 'width:33%;'}"><div style="font:600 10px/1.2 ${SANS};letter-spacing:2px;text-transform:uppercase;color:#c4bfb3">${k}</div><div style="font:600 30px/1.05 ${SERIF};color:#ecd3a0;padding-top:2px">${w}</div></td>`;
    const platz = s?.rollstuhl
      ? `${zelle('Rollstuhlplatz', s.stellplatz ?? '', true)}<td style="width:8px"></td>${zelle('Begleitsitz', 'inkl.', true)}`
      : s ? `${zelle('Reihe', s.reihe)}<td style="width:8px"></td>${zelle('Platz', s.platz)}<td style="width:8px"></td>${zelle('Kategorie', esc(t.kat))}` : zelle('Platz', esc(t.seatId), true);
    const preis = t.art === 'frei' || t.priceCents === 0 ? 'Freikarte' : `${formatEur(t.priceCents)} <span style="color:#c4bfb3;font-weight:400">inkl. ${t.vatRate} % USt</span>`;
    const art = t.kat === 'R' ? 'Rollstuhlplatz inkl. Begleitperson' : ART_TEXT[t.art] ?? t.art;
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;background:#070b14;border-radius:16px;border:1px solid #2a3654">
<tr><td style="padding:16px 20px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="font:600 22px/1.1 ${SERIF};color:#ecd3a0">${esc(t.titel)}</td>
    <td align="right" style="font:600 11px/1.2 ${SANS};letter-spacing:2px;text-transform:uppercase;color:#d9b877;white-space:nowrap">Ticket ${t.nr} von ${t.von}</td>
  </tr></table>
  <div style="font:400 14px/1.5 ${SANS};color:#f4efe6;padding-top:6px">${esc(terminText(t.startsAt))} · Einlass ab ${fmtZeit(einlass)} Uhr</div>
</td></tr>
<tr><td style="padding:12px 20px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate"><tr>${platz}</tr></table></td></tr>
<tr><td style="padding:10px 20px 0;font:400 14px/1.5 ${SANS};color:#f4efe6"><strong>${esc(art)}</strong> · ${preis}${t.art === 'ermaessigt' ? `<br><span style="color:#ecd3a0">Nachweis beim Einlass erforderlich</span>` : ''}</td></tr>
<tr><td style="padding:14px 20px 0"><div style="border-top:2px dashed #2a3654;font-size:0;line-height:0">&nbsp;</div></td></tr>
<tr><td align="center" style="padding:16px 20px 18px">
  <table role="presentation" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px"><tr><td style="padding:12px"><img src="cid:${cid}" width="180" height="180" alt="QR-Code für Ticket ${esc(t.code)}" style="display:block;width:180px;height:180px;border:0"></td></tr></table>
  <div style="font:600 10px/1.2 ${SANS};letter-spacing:2px;text-transform:uppercase;color:#c4bfb3;padding-top:12px">Ticketcode</div>
  <div style="font:700 20px/1.3 'Courier New',Courier,monospace;letter-spacing:4px;color:#f4efe6">${esc(t.code)}</div>
</td></tr>
</table>`;
  });
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 8px"><tr><td align="center">${knopf(links.mobil, 'Tickets am Handy öffnen', true)}</td></tr>
<tr><td align="center" style="padding-top:8px;font:400 13px/1.5 ${SANS};color:#525b6e">oder <a href="${esc(links.pdf)}" style="color:#7a5a1c">als PDF herunterladen</a> (auch im Anhang dieser E-Mail)</td></tr></table>
<div style="margin:18px 0 6px">${karten.join('')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 6px"><tr><td align="center">${knopf(links.verwalten, 'Buchung verwalten', false)}</td></tr></table>`;
}

/** Rahmen der Buchungsbestätigung (statt des schlichten Layouts aus mail.ts) */
export function markenLayout(titel: string, inhaltHtml: string, fussHtml: string, vorschau = '') {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><title>${esc(titel)}</title></head>
<body style="margin:0;padding:0;background:#efe9de;font-family:${SANS};color:#121a2b">
${vorschau ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${esc(vorschau)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#efe9de"><tr><td align="center" style="padding:24px 10px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden">
<tr><td align="center" style="background:#070b14;padding:30px 24px 24px">
  <div style="font:600 34px/1 ${SERIF};letter-spacing:1px;color:#ecd3a0">Light of Creation</div>
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:12px"><tr><td style="width:40px;border-top:1px solid #d9b877;font-size:0">&nbsp;</td><td style="padding:0 12px;font:600 11px/1 ${SANS};letter-spacing:4px;text-transform:uppercase;color:#d9b877">${esc(ORT.name)} Wien</td><td style="width:40px;border-top:1px solid #d9b877;font-size:0">&nbsp;</td></tr></table>
</td></tr>
<tr><td style="height:4px;background:#d9b877;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:30px 28px 16px;font:400 16px/1.6 ${SANS};color:#121a2b">${inhaltHtml}</td></tr>
<tr><td style="padding:18px 28px 22px;background:#f3efe7;border-top:1px solid #e2dacb;font:400 13px/1.55 ${SANS};color:#4b5366">${fussHtml}</td></tr>
</table></td></tr></table></body></html>`;
}
