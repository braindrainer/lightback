import { NextResponse } from 'next/server';
import { z } from 'zod';
import { suchen } from '@/lib/einlass';
import { mitRolle } from '../_hilfe';

export const dynamic = 'force-dynamic';

/** Namenssuche am Eingang: Name, E-Mail, Firma, Bestellnummer oder Ticketcode */
export async function GET(req: Request) {
  return mitRolle(async () => {
    const u = new URL(req.url).searchParams;
    const d = z.object({ showId: z.string().min(1).max(40), q: z.string().trim().min(2, 'Mindestens 2 Zeichen').max(80) }).parse({ showId: u.get('showId'), q: u.get('q') });
    return NextResponse.json({ treffer: await suchen(d.showId, d.q) }, { headers: { 'Cache-Control': 'no-store' } });
  });
}
