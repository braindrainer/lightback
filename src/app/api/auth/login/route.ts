import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { weiter } from '@/lib/http';
import { db } from '@/lib/db';
import { audit } from '@/lib/audit';
import { cookieOptions, createSessionToken, SESSION_COOKIE, type Rolle } from '@/lib/session';

// Anmeldung mit Benutzername oder E-Mail. Nach 8 Fehlversuchen in 15 Minuten gesperrt.
export async function POST(req: Request) {
  const f = await req.formData();
  const login = String(f.get('login') ?? '').trim().toLowerCase();
  const pw = String(f.get('passwort') ?? '');
  const ziel = String(f.get('ziel') ?? '/');
  const ip = req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0] ?? '';
  const zurueck = (fehler: string) => weiter(`/login?fehler=${fehler}`);
  const fehlversuche = await db.loginAttempt.count({ where: { email: login, ok: false, createdAt: { gt: new Date(Date.now() - 15 * 60e3) } } });
  if (fehlversuche >= 8) return zurueck('gesperrt');
  const u = await db.user.findFirst({ where: { OR: [{ username: login }, { email: login }] } });
  const ok = !!u && u.active && (await bcrypt.compare(pw, u.passwordHash));
  await db.loginAttempt.create({ data: { email: login, ip, ok } });
  if (!ok || !u) return zurueck('falsch');
  await db.user.update({ where: { id: u.id }, data: { lastLoginAt: new Date() } });
  await audit({ id: u.id, name: u.name, email: u.email, roles: u.roles as Rolle[] }, 'login', 'user', u.id);
  const res = new NextResponse(null, { status: 303, headers: { Location: ziel.startsWith('/') && !ziel.startsWith('//') ? ziel : '/' } });
  res.cookies.set(SESSION_COOKIE, await createSessionToken({ sub: u.id, roles: u.roles as Rolle[], name: u.name }), cookieOptions());
  return res;
}
