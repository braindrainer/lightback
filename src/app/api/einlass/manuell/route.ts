import { NextResponse } from 'next/server';
import { z } from 'zod';
import { manuellEinlassen } from '@/lib/einlass';
import { mitRolle } from '../_hilfe';

export const dynamic = 'force-dynamic';

/** Einlass ohne Scan (einzeln oder „Alle einlassen“ für Gruppen) */
export async function POST(req: Request) {
  return mitRolle(async (u) => {
    const d = z.object({ showId: z.string().min(1).max(40), ticketIds: z.array(z.string().min(1).max(40)).min(1).max(100), deviceId: z.string().max(60).optional() }).parse(await req.json());
    return NextResponse.json(await manuellEinlassen({ ...d, user: u }));
  });
}
