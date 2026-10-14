import { z } from 'zod';
import { partnerBestellen, partnerRoute } from '@/lib/partner';
import { json, koerper } from '@/lib/schnittstelle';

export const dynamic = 'force-dynamic';

const schema = z.object({
  holdToken: z.string().min(10).max(100),
  partnerRef: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9._:\-/]+$/, 'Nur Buchstaben, Ziffern und . _ : - /'),
  kunde: z.object({ name: z.string().trim().min(1).max(160), email: z.email().max(200) }).optional(),
});

// POST → Bestellung auf Rechnung, sofort gültig. Idempotent über partnerRef.
export const POST = partnerRoute(async (req, p) => {
  const e = await koerper(req, schema);
  const r = await partnerBestellen(p, e);
  return json(r.order, r.neu ? 201 : 200);
});
