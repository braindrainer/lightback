'use server';
import nodemailer from 'nodemailer';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { aenderung, audit, maskieren } from '@/lib/audit';
import { assertRole } from '@/lib/auth';
import { db, getSettings } from '@/lib/db';
import { renderNumber } from '@/lib/invoice-calc';
import { decrypt, encrypt } from '@/lib/secret';
import type { Ergebnis } from '@/components/system/Formular';

const txt = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const fehlerText = (e: unknown) => (e instanceof z.ZodError ? e.issues.map((i) => i.message).join(' ') : (e as Error).message);
const fertig = () => revalidatePath('/', 'layout');

export async function firmaSpeichern(_p: Ergebnis, fd: FormData): Promise<Ergebnis> {
  const ich = await assertRole('admin');
  try {
    const pflicht = (m: string) => z.string().min(1, m).max(200);
    const d = z.object({
      companyName: pflicht('Firmenname fehlt.'), street: pflicht('Straße fehlt.'), zip: pflicht('PLZ fehlt.'), city: pflicht('Ort fehlt.'), country: pflicht('Land fehlt.'),
      fn: z.string().max(60), court: z.string().max(100), uid: z.string().max(30), managingDirector: z.string().max(200),
      email: z.email('Bitte eine gültige E-Mail-Adresse angeben.'), phone: z.string().max(40),
      iban: z.string().max(40).transform((v) => v.replace(/\s+/g, '').toUpperCase()), bic: z.string().max(11).transform((v) => v.toUpperCase()),
    }).parse(Object.fromEntries(['companyName', 'street', 'zip', 'city', 'country', 'fn', 'court', 'uid', 'managingDirector', 'email', 'phone', 'iban', 'bic'].map((k) => [k, txt(fd, k)])));
    const alt = await getSettings();
    await db.settings.update({ where: { id: 1 }, data: d });
    await audit(ich, 'einstellungen_firma', 'settings', '1', undefined, aenderung(alt, d));
    fertig();
    return { ok: 'Firmendaten gespeichert.' };
  } catch (e) { return { fehler: fehlerText(e) }; }
}

export async function rechnungenSpeichern(_p: Ergebnis, fd: FormData): Promise<Ergebnis> {
  const ich = await assertRole('admin');
  try {
    const d = z.object({
      invoicePrefix: z.string().max(10).regex(/^[A-Za-z0-9-]*$/, 'Präfix: nur Buchstaben, Ziffern und Bindestrich.'),
      invoiceNumberFmt: z.string().min(3).max(40).regex(/\{N{3,8}\}/, 'Das Format braucht eine laufende Nummer, z. B. {NNNNN}.'),
      orderPrefix: z.string().min(1, 'Bestellpräfix fehlt.').max(10).regex(/^[A-Z0-9]+$/, 'Bestellpräfix: nur Großbuchstaben und Ziffern.'),
    }).parse({ invoicePrefix: txt(fd, 'invoicePrefix'), invoiceNumberFmt: txt(fd, 'invoiceNumberFmt'), orderPrefix: txt(fd, 'orderPrefix').toUpperCase() });
    const alt = await getSettings();
    await db.settings.update({ where: { id: 1 }, data: d });
    await audit(ich, 'einstellungen_rechnungen', 'settings', '1', undefined, aenderung(alt, d));
    fertig();
    return { ok: `Gespeichert. Nächste Rechnungsnummer etwa: ${renderNumber(d.invoiceNumberFmt, d.invoicePrefix, new Date(), 1)}` };
  } catch (e) { return { fehler: fehlerText(e) }; }
}

