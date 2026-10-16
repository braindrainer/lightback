import { db } from '@/lib/db';
import { laufJson } from '@/lib/finanzen/bmd-uebergabe';
import { bmdRoute } from '@/lib/finanzen/bmd-route';
import { json } from '@/lib/schnittstelle';

export const dynamic = 'force-dynamic';

// GET ?status=bereit (Standard) | abgeholt | alle → Läufe, älteste zuerst
export const GET = bmdRoute(async (req) => {
  const st = new URL(req.url).searchParams.get('status') ?? 'bereit';
  const laeufe = await db.bmdLauf.findMany({ where: st === 'alle' ? {} : { status: st }, orderBy: { nummer: 'asc' }, take: 200 });
  return json(laeufe.map(laufJson));
});
