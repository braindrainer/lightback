'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { audit, protokollMehrere } from '@/lib/audit';
import { assertRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { wienZuUtc } from '@/lib/dates';
import { formatEur, parseAmountToCents } from '@/lib/money';
import { gutscheinVerkaufen } from '@/lib/orders';
import { neuerCode } from '@/lib/tickets';
import { gutscheinMail } from '@/lib/gutschein';
import { ausfuehren, type Ergebnis } from '@/components/verkauf/ergebnis';

const obj = (fd: FormData) => Object.fromEntries(fd.entries());
const wert = z.string().trim().min(1, 'Wert fehlt').transform(parseAmountToCents).pipe(z.number().int().min(100, 'Mindestens 1,00 €').max(100000, 'Höchstens 1.000,00 €'));
const gueltig = z.string().trim().default('').refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Datum ungültig')
  .transform((v) => (v ? wienZuUtc(v, '23:59') : null)).refine((d) => !d || d > new Date(), 'Gültig-bis liegt in der Vergangenheit');
const ROLLEN = ['leitung', 'buchhaltung'] as const;

/** Eigene Gutscheine ohne Zahlung ausstellen (Kulanz, Gewinnspiel, Kooperation) */
export async function gutscheineAusstellen(_: Ergebnis, fd: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole(...ROLLEN);
    const d = z.object({ wert, gueltig, note: z.string().trim().min(1, 'Bitte einen Anlass angeben').max(300), anzahl: z.coerce.number().int().min(1).max(500) }).parse(obj(fd));
    const validUntil = d.gueltig ?? new Date(Date.now() + 3 * 365 * 864e5);
    const codes = Array.from({ length: d.anzahl }, () => `LOC-${neuerCode(8)}`);
    await db.voucher.createMany({ data: codes.map((code) => ({ code, kind: 'wert', issuer: 'eigen', valueCents: d.wert, remainingCents: d.wert, validUntil, note: d.note })) });
    const neu = await db.voucher.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } });
    await protokollMehrere(neu.map((v) => ({ user: u, action: 'gutschein_ausgestellt', entity: 'voucher', entityId: v.id, data: { herkunft: 'eigen', anlass: d.note, serie: d.anzahl > 1 ? d.anzahl : undefined }, nachher: { code: v.code, valueCents: d.wert, validUntil, active: true } })));
    revalidatePath('/gutscheine');
    return { ok: true, meldung: `${d.anzahl} ${d.anzahl === 1 ? 'Gutschein' : 'Gutscheine'} über je ${formatEur(d.wert)} ausgestellt.`, daten: { codes } };
  });
}

/** Gutschein gegen Bezahlung (bar, Terminal) – wird gebucht */
export async function gutscheinVerkaufenAktion(_: Ergebnis, fd: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole(...ROLLEN);
    const d = z.object({ wert, provider: z.enum(['bar', 'terminal']), note: z.string().trim().max(300).default('') }).parse(obj(fd));
    const v = await gutscheinVerkaufen({ cents: d.wert, provider: d.provider, note: d.note });
    revalidatePath('/gutscheine');
    return { ok: true, meldung: `Gutschein über ${formatEur(d.wert)} verkauft und gebucht.`, daten: { codes: [v.code] } };
  });
}

