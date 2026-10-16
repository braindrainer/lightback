import { z } from 'zod';
import { assertModulApi } from '@/lib/module';
import { json, koerper, preflight, shopRoute } from '@/lib/schnittstelle';
import { bestellungJson, bestellungLaden } from '@/lib/shop';
import { selbstUmbuchen } from '@/lib/selbstservice';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

const schema = z.object({ showId: z.string().min(1).max(40), ticketCodes: z.array(z.string().min(4).max(20)).max(10).optional() });

// POST /orders/{manageToken}/rebook → Selbst-Umbuchung bis 24 h vor Beginn (gleiche Kategorie, beste freie Plätze)
export const POST = shopRoute<{ ref: string }>(async (req, { ref }) => {
  await assertModulApi('selbstservice');
  const e = await koerper(req, schema);
  const r = await selbstUmbuchen(ref, e);
  const neu = (await bestellungLaden({ manageToken: r.manageToken }))!;
  return json({ order: bestellungJson(neu), voucher: r.gutschein });
}, 10);
