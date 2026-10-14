import { NextResponse } from 'next/server';
import { z } from 'zod';
import { umbuchenAmEinlass } from '@/lib/einlass';
import { PlatzBelegt } from '@/lib/seats';
import { mitRolle } from '../_hilfe';

export const dynamic = 'force-dynamic';

/** Falsche Vorstellung: Ticket auf die gescannte Vorstellung umbuchen und einlassen (ohne Aufzahlung) */
export async function POST(req: Request) {
  return mitRolle(async (u) => {
    const d = z.object({ showId: z.string().min(1).max(40), code: z.string().min(6).max(200), bestaetigt: z.literal(true), deviceId: z.string().max(60).optional() }).parse(await req.json());
    try {
      return NextResponse.json(await umbuchenAmEinlass({ code: d.code, showId: d.showId, user: u, deviceId: d.deviceId }));
    } catch (e) {
      if (e instanceof PlatzBelegt) throw new Error('Die Plätze wurden gerade vergeben – bitte erneut versuchen.');
      throw e;
    }
  }, ['einlass', 'leitung']);
}
