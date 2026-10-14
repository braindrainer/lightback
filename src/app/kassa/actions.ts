'use server';
// Server Actions der Kassa: Verkauf, Storno, Schicht, Einrichtung (Kassen, Artikel, Sonderbelege)
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z, ZodError } from 'zod';
import { aenderung, audit, maskieren } from '@/lib/audit';
import { assertRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { kasseAnlegen, schichtOeffnen, schichtSchliessen, sonderbeleg, stornoBeleg, verkaufen } from '@/lib/kassa';
import { parseAmountToCents } from '@/lib/money';
import { encrypt } from '@/lib/secret';
import { KASSE_COOKIE } from './daten';

export type Antwort<T = object> = ({ ok: true } & T) | { ok: false; fehler: string };

const meldung = (e: unknown) => (e instanceof ZodError ? `Ungültige Eingabe: ${e.issues[0]?.message ?? ''}` : (e as Error).message);
const zurueck = (pfad: string, art: 'meldung' | 'fehler', text: string) => redirect(`${pfad}${pfad.includes('?') ? '&' : '?'}${art}=${encodeURIComponent(text)}`);

const Verkauf = z.object({
  registerId: z.string().min(1),
  sessionId: z.string().min(1),
  items: z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(99) })).min(1).max(50),
  payment: z.enum(['bar', 'karte']),
  givenCents: z.number().int().min(0).max(10_000_00).nullable().optional(),
  training: z.boolean().optional(),
  showId: z.string().nullable().optional(),
});

export async function verkaufAction(input: z.input<typeof Verkauf>): Promise<Antwort<{ id: string; number: number; totalCents: number; changeCents: number | null }>> {
  try {
    const u = await assertRole('kassa');
    const d = Verkauf.parse(input);
    const b = await verkaufen({ ...d, user: u });
    revalidatePath('/kassa');
    return { ok: true, id: b.id, number: b.number, totalCents: b.totalCents, changeCents: b.changeCents };
  } catch (e) {
    return { ok: false, fehler: meldung(e) };
  }
}

export async function stornoAction(input: { receiptId: string; grund: string; sessionId: string }): Promise<Antwort<{ id: string; number: number }>> {
  try {
    const u = await assertRole('kassa');
    const d = z.object({ receiptId: z.string().min(1), sessionId: z.string().min(1), grund: z.string().trim().min(3, 'Bitte einen Grund angeben (mind. 3 Zeichen)').max(200) }).parse(input);
    const b = await stornoBeleg({ ...d, user: u });
    revalidatePath('/kassa/belege');
    return { ok: true, id: b.id, number: b.number };
  } catch (e) {
    return { ok: false, fehler: meldung(e) };
  }
}

export async function kasseSetzenAction(f: FormData) {
  await assertRole('kassa');
  const id = String(f.get('registerId') ?? '');
  (await cookies()).set(KASSE_COOKIE, id, { httpOnly: true, sameSite: 'lax', path: '/kassa', maxAge: 400 * 864e2, secure: process.env.NODE_ENV === 'production' });
  redirect(`/kassa?kasse=${encodeURIComponent(id)}`);
}

export async function schichtOeffnenAction(f: FormData) {
  const u = await assertRole('kassa');
  const registerId = String(f.get('registerId') ?? '');
  const cents = parseAmountToCents(String(f.get('wechselgeld') ?? '0'));
  try {
    if (cents < 0) throw new Error('Wechselgeld kann nicht negativ sein.');
    await schichtOeffnen(registerId, cents, u);
  } catch (e) {
    zurueck(`/kassa?kasse=${registerId}`, 'fehler', meldung(e));
  }
  redirect(`/kassa?kasse=${registerId}`);
}

export async function schichtSchliessenAction(f: FormData) {
  const u = await assertRole('kassa');
  const sessionId = String(f.get('sessionId') ?? '');
  const gezaehlt = String(f.get('gezaehlt') ?? '').trim();
  try {
    if (!gezaehlt) throw new Error('Bitte den gezählten Kassenbestand eingeben.');
    await schichtSchliessen(sessionId, parseAmountToCents(gezaehlt), String(f.get('notiz') ?? '').slice(0, 500), u);
  } catch (e) {
    zurueck('/kassa/schicht', 'fehler', meldung(e));
  }
  redirect(`/kassa/bericht/${sessionId}?druck=1`);
}

// ─────────── Einrichtung (nur Administration) ───────────

const EINR = '/kassa/einrichtung';

