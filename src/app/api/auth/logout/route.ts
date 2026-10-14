import { NextResponse } from 'next/server';
import { audit } from '@/lib/audit';
import { currentUser } from '@/lib/auth';
import { cookieOptions, SESSION_COOKIE } from '@/lib/session';

export async function POST() {
  const u = await currentUser();
  if (u) await audit(u, 'logout', 'user', u.id);
  const res = new NextResponse(null, { status: 303, headers: { Location: '/login' } });
  res.cookies.set(SESSION_COOKIE, '', cookieOptions(0));
  return res;
}
