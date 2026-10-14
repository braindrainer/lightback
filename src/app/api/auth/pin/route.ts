import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { sicheresZiel } from '@/lib/apphost';
import { audit } from '@/lib/audit';
import { db } from '@/lib/db';
import { weiter } from '@/lib/http';
import { cookieOptions, createSessionToken, MAX_AGE, SESSION_COOKIE, type Rolle } from '@/lib/session';

// Schnellanmeldung am Gerät: Benutzername + PIN (4–6 Ziffern), nur für Einlass, Kassa und Administration.
// Kurze PINs sind leicht zu erraten – daher 5 Fehlversuche je Benutzer und 20 je IP in 15 Minuten.
const PIN_ROLLEN: Rolle[] = ['einlass', 'kassa', 'admin'];
const ATTRAPPE = bcrypt.hashSync('keine-pin', 10);

export async function POST(req: Request) {
  const f = await req.formData();
  const login = String(f.get('login') ?? '').trim().toLowerCase().slice(0, 100);
  const pin = String(f.get('pin') ?? '').trim();
  const ziel = sicheresZiel(String(f.get('ziel') ?? ''), '/einlass');
  const ip = req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  const zurueck = (fehler: string) => weiter(`/login?modus=pin&fehler=${fehler}&ziel=${encodeURIComponent(ziel)}${login ? `&nutzer=${encodeURIComponent(login)}` : ''}`);
  if (!login || !/^\d{4,6}$/.test(pin)) return zurueck('pin');
  const seit = new Date(Date.now() - 15 * 60e3);
  const [jeNutzer, jeIp] = await Promise.all([
    db.loginAttempt.count({ where: { email: login, ok: false, createdAt: { gt: seit } } }),
    ip ? db.loginAttempt.count({ where: { ip, ok: false, createdAt: { gt: seit } } }) : 0,
  ]);
  if (jeNutzer >= 5 || jeIp >= 20) return zurueck('gesperrt');
  const u = await db.user.findUnique({ where: { username: login } });
  const darf = !!u && u.active && !!u.pin && (u.roles as Rolle[]).some((r) => PIN_ROLLEN.includes(r));
  // Auch ohne passenden Benutzer vergleichen, damit die Antwortzeit nichts verrät
  const ok = (await bcrypt.compare(pin, darf ? u.pin! : ATTRAPPE)) && darf;
  await db.loginAttempt.create({ data: { email: login, ip, ok } });
  if (!ok || !u) return zurueck('pin');
  await db.user.update({ where: { id: u.id }, data: { lastLoginAt: new Date() } });
  await audit({ id: u.id, name: u.name, email: u.email, roles: u.roles as Rolle[] }, 'login_pin', 'user', u.id);
  const res = new NextResponse(null, { status: 303, headers: { Location: ziel } });
  res.cookies.set(SESSION_COOKIE, await createSessionToken({ sub: u.id, roles: u.roles as Rolle[], name: u.name }), cookieOptions(Math.min(MAX_AGE, 12 * 3600)));
  return res;
}
