import { kontingentPruefen, partnerKategorien, partnerRoute } from '@/lib/partner';
import { holdSchema, json, koerper } from '@/lib/schnittstelle';
import { holdAnlegen, kategorienPruefen } from '@/lib/shop';

export const dynamic = 'force-dynamic';

// POST { showId, seats: [{ seatId, art }] } → Reservierung (15 Min.)
export const POST = partnerRoute(async (req, p) => {
  const e = await koerper(req, holdSchema);
  kategorienPruefen(e.seats.map((s) => s.seatId), partnerKategorien(p));
  await kontingentPruefen(p, e.showId, e.seats.length);
  return json(await holdAnlegen(e.showId, e.seats, partnerKategorien(p)), 201);
});
