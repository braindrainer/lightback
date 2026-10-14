import { partnerKategorien, partnerRoute } from '@/lib/partner';
import { jsonMitEtag } from '@/lib/schnittstelle';
import { sitzStatus } from '@/lib/shop';

export const dynamic = 'force-dynamic';

export const GET = partnerRoute<{ id: string }>(async (req, p, { id }) => {
  const r = await sitzStatus(id, partnerKategorien(p), req.headers.get('x-hold-token'));
  return jsonMitEtag(req, r.etag, r.daten);
});
