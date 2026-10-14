// E-Mail-Versand mit Protokoll. Ohne SMTP-Zugang (oder im Demo-Modus) wird nichts verschickt,
// die Mail landet mit Status "demo" im Protokoll und ist dort vollständig ansehbar.
import nodemailer from 'nodemailer';
import { db, getSettings } from './db';
import { decrypt } from './secret';

export type Anhang = { filename: string; content: Buffer; contentType: string; cid?: string };

export async function senden(m: { to: string; subject: string; html: string; template: string; orderId?: string; anhaenge?: Anhang[] }) {
  const s = await getSettings();
  const log = await db.emailLog.create({ data: { to: m.to, subject: m.subject, template: m.template, orderId: m.orderId, html: m.html, status: 'wartet' } });
  if (!s.smtpHost || s.demoMode) {
    await db.emailLog.update({ where: { id: log.id }, data: { status: 'demo' } });
    return { ok: true, demo: true, id: log.id };
  }
  try {
    const t = nodemailer.createTransport({
      host: s.smtpHost, port: s.smtpPort, secure: s.smtpPort === 465,
      auth: s.smtpUser ? { user: s.smtpUser, pass: s.smtpPassEnc ? decrypt(s.smtpPassEnc) : '' } : undefined,
    });
    await t.sendMail({ from: s.mailFrom, to: m.to, bcc: s.mailBcc || undefined, subject: m.subject, html: m.html, text: textVersion(m.html), attachments: m.anhaenge });
    await db.emailLog.update({ where: { id: log.id }, data: { status: 'gesendet', sentAt: new Date() } });
    return { ok: true, id: log.id };
  } catch (e) {
    await db.emailLog.update({ where: { id: log.id }, data: { status: 'fehler', error: (e as Error).message } });
    return { ok: false, id: log.id, fehler: (e as Error).message };
  }
}