export async function mailSpeichern(_p: Ergebnis, fd: FormData): Promise<Ergebnis> {
  const ich = await assertRole('admin');
  try {
    const d = z.object({
      smtpHost: z.string().max(200).regex(/^[A-Za-z0-9.-]*$/, 'SMTP-Server: nur Hostname, z. B. smtp.example.com.'),
      smtpPort: z.coerce.number().int().min(1, 'Port 1–65535.').max(65535, 'Port 1–65535.'),
      smtpUser: z.string().max(200), mailFrom: z.string().min(3, 'Absender fehlt.').max(200),
      mailBcc: z.string().max(200).refine((v) => !v || z.email().safeParse(v).success, 'Bcc: eine gültige E-Mail-Adresse oder leer.'),
    }).parse({ smtpHost: txt(fd, 'smtpHost'), smtpPort: txt(fd, 'smtpPort') || '587', smtpUser: txt(fd, 'smtpUser'), mailFrom: txt(fd, 'mailFrom'), mailBcc: txt(fd, 'mailBcc') });
    const pw = String(fd.get('smtpPass') ?? '');
    const loeschen = fd.get('smtpPassLoeschen') === 'on';
    const alt = await getSettings();
    await db.settings.update({ where: { id: 1 }, data: { ...d, ...(pw ? { smtpPassEnc: encrypt(pw) } : loeschen ? { smtpPassEnc: '' } : {}) } });
    const diff = aenderung(alt, d);
    if (pw || loeschen) { diff.vorher.smtpPasswort = alt.smtpPassEnc ? 'gesetzt' : 'leer'; diff.nachher.smtpPasswort = pw ? 'neu gesetzt' : 'entfernt'; }
    await audit(ich, 'einstellungen_mail', 'settings', '1', undefined, diff);
    fertig();
    return { ok: 'E-Mail-Einstellungen gespeichert.' };
  } catch (e) { return { fehler: fehlerText(e) }; }
}

export async function mailTesten(): Promise<Ergebnis> {
  await assertRole('admin');
  const s = await getSettings();
  if (!s.smtpHost) return { fehler: 'Kein SMTP-Server eingetragen.' };
  try {
    const t = nodemailer.createTransport({ host: s.smtpHost, port: s.smtpPort, secure: s.smtpPort === 465, auth: s.smtpUser ? { user: s.smtpUser, pass: s.smtpPassEnc ? decrypt(s.smtpPassEnc) : '' } : undefined, connectionTimeout: 10_000, greetingTimeout: 10_000 });
    await t.verify();
    return { ok: `Verbindung zu ${s.smtpHost}:${s.smtpPort} klappt, Anmeldung erfolgreich.` };
  } catch (e) {
    return { fehler: `Verbindung fehlgeschlagen: ${(e as Error).message}` };
  }
}

type Konfig = {
  hobex?: { entityId?: string; tokenEnc?: string; live?: boolean };
  stripe?: { publishableKey?: string; secretKeyEnc?: string; webhookSecretEnc?: string };
  paypal?: { clientId?: string; secretEnc?: string; live?: boolean };
};

/** Geheimnis: leer = unverändert, "-" = löschen, sonst neu verschlüsseln */
const geheim = (neu: string, alt?: string) => (neu === '-' ? undefined : neu ? encrypt(neu) : alt);

