import { holdLimit, preflight, shopRoute } from '@/lib/schnittstelle';
import { freigeben } from '@/lib/seats';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

// POST – wie DELETE, für navigator.sendBeacon beim Schließen des Tabs
export const POST = shopRoute<{ token: string }>(async (req, { token }) => {
  holdLimit(req);
  await freigeben(token);
  return new Response(null, { status: 204 });
});
