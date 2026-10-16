'use server';
import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { audit } from '@/lib/audit';
import { assertRole } from '@/lib/auth';
import { schluesselHash } from '@/lib/apikey';
import { db } from '@/lib/db';
import { BMD_KEY_PREFIX, laufErstellen, rueckmeldung } from '@/lib/finanzen/bmd-uebergabe';
import { assertModul } from '@/lib/module';
import type { Ergebnis } from '@/components/system/Formular';

const fehlerText = (e: unknown) => (e instanceof z.ZodError ? e.issues.map((i) => i.message).join(' ') : (e as Error).message);

export async function laufJetzt(_p: Ergebnis, fd: FormData): Promise<Ergebnis> {
  const ich = await assertRole('buchhaltung');
  try {
    await assertModul('bmd');
    const bis = String(fd.get('bis') ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bis)) return { fehler: 'Bitte ein Datum angeben.' };
    const l = await laufErstellen({ bis: new Date(`${bis}T00:00:00Z`), userId: ich.id, quelle: 'manuell' });
    revalidatePath('/bmd');
    return l ? { ok: `Lauf ${l.nummer} mit ${l.anzahl} Buchungen erstellt.` } : { ok: 'Keine offenen Buchungen bis zu diesem Tag.' };
  } catch (e) { return { fehler: fehlerText(e) }; }
}

export async function rueckmeldungErfassen(_p: Ergebnis, fd: FormData): Promise<Ergebnis> {
  const ich = await assertRole('buchhaltung');
  try {
    await assertModul('bmd');
    const d = z.object({
      nummer: z.coerce.number().int().positive(),
      ok: z.enum(['ja', 'nein'], { message: 'Bitte wählen: übernommen oder Fehler.' }),
      referenz: z.string().max(100), fehler: z.string().max(2000),
    }).parse({ nummer: fd.get('nummer'), ok: fd.get('ok'), referenz: String(fd.get('referenz') ?? '').trim(), fehler: String(fd.get('fehler') ?? '').trim() });
    if (d.ok === 'nein' && !d.fehler) return { fehler: 'Bitte den Fehler aus dem BMD-Importprotokoll eintragen.' };
    const st = await rueckmeldung({ nummer: d.nummer, ok: d.ok === 'ja', referenz: d.referenz || undefined, fehler: d.fehler || undefined, userId: ich.id });
    revalidatePath('/bmd');
    return { ok: st === 'uebernommen' ? `Lauf ${d.nummer} als übernommen bestätigt.` : `Lauf ${d.nummer} als Fehler markiert – die Buchungen kommen in den nächsten Lauf.` };
  } catch (e) { return { fehler: fehlerText(e) }; }
}

export async function konnektorSchluessel(_p: Ergebnis): Promise<Ergebnis> {
  const ich = await assertRole('einstellungen');
  const key = BMD_KEY_PREFIX + randomBytes(24).toString('base64url');
  const prefix = key.slice(0, BMD_KEY_PREFIX.length + 6);
  await db.settings.update({ where: { id: 1 }, data: { bmdKeyHash: schluesselHash(key), bmdKeyPrefix: prefix } });
  await audit(ich, 'bmd_schluessel_neu', 'settings', '1', { prefix });
  revalidatePath('/bmd');
  return { ok: 'Neuer Schlüssel erstellt, der alte gilt nicht mehr.', geheim: { label: 'Schlüssel für den BMD-Konnektor', wert: key } };
}

export async function bmdMailSpeichern(_p: Ergebnis, fd: FormData): Promise<Ergebnis> {
  const ich = await assertRole('einstellungen');
  try {
    const mail = z.union([z.literal(''), z.email('Bitte eine gültige E-Mail-Adresse angeben.')]).parse(String(fd.get('bmdMail') ?? '').trim());
    const alt = await db.settings.findUniqueOrThrow({ where: { id: 1 }, select: { bmdMail: true } });
    await db.settings.update({ where: { id: 1 }, data: { bmdMail: mail } });
    await audit(ich, 'einstellungen_bmd', 'settings', '1', undefined, { vorher: { bmdMail: alt.bmdMail }, nachher: { bmdMail: mail } });
    revalidatePath('/bmd');
    return { ok: mail ? `Jeder Lauf geht zusätzlich an ${mail}.` : 'Kein Mailversand.' };
  } catch (e) { return { fehler: fehlerText(e) }; }
}
