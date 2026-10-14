import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Prisma } from '@prisma/client';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatumZeit, fmtTag, fmtZeit, wienZuUtc } from '@/lib/dates';
import { Empty, Money, PageHeader, StatusPill } from '@/components/ui';
import { Seiten } from '@/components/verkauf/Seiten';
import { KANAL_NAME } from '@/components/verkauf/texte';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Bestellungen' };
const PRO_SEITE = 50;
const STATUS = [['offen', 'Offen'], ['bezahlt', 'Bezahlt'], ['teilstorniert', 'Teilstorniert'], ['storniert', 'Storniert']];
const tagOk = (s?: string) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '');

export default async function Bestellungen({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole('leitung');
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  const seite = Math.max(1, Number(sp.seite) || 1);
  // Exakter Ticketcode (auch mit Leer- oder Bindestrichen): direkt zum Ticket
  const code = q.toUpperCase().replace(/[\s-]/g, '');
  if (/^[A-Z0-9]{6,16}$/.test(code)) {
    const t = await db.ticket.findUnique({ where: { code }, select: { id: true } });
    if (t) redirect(`/tickets/${t.id}`);
  }
  const and: Prisma.OrderWhereInput[] = [];
  if (q) {
    const teile = q.split(/\s+/).filter(Boolean);
    and.push({
      OR: [
        { number: { contains: q, mode: 'insensitive' } },
        { partnerRef: { contains: q, mode: 'insensitive' } },
        { voucherCode: { equals: q.toUpperCase() } },
        { tickets: { some: { code: q.toUpperCase() } } },
        { customer: { email: { contains: q, mode: 'insensitive' } } },
        { customer: { phone: { contains: q } } },
        { customer: { AND: teile.map((t) => ({ OR: [{ firstName: { contains: t, mode: 'insensitive' as const } }, { lastName: { contains: t, mode: 'insensitive' as const } }, { company: { contains: t, mode: 'insensitive' as const } }] })) } },
      ],
    });
  }
  if (STATUS.some(([k]) => k === sp.status)) and.push({ status: sp.status });
  if (sp.kanal && KANAL_NAME[sp.kanal]) and.push({ channel: sp.kanal });
  if (tagOk(sp.von)) and.push({ createdAt: { gte: wienZuUtc(sp.von!, '00:00') } });
  if (tagOk(sp.bis)) and.push({ createdAt: { lt: new Date(wienZuUtc(sp.bis!, '00:00').getTime() + 864e5) } });
  if (sp.show) and.push({ showId: sp.show });
  if (tagOk(sp.tag)) and.push({ show: { startsAt: { gte: wienZuUtc(sp.tag!, '00:00'), lt: new Date(wienZuUtc(sp.tag!, '00:00').getTime() + 864e5) } } });
  const where: Prisma.OrderWhereInput = { AND: and };
  const [anzahl, orders, show] = await Promise.all([
    db.order.count({ where }),
    db.order.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (seite - 1) * PRO_SEITE, take: PRO_SEITE, include: { customer: true, show: { select: { startsAt: true } }, _count: { select: { tickets: { where: { status: { not: 'storniert' } } } } } } }),
    sp.show ? db.show.findUnique({ where: { id: sp.show }, select: { startsAt: true } }) : null,
  ]);
  const params = { q: q || undefined, status: sp.status, kanal: sp.kanal, von: sp.von, bis: sp.bis, show: sp.show, tag: sp.tag };
  return (
    <>
      <PageHeader title="Bestellungen" sub={`${anzahl} Treffer`}>
        <Link href="/bestellungen/neu" className="btn-gold">Telefonverkauf</Link>
      </PageHeader>
      <form method="get" className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-7" role="search" aria-label="Bestellungen suchen">
        {sp.show && <input type="hidden" name="show" value={sp.show} />}
        <div className="sm:col-span-2"><label htmlFor="q" className="label">Suche</label><input id="q" name="q" type="search" defaultValue={q} placeholder="Nummer, Name, E-Mail, Ticketcode" className="input" /></div>
        <div><label htmlFor="status" className="label">Status</label>
          <select id="status" name="status" defaultValue={sp.status ?? ''} className="input"><option value="">Alle</option>{STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div><label htmlFor="kanal" className="label">Kanal</label>
          <select id="kanal" name="kanal" defaultValue={sp.kanal ?? ''} className="input"><option value="">Alle</option>{Object.entries(KANAL_NAME).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div><label htmlFor="von" className="label">Bestellt ab</label><input id="von" name="von" type="date" defaultValue={sp.von} className="input" /></div>
        <div><label htmlFor="bis" className="label">Bestellt bis</label><input id="bis" name="bis" type="date" defaultValue={sp.bis} className="input" /></div>
        <div><label htmlFor="tag" className="label">Vorstellungstag</label><input id="tag" name="tag" type="date" defaultValue={sp.tag} className="input" /></div>
        <div className="flex flex-wrap items-center gap-2 lg:col-span-7">
          <button className="btn-primary">Suchen</button>
          <Link href="/bestellungen" className="btn-secondary">Filter zurücksetzen</Link>
          {show && <span className="text-sm">Nur Vorstellung {fmtTag(show.startsAt)}, {fmtZeit(show.startsAt)} · <Link className="underline underline-offset-4" href={`/bestellungen?${new URLSearchParams(Object.entries({ ...params, show: undefined }).filter(([, v]) => v) as [string, string][])}`}>alle Vorstellungen zeigen</Link></span>}
        </div>
      </form>
      <section className="card" aria-label="Ergebnisse">
        {orders.length ? (
          <table className="table">
            <caption className="sr-only">Bestellungen, neueste zuerst</caption>
            <thead><tr><th scope="col">Nummer</th><th scope="col">Kund:in</th><th scope="col">Vorstellung</th><th scope="col">Kanal</th><th scope="col">Status</th><th scope="col" className="text-right">Tickets</th><th scope="col" className="text-right">Summe</th><th scope="col">Bestellt</th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td><Link href={`/bestellungen/${o.id}`} className="font-mono font-medium underline-offset-4 hover:underline">{o.number}</Link></td>
                  <td>{o.customer ? <>{`${o.customer.firstName} ${o.customer.lastName}`.trim() || '–'}<span className="block text-xs text-muted">{o.customer.email}</span></> : <span className="text-muted">anonym</span>}</td>
                  <td className="whitespace-nowrap">{fmtTag(o.show.startsAt)}, {fmtZeit(o.show.startsAt)}</td>
                  <td>{KANAL_NAME[o.channel] ?? o.channel}</td>
                  <td><StatusPill status={o.status} /></td>
                  <td className="num text-right">{o._count.tickets}</td>
                  <td className="text-right"><Money cents={o.totalCents} /></td>
                  <td className="whitespace-nowrap">{fmtDatumZeit(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>Keine Bestellungen gefunden.</Empty>}
        <Seiten seite={seite} seiten={Math.ceil(anzahl / PRO_SEITE)} basis="/bestellungen" params={params} />
      </section>
    </>
  );
}
