import { jsonMitEtag, preflight, shopRoute } from '@/lib/schnittstelle';
import { sitzStatus } from '@/lib/shop';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

// GET → { showId, status: { seatId: frei|belegt|meins } }. ETag/If-None-Match → 304; Header X-Hold-Token markiert eigene Plätze.
export const GET = shopRoute<{ id: string }>(async (req, { id }) => {
  const r = await sitzStatus(id, undefined, req.headers.get('x-hold-token'));
  return jsonMitEtag(req, r.etag, r.daten);
}, 240);
