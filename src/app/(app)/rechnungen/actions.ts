'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { assertRole } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { wienZuUtc } from '@/lib/dates';
import { ausfuehren, pruefen, type Ergebnis } from '@/lib/finanzen/aktion';
import { rechnungAnlegen, rechnungBezahlt, rechnungSenden, rechnungStornieren } from '@/lib/finanzen/rechnungen';
import { euroZuCent, tag } from '@/lib/finanzen/zeitraum';
import { KLEINBETRAG_CENT, UID_PFLICHT_CENT } from '@/lib/invoice-html';
import { invoiceTotals } from '@/lib/invoice-calc';

const datum = (msg: string) => z.string().refine((s) => !!tag(s), msg);
const optDatum = z.string().optional().transform((s) => (s ? s : '')).refine((s) => !s || !!tag(s), 'Datum ungültig');

const kopf = z.object({
  company: z.string().trim().min(1, 'Bitte die Firma der Empfänger:in angeben.').max(140),
  name: z.string().trim().max(140).optional().default(''),
  street: z.string().trim().max(140).optional().default(''),
  zip: z.string().trim().max(20).optional().default(''),
  city: z.string().trim().max(80).optional().default(''),
  country: z.string().trim().max(60).optional().default(''),
  vatId: z.string().trim().max(20).optional().default('').transform((s) => s.replace(/\s+/g, '').toUpperCase()).refine((s) => !s || /^[A-Z]{2}[0-9A-Z]{2,13}$/.test(s), 'Die UID-Nummer hat ein ungültiges Format (z. B. ATU12345678).'),
  email: z.string().trim().max(200).optional().default('').refine((s) => !s || z.email().safeParse(s).success, 'E-Mail-Adresse ungültig'),
  issueDate: datum('Rechnungsdatum fehlt'),
  serviceDate: datum('Leistungsdatum fehlt'),
  dueDate: optDatum,
  note: z.string().trim().max(1000).optional().default(''),
});

export async function rechnungNeuAktion(_: Ergebnis, fd: FormData): Promise<Ergebnis> {
  let id = '';
  const r = await ausfuehren(async () => {
    const u = await assertRole('buchhaltung');
    const k = pruefen(kopf, fd);
    const titel = fd.getAll('titel').map(String);
    const menge = fd.getAll('menge').map(String);
    const preis = fd.getAll('preis').map(String);
    const satz = fd.getAll('satz').map(String);
    const items = titel.map((t, i) => ({ title: t.trim(), quantity: Number(menge[i]?.replace(',', '.')), unitCents: euroZuCent(preis[i]), vatRate: Number(satz[i]) }))
      .filter((x) => x.title || x.unitCents);
    if (!items.length) throw new Error('Bitte mindestens eine Position angeben.');
    items.forEach((x, i) => {
      if (!x.title) throw new Error(`Position ${i + 1}: Bezeichnung fehlt.`);
      if (!Number.isFinite(x.quantity) || x.quantity <= 0 || x.quantity > 100000) throw new Error(`Position ${i + 1}: Menge ungültig.`);
      if (x.unitCents == null || x.unitCents < 0) throw new Error(`Position ${i + 1}: Einzelpreis ungültig.`);
      if (![20, 13, 10, 0].includes(x.vatRate)) throw new Error(`Position ${i + 1}: Steuersatz ungültig.`);
    });
    const pos = items.map((x) => ({ ...x, unitCents: x.unitCents! }));
    const t = invoiceTotals(pos.map((p) => ({ ...p, discountPct: 0 })), 'domestic');
    if (t.gross > UID_PFLICHT_CENT && !k.vatId) throw new Error('Über 10.000 € brutto muss die UID-Nummer der Empfänger:in auf der Rechnung stehen.');
    if (t.gross > KLEINBETRAG_CENT && !(k.street && k.city)) throw new Error('Über 400 € brutto braucht die Rechnung die Anschrift der Empfänger:in.');
    const inv = await rechnungAnlegen({
      recipient: { company: k.company, name: k.name, street: k.street, zip: k.zip, city: k.city, country: k.country, vatId: k.vatId, email: k.email },
      items: pos, issueDate: wienZuUtc(k.issueDate, '12:00'), serviceDate: wienZuUtc(k.serviceDate, '12:00'), dueDate: k.dueDate ? wienZuUtc(k.dueDate, '12:00') : null, note: k.note,
    }, u.id);
    await audit(u, 'rechnung.anlegen', 'invoice', inv.id, { number: inv.number, brutto: inv.grossCents });
    id = inv.id;
  });
  if (id) { revalidatePath('/rechnungen'); redirect(`/rechnungen/${id}?neu=1`); }
  return r;
}

export async function zahlungErhaltenAktion(id: string, _: Ergebnis, fd: FormData): Promise<Ergebnis> {
  let fertig = false;
  const r = await ausfuehren(async () => {
    const u = await assertRole('buchhaltung');
    const d = pruefen(z.object({ datum: datum('Datum fehlt'), konto: z.enum(['2800', '2700']) }), fd);
    await rechnungBezahlt(id, tag(d.datum)!, u.id, d.konto);
    await audit(u, 'rechnung.bezahlt', 'invoice', id, d);
    fertig = true;
  });
  if (fertig) { revalidatePath('/rechnungen'); redirect(`/rechnungen/${id}?bezahlt=1`); }
  return r;
}

export async function stornoAktion(id: string, _: Ergebnis): Promise<Ergebnis> {
  let neu = '';
  const r = await ausfuehren(async () => {
    const u = await assertRole('buchhaltung');
    const st = await rechnungStornieren(id, u.id);
    await audit(u, 'rechnung.storno', 'invoice', id, { storno: st.number });
    neu = st.id;
  });
  if (neu) { revalidatePath('/rechnungen'); redirect(`/rechnungen/${neu}`); }
  return r;
}

export async function sendenAktion(id: string, _: Ergebnis, fd: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('buchhaltung');
    const d = pruefen(z.object({ an: z.email('Bitte eine gültige E-Mail-Adresse angeben.') }), fd);
    const r = await rechnungSenden(id, d.an);
    await audit(u, 'rechnung.senden', 'invoice', id, { an: d.an, demo: 'demo' in r });
    revalidatePath(`/rechnungen/${id}`);
    if (!r.ok) throw new Error(`Versand fehlgeschlagen: ${'fehler' in r ? r.fehler : ''}`);
    return 'demo' in r && r.demo ? 'Im Demo-Modus nicht verschickt – die Mail steht im E-Mail-Protokoll.' : `Rechnung an ${d.an} verschickt.`;
  });
}
