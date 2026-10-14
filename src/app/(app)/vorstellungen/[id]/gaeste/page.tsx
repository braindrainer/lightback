// Gästeliste einer Vorstellung: Freikarten anlegen, importieren, zurückziehen; Kontingent; Druckliste
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatumZeit, fmtTag, fmtZeit, wienTag } from '@/lib/dates';
import { freikartenStand, GAST_GRUENDE, GAST_MAX, gaesteListe, nachGrund } from '@/lib/gaeste';
import { sitzName } from '@/lib/saal';
import { platzStatus } from '@/lib/seats';
import { Empty, PageHeader, StatusPill } from '@/components/ui';
import { GastFormular, GastStornoDialog, ImportFormular, KontingentFormular, type GastDaten } from '@/components/verkauf/Gaeste';
import type { Ergebnis } from '@/components/verkauf/ergebnis';
import { gaesteImportAktion, gastAnlegenAktion, gastStornierenAktion, kontingentAktion } from '../../ablauf-actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const s = await db.show.findUnique({ where: { id: (await params).id }, select: { startsAt: true } });
  return { title: s ? `Gästeliste ${fmtDatumZeit(s.startsAt)}` : 'Gästeliste' };
}

export default async function Gaeste({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('leitung');
  const { id } = await params;
  const show = await db.show.findUnique({ where: { id } });
  if (!show) notFound();
  const [liste, stand, status] = await Promise.all([gaesteListe(id, true), freikartenStand(id), platzStatus(id)]);
  const aktiv = liste.filter((g) => g.status !== 'storniert');
  const titel = `${fmtTag(show.startsAt)} ${wienTag(show.startsAt).slice(0, 4)}, ${fmtZeit(show.startsAt)}`;
  const offen = show.status !== 'abgesagt' && Date.now() < show.startsAt.getTime() + show.durationMin * 60e3;
  const gruende = nachGrund(aktiv);
  return (
    <>
      <PageHeader title={`Gästeliste ${titel}`} sub={<><Link href={`/vorstellungen/${id}`} className="underline underline-offset-4">Zur Vorstellung</Link> · {aktiv.length} Gäste, {stand.vergeben} Freikarten{stand.limit != null ? ` von ${stand.limit} (Kontingent)` : ''}</>}>
        <a href={`/vorstellungen/${id}/gaeste/druck`} target="_blank" rel="noopener" className="btn-secondary">Liste drucken (A4)<span className="sr-only"> – neues Fenster</span></a>
      </PageHeader>
      {stand.rest != null && stand.rest < 0 && <p role="alert" className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-warn">Das Freikarten-Kontingent ist um {-stand.rest} überschritten.</p>}

      <div className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {offen ? (
          <section className="card p-5" aria-labelledby="h-neu">
            <h2 id="h-neu" className="h2 mb-3">Gast hinzufügen</h2>
            <GastFormular gruende={GAST_GRUENDE} status={status} max={GAST_MAX} action={gastAnlegenAktion.bind(null, id) as (d: GastDaten) => Promise<Ergebnis>} />
          </section>
        ) : <p className="card p-5 text-sm">Die Vorstellung ist {show.status === 'abgesagt' ? 'abgesagt' : 'vorbei'} – keine neuen Gäste mehr.</p>}
        <div className="grid content-start gap-6">
          <section className="card p-5" aria-labelledby="h-kont">
            <h2 id="h-kont" className="h2 mb-3">Kontingent</h2>
            <KontingentFormular action={kontingentAktion.bind(null, id)} limit={show.freikartenLimit} />
          </section>
          <section className="card p-5" aria-labelledby="h-gruende">
            <h2 id="h-gruende" className="h2 mb-2">Freikarten nach Grund</h2>
            {gruende.length ? <ul className="grid gap-1 text-sm">{gruende.map(([g, n]) => <li key={g} className="flex justify-between gap-2"><span>{g}</span><span className="num font-semibold">{n}</span></li>)}</ul> : <p className="text-sm text-muted">Noch keine.</p>}
          </section>
        </div>
      </div>

      {offen && (
        <section className="card mb-6 p-5" aria-labelledby="h-import">
          <h2 id="h-import" className="h2 mb-3">Liste importieren</h2>
          <ImportFormular action={gaesteImportAktion.bind(null, id)} />
        </section>
      )}

      <section className="card" aria-labelledby="h-liste">
        <h2 id="h-liste" className="h2 px-5 pt-4">Gäste ({liste.length})</h2>
        {liste.length ? (
          <table className="table mt-3">
            <caption className="sr-only">Gäste nach Nachname</caption>
            <thead><tr><th scope="col">Name</th><th scope="col" className="text-right">Karten</th><th scope="col">Plätze</th><th scope="col">Grund</th><th scope="col">Zustellung</th><th scope="col">Einlass</th><th scope="col"><span className="sr-only">Aktionen</span></th></tr></thead>
            <tbody>
              {liste.map((g) => {
                const c = g.customer;
                const name = c ? `${c.lastName} ${c.firstName}`.trim() : '–';
                const ein = g.aktiv.filter((t) => t.status === 'eingelassen').length;
                return (
                  <tr key={g.id} className={g.status === 'storniert' ? 'text-muted' : ''}>
                    <td><Link href={`/bestellungen/${g.id}`} className="font-medium underline-offset-4 hover:underline">{name}</Link>{c?.company && <span className="block text-xs text-muted">{c.company}</span>}{c?.email && <span className="block text-xs text-muted">{c.email}</span>}</td>
                    <td className="num text-right">{g.aktiv.length}{g.gast.begleitung ? <span className="block text-xs text-muted">inkl. +1</span> : null}</td>
                    <td className="text-sm">{g.aktiv.map((t) => sitzName(t.seatId)).join(' · ') || '–'}</td>
                    <td>{g.gast.grund}{g.gast.notiz && <span className="block text-xs text-muted">{g.gast.notiz}</span>}</td>
                    <td className="text-sm">{[g.gast.mail ? 'E-Mail' : '', g.gast.hinterlegt ? (g.gast.abgeholtAm ? `Kassa, abgeholt ${fmtZeit(new Date(g.gast.abgeholtAm))}` : 'Kassa, offen') : ''].filter(Boolean).join(' · ')}</td>
                    <td>{g.status === 'storniert' ? <StatusPill status="storniert" /> : `${ein} / ${g.aktiv.length}`}</td>
                    <td>{g.status !== 'storniert' && offen && <GastStornoDialog action={gastStornierenAktion.bind(null, id, g.id)} name={name} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <Empty>Noch keine Gäste auf der Liste.</Empty>}
      </section>
    </>
  );
}
