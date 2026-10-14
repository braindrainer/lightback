import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatumZeit } from '@/lib/dates';
import { Empty, Icon, PageHeader, StatusPill } from '@/components/ui';
import { VORLAGE_NAME } from './vorlagen/platzhalter';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'E-Mails' };

const JE_SEITE = 50;
const STATI = [['gesendet', 'Gesendet'], ['demo', 'Demo (nicht gesendet)'], ['fehler', 'Fehler'], ['wartet', 'Wartet']];

export default async function Emails({ searchParams }: { searchParams: Promise<{ status?: string; vorlage?: string; q?: string; seite?: string }> }) {
  await requireRole('leitung');
  const sp = await searchParams;
  const seite = Math.max(1, Number(sp.seite) || 1);
  const q = sp.q?.trim();
  const where: Prisma.EmailLogWhereInput = {
    ...(sp.status ? { status: sp.status } : {}),
    ...(sp.vorlage ? { template: sp.vorlage } : {}),
    ...(q ? { OR: [{ to: { contains: q, mode: 'insensitive' } }, { subject: { contains: q, mode: 'insensitive' } }, { order: { number: { contains: q, mode: 'insensitive' } } }] } : {}),
  };
  const [mails, anzahl, vorlagen, fehler] = await Promise.all([
    db.emailLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (seite - 1) * JE_SEITE, take: JE_SEITE, select: { id: true, to: true, subject: true, template: true, status: true, createdAt: true, error: true, orderId: true, order: { select: { number: true } } } }),
    db.emailLog.count({ where }),
    db.emailLog.groupBy({ by: ['template'], _count: { _all: true }, orderBy: { template: 'asc' } }),
    db.emailLog.count({ where: { status: 'fehler', createdAt: { gt: new Date(Date.now() - 7 * 864e5) } } }),
  ]);
  const seiten = Math.max(1, Math.ceil(anzahl / JE_SEITE));
  const link = (s: number) => `/emails?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && k !== 'seite')), seite: String(s) })}`;
  return (
    <>
      <PageHeader krumen={[{ label: 'System' }, { label: 'E-Mails' }]} title="E-Mails" sub={`${anzahl.toLocaleString('de-AT')} Mails${fehler ? ` · ${fehler} Fehler in den letzten 7 Tagen` : ''}`}>
        <Link href="/emails/vorlagen" className="btn-secondary"><Icon name="bearbeiten" className="h-4 w-4" />Vorlagen bearbeiten</Link>
      </PageHeader>
      <form method="get" className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end" aria-label="E-Mails filtern">
        <div className="sm:col-span-2 lg:col-span-1"><label htmlFor="q" className="label">Suche (Empfänger, Betreff, Bestellnummer)</label><input id="q" name="q" type="search" defaultValue={q} className="input" /></div>
        <div><label htmlFor="status" className="label">Status</label><select id="status" name="status" defaultValue={sp.status ?? ''} className="input"><option value="">Alle</option>{STATI.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div><label htmlFor="vorlage" className="label">Vorlage</label><select id="vorlage" name="vorlage" defaultValue={sp.vorlage ?? ''} className="input"><option value="">Alle</option>{vorlagen.map((v) => <option key={v.template} value={v.template}>{VORLAGE_NAME[v.template] ?? v.template} ({v._count._all})</option>)}</select></div>
        <div className="flex gap-2"><button className="btn-primary">Filtern</button><Link href="/emails" className="btn-ghost">Zurücksetzen</Link></div>
      </form>
      <div className="card tabelle-frei">
        {mails.length ? (
          <table className="table rtab">
            <thead><tr><th scope="col">Zeit</th><th scope="col">Empfänger</th><th scope="col">Betreff</th><th scope="col">Vorlage</th><th scope="col">Bestellung</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {mails.map((m) => (
                <tr key={m.id}>
                  <td data-label="Zeit" className="whitespace-nowrap">{fmtDatumZeit(m.createdAt)}</td>
                  <td data-label="Empfänger" className="max-w-56 break-words">{m.to}</td>
                  <td className="rtab-kopf md:!max-w-md"><Link href={`/emails/${m.id}`} className="font-medium underline-offset-4 hover:underline">{m.subject}</Link>{m.error && <p className="mt-0.5 text-xs text-neg">{m.error}</p>}</td>
                  <td data-label="Vorlage">{VORLAGE_NAME[m.template] ?? m.template}</td>
                  <td data-label="Bestellung" className="whitespace-nowrap">{m.orderId ? <Link href={`/bestellungen/${m.orderId}`} className="font-mono text-[13px] underline-offset-4 hover:underline">{m.order?.number ?? 'öffnen'}</Link> : <span className="text-muted">–</span>}</td>
                  <td data-label="Status"><StatusPill status={m.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty icon="mail" titel="Keine Mails für diesen Filter" aktion={<Link href="/emails" className="btn-secondary btn-sm">Filter zurücksetzen</Link>}>Jede automatische Mail (Tickets, Storno, Rechnung …) wird hier protokolliert.</Empty>}
        {seiten > 1 && (
          <nav aria-label="Seiten" className="flex items-center justify-between gap-3 border-t border-line-soft px-4 py-3 text-sm">
            {seite > 1 ? <Link href={link(seite - 1)} className="btn-secondary btn-sm">Neuere</Link> : <span />}
            <span className="text-muted">Seite {seite} von {seiten}</span>
            {seite < seiten ? <Link href={link(seite + 1)} className="btn-secondary btn-sm">Ältere</Link> : <span />}
          </nav>
        )}
      </div>
    </>
  );
}