export async function zahlungSpeichern(_p: Ergebnis, fd: FormData): Promise<Ergebnis> {
  const ich = await assertRole('admin');
  try {
    const s = await getSettings();
    const alt = (s.paymentConfig ?? {}) as Konfig;
    const pk = txt(fd, 'stripePk');
    if (pk && !/^pk_(live|test)_/.test(pk)) return { fehler: 'Stripe: Der Publishable Key beginnt mit pk_live_ oder pk_test_.' };
    const sk = txt(fd, 'stripeSk');
    if (sk && sk !== '-' && !/^(sk|rk)_(live|test)_/.test(sk)) return { fehler: 'Stripe: Der Secret Key beginnt mit sk_live_ / sk_test_ (oder rk_ für eingeschränkte Schlüssel).' };
    const wh = txt(fd, 'stripeWh');
    if (wh && wh !== '-' && !wh.startsWith('whsec_')) return { fehler: 'Stripe: Das Webhook-Geheimnis beginnt mit whsec_.' };
    const neu: Konfig = {
      hobex: { entityId: txt(fd, 'hobexEntity') || undefined, tokenEnc: geheim(txt(fd, 'hobexToken'), alt.hobex?.tokenEnc), live: fd.get('hobexLive') === 'live' },
      stripe: { publishableKey: pk || undefined, secretKeyEnc: geheim(sk, alt.stripe?.secretKeyEnc), webhookSecretEnc: geheim(wh, alt.stripe?.webhookSecretEnc) },
      paypal: { clientId: txt(fd, 'paypalId') || undefined, secretEnc: geheim(txt(fd, 'paypalSecret'), alt.paypal?.secretEnc), live: fd.get('paypalLive') === 'live' },
    };
    await db.settings.update({ where: { id: 1 }, data: { paymentConfig: JSON.parse(JSON.stringify(neu)) } });
    const was = (k: string, a?: string, n?: string) => (a === n ? null : n ? (a ? `${k} geändert` : `${k} gesetzt`) : `${k} entfernt`);
    const oeffentlich = (k: Konfig) => ({ hobexEntityId: k.hobex?.entityId, hobexLive: k.hobex?.live, stripePublishableKey: k.stripe?.publishableKey, paypalClientId: k.paypal?.clientId, paypalLive: k.paypal?.live });
    const diff = aenderung(oeffentlich(alt), oeffentlich(neu));
    await audit(ich, 'einstellungen_zahlung', 'settings', '1', {
      geheimnisse: [was('hobex-Token', alt.hobex?.tokenEnc, neu.hobex?.tokenEnc), was('Stripe Secret Key', alt.stripe?.secretKeyEnc, neu.stripe?.secretKeyEnc), was('Stripe Webhook', alt.stripe?.webhookSecretEnc, neu.stripe?.webhookSecretEnc), was('PayPal Secret', alt.paypal?.secretEnc, neu.paypal?.secretEnc)].filter(Boolean),
    }, { vorher: maskieren(diff.vorher), nachher: maskieren(diff.nachher) });
    fertig();
    return { ok: 'Zahlungsanbieter gespeichert. Geheimnisse sind verschlüsselt abgelegt.' };
  } catch (e) { return { fehler: fehlerText(e) }; }
}

export async function demoSpeichern(_p: Ergebnis, fd: FormData): Promise<Ergebnis> {
  const ich = await assertRole('admin');
  const demo = fd.get('demoMode') === 'an';
  const alt = await getSettings();
  await db.settings.update({ where: { id: 1 }, data: { demoMode: demo } });
  await audit(ich, demo ? 'demo_an' : 'demo_aus', 'settings', '1', undefined, { vorher: { demoMode: alt.demoMode }, nachher: { demoMode: demo } });
  fertig();
  return { ok: demo ? 'Demo-Modus ist an: Zahlungen werden simuliert, E-Mails nicht verschickt.' : 'Demo-Modus ist aus: echte Zahlungen und E-Mails.' };
}

export async function vorstellungenSpeichern(_p: Ergebnis, fd: FormData): Promise<Ergebnis> {
  const ich = await assertRole('admin');
  try {
    const d = z.object({
      reservierungVerfallMin: z.coerce.number().int('Bitte ganze Minuten angeben.').min(0, 'Mindestens 0 Minuten.').max(1440, 'Höchstens 1440 Minuten (24 Stunden).'),
      reservierungVerfallMail: z.boolean(),
    }).parse({ reservierungVerfallMin: txt(fd, 'reservierungVerfallMin'), reservierungVerfallMail: fd.get('reservierungVerfallMail') === 'on' });
    const alt = await getSettings();
    await db.settings.update({ where: { id: 1 }, data: d });
    await audit(ich, 'einstellungen_vorstellungen', 'settings', '1', undefined, aenderung(alt, d));
    fertig();
    return { ok: `Gespeichert: unbezahlte Reservierungen verfallen ${d.reservierungVerfallMin} Minuten vor Beginn.` };
  } catch (e) { return { fehler: fehlerText(e) }; }
}
