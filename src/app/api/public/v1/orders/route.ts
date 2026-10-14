import { z } from 'zod';
import { json, koerper, preflight, shopRoute } from '@/lib/schnittstelle';
import { shopBestellen } from '@/lib/shop';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

const schema = z.object({
  holdToken: z.string().min(10).max(100),
  kunde: z.object({
    firstName: z.string().trim().min(1).max(80), lastName: z.string().trim().min(1).max(80),
    email: z.email().max(200), newsletter: z.boolean().optional(),
  }),
  voucherCode: z.string().trim().max(40).optional().transform((v) => v || undefined),
  provider: z.enum(['hobex', 'stripe', 'paypal', 'applepay', 'gutschein']),
  demoKarte: z.string().max(30).optional(),
  locale: z.enum(['de', 'en']).default('de'),
});

// POST → Bestellung anlegen und Zahlung starten
export const POST = shopRoute(async (req) => {
  const e = await koerper(req, schema);
  const r = await shopBestellen(e);
  if (r.status === 'abgelehnt') return json({ status: 'abgelehnt', error: { code: 'zahlung_abgelehnt', message: r.message }, holdToken: r.holdToken }, 402);
  return json(r, r.status === 'bezahlt' ? 201 : 202);
}, 20);
