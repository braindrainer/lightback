import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Prisma } from '@prisma/client';
import { hat, requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatumZeit, fmtTag, fmtZeit, wienTag, wienZuUtc } from '@/lib/dates';
import { stornoMoeglich } from '@/lib/orders';
import { sitzName } from '@/lib/saal';
import { FilterChips, Icon, PageHeader } from '@/components/ui';
import { Seiten } from '@/components/verkauf/Seiten';
import { KANAL_NAME, ZAHLART_NAME } from '@/components/verkauf/texte';
import BestellungenTabelle, { type Zeile } from '@/components/verkauf/BestellungenTabelle';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Bestellungen' };
const GROESSEN = [25, 50, 100];
const STATUS = [['offen', 'Offen'], ['bezahlt', 'Bezahlt'], ['teilstorniert', 'Teilstorniert'], ['storniert', 'Storniert']];
const tagOk = (s?: string) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '');
const SORT: Record<string, (d: Prisma.SortOrder) => Prisma.OrderOrderByWithRelationInput> = {
  datum: (d) => ({ createdAt: d }),
  kunde: (d) => ({ customer: { lastName: d } }),
  vorstellung: (d) => ({ show: { startsAt: d } }),
  tickets: (d) => ({ tickets: { _count: d } }),
  kanal: (d) => ({ channel: d }),
  status: (d) => ({ status: d }),
  betrag: (d) => ({ totalCents: d }),
};

export default async function Bestellungen({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireRole('leitung');
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  const seite = Math.max(1, Number(sp.seite) || 1);
  const pro = GROESSEN.includes(Number(sp.pro)) ? Number(sp.pro) : 50;
  const sort = SORT[sp.sort ?? ''] ? sp.sort! : 'datum';
  const dir: Prisma.SortOrder = sp.dir === 'asc' ? 'asc' : 'desc';
  // Exakter Ticketcode (auch mit Leer- oder Bindestrichen): direkt zum Ticket
  const code = q.toUpperCase().replace(/[\s-]/g, '');
  if (/^[A-Z0-9]{6,16}$/.test(code)) {
    const t = await db.ticket.findUnique({ where: { code }, select: { id: true } });
    if (t) redirect(`/tickets/${t.id}`);
  }
  const heute = wienTag(new Date());
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
  if (sp.heute === '1') and.push({ createdAt: { gte: wienZuUtc(heute, '00:00') } });
  if (tagOk(sp.von)) and.push({ createdAt: { gte: wienZuUtc(sp.von!, '00:00') } });
  if (tagOk(sp.bis)) and.push({ createdAt: { lt: new Date(wienZuUtc(sp.bis!, '00:00').getTime() + 864e5) } });
  if (sp.show) and.push({ showId: sp.show });
  if (tagOk(sp.tag)) and.push({ show: { startsAt: { gte: wienZuUtc(sp.tag!, '00:00'), lt: new Date(wienZuUtc(sp.tag!, '00:00').getTime() + 864e5) } } });
  const where: Prisma.OrderWhereInput = { AND: and };
  const [anzahl, orders, show] = await Promise.all([
    db.order.count({ where }),
    db.order.findMany({
      where, orderBy: [SORT[sort](dir), { createdAt: 'desc' }], skip: (seite - 1) * pro, take: pro,
      include: {
        customer: { select: { firstName: true, lastName: true, email: true, company: true } }, show: { select: { id: true, startsAt: true } }, partner: { select: { name: true } },
        tickets: { where: { status: { not: 'storniert' } }, select: { seatId: true }, orderBy: { seatId: 'asc' } },
        payments: { select: { provider: true }, orderBy: { createdAt: 'asc' } },
        invoices: { where: { kind: 'rechnung' }, select: { id: true, number: true }, orderBy: { issueDate: 'desc' }, take: 1 },
      },
    }),
    sp.show ? db.show.findUnique({ where: { id: sp.show }, select: { startsAt: true } }) : null,
  ]);
  const params: Record<string, string | undefined> = { q: q || undefined, status: sp.status, kanal: sp.kanal, heute: sp.heute, von: sp.von, bis: sp.bis, show: sp.show, tag: sp.tag, sort: sp.sort, dir: sp.dir, pro: sp.pro };
  const url = (p: Record<string, string | undefined>) => {
    const s = new URLSearchParams(Object.entries({ ...params, ...p }).filter((e): e is [string, string] => !!e[1])).toString();
    return `/bestellungen${s ? `?${s}` : ''}`;
  };
  const zeilen: Zeile[] = orders.map((o) => {
    const zahlarten = [...new Set(o.payments.map((p) => ZAHLART_NAME[p.provider] ?? p.provider))];
    return {
      id: o.id, number: o.number, erstellt: fmtDatumZeit(o.createdAt),
      kunde: o.customer ? { name: `${o.customer.firstName} ${o.customer.lastName}`.trim(), email: o.customer.email, firma: o.customer.company ?? '' } : null,
      show: { id: o.show.id, label: `${fmtTag(o.show.startsAt)} ${wienTag(o.show.startsAt).slice(0, 4)}, ${fmtZeit(o.show.startsAt)}`, kurz: `${fmtTag(o.show.startsAt)}, ${fmtZeit(o.show.startsAt)}` },
      tickets: o.tickets.length, plaetze: o.tickets.map((t) => sitzName(t.seatId)),
      kanal: o.channel, kanalName: KANAL_NAME[o.channel] ?? o.channel, partner: o.partner?.name ?? null,
      zahlung: zahlarten.join(', ') || (o.status === 'offen' ? (o.note.includes('Zahlungslink') ? 'Zahlungslink ausständig' : o.note.includes('Rechnung') ? 'Rechnung ausständig' : 'ausständig') : '–'),
      status: o.status, totalCents: o.totalCents,
      rechnung: o.invoices[0] ?? null, manageToken: o.manageToken,
      hatEmail: !!o.customer?.email,
      stornierbar: ['bezahlt', 'teilstorniert'].includes(o.status) && o.tickets.length > 0,
      fristAbgelaufen: !stornoMoeglich(o.show.startsAt),
    };
  });
  const chip = (label: string, key: string, wert: string) => ({ label, href: url({ [key]: params[key] === wert ? undefined : wert }), aktiv: params[key] === wert });
  const filterAktiv = Object.entries(params).some(([k, v]) => v && !['sort', 'dir', 'pro'].includes(k));
  return (
    <>
      <PageHeader title="Bestellungen" krumen={[{ label: 'Verkauf' }, { label: 'Bestellungen' }]}
        sub={<><span className="num font-semibold text-ink">{anzahl.toLocaleString('de-AT')}</span> {anzahl === 1 ? 'Bestellung' : 'Bestellungen'}{filterAktiv ? ' für diesen Filter' : ' insgesamt'}</>}>
        <Link href="/bestellungen/neu" className="btn-gold"><Icon name="telefon" className="h-4 w-4" />Telefonverkauf</Link>
      </PageHeader>

      <div className="card mb-4 !overflow-visible">
        <form method="get" role="search" aria-label="Bestellungen suchen" className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_10.5rem_10.5rem_auto] md:items-end">
          {(['kanal', 'heute', 'show', 'sort', 'dir', 'pro'] as const).map((k) => params[k] && <input key={k} type="hidden" name={k} value={params[k]} />)}
          <div>
            <label htmlFor="q" className="label">Suche</label>
            <div className="relative">
              <Icon name="suche" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input id="q" name="q" type="search" defaultValue={q} placeholder="Nummer, Name, E-Mail, Telefon, Ticketcode" className="input !pl-9" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 md:contents">
            <div><label htmlFor="von" className="label">Bestellt ab</label><input id="von" name="von" type="date" defaultValue={sp.von} className="input" /></div>
            <div><label htmlFor="bis" className="label">Bestellt bis</label><input id="bis" name="bis" type="date" defaultValue={sp.bis} className="input" /></div>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary flex-1 md:flex-none">Suchen</button>
            {filterAktiv && <Link href="/bestellungen" className="btn-ghost">Zurücksetzen</Link>}
          </div>
          <details className="md:col-span-full" open={!!sp.tag || sp.status === 'teilstorniert'}>
            <summary className="inline-flex min-h-8 cursor-pointer items-center gap-1 text-sm font-medium text-accent-deep">Weitere Filter</summary>
            <div className="mt-2 grid max-w-xl gap-3 sm:grid-cols-2">
              <div><label htmlFor="tag" className="label">Vorstellungstag</label><input id="tag" name="tag" type="date" defaultValue={sp.tag} className="input" /></div>
              <div><label htmlFor="status" className="label">Status</label>
                <select id="status" name="status" defaultValue={sp.status ?? ''} className="input"><option value="">Alle</option>{STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            </div>
          </details>
        </form>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-soft px-4 py-3">
          <FilterChips label="Schnellfilter" chips={[
            chip('Heute', 'heute', '1'),
            chip('Offen', 'status', 'offen'), chip('Bezahlt', 'status', 'bezahlt'), chip('Storniert', 'status', 'storniert'),
            chip('Telefon', 'kanal', 'telefon'), chip('Web', 'kanal', 'web'), chip('Partner', 'kanal', 'partner'), chip('Gäste/Freikarten', 'kanal', 'gast'),
          ]} />
          {show && <span className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-[13px]">Vorstellung {fmtTag(show.startsAt)}, {fmtZeit(show.startsAt)}<Link className="underline underline-offset-4" href={url({ show: undefined })}>entfernen<span className="sr-only"> (Filter Vorstellung)</span></Link></span>}
        </div>
      </div>

      <BestellungenTabelle zeilen={zeilen} sort={sort} dir={dir} darfFrist={hat(u, 'leitung')} filterAktiv={filterAktiv}
        sortHref={Object.fromEntries(Object.keys(SORT).map((k) => [k, url({ sort: k, dir: sort === k && dir === 'desc' ? 'asc' : 'desc' })]))}>
        <Seiten seite={seite} seiten={Math.ceil(anzahl / pro)} basis="/bestellungen" params={params} gesamt={anzahl} pro={pro} groessen={GROESSEN} />
      </BestellungenTabelle>
    </>
  );
}
