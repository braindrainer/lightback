import { z } from 'zod';
import { assertModulApi } from '@/lib/module';
import { json, koerper, preflight, shopRoute } from '@/lib/schnittstelle';
import { buchungFinden } from '@/lib/selbstservice';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

const schema = z.object({ nummer: z.string().min(4).max(40), email: z.string().email().max(200) });

// POST { nummer (Buchungsnummer oder Ticketcode), email } → { manageToken } für „Buchung verwalten“
export const POST = shopRoute(async (req) => {
  await assertModulApi('selbstservice');
  const e = await koerper(req, schema);
  return json({ manageToken: await buchungFinden(e.nummer, e.email) });
}, 10);
