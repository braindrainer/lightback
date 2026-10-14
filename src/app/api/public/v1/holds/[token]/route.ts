import { z } from 'zod';
import { holdLimit, json, koerper, preflight, shopRoute, sitzSchema } from '@/lib/schnittstelle';
import { freigeben } from '@/lib/seats';
import { holdAusgabe, holdBearbeiten } from '@/lib/shop';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

export const GET = shopRoute<{ token: string }>(async (_req, { token }) => json(await holdAusgabe(token)));

const aenderung = z.object({
  add: z.array(sitzSchema).max(10).optional(),
  remove: z.array(z.string().min(1).max(10)).max(10).optional(),
  art: z.record(z.string().max(10), z.enum(['normal', 'ermaessigt'])).optional(),
});

// PATCH { add?, remove?, art? } → Plätze einzeln dazu/weg; leere Reservierung wird gelöscht (dann { token, seats: [] })
export const PATCH = shopRoute<{ token: string }>(async (req, { token }) => {
  holdLimit(req);
  const e = await koerper(req, aenderung);
  const h = await holdBearbeiten(token, e);
  return json(h ?? { token, geloescht: true, seats: [], totalCents: 0 });
});

export const DELETE = shopRoute<{ token: string }>(async (req, { token }) => {
  holdLimit(req);
  await freigeben(token);
  return new Response(null, { status: 204 });
});
