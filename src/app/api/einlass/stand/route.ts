import { NextResponse } from 'next/server';
import { stand } from '@/lib/einlass';
import { mitRolle } from '../_hilfe';

export const dynamic = 'force-dynamic';

/** Zähler eingelassen / verkauft */
export async function GET(req: Request) {
  return mitRolle(async () => NextResponse.json(await stand(new URL(req.url).searchParams.get('showId') ?? ''), { headers: { 'Cache-Control': 'no-store' } }));
}
