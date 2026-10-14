import { bestSchema, clientIp, holdLimit, json, koerper, preflight, shopRoute } from '@/lib/schnittstelle';
import { besteReservieren, holdMerken, holdPlatzFrei } from '@/lib/shop';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

// POST { showId, anzahl, kat, wunsch? } → beste Plätze nebeneinander suchen und reservieren
export const POST = shopRoute(async (req) => {
  holdLimit(req);
  const e = await koerper(req, bestSchema);
  await holdPlatzFrei(clientIp(req));
  const h = await besteReservieren(e);
  holdMerken(clientIp(req), h.token);
  return json(h, 201);
});