/** Partner-Gutscheine importieren: je Zeile „CODE“ oder „CODE;Wert“ */
export async function partnerImport(_: Ergebnis, fd: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole(...ROLLEN);
    const d = z.object({
      issuer: z.string().trim().min(2, 'Bitte den Partner angeben').max(60),
      standardwert: z.string().trim().default(''),
      gueltig,
      codes: z.string().min(1, 'Bitte Codes einfügen').max(200000),
    }).parse(obj(fd));
    const standard = d.standardwert ? parseAmountToCents(d.standardwert) : 0;
    const fehler: string[] = [];
    const zeilen = new Map<string, number>();
    d.codes.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((zeile, i) => {
      const [roh, betrag] = zeile.split(/[;\t]|\s+/).map((x) => x.trim());
      const code = roh.toUpperCase();
      const cents = betrag ? parseAmountToCents(betrag) : standard;
      if (!/^[A-Z0-9-]{4,40}$/.test(code)) fehler.push(`Zeile ${i + 1}: Code „${roh}“ ungültig`);
      else if (!cents || cents < 100 || cents > 100000) fehler.push(`Zeile ${i + 1}: Wert fehlt oder ungültig`);
      else zeilen.set(code, cents);
    });
    if (fehler.length) throw new Error(`${fehler.slice(0, 5).join('; ')}${fehler.length > 5 ? ` (und ${fehler.length - 5} weitere)` : ''}. Es wurde nichts importiert.`);
    if (zeilen.size > 5000) throw new Error('Höchstens 5000 Codes je Import');
    const r = await db.voucher.createMany({
      data: [...zeilen].map(([code, cents]) => ({ code, kind: 'partner', issuer: d.issuer, valueCents: cents, remainingCents: cents, validUntil: d.gueltig, note: `Import ${d.issuer}` })),
      skipDuplicates: true,
    });
    const neu = await db.voucher.findMany({ where: { code: { in: [...zeilen.keys()] }, issuer: d.issuer, kind: 'partner', createdAt: { gte: new Date(Date.now() - 10 * 60e3) }, redemptions: { none: {} } }, select: { id: true, code: true, valueCents: true } });
    await audit(u, 'partnergutscheine_import', 'voucher', null, { issuer: d.issuer, neu: r.count, doppelt: zeilen.size - r.count });
    await protokollMehrere(neu.map((v) => ({ user: u, action: 'gutschein_importiert', entity: 'voucher', entityId: v.id, data: { herkunft: 'partner', issuer: d.issuer }, nachher: { code: v.code, valueCents: v.valueCents, validUntil: d.gueltig, active: true } })));
    revalidatePath('/gutscheine');
    return { ok: true, meldung: `${r.count} Codes von ${d.issuer} importiert${zeilen.size - r.count ? `, ${zeilen.size - r.count} gab es schon` : ''}.` };
  });
}

export async function gutscheinAktivSetzen(id: string, aktiv: boolean, _: Ergebnis): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole(...ROLLEN);
    const alt = await db.voucher.findUniqueOrThrow({ where: { id }, select: { active: true, code: true } });
    await db.voucher.update({ where: { id }, data: { active: aktiv } });
    await audit(u, aktiv ? 'gutschein_aktivieren' : 'gutschein_deaktivieren', 'voucher', id, { code: alt.code }, { vorher: { active: alt.active }, nachher: { active: aktiv } });
    revalidatePath(`/gutscheine/${id}`);
    revalidatePath('/gutscheine');
    return { ok: true, meldung: aktiv ? 'Gutschein ist wieder aktiv.' : 'Gutschein deaktiviert.' };
  });
}

/** Gutschein als Karte per E-Mail schicken */
export async function gutscheinSendenAktion(id: string, _: Ergebnis, fd: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole(...ROLLEN);
    const d = z.object({ an: z.email('Bitte eine gültige E-Mail-Adresse angeben'), name: z.string().trim().max(120).default('') }).parse({ an: String(fd.get('an') ?? '').trim(), name: fd.get('name') ?? '' });
    const r = await gutscheinMail(id, d.an, d.name, u);
    revalidatePath(`/gutscheine/${id}`);
    if (!r.ok) throw new Error(`Versand fehlgeschlagen: ${'fehler' in r ? r.fehler : ''}`);
    return { ok: true, meldung: 'demo' in r && r.demo ? 'Im Demo-Modus nicht verschickt – die Mail steht im E-Mail-Protokoll.' : `Gutschein an ${d.an} gesendet.` };
  });
}
