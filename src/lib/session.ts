// Anmeldung: Benutzer aus der Datenbank, Session als signiertes JWT im Cookie.
import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-lb_session' : 'lb_session';
export const MAX_AGE = 60 * 60 * 12; // eine Arbeitsschicht

export const ROLLEN = ['admin', 'leitung', 'buchhaltung', 'kassa', 'einlass'] as const;
export type Rolle = (typeof ROLLEN)[number];
export const ROLLEN_NAME: Record<Rolle, string> = {
  admin: 'Administration', leitung: 'Leitung', buchhaltung: 'Buchhaltung', kassa: 'Kassa', einlass: 'Einlass',
};

const key = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET fehlt oder ist zu kurz');
  return new TextEncoder().encode(s);
};

export type SessionData = { sub: string; roles: Rolle[]; name: string };

export async function createSessionToken(d: SessionData): Promise<string> {
  return new SignJWT({ roles: d.roles, name: d.name }).setSubject(d.sub).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(`${MAX_AGE}s`).sign(key());
}

export async function readSessionToken(token: string | undefined): Promise<SessionData | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    return { sub: String(payload.sub), roles: (payload.roles as Rolle[]) ?? [], name: String(payload.name ?? '') };
  } catch { return null; }
}

export const cookieOptions = (maxAge = MAX_AGE) => ({ httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge });
