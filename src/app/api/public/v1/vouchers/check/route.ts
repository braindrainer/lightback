import { z } from 'zod';
import { gutscheinPruefen } from '@/lib/orders';
import { ApiFehler, iso, json, koerper, preflight, shopRoute } from '@/lib/schnittstelle';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

// POST { code } → Restwert. Streng begrenzt (10/Min. je IP) gegen Durchprobieren.
export const POST = shopRoute(async (req) => {
  const { code } = await koerper(req, z.object({ code: z.string().trim().min(3).max(40) }));
  try {
    const v = await gutscheinPruefen(code);
    return json({ code: v.code, remainingCents: v.remainingCents, validUntil: iso(v.validUntil) });
  } catch (e) {
    throw new ApiFehler(404, 'gutschein_ungueltig', (e as Error).message);
  }
}, 10);
