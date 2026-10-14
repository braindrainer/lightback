import { revalidatePath } from 'next/cache';
import { audit } from '@/lib/audit';
import { bankImport } from '@/lib/finanzen/buchhaltung';
import { json, postZugriff } from '@/lib/finanzen/route';

export async function POST(req: Request) {
  const z = await postZugriff(req, 'buchhaltung');
  if ('fehler' in z) return z.fehler;
  try {
    const f = (await req.formData()).get('datei');
    if (!(f instanceof File) || !f.size) return json({ fehler: 'Bitte eine Datei wählen.' }, 400);
    if (f.size > 10 * 1024 * 1024) return json({ fehler: 'Die Datei ist größer als 10 MB.' }, 400);
    const r = await bankImport(Buffer.from(await f.arrayBuffer()));
    await audit(z.u, 'bank.import', 'bank', null, { datei: f.name, ...r, uebersprungen: r.uebersprungen.length });
    revalidatePath('/buchhaltung/bank');
    const ueb = r.uebersprungen.length ? ` ${r.uebersprungen.length} Zeilen übersprungen (${r.uebersprungen.slice(0, 3).map((u) => `Zeile ${u.zeile}: ${u.grund}`).join('; ')}).` : '';
    return json({ ok: `${r.format}: ${r.gelesen} Umsätze gelesen, ${r.neu} neu, ${r.gelesen - r.neu} bereits vorhanden.${ueb}` });
  } catch (e) {
    return json({ fehler: (e as Error).message }, 400);
  }
}
