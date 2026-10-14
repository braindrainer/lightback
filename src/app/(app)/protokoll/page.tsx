import Link from 'next/link';
import { audit, pruefeKette } from '@/lib/audit';
import { aktionName, bereichLink, bereichName } from '@/lib/audit-texte';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatum } from '@/lib/dates';
import { tagesAnker } from '@/lib/protokoll-anker';
import { filterLesen, filterQuery, filterWhere } from '@/lib/protokoll-filter';
import { Empty, PageHeader } from '@/components/ui';
import { Aenderungen, Daten } from '@/components/Verlauf';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Protokoll' };

const JE_SEITE = 50;
const zeit = (d: Date) => new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(d);
const kurz = (h?: string | null) => (h ? `${h.slice(0, 10)}…` : '–');

export default async function Protokoll({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireRole('admin');
  const sp = await searchParams;
  const f = filterLesen(sp);
  const seite = Math.max(1, Number(sp.seite) || 1);
  const where = await filterWhere(f);
  const pruefung = sp.pruefen === '1' ? await pruefeKette() : null;
  if (pruefung) await audit(u, 'protokoll_pruefung', 'auditLog', null, { ok: pruefung.ok, anzahl: pruefung.anzahl, letzterHash: pruefung.letzterHash, fehler: 'fehler' in pruefung ? pruefung.fehler : undefined });
  const [eintraege, anzahl, entities, anker] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { seq: 'desc' }, skip: (seite - 1) * JE_SEITE, take: JE_SEITE }),
    db.auditLog.count({ where }),
    db.auditLog.groupBy({ by: ['entity'], _count: { _all: true }, orderBy: { entity: 'asc' } }),
    tagesAnker(14),
  ]);
  const bereiche = new Map<string, number>();
  for (const e of entities) {
    const k = e.entity.charAt(0).toLowerCase() + e.entity.slice(1);
    bereiche.set(k, (bereiche.get(k) ?? 0) + e._count._all);
  }
  const seiten = Math.max(1, Math.ceil(anzahl / JE_SEITE));
  const link = (s: number) => `/protokoll?${filterQuery(f, { seite: String(s) })}`;
  return (
    <>
      <PageHeader krumen={[{ label: 'System' }, { label: 'Protokoll' }]} title="Protokoll" sub={`${anzahl.toLocaleString('de-AT')} Einträge – nur anhängbar, jeder Eintrag mit dem Hash seines Vorgängers verkettet`}>
        <Link href={`/protokoll?${filterQuery(f, { pruefen: '1' })}`} className="btn-primary">Integrität prüfen</Link>
        <a href={`/protokoll/export?${filterQuery(f, { format: 'csv' })}`} className="btn-secondary">CSV-Export</a>
        <a href={`/protokoll/export?${filterQuery(f, { format: 'json' })}`} className="btn-secondary">JSON-Export</a>
      </PageHeader>

      {pruefung && (
        pruefung.ok ? (
          <div role="status" className="mb-5 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-pos">
            <p className="font-semibold">Kette in Ordnung: {pruefung.anzahl.toLocaleString('de-AT')} Einträge geprüft, kein Eintrag verändert, gelöscht oder eingeschoben.</p>
            <p className="mt-1 text-ink">Letzter Hash (Nr. {pruefung.letzteSeq ?? '–'}): <code className="font-mono break-all">{pruefung.letzterHash}</code></p>
            {pruefung.luecken.length > 0 && <p className="mt-1 text-ink">Hinweis: Nummernlücken vor {pruefung.luecken.slice(0, 10).join(', ')} – entstehen durch abgebrochene Transaktionen; die Hash-Kette selbst ist geschlossen.</p>}
          </div>
        ) : (
          <div role="alert" className="mb-5 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-neg">
            <p className="font-semibold">Kette gebrochen bei Eintrag Nr. {pruefung.fehler.seq}: {pruefung.fehler.text}.</p>
            <p className="mt-1 text-ink">{pruefung.anzahl.toLocaleString('de-AT')} Einträge davor sind in Ordnung. <Link className="underline underline-offset-4" href={`/protokoll?q=${encodeURIComponent(pruefung.fehler.id)}`}>Eintrag ansehen</Link></p>
          </div>
        )
      )}

      <form method="get" className="card mb-5 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4" role="search" aria-label="Protokoll filtern">
        <div><label htmlFor="von" className="label">Von</label><input id="von" name="von" type="date" defaultValue={f.von} className="input" /></div>
        <div><label htmlFor="bis" className="label">Bis</label><input id="bis" name="bis" type="date" defaultValue={f.bis} className="input" /></div>
        <div><label htmlFor="benutzer" className="label">Benutzer</label><input id="benutzer" name="benutzer" defaultValue={f.benutzer} aria-describedby="benutzer-h" className="input" /><p id="benutzer-h" className="mt-1 text-xs text-muted">Name oder „system“ (ohne Anmeldung: Shop, Partner, Cron)</p></div>
        <div><label htmlFor="aktion" className="label">Aktion enthält</label><input id="aktion" name="aktion" defaultValue={f.aktion} placeholder="z. B. storno" className="input" /></div>
        <div><label htmlFor="entity" className="label">Objekt</label>
          <select id="entity" name="entity" defaultValue={f.entity ?? ''} className="input"><option value="">Alle</option>{[...bereiche].sort((a, b) => bereichName(a[0]).localeCompare(bereichName(b[0]), 'de')).map(([k, n]) => <option key={k} value={k}>{bereichName(k)} ({n})</option>)}</select></div>
        <div><label htmlFor="id" className="label">Objekt-ID</label><input id="id" name="id" defaultValue={f.id} className="input font-mono" /></div>
        <div className="sm:col-span-2"><label htmlFor="q" className="label">Volltext</label><input id="q" name="q" type="search" defaultValue={f.q} placeholder="Bestellnummer, Ticketcode, E-Mail, IP …" aria-describedby="q-h" className="input" /><p id="q-h" className="mt-1 text-xs text-muted">Sucht auch in Daten, Vorher- und Nachher-Werten.</p></div>
        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4"><button className="btn-primary">Filtern</button><Link href="/protokoll" className="btn-secondary">Zurücksetzen</Link></div>
      </form>

      <section className="card mb-6" aria-labelledby="h-eintraege">
        <h2 id="h-eintraege" className="sr-only">Einträge</h2>
        {eintraege.length ? (
          <table className="table">
            <caption className="sr-only">Protokolleinträge, neueste zuerst. „Details“ öffnet Änderungen, IP, Gerät und Hash.</caption>
            <thead><tr><th scope="col">Nr.</th><th scope="col">Zeit</th><th scope="col">Benutzer</th><th scope="col">Aktion</th><th scope="col">Objekt</th><th scope="col">Details</th></tr></thead>
            <tbody>
              {eintraege.map((e) => {
                const l = bereichLink(e.entity, e.entityId);
                return (
                  <tr key={e.id}>
                    <td className="num text-xs text-muted">{e.seq}</td>
                    <td className="whitespace-nowrap"><time dateTime={e.createdAt.toISOString()}>{fmtDatum(e.createdAt)}<br /><span className="num text-xs text-muted">{zeit(e.createdAt)}</span></time></td>
                    <td>{e.userName ?? 'System'}{!e.userId && <span className="block text-xs text-muted">ohne Anmeldung</span>}</td>
                    <td>{aktionName(e.action)}<span className="block font-mono text-[11px] text-muted">{e.action}</span></td>
                    <td>{bereichName(e.entity)}{e.entityId && <span className="flex flex-wrap gap-x-2 font-mono text-[11px]">{l ? <Link href={l} className="inline-flex min-h-6 items-center underline underline-offset-2">{e.entityId}</Link> : <span className="inline-flex min-h-6 items-center">{e.entityId}</span>}<Link href={`/protokoll?entity=${encodeURIComponent(e.entity)}&id=${encodeURIComponent(e.entityId)}`} className="relative inline-flex min-h-6 items-center font-sans text-accent-deep underline underline-offset-2">Verlauf<span className="sr-only"> von {e.entityId}</span></Link></span>}</td>
                    <td className="min-w-[16rem] max-w-xl">
                      <details>
                        <summary className="relative inline-flex min-h-6 cursor-pointer items-center text-sm text-accent-deep underline underline-offset-2">Details<span className="sr-only"> zu Eintrag {e.seq}</span></summary>
                        <Aenderungen vorher={e.vorher} nachher={e.nachher} beschriftung={`Änderungen in Eintrag ${e.seq}`} />
                        <Daten data={e.data} />
                        <dl className="mt-2 grid gap-x-3 gap-y-0.5 text-[11px] text-muted sm:grid-cols-[auto_1fr]">
                          <dt>IP</dt><dd className="font-mono">{e.ip ?? '–'}</dd>
                          <dt>Gerät</dt><dd className="break-all">{e.userAgent ?? '–'}</dd>
                          <dt>Hash</dt><dd className="font-mono break-all" title={e.hash ?? ''}>{kurz(e.hash)}</dd>
                          <dt>Vorgänger</dt><dd className="font-mono break-all" title={e.prevHash ?? ''}>{kurz(e.prevHash)}</dd>
                        </dl>
                      </details>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <Empty>Keine Einträge für diesen Filter.</Empty>}
      </section>
      {seiten > 1 && (
        <nav aria-label="Seiten" className="mb-6 flex items-center gap-3 text-sm">
          {seite > 1 && <Link href={link(seite - 1)} className="btn-secondary btn-sm">Neuere</Link>}
          <span>Seite {seite} von {seiten}</span>
          {seite < seiten && <Link href={link(seite + 1)} className="btn-secondary btn-sm">Ältere</Link>}
        </nav>
      )}

      <section className="card p-5" aria-labelledby="h-anker">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="h-anker" className="h2">Tagesanker</h2>
          <div className="flex flex-wrap gap-2"><Link href="/protokoll/anker" className="btn-secondary btn-sm">Druckansicht</Link><a href="/protokoll/export?format=anker" className="btn-secondary btn-sm">Als Textdatei</a></div>
        </div>
        <p className="mt-1 text-sm text-muted">Letzter Hash je Tag. Regelmäßig ausdrucken oder außerhalb des Systems ablegen – damit lässt sich später beweisen, dass bis dahin nichts verändert wurde.</p>
        {anker.length ? (
          <table className="table mt-3">
            <caption className="sr-only">Tagesanker der letzten 14 Tage</caption>
            <thead><tr><th scope="col">Tag</th><th scope="col" className="text-right">Letzte Nr.</th><th scope="col" className="text-right">Einträge</th><th scope="col">Hash</th></tr></thead>
            <tbody>{anker.map((a) => <tr key={a.tag}><td className="num whitespace-nowrap">{a.tag}</td><td className="num text-right">{a.seq}</td><td className="num text-right">{a.anzahl}</td><td className="font-mono text-xs break-all">{a.hash ?? '–'}</td></tr>)}</tbody>
          </table>
        ) : <Empty>Noch keine Einträge.</Empty>}
      </section>
    </>
  );
}
