import { partnerBestellungLaden, partnerRoute } from '@/lib/partner';
import { json } from '@/lib/schnittstelle';
import { bestellungJson } from '@/lib/shop';

export const dynamic = 'force-dynamic';

export const GET = partnerRoute<{ ref: string }>(async (_req, p, { ref }) => {
  const { manageToken: _m, ...o } = bestellungJson(await partnerBestellungLaden(p, decodeURIComponent(ref)));
  void _m;
  return json(o);
});
