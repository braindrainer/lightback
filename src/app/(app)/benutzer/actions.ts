'use server';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { audit } from '@/lib/audit';
import { assertRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { ROLLEN } from '@/lib/session';
import type { Ergebnis } from '@/components/system/Formular';

const neuesPasswort = () => randomBytes(12).toString('base64url'); // 16 Zeichen
const fehlerText = (e: unknown) => {
  if (e instanceof z.ZodError) return e.issues.map((i) => i.message).join(' ');
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return 'Benutzername oder E-Mail-Adresse ist schon vergeben.';
  return (e as Error).message;
};

const basis = z.object({
  name: z.string().trim().min(2, 'Bitte einen Namen angeben.').max(80),
  email: z.email('Bitte eine gültige E-Mail-Adresse angeben.').trim().toLowerCase(),
  roles: z.array(z.enum(ROLLEN)).min(1, 'Bitte mindestens eine Rolle wählen.'),
  pin: z.string().trim().regex(/^(\d{4,6})?$/, 'Die PIN hat 4 bis 6 Ziffern.').optional(),
});

export async function benutzerAnlegen(_p: Ergebnis, fd: FormData): Promise<Ergebnis> {
  const ich = await assertRole('admin');
  try {
    const e = basis.extend({
      username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/, 'Benutzername: 3–32 Zeichen, nur Kleinbuchstaben, Ziffern, Punkt, Bindestrich, Unterstrich.'),
      passwort: z.string().refine((v) => v === '' || v.length >= 12, 'Das Passwort braucht mindestens 12 Zeichen – oder leer lassen, dann erzeugen wir eines.'),
    }).parse({ username: fd.get('username'), name: fd.get('name'), email: fd.get('email'), roles: fd.getAll('roles'), pin: fd.get('pin') ?? '', passwort: fd.get('passwort') ?? '' });
    const pw = e.passwort || neuesPasswort();
    const u = await db.user.create({ data: { username: e.username, name: e.name, email: e.email, roles: e.roles, passwordHash: await bcrypt.hash(pw, 12), pin: e.pin ? await bcrypt.hash(e.pin, 10) : null } });
    await audit(ich, 'benutzer_angelegt', 'user', u.id, { username: u.username, roles: u.roles, pin: !!e.pin });
    revalidatePath('/benutzer');
    return { ok: `${u.name} wurde angelegt.`, geheim: e.passwort ? undefined : { label: `Erstes Passwort für ${u.username}`, wert: pw } };
  } catch (err) {
    return { fehler: fehlerText(err) };
  }
}

export async function benutzerSpeichern(_p: Ergebnis, fd: FormData): Promise<Ergebnis> {
  const ich = await assertRole('admin');
  try {
    const id = String(fd.get('id'));
    const e = basis.extend({ active: z.boolean() }).parse({ name: fd.get('name'), email: fd.get('email'), roles: fd.getAll('roles'), pin: fd.get('pin') ?? '', active: fd.get('active') === 'on' });
    if (id === ich.id && !e.roles.includes('admin')) return { fehler: 'Sie können sich die Rolle Administration nicht selbst entziehen.' };
    if (id === ich.id && !e.active) return { fehler: 'Sie können sich nicht selbst deaktivieren.' };
    const vorher = await db.user.findUniqueOrThrow({ where: { id } });
    const pinLoeschen = fd.get('pinLoeschen') === 'on';
    await db.user.update({ where: { id }, data: { name: e.name, email: e.email, roles: e.roles, active: e.active, ...(e.pin ? { pin: await bcrypt.hash(e.pin, 10) } : pinLoeschen ? { pin: null } : {}) } });
    await audit(ich, 'benutzer_geaendert', 'user', id, { vorher: { roles: vorher.roles, active: vorher.active, email: vorher.email }, nachher: { roles: e.roles, active: e.active, email: e.email }, pin: e.pin ? 'neu' : pinLoeschen ? 'entfernt' : undefined });
    revalidatePath('/benutzer');
    return { ok: 'Gespeichert.' };
  } catch (err) {
    return { fehler: fehlerText(err) };
  }
}

export async function passwortZuruecksetzen(_p: Ergebnis, fd: FormData): Promise<Ergebnis> {
  const ich = await assertRole('admin');
  const id = String(fd.get('id'));
  const u = await db.user.findUnique({ where: { id } });
  if (!u) return { fehler: 'Benutzer nicht gefunden.' };
  const pw = neuesPasswort();
  await db.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(pw, 12) } });
  await audit(ich, 'passwort_zurueckgesetzt', 'user', id, { username: u.username });
  return { ok: 'Neues Passwort erzeugt.', geheim: { label: `Neues Passwort für ${u.username}`, wert: pw, hinweis: 'Wird nur jetzt angezeigt. Das alte Passwort gilt nicht mehr.' } };
}

