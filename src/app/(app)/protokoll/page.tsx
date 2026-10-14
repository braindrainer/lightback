import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatumZeit, wienZuUtc } from '@/lib/dates';
import { Empty, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Protokoll' };

const JE_SEITE = 50;
type SP = { aktion?: string; entity?: string; id?: string; benutzer?: string; von?: string; bis?: string; seite?: string };

export default async function Protokoll({ searchParams }: { searchParams: Promise<SP> }) {
  await requireRole('admin');
  const sp = await searchParams;
  const seite = Math.max(1, Number(sp.seite) || 1);
  const tag = /^\d{4}-\d{2}-\d{2}$/;
  const where: Prisma.AuditLogWhereInput = {
    ...(sp.aktion ? { action: { contains: sp.aktion, mode: 'insensitive' } } : {}),
    ...(sp.entity ? { entity: sp.entity } : {}),
    ...(sp.id ? { entityId: sp.id.trim() } : {}),
    ...(sp.benutzer ? (sp.benutzer === 'system' ? { userId: null } : { userName: { contains: sp.benutzer, mode: 'insensitive' } }) : {}),
    ...(sp.von || sp.bis ? { createdAt: { ...(sp.von && tag.test(sp.von) ? { gte: wienZuUtc(sp.von, '00:00') } : {}), ...(sp.bis && tag.test(sp.bis) ? { lt: new Date(wienZuUtc(sp.bis, '00:00').getTime() + 864e5) } : {}) } } : {}),
  };
  const [eintraege, anzahl, entities] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (seite - 1) * JE_SEITE, take: JE_SEITE }),
    db.auditLog.count({ where }),
    db.auditLog.groupBy({ by: ['entity'], _count: { _all: true }, orderBy: { entity: 'asc' } }),
  ]);
  const seiten = Math.max(1, Math.ceil(anzahl / JE_SEITE));
  const link = (s: number) => `/protokoll?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && k !== 'seite')), seite: String(s) })}`;
  return (
    <>
      <PageHeader title="Protokoll" sub={`${anzahl.toLocaleString('de-AT')} Einträge`} />
      <form method="get" className="card mb-5 grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6" aria-label="Protokoll filtern">
        <div><label htmlFor="aktion" className="label">Aktion enthält</label><input id="aktion" name="aktion" defaultValue={sp.aktion} className="input" /></div>
        <div><label htmlFor="entity" className="label">Bereich</label>
          <select id="entity" name="entity" defaultValue={sp.entity ?? ''} className="input"><option value="">Alle</option>{entities.map((e) => <option key={e.entity} value={e.entity}>{e.entity} ({e._count._all})</option>)}</select></div>
        <div><label htmlFor="id" className="label">Datensatz-ID</label><input id="id" name="id" defaultValue={sp.id} className="input" /></div>
        <div><label htmlFor="benutzer" className="label">Benutzer</label><input id="benutzer" name="benutzer" defaultValue={sp.benutzer} aria-describedby="benutzer-h" className="input" /><p id="benutzer-h" className="mt-1 text-xs text-muted">„system“ = ohne Anmeldung</p></div>
        <div><label htmlFor="von" className="label">Von</label><input id="von" name="von" type="date" defaultValue={sp.von} className="input" /></div>
        <div><label htmlFor="bis" className="label">Bis</label><input id="bis" name="bis" type="date" defaultValue={sp.bis} className="input" /></div>
        <div className="flex gap-2 sm:col-span-3 lg:col-span-6"><button className="btn-primary">Filtern</button><Link href="/protokoll" className="btn-secondary">Zurücksetzen</Link></div>
      </form>
      <div className="card">
        {eintraege.length ? (
          <table className="table">
            <thead><tr><th scope="col">Zeit</th><th scope="col">Benutzer</th><th scope="col">Aktion</th><th scope="col">Bereich</th><th scope="col">Details</th></tr></thead>
            <tbody>
              {eintraege.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap">{fmtDatumZeit(e.createdAt)}</td>
                  <td>{e.userName ?? <span className="text-muted">System/API</span>}</td>
                  <td className="font-mono text-[13px]">{e.action}</td>
                  <td>{e.entity}{e.entityId && <><br /><Link href={`/protokoll?entity=${encodeURIComponent(e.entity)}&id=${encodeURIComponent(e.entityId)}`} className="font-mono text-xs text-accent-deep underline underline-offset-2">{e.entityId}</Link></>}</td>
                  <td className="max-w-md">{e.data ? <details><summary className="cursor-pointer text-sm text-accent-deep underline underline-offset-2">Daten</summary><pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-paper p-2 text-xs">{JSON.stringify(e.data, null, 2)}</pre></details> : <span className="text-muted">–</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>Keine Einträge für diesen Filter.</Empty>}
      </div>
      {seiten > 1 && (
        <nav aria-label="Seiten" className="mt-4 flex items-center gap-3 text-sm">
          {seite > 1 && <Link href={link(seite - 1)} className="btn-secondary btn-sm">Neuere</Link>}
          <span>Seite {seite} von {seiten}</span>
          {seite < seiten && <Link href={link(seite + 1)} className="btn-secondary btn-sm">Ältere</Link>}
        </nav>
      )}
    </>
  );
}
