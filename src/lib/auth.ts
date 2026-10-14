// Zugriff prüfen – in Server-Komponenten, Server Actions und API-Routen.
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from './db';
import { readSessionToken, SESSION_COOKIE, type Rolle } from './session';

export type Nutzer = { id: string; name: string; email: string; roles: Rolle[] };

/** Aktueller Benutzer (Rollen frisch aus der DB, damit Sperren sofort wirken) oder null */
export async function currentUser(): Promise<Nutzer | null> {
  const s = await readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!s) return null;
  const u = await db.user.findUnique({ where: { id: s.sub } });
  if (!u || !u.active) return null;
  return { id: u.id, name: u.name, email: u.email, roles: u.roles as Rolle[] };
}

export const hat = (u: Nutzer | null, ...rollen: Rolle[]) => !!u && (u.roles.includes('admin') || rollen.some((r) => u.roles.includes(r)));

/** Für Seiten: ohne Anmeldung zum Login, ohne Rolle auf die Startseite */
export async function requireRole(...rollen: Rolle[]): Promise<Nutzer> {
  const u = await currentUser();
  if (!u) redirect('/login');
  if (rollen.length && !hat(u, ...rollen)) redirect('/?verboten=1');
  return u;
}

/** Für Server Actions/API: wirft statt umzuleiten */
export async function assertRole(...rollen: Rolle[]): Promise<Nutzer> {
  const u = await currentUser();
  if (!u || (rollen.length && !hat(u, ...rollen))) throw new Error('Keine Berechtigung');
  return u;
}
