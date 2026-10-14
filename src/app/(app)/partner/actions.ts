'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { audit } from '@/lib/audit';
import { assertRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { neuerSchluessel, neuesWebhookGeheimnis } from '@/lib/apikey';
import { webhookSenden } from '@/lib/partner';
import type { Ergebnis } from '@/components/system/Formular';

const felder = z.object({
  name: z.string().trim().min(2, 'Bitte einen Namen angeben.').max(100),
  contactEmail: z.string().trim().toLowerCase().refine((v) => !v || z.email().safeParse(v).success, 'Kontakt: gültige E-Mail-Adresse oder leer.'),
  commissionPct: z.coerce.number().int('Provision in ganzen Prozent.').min(0, 'Provision 0–50 %.').max(50, 'Provision 0–50 %.'),
  categories: z.array(z.enum(['I', 'II', 'R'])).min(1, 'Bitte mindestens eine Kategorie freigeben.'),
  quotaPerShow: z.string().trim().transform((v, c) => {
    if (!v) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 662) { c.addIssue({ code: 'custom', message: 'Kontingent: ganze Zahl 1–662 oder leer (unbegrenzt).' }); return z.NEVER; }
    return n;
  }),
  webhookUrl: z.string().trim().refine((v) => !v || /^https:\/\/[^\s]+$/.test(v), 'Webhook-URL muss mit https:// beginnen.'),
});
const lesen = (fd: FormData) => felder.parse({ name: fd.get('name'), contactEmail: fd.get('contactEmail') ?? '', commissionPct: fd.get('commissionPct') || '0', categories: fd.getAll('categories'), quotaPerShow: fd.get('quotaPerShow') ?? '', webhookUrl: fd.get('webhookUrl') ?? '' });
const fehlerText = (e: unknown) => (e instanceof z.ZodError ? e.issues.map((i) => i.message).join(' ') : (e as Error).message);
const KEY_HINWEIS = 'Wird nur jetzt angezeigt – wir speichern nur einen Hash. Bitte sicher an den Partner übermitteln (nicht per unverschlüsselter Mail im Klartext mit dem Namen zusammen).';

export async function partnerAnlegen(_p: Ergebnis, fd: FormData): Promise<Ergebnis> {
  const ich = await assertRole('leitung');
  try {
    const d = lesen(fd);
    const k = neuerSchluessel();
    const p = await db.partner.create({ data: { ...d, apiKeyHash: k.hash, apiKeyPrefix: k.prefix, webhookSecret: neuesWebhookGeheimnis() } });
    await audit(ich, 'partner_angelegt', 'partner', p.id, { ...d, apiKeyPrefix: k.prefix });
    revalidatePath('/partner');
    return { ok: `${p.name} wurde angelegt.`, geheim: { label: `API-Schlüssel für ${p.name}`, wert: k.key, hinweis: KEY_HINWEIS } };
  } catch (e) { return { fehler: fehlerText(e) }; }
}

export async function partnerSpeichern(_p: Ergebnis, fd: FormData): Promise<Ergebnis> {
  const ich = await assertRole('leitung');
  try {
    const id = String(fd.get('id'));
    const d = { ...lesen(fd), active: fd.get('active') === 'on' };
    const vorher = await db.partner.findUniqueOrThrow({ where: { id } });
    await db.partner.update({ where: { id }, data: d });
    await audit(ich, vorher.active && !d.active ? 'partner_deaktiviert' : 'partner_geaendert', 'partner', id, d);
    revalidatePath('/partner');
    return { ok: d.active ? 'Gespeichert.' : 'Gespeichert. Der Zugang ist deaktiviert – API-Anfragen werden abgelehnt.' };
  } catch (e) { return { fehler: fehlerText(e) }; }
}

export async function schluesselNeu(_p: Ergebnis, fd: FormData): Promise<Ergebnis> {
  const ich = await assertRole('leitung');
  const id = String(fd.get('id'));
  const k = neuerSchluessel();
  const p = await db.partner.update({ where: { id }, data: { apiKeyHash: k.hash, apiKeyPrefix: k.prefix } });
  await audit(ich, 'partner_schluessel_neu', 'partner', id, { apiKeyPrefix: k.prefix });
  revalidatePath(`/partner/${id}`);
  return { ok: 'Neuer Schlüssel erzeugt. Der alte gilt ab sofort nicht mehr.', geheim: { label: `Neuer API-Schlüssel für ${p.name}`, wert: k.key, hinweis: KEY_HINWEIS } };
}

export async function webhookGeheimnisNeu(_p: Ergebnis, fd: FormData): Promise<Ergebnis> {
  const ich = await assertRole('leitung');
  const id = String(fd.get('id'));
  const s = neuesWebhookGeheimnis();
  await db.partner.update({ where: { id }, data: { webhookSecret: s } });
  await audit(ich, 'partner_webhook_geheimnis_neu', 'partner', id);
  revalidatePath(`/partner/${id}`);
  return { ok: 'Neues Webhook-Geheimnis erzeugt.', geheim: { label: 'Webhook-Geheimnis', wert: s, hinweis: 'Der Partner prüft damit die Signatur X-LoC-Signature.' } };
}

export async function webhookTesten(_p: Ergebnis, fd: FormData): Promise<Ergebnis> {
  await assertRole('leitung');
  const p = await db.partner.findUnique({ where: { id: String(fd.get('id')) } });
  if (!p?.webhookUrl) return { fehler: 'Keine Webhook-URL eingetragen.' };
  const r = await webhookSenden(p, 'ping', { partner: p.name, nachricht: 'Test von Light of Creation' });
  return r.ok ? { ok: `Test-Webhook zugestellt (HTTP ${r.status}).` } : { fehler: `Zustellung fehlgeschlagen: ${r.fehler}` };
}
