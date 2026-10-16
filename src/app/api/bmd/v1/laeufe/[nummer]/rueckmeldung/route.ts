import { z } from 'zod';
import { db } from '@/lib/db';
import { laufJson, rueckmeldung } from '@/lib/finanzen/bmd-uebergabe';
import { bmdRoute, nummerAus } from '@/lib/finanzen/bmd-route';
import { json, koerper } from '@/lib/schnittstelle';

export const dynamic = 'force-dynamic';

const schema = z.object({ ok: z.boolean(), referenz: z.string().max(100).optional(), fehler: z.string().max(2000).optional() });

// POST { ok, referenz?, fehler? } → Ergebnis des Imports in BMD (übernommen bzw. Fehler → nächster Lauf)
export const POST = bmdRoute<{ nummer: string }>(async (req, { nummer }) => {
  const e = await koerper(req, schema);
  const n = nummerAus(nummer);
  await rueckmeldung({ nummer: n, ...e });
  return json(laufJson((await db.bmdLauf.findUniqueOrThrow({ where: { nummer: n } }))));
});
