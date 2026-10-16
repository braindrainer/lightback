// Gutschein als Karte: Mail an die Kund:in (Vorlage „gutschein“) mit QR-Code des Codes
import { audit } from './audit';
import type { Nutzer } from './auth';
import { db } from './db';
import { fmtDatum } from './dates';
import { fussText, fuellen, senden, vorlage } from './mail';
import { esc } from './marke';
import { formatEur } from './money';
import { shopUrl } from './ticket-html';
import { qrPng } from './tickets';
import { markenLayout } from './ticket-mail';

const SERIF = "Inter,'Helvetica Neue',Helvetica,Arial,sans-serif";
const SANS = "Inter,'Helvetica Neue',Helvetica,Arial,sans-serif";

/** Gutscheinkarte für Mails (Tabellen, Inline-Stile) */
export function gutscheinKarteMail(v: { code: string; valueCents: number; remainingCents: number; validUntil: Date | null }, cid: string) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;background:#070b14;border-radius:16px;border:1px solid #2a3654">
<tr><td style="padding:20px 22px 0">
  <div style="font:600 11px/1.2 ${SANS};letter-spacing:3px;text-transform:uppercase;color:#d9b877">Gutschein</div>
  <div style="font:600 46px/1.05 ${SERIF};color:#ecd3a0;padding-top:6px">${formatEur(v.remainingCents)}</div>
  ${v.remainingCents !== v.valueCents ? `<div style="font:400 13px/1.4 ${SANS};color:#c4bfb3">Restwert von ${formatEur(v.valueCents)}</div>` : ''}
</td></tr>
<tr><td style="padding:16px 22px 0"><div style="border-top:2px dashed #2a3654;font-size:0;line-height:0">&nbsp;</div></td></tr>
<tr><td align="center" style="padding:18px 22px 20px">
  <table role="presentation" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px"><tr><td style="padding:10px"><img src="cid:${cid}" width="150" height="150" alt="QR-Code des Gutscheins ${esc(v.code)}" style="display:block;width:150px;height:150px;border:0"></td></tr></table>
  <div style="font:600 10px/1.2 ${SANS};letter-spacing:2px;text-transform:uppercase;color:#c4bfb3;padding-top:12px">Gutscheincode</div>
  <div style="font:700 22px/1.3 'Courier New',Courier,monospace;letter-spacing:3px;color:#f4efe6">${esc(v.code)}</div>
  <div style="font:400 13px/1.5 ${SANS};color:#c4bfb3;padding-top:6px">${v.validUntil ? `Gültig bis ${fmtDatum(v.validUntil)}` : 'Unbefristet gültig'}</div>
</td></tr></table>`;
}

/** Gutschein per E-Mail schicken (protokolliert) */
export async function gutscheinMail(id: string, an: string, name: string, u: Nutzer) {
  const v = await db.voucher.findUniqueOrThrow({ where: { id } });
  if (!v.active) throw new Error('Der Gutschein ist deaktiviert');
  const cid = `gs-${v.code}@loc`;
  const vl = await vorlage('gutschein');
  const werte = {
    name, anrede: name ? `Guten Tag ${name},` : 'Guten Tag,', code: v.code, wert: formatEur(v.remainingCents), gueltig_bis: v.validUntil ? fmtDatum(v.validUntil) : 'unbefristet',
    shop_url: shopUrl(), gutschein_html: gutscheinKarteMail(v, cid),
  };
  const titel = fuellen(vl.subject, werte);
  const r = await senden({
    to: an, subject: titel, template: 'gutschein',
    html: markenLayout(titel, fuellen(vl.body, werte), await fussText(), `Gutschein ${v.code} über ${formatEur(v.remainingCents)}`),
    anhaenge: [{ filename: `gutschein-${v.code}.png`, content: await qrPng(v.code), contentType: 'image/png', cid }],
  });
  await audit(u, 'gutschein_gesendet', 'voucher', v.id, { code: v.code, an, mailId: r.id, ok: r.ok });
  return r;
}
