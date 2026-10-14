import { headers } from 'next/headers';
import { istAppHost } from '@/lib/apphost';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtTag, fmtZeit } from '@/lib/dates';
import EinlassApp from './EinlassApp';

export const dynamic = 'force-dynamic';

export default async function EinlassSeite() {
  const u = await requireRole('einlass');
  const jetzt = Date.now();
  const shows = await db.show.findMany({
    where: { startsAt: { gte: new Date(jetzt - 4 * 3600e3), lte: new Date(jetzt + 3 * 864e5) }, status: { not: 'abgesagt' } },
    orderBy: { startsAt: 'asc' }, take: 10,
  });
  // Laufende oder nächste Vorstellung (Einlass bis Ende der Vorstellung)
  const aktuell = shows.find((s) => s.startsAt.getTime() + (s.durationMin + 15) * 60e3 > jetzt) ?? shows.at(-1);
  return (
    <>
      <h1 className="sr-only">Einlass-Scanner</h1>
      <EinlassApp
        shows={shows.map((s) => ({ id: s.id, label: `${fmtTag(s.startsAt)}, ${fmtZeit(s.startsAt)} Uhr`, tag: fmtTag(s.startsAt), zeit: fmtZeit(s.startsAt) }))}
        standard={aktuell?.id ?? ''} benutzer={u.name} appHost={istAppHost(await headers())} />
    </>
  );
}
