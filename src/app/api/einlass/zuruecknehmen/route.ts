import { NextResponse } from 'next/server';
import { z } from 'zod';
import { zuruecknehmen } from '@/lib/einlass';
import { mitRolle } from '../_hilfe';

export const dynamic = 'force-dynamic';

/** Letzten Einlass zurücknehmen (innerhalb von 2 Minuten) */
export async function POST(req: Request) {
  return mitRolle(async (u) => {
    const { checkInId } = z.object({ checkInId: z.string().min(1).max(40) }).parse(await req.json());
    await zuruecknehmen(checkInId, u);
    return NextResponse.json({ ok: true });
  });
}
