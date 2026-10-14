// Kommende Vorstellungen im Verkauf als Auswahlliste (mit freien Plätzen)
import { db } from '@/lib/db';
import { fmtTag, fmtZeit, wienTag } from '@/lib/dates';
import { auslastungListe } from './daten';
import type { ShowOption } from './PlatzWahl';

export async function showOptionen(take = 250): Promise<ShowOption[]> {
  const shows = await db.show.findMany({ where: { status: 'verkauf', startsAt: { gt: new Date() } }, orderBy: { startsAt: 'asc' }, take, select: { id: true, startsAt: true, title: true } });
  const z = await auslastungListe(shows.map((s) => s.id));
  return shows.map((s) => ({ id: s.id, label: `${fmtTag(s.startsAt)} ${wienTag(s.startsAt).slice(0, 4)}, ${fmtZeit(s.startsAt)}${s.title !== 'Light of Creation' ? ` · ${s.title}` : ''}`, frei: z.get(s.id)!.gesamt.frei }));
}
