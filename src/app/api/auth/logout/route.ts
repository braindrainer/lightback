import { NextResponse } from 'next/server';
import { cookieOptions, SESSION_COOKIE } from '@/lib/session';

export async function POST(req: Request) {
  const res = new NextResponse(null, { status: 303, headers: { Location: '/login' } });
  res.cookies.set(SESSION_COOKIE, '', cookieOptions(0));
  return res;
}
