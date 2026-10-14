import { partnerRoute } from '@/lib/partner';
import { json } from '@/lib/schnittstelle';
import { freigeben } from '@/lib/seats';
import { holdAusgabe } from '@/lib/shop';

export const dynamic = 'force-dynamic';

export const GET = partnerRoute<{ token: string }>(async (_req, _p, { token }) => json(await holdAusgabe(token)));
export const DELETE = partnerRoute<{ token: string }>(async (_req, _p, { token }) => {
  await freigeben(token);
  return new Response(null, { status: 204 });
});
