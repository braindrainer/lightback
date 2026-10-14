import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { mitRolle } from '../_hilfe';

export const dynamic = 'force-dynamic';

/** Codeliste einer Vorstellung für den Offline-Betrieb (die HMAC-Prüfung bleibt am Server) */
export async function GET(req: Request) {
  return mitRolle(async () => {
    const showId = new URL(req.url).searchParams.get('showId') ?? '';
    const tickets = await db.ticket.findMany({ where: { showId }, select: { code: true, seatId: true, kat: true, art: true, status: true, checkedInAt: true } });
    return NextResponse.json({ showId, stand: new Date().toISOString(), tickets }, { headers: { 'Cache-Control': 'no-store' } });
  });
}
