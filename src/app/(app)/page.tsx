import Link from 'next/link';
import { hat, requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtTag, fmtZeit, wienTag, wienZuUtc } from '@/lib/dates';
import { formatEur } from '@/lib/money';
import { KAPAZITAET } from '@/lib/saal';
import { PageHeader, StatusPill } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function Uebersicht() {
  const u = await requireRole();
  const heute = wienTag(new Date());
  const tagStart = wienZuUtc(heute, '00:00');
  const morgen = new Date(tagStart.getTime() + 864e5);
  const [shows, verkaufHeute, offen] = await Promise.all([
    db.show.findMany({ where: { startsAt: { gte: new Date(Date.now() - 2 * 3600e3) } }, orderBy: { startsAt: 'asc' }, take: 8, include: { _count: { select: { tickets: { where: { status: { not: 'storniert' } } } } } } }),
    db.order.aggregate({ where: { paidAt: { gte: tagStart, lt: morgen } }, _sum: { totalCents: true }, _count: true }),
    db.order.count({ where: { status: 'offen', createdAt: { lt: new Date(Date.now() - 30 * 60e3) } } }),
  ]);
  const eingelassen = shows[0] ? await db.ticket.count({ where: { showId: shows[0].id, status: 'eingelassen' } }) : 0;
  return (
    <>
      <PageHeader title={`Guten Tag, ${u.name.split(' ')[0]}`} sub="Was heute ansteht" />
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card p-5"><p className="text-xs text-muted">Verkauf heute</p><p className="num mt-1 text-2xl font-semibold">{formatEur(verkaufHeute._sum.totalCents ?? 0)}</p><p className="text-xs text-muted">{verkaufHeute._count} Bestellungen</p></div>
        <div className="card p-5"><p className="text-xs text-muted">Nächste Vorstellung</p><p className="mt-1 text-2xl font-semibold">{shows[0] ? `${fmtTag(shows[0].startsAt)}, ${fmtZeit(shows[0].startsAt)}` : '–'}</p><p className="text-xs text-muted">{shows[0] ? `${shows[0]._count.tickets} von ${KAPAZITAET} verkauft · ${eingelassen} eingelassen` : ''}</p></div>
        <div className="card p-5"><p className="text-xs text-muted">Unbezahlte Bestellungen (älter als 30 Min.)</p><p className="num mt-1 text-2xl font-semibold">{offen}</p></div>
      </div>
      {hat(u, 'leitung') && (
        <section className="card mt-6" aria-labelledby="naechste">
          <h2 id="naechste" className="h2 px-5 pt-4">Nächste Vorstellungen</h2>
          <table className="table mt-3">
            <thead><tr><th>Termin</th><th>Status</th><th className="text-right">Verkauft</th><th>Auslastung</th></tr></thead>
            <tbody>
              {shows.map((s) => {
                const pct = Math.round((s._count.tickets / KAPAZITAET) * 100);
                return (
                  <tr key={s.id}>
                    <td><Link href={`/vorstellungen/${s.id}`} className="font-medium underline-offset-4 hover:underline">{fmtTag(s.startsAt)}, {fmtZeit(s.startsAt)}</Link></td>
                    <td><StatusPill status={s.status} /></td>
                    <td className="num text-right">{s._count.tickets}</td>
                    <td className="w-1/3"><div className="h-2 rounded-full bg-line" role="img" aria-label={`${pct} % ausgelastet`}><div className="h-2 rounded-full bg-kat1" style={{ width: `${pct}%` }} /></div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
