'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { aenderung, audit } from '@/lib/audit';
import { assertRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { gleichePerson } from '@/components/verkauf/daten';
import { ausfuehren, type Ergebnis } from '@/components/verkauf/ergebnis';

const opt = z.string().trim().max(200).optional().transform((v) => v || null);
const kundeSchema = z.object({
  firstName: z.string().trim().max(100).default(''),
  lastName: z.string().trim().min(1, 'Bitte den Nachnamen angeben').max(100),
  email: z.union([z.literal(''), z.email('E-Mail-Adresse ist ungültig')]).default(''),
  phone: opt, company: opt, vatId: opt, street: opt, zip: opt, city: opt, country: opt,
});

export async function kundeBearbeiten(id: string, _: Ergebnis, fd: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('leitung');
    const d = kundeSchema.parse(Object.fromEntries(fd.entries()));
    const vorher = await db.customer.findUniqueOrThrow({ where: { id } });
    const daten = { ...d, email: d.email.toLowerCase(), newsletter: fd.get('newsletter') === 'on' };
    await db.customer.update({ where: { id }, data: daten });
    // Newsletter-Wunsch gilt für die Person, nicht nur für einen Datensatz
    if (vorher.email) await db.customer.updateMany({ where: { email: { equals: vorher.email, mode: 'insensitive' } }, data: { newsletter: daten.newsletter } });
    const diff = aenderung(vorher, daten);
    if (diff.geaendert) await audit(u, 'kunde_bearbeiten', 'customer', id, undefined, diff);
    revalidatePath(`/kunden/${id}`);
    revalidatePath('/kunden');
    return { ok: true, meldung: 'Gespeichert. Bereits ausgestellte Rechnungen bleiben unverändert.' };
  });
}

/** DSGVO: personenbezogene Daten löschen, Bestellungen und Rechnungen bleiben für die Buchhaltung */
export async function anonymisieren(id: string, _: Ergebnis, fd: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('leitung');
    if (fd.get('bestaetigt') !== 'ja') throw new Error('Bitte bestätigen Sie das Anonymisieren');
    const alle = await gleichePerson(id);
    await db.$transaction(alle.map((c) => db.customer.update({
      where: { id: c.id },
      data: { firstName: 'Anonymisiert', lastName: '', email: '', phone: null, company: null, vatId: null, street: null, zip: null, city: null, country: null, newsletter: false },
    })));
    // Protokoll hält nur fest, dass und welche Felder geleert wurden – nicht die Daten selbst
    await audit(u, 'kunde_anonymisieren', 'customer', id, { datensaetze: alle.map((c) => c.id), felder: ['firstName', 'lastName', 'email', 'phone', 'company', 'vatId', 'street', 'zip', 'city', 'country', 'newsletter'] });
    revalidatePath(`/kunden/${id}`);
    revalidatePath('/kunden');
    return { ok: true, meldung: `${alle.length} ${alle.length === 1 ? 'Datensatz' : 'Datensätze'} anonymisiert. Bestellungen und Rechnungen bleiben erhalten (Aufbewahrungspflicht).` };
  });
}
