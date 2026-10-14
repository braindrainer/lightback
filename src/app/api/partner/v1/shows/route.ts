import { wienZuUtc } from '@/lib/dates';
import { partnerKategorien, partnerRoute, verkauftJeShow } from '@/lib/partner';
import { json, zeitraum } from '@/lib/schnittstelle';
import { vorstellungen } from '@/lib/shop';

export const dynamic = 'force-dynamic';

// GET /api/partner/v1/shows?from&to → Vorstellungen mit freien Plätzen (nur freigegebene Kategorien) und Restkontingent
export const GET = partnerRoute(async (req, p) => {
  const { from, to } = zeitraum(new URL(req.url), wienZuUtc);
  const shows = await vorstellungen({ from, to, kategorien: partnerKategorien(p) });
  const verkauft = await verkauftJeShow(p.id, shows.map((s) => s.id));
  return json(shows.map((s) => {
    const v = verkauft.get(s.id) ?? 0;
    return { ...s, quota: p.quotaPerShow == null ? null : { total: p.quotaPerShow, sold: v, remaining: Math.max(0, p.quotaPerShow - v) } };
  }));
});
