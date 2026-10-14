import { ApiFehler, holdLimit, json, preflight, shopRoute } from '@/lib/schnittstelle';
import { holdAusgabe } from '@/lib/shop';
import { verlaengern } from '@/lib/seats';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

// Um 10 Minuten verlängern (höchstens zweimal)
export const POST = shopRoute<{ token: string }>(async (req, { token }) => {
  holdLimit(req);
  try { await verlaengern(token); } catch (e) { throw new ApiFehler(409, 'nicht_verlaengerbar', (e as Error).message); }
  return json(await holdAusgabe(token));
});