const textVersion = (html: string) => html.replace(/<br\s*\/?>/g, '\n').replace(/<\/(p|h\d|li|tr)>/g, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Platzhalter {{name}} ersetzen (Werte werden HTML-maskiert, außer Schlüssel mit _html) */
export function fuellen(vorlage: string, werte: Record<string, string>) {
  return vorlage.replace(/\{\{(\w+)\}\}/g, (_, k: string) => (k.endsWith('_html') ? (werte[k] ?? '') : esc(werte[k] ?? '')));
}

/** Schlichtes, barrierearmes Mail-Layout (Tabellen für Mailprogramme, echte Überschriften, hoher Kontrast) */
export function layout(titel: string, inhaltHtml: string, fuss: string) {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(titel)}</title></head>
<body style="margin:0;background:#f6f2e9;font-family:Helvetica,Arial,sans-serif;color:#121a2b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:#070b14;padding:22px 28px;color:#ecd3a0;font-family:Georgia,serif;font-size:22px;letter-spacing:.04em">Light of Creation</td></tr>
<tr><td style="padding:28px;font-size:16px;line-height:1.6">${inhaltHtml}</td></tr>
<tr><td style="padding:18px 28px;background:#f3efe7;font-size:13px;line-height:1.5;color:#525b6e">${fuss}</td></tr>
</table></td></tr></table></body></html>`;
}

export const STANDARD_VORLAGEN: Record<string, { subject: string; body: string }> = {
  buchung: {
    subject: 'Ihre Tickets für Light of Creation – {{datum}}',
    body: `<h1 style="font-size:24px;margin:0 0 12px">Danke für Ihre Buchung, {{vorname}}!</h1>
<p>Ihre Tickets für <strong>{{datum}}, {{uhrzeit}} Uhr</strong> in der Votivkirche, Rooseveltplatz, 1090 Wien.</p>
{{tickets_html}}
<p>Zeigen Sie den QR-Code beim Einlass am Handy oder ausgedruckt. Einlass ab 30 Minuten vor Beginn.</p>
<p><strong>Buchungsnummer:</strong> {{bestellnummer}} · <strong>Gesamt:</strong> {{summe}} (inkl. 13 % USt.)</p>
<p>Bis 24 Stunden vor der Vorstellung können Sie <a href="{{verwalten_url}}">Ihre Buchung kostenlos stornieren oder umbuchen</a>.</p>
<p><strong>Hinweis:</strong> Die Show verwendet Stroboskop- und Blitzlichteffekte.</p>`,
  },
  storno: {
    subject: 'Stornobestätigung {{bestellnummer}}',
    body: `<h1 style="font-size:24px;margin:0 0 12px">Ihre Stornierung</h1>
<p>Guten Tag {{vorname}} {{nachname}},</p>
<p>wir haben folgende Tickets der Buchung {{bestellnummer}} storniert: {{plaetze}}.</p>
<p>{{erstattung}}</p>`,
  },
  absage: {
    subject: 'Absage der Vorstellung am {{datum}}',
    body: `<h1 style="font-size:24px;margin:0 0 12px">Ihre Vorstellung muss leider entfallen</h1>
<p>Guten Tag {{vorname}} {{nachname}},</p>
<p>die Vorstellung am {{datum}} um {{uhrzeit}} Uhr kann leider nicht stattfinden. {{grund}}</p>
<p>{{erstattung}}</p>
<p>Gerne buchen wir Sie auf einen anderen Termin um: Antworten Sie einfach auf diese E-Mail.</p>`,
  },
  freikarte: {
    subject: 'Ihre Einladung zu Light of Creation – {{datum}}',
    body: `<h1 style="font-size:24px;margin:0 0 12px">Sie sind eingeladen, {{vorname}}!</h1>
<p>Wir freuen uns, Sie am <strong>{{datum}} um {{uhrzeit}} Uhr</strong> in der Votivkirche, Rooseveltplatz, 1090 Wien, begrüßen zu dürfen.</p>
{{tickets_html}}
<p>Zeigen Sie den QR-Code beim Einlass am Handy oder ausgedruckt. Einlass ab 30 Minuten vor Beginn.</p>
<p><strong>Buchungsnummer:</strong> {{bestellnummer}}</p>
<p>Falls Sie verhindert sind, geben Sie uns bitte kurz Bescheid – dann können wir die Plätze weitergeben.</p>
<p><strong>Hinweis:</strong> Die Show verwendet Stroboskop- und Blitzlichteffekte.</p>`,
  },
  info: {
    subject: '{{betreff}}',
    body: `<h1 style="font-size:24px;margin:0 0 12px">{{betreff}}</h1>
<p>Guten Tag {{vorname}} {{nachname}},</p>
{{text_html}}
<p>Ihre Vorstellung: <strong>{{datum}}, {{uhrzeit}} Uhr</strong>, Votivkirche, Rooseveltplatz, 1090 Wien.</p>`,
  },
  abbruch: {
    subject: 'Abbruch der Vorstellung am {{datum}}',
    body: `<h1 style="font-size:24px;margin:0 0 12px">Ihre Vorstellung musste abgebrochen werden</h1>
<p>Guten Tag {{vorname}} {{nachname}},</p>
<p>die Vorstellung am {{datum}} um {{uhrzeit}} Uhr mussten wir leider abbrechen. {{grund}} Wir bitten um Entschuldigung.</p>
<p>{{erstattung}}</p>
<p>Den Gutschein können Sie im Webshop oder an der Kassa für einen neuen Termin einlösen.</p>`,
  },
  reservierung_verfallen: {
    subject: 'Ihre Reservierung {{bestellnummer}} ist verfallen',
    body: `<h1 style="font-size:24px;margin:0 0 12px">Ihre Reservierung ist verfallen</h1>
<p>Guten Tag {{vorname}} {{nachname}},</p>
<p>Ihre Reservierung {{bestellnummer}} für die Vorstellung am {{datum}} um {{uhrzeit}} Uhr war bis {{frist}} Uhr nicht bezahlt. Die Plätze haben wir deshalb freigegeben.</p>
<p>Restkarten gibt es an der Abendkasse, solange Plätze frei sind.</p>`,
  },
  erinnerung: {
    subject: 'Morgen bei Light of Creation',
    body: `<h1 style="font-size:24px;margin:0 0 12px">Bis morgen, {{vorname}}!</h1>
<p>Ihre Vorstellung: <strong>{{datum}}, {{uhrzeit}} Uhr</strong>, Votivkirche, Rooseveltplatz, 1090 Wien.</p>
<p>Ihre Tickets finden Sie in der Buchungsbestätigung oder unter <a href="{{verwalten_url}}">Buchung verwalten</a>.</p>`,
  },
};

export async function vorlage(key: string) {
  const v = await db.emailTemplate.findUnique({ where: { key } });
  return v ?? { key, ...STANDARD_VORLAGEN[key] };
}

export async function fussText() {
  const s = await getSettings();
  return `${esc(s.companyName)} · ${esc(s.street)}, ${esc(s.zip)} ${esc(s.city)} · ${esc(s.fn)} · ${esc(s.uid)}<br>${esc(s.email)} · ${esc(s.phone)}`;
}
