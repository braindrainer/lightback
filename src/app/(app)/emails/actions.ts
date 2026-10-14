'use server';
import { revalidatePath } from 'next/cache';
import { aenderung, audit } from '@/lib/audit';
import { assertRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fuellen, fussText, layout, senden, STANDARD_VORLAGEN } from '@/lib/mail';
import { ticketMail } from '@/lib/orders';
import type { Ergebnis } from '@/components/system/Formular';
import { BEISPIEL } from './vorlagen/platzhalter';

export async function erneutSenden(_p: Ergebnis, fd: FormData): Promise<Ergebnis> {
  const ich = await assertRole('leitung');
  const m = await db.emailLog.findUnique({ where: { id: String(fd.get('id')) } });
  if (!m) return { fehler: 'Mail nicht gefunden.' };
  // Buchungsbestätigung neu erzeugen, damit die QR-Codes als Anhang wieder dabei sind
  const r = (m.template === 'buchung' || m.template === 'freikarte') && m.orderId ? await ticketMail(m.orderId) : await senden({ to: m.to, subject: m.subject, html: m.html, template: m.template, orderId: m.orderId ?? undefined });
  await audit(ich, 'mail_erneut', 'email', m.id, { to: m.to, template: m.template, neu: r?.id });
  revalidatePath('/emails');
  if (!r) return { fehler: 'Für diese Bestellung gibt es keine E-Mail-Adresse.' };
  return r.ok ? { ok: 'demo' in r && r.demo ? 'Erneut erzeugt (Demo-Modus/kein SMTP: nicht verschickt, steht im Protokoll).' : `Erneut an ${m.to} gesendet.` } : { fehler: `Versand fehlgeschlagen: ${'fehler' in r ? r.fehler : ''}` };
}

const pruefen = (key: string, subject: string, body: string) => {
  if (!STANDARD_VORLAGEN[key]) return 'Unbekannte Vorlage.';
  if (!subject.trim() || subject.length > 200) return 'Der Betreff fehlt oder ist zu lang (max. 200 Zeichen).';
  if (!body.trim() || body.length > 20000) return 'Der Text fehlt oder ist zu lang.';
  return null;
};

export async function vorlageSpeichern(key: string, subject: string, body: string): Promise<Ergebnis> {
  const ich = await assertRole('leitung');
  const f = pruefen(key, subject, body);
  if (f) return { fehler: f };
  const alt = await db.emailTemplate.findUnique({ where: { key } });
  await db.emailTemplate.upsert({ where: { key }, update: { subject, body }, create: { key, subject, body } });
  await audit(ich, 'vorlage_gespeichert', 'emailTemplate', key, undefined, aenderung(alt ?? { subject: STANDARD_VORLAGEN[key].subject, body: STANDARD_VORLAGEN[key].body }, { subject, body }));
  revalidatePath('/emails/vorlagen');
  return { ok: 'Vorlage gespeichert. Neue Mails verwenden sie ab sofort.' };
}

export async function vorlageZuruecksetzen(key: string): Promise<Ergebnis> {
  const ich = await assertRole('leitung');
  if (!STANDARD_VORLAGEN[key]) return { fehler: 'Unbekannte Vorlage.' };
  await db.emailTemplate.deleteMany({ where: { key } });
  await audit(ich, 'vorlage_zurueckgesetzt', 'emailTemplate', key);
  revalidatePath('/emails/vorlagen');
  return { ok: 'Auf den Standardtext zurückgesetzt.' };
}

async function bauen(key: string, subject: string, body: string) {
  const werte = BEISPIEL[key] ?? {};
  const betreff = fuellen(subject, werte);
  return { betreff, html: layout(betreff, fuellen(body, werte), await fussText()) };
}

export async function vorschau(key: string, subject: string, body: string): Promise<Ergebnis> {
  await assertRole('leitung');
  const f = pruefen(key, subject, body);
  if (f) return { fehler: f };
  const b = await bauen(key, subject, body);
  return { ok: `Betreff: ${b.betreff}`, html: b.html };
}

export async function testmail(key: string, subject: string, body: string): Promise<Ergebnis> {
  const ich = await assertRole('leitung');
  const f = pruefen(key, subject, body);
  if (f) return { fehler: f };
  const b = await bauen(key, subject, body);
  const r = await senden({ to: ich.email, subject: `[Test] ${b.betreff}`, html: b.html, template: `test-${key}` });
  return r.ok ? { ok: 'demo' in r && r.demo ? `Testmail an ${ich.email} erzeugt – Demo-Modus/kein SMTP, daher nur im Protokoll.` : `Testmail an ${ich.email} gesendet.` } : { fehler: `Versand fehlgeschlagen: ${'fehler' in r ? r.fehler : ''}` };
}
