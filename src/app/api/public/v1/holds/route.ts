import { clientIp, holdLimit, holdSchema, json, koerper, preflight, shopRoute } from '@/lib/schnittstelle';
import { holdAnlegen, holdMerken, holdPlatzFrei } from '@/lib/shop';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

// POST { showId, seats: [{ seatId, art }] } (1–10 Plätze) → Reservierung (15 Min.)
export const POST = shopRoute(async (req) => {
  holdLimit(req);
  const e = await koerper(req, holdSchema);
  await holdPlatzFrei(clientIp(req));
  const h = await holdAnlegen(e.showId, e.seats);
  holdMerken(clientIp(req), h.token);
  return json(h, 201);
});