export async function kasseAnlegenAction(f: FormData) {
  const u = await assertRole('admin');
  try {
    const d = z.object({ name: z.string().trim().min(2).max(60), kassenId: z.string().trim().regex(/^[A-Za-z0-9-]{3,30}$/, 'Kassen-ID: 3–30 Zeichen, Buchstaben, Ziffern, Bindestrich (kein Unterstrich)') }).parse({ name: f.get('name'), kassenId: f.get('kassenId') });
    if (await db.register.findUnique({ where: { kassenId: d.kassenId } })) throw new Error('Diese Kassen-ID gibt es bereits.');
    await kasseAnlegen({ ...d, user: u });
  } catch (e) {
    zurueck(EINR, 'fehler', meldung(e));
  }
  zurueck(EINR, 'meldung', 'Kasse angelegt. Als Nächstes den Startbeleg erstellen.');
}

export async function sonderbelegAction(f: FormData) {
  const u = await assertRole('admin');
  const registerId = String(f.get('registerId') ?? '');
  const typ = z.enum(['start', 'null', 'monat', 'jahr', 'schluss']).parse(f.get('typ'));
  let nr = 0;
  try {
    if (typ === 'schluss' && f.get('bestaetigt') !== 'ja') throw new Error('Bitte bestätigen, dass die Kasse endgültig außer Betrieb geht.');
    nr = (await sonderbeleg(registerId, typ, u)).number;
  } catch (e) {
    zurueck(EINR, 'fehler', meldung(e));
  }
  const b = await db.receipt.findFirst({ where: { registerId, number: nr } });
  redirect(`/kassa/beleg/${b?.id}`);
}

export async function signaturAction(f: FormData) {
  const u = await assertRole('admin');
  const registerId = String(f.get('registerId') ?? '');
  try {
    const signer = z.enum(['demo', 'fiskaly']).parse(f.get('signer'));
    const reg = await db.register.findUniqueOrThrow({ where: { id: registerId } });
    const alt = (reg.signerConfig ?? {}) as Record<string, unknown>;
    const neu: Record<string, unknown> = { ...alt };
    if (signer === 'fiskaly') {
      neu.apiKey = String(f.get('apiKey') ?? '').trim() || alt.apiKey;
      const secret = String(f.get('apiSecret') ?? '').trim();
      if (secret) neu.apiSecretEnc = encrypt(secret);
      neu.tssId = String(f.get('tssId') ?? '').trim() || alt.tssId;
    }
    const certSerial = signer === 'demo' ? 'DEMO' : String(f.get('certSerial') ?? '').trim() || reg.certSerial;
    await db.register.update({ where: { id: registerId }, data: { signer, signerConfig: neu as object, certSerial } });
    await audit(u, 'kasse_signatur', 'register', registerId, undefined, { vorher: maskieren({ signer: reg.signer, certSerial: reg.certSerial, ...alt }), nachher: maskieren({ signer, certSerial, ...neu }) });
  } catch (e) {
    zurueck(EINR, 'fehler', meldung(e));
  }
  zurueck(EINR, 'meldung', 'Signatureinstellungen gespeichert.');
}

const Produkt = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, 'Name fehlt').max(60),
  category: z.enum(['ticket', 'merch', 'getraenk', 'snack', 'sonstiges']),
  preis: z.string(),
  vatRate: z.coerce.number().int().refine((v) => [0, 10, 13, 20].includes(v), 'Steuersatz 0, 10, 13 oder 20 %'),
  sku: z.string().trim().max(30).optional(),
  stock: z.string().trim().optional(),
  sort: z.coerce.number().int().min(0).max(9999).default(0),
  color: z.string().trim().regex(/^(#[0-9a-fA-F]{6})?$/, 'Farbe als #RRGGBB').optional(),
  active: z.string().optional(),
});

export async function produktSpeichernAction(f: FormData) {
  const u = await assertRole('admin');
  try {
    const d = Produkt.parse(Object.fromEntries([...f.entries()].map(([k, v]) => [k, String(v)])));
    const priceCents = parseAmountToCents(d.preis);
    if (priceCents < 0) throw new Error('Preis kann nicht negativ sein.');
    const data = { name: d.name, category: d.category, priceCents, vatRate: d.vatRate, sku: d.sku || null, stock: d.stock ? Number.parseInt(d.stock, 10) : null, sort: d.sort, color: d.color ?? '', active: d.active === 'on' };
    const alt = d.id ? await db.product.findUniqueOrThrow({ where: { id: d.id } }) : null;
    const p = d.id ? await db.product.update({ where: { id: d.id }, data }) : await db.product.create({ data });
    await audit(u, d.id ? 'artikel_aendern' : 'artikel_anlegen', 'product', p.id, undefined, alt ? aenderung(alt, data) : { nachher: data });
  } catch (e) {
    zurueck(EINR, 'fehler', meldung(e));
  }
  revalidatePath('/kassa');
  zurueck(EINR, 'meldung', 'Artikel gespeichert.');
}
