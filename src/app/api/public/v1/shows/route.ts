import { wienZuUtc } from '@/lib/dates';
import { json, preflight, shopRoute, zeitraum } from '@/lib/schnittstelle';
import { vorstellungen } from '@/lib/shop';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

// GET /api/public/v1/shows?from=YYYY-MM-DD&to=YYYY-MM-DD
export const GET = shopRoute(async (req) => {
  const { from, to } = zeitraum(new URL(req.url), wienZuUtc);
  return json(await vorstellungen({ from, to }));
});
