import { z } from 'zod';
import { partnerRoute, partnerStornieren } from '@/lib/partner';
import { json, koerper } from '@/lib/schnittstelle';

export const dynamic = 'force-dynamic';

// POST { ticketCodes? } → ganze Bestellung oder einzelne Tickets stornieren (bis 24 h vor Beginn)
export const POST = partnerRoute<{ ref: string }>(async (req, p, { ref }) => {
  const e = await koerper(req, z.object({ ticketCodes: z.array(z.string().min(4).max(20)).max(10).optional() }));
  const o = await partnerStornieren(p, decodeURIComponent(ref), e.ticketCodes);
  return json(o);
});
