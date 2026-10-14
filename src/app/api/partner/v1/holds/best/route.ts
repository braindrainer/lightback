import { kontingentPruefen, partnerKategorien, partnerRoute } from '@/lib/partner';
import { bestSchema, json, koerper } from '@/lib/schnittstelle';
import { besteReservieren } from '@/lib/shop';

export const dynamic = 'force-dynamic';

// POST { showId, anzahl, kat, art?, wunsch? } → beste Plätze nebeneinander reservieren
export const POST = partnerRoute(async (req, p) => {
  const e = await koerper(req, bestSchema);
  await kontingentPruefen(p, e.showId, e.anzahl);
  return json(await besteReservieren(e, partnerKategorien(p)), 201);
});
