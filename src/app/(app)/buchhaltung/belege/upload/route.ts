import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { audit } from '@/lib/audit';
import { belegAnlegen } from '@/lib/finanzen/buchhaltung';
import { json, postZugriff } from '@/lib/finanzen/route';
import { euroZuCent, tag } from '@/lib/finanzen/zeitraum';
import { formatEur } from '@/lib/money';

const MAX = 15 * 1024 * 1024;
const ENDUNG = /\.(pdf|png|jpe?g|webp)$/i;

const schema = z.object({
  supplier: z.string().trim().min(2, 'Lieferant fehlt.').max(120),
  docNumber: z.string().trim().max(60).default(''),
  docDate: z.string().refine((s) => !!tag(s), 'Rechnungsdatum fehlt.'),
  dueDate: z.string().default('').refine((s) => !s || !!tag(s), 'Fälligkeit ungültig.'),
  gross: z.string().transform((s) => euroZuCent(s)).refine((c) => c != null && c > 0, 'Bruttobetrag ungültig.'),
  vatRate: z.coerce.number().refine((n) => [20, 13, 10, 0].includes(n), 'USt-Satz ungültig.'),
  vat: z.string().default('').transform((s) => (s.trim() ? euroZuCent(s) : null)),
  accountNumber: z.string().regex(/^\d+$/, 'Aufwandskonto fehlt.'),
  note: z.string().trim().max(500).default(''),
});

export async function POST(req: Request) {
  const z0 = await postZugriff(req, 'buchhaltung');
  if ('fehler' in z0) return z0.fehler;
  try {
    const fd = await req.formData();
    const roh = Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
    const r = schema.safeParse(roh);
    if (!r.success) return json({ fehler: r.error.issues[0].message }, 400);
    const d = r.data;
    if (d.vat != null && (d.vat < 0 || d.vat >= d.gross!)) return json({ fehler: 'USt-Betrag ungültig.' }, 400);
    if (d.vatRate === 0 && d.vat) return json({ fehler: 'Bei 0 % gibt es keine Vorsteuer.' }, 400);
    const f = fd.get('datei');
    let datei: { name: string; inhalt: Buffer } | null = null;
    if (f instanceof File && f.size > 0) {
      if (f.size > MAX) return json({ fehler: 'Die Datei ist größer als 15 MB.' }, 400);
      if (!ENDUNG.test(f.name)) return json({ fehler: 'Nur PDF, PNG, JPG oder WebP.' }, 400);
      datei = { name: f.name, inhalt: Buffer.from(await f.arrayBuffer()) };
    }
    const e = await belegAnlegen({ supplier: d.supplier, docNumber: d.docNumber, docDate: tag(d.docDate)!, dueDate: tag(d.dueDate), grossCents: d.gross!, vatRate: d.vatRate, vatCents: d.vatRate ? d.vat : 0, accountNumber: d.accountNumber, note: d.note }, datei, z0.u.id);
    await audit(z0.u, 'beleg.anlegen', 'expense', e.id, { supplier: e.supplier, brutto: e.grossCents });
    revalidatePath('/buchhaltung', 'layout');
    return json({ ok: `Beleg ${e.supplier} über ${formatEur(e.grossCents)} erfasst und gebucht (Aufwand und Vorsteuer an Lieferverbindlichkeiten).` });
  } catch (e) {
    return json({ fehler: (e as Error).message }, 400);
  }
}
