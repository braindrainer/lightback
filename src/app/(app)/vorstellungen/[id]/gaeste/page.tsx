// Gästeliste einer Vorstellung: Freikarten anlegen, importieren, zurückziehen; Kontingent; Druckliste
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatumZeit, fmtTag, fmtZeit, wienTag } from '@/lib/dates';
import { freikartenStand, GAST_GRUENDE, GAST_MAX, gaesteListe, nachGrund } from '@/lib/gaeste';
import { sitzName } from '@/lib/saal';
import { platzStatus } from '@/lib/seats';
import { Abschnitt, Empty, Hinweis, Icon, Kennzahlen, PageHeader, StatusPill } from '@/components/ui';
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
      <PageHeader title="Gästeliste" krumen={[{ label: 'Verkauf' }, { label: 'Vorstellungen', href: '/vorstellungen' }, { label: titel, href: `/vorstellungen/${id}` }, { label: 'Gästeliste' }]}
        sub={<>Freikarten für die Vorstellung <Link href={`/vorstellungen/${id}`} className="link">{titel}</Link></>}>
        <a href={`/vorstellungen/${id}/gaeste/druck`} target="_blank" rel="noopener" className="btn-secondary"><Icon name="druck" className="h-4 w-4" />Liste drucken (A4)<span className="sr-only"> – neues Fenster</span></a>
      </PageHeader>
      {stand.rest != null && stand.rest < 0 && <Hinweis art="warn" rolle="alert">Das Freikarten-Kontingent ist um {-stand.rest} überschritten.</Hinweis>}
      <Kennzahlen items={[
        { label: 'Gäste', wert: aktiv.length, icon: 'kunden' },
        { label: 'Freikarten', wert: stand.vergeben, hinweis: stand.limit != null ? `von ${stand.limit} (Kontingent)` : 'ohne Kontingent', icon: 'ticket' },
        { label: 'Noch frei im Kontingent', wert: stand.rest ?? '–', ton: stand.rest != null && stand.rest < 0 ? 'neg' : undefined },
        { label: 'Eingelassen', wert: aktiv.reduce((n, g) => n + g.aktiv.filter((t) => t.status === 'eingelassen').length, 0), icon: 'scan' },
      ]} />

      <div className="mb-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {offen ? (
          <Abschnitt id="h-neu" titel="Gast hinzufügen">
            <GastFormular gruende={GAST_GRUENDE} status={status} max={GAST_MAX} action={gastAnlegenAktion.bind(null, id) as (d: GastDaten) => Promise<Ergebnis>} />
          </Abschnitt>
        ) : <div className="card"><Empty icon="schloss" titel="Keine neuen Gäste mehr">Die Vorstellung ist {show.status === 'abgesagt' ? 'abgesagt' : 'vorbei'}.</Empty></div>}
        <div className="grid content-start gap-6">
          <Abschnitt id="h-kont" titel="Kontingent"><KontingentFormular action={kontingentAktion.bind(null, id)} limit={show.freikartenLimit} /></Abschnitt>
          <Abschnitt id="h-gruende" titel="Freikarten nach Grund">
            {gruende.length ? <ul className="grid gap-1.5 text-sm">{gruende.map(([g, n]) => <li key={g} className="flex justify-between gap-2"><span>{g}</span><span className="num font-semibold">{n}</span></li>)}</ul> : <p className="text-sm text-muted">Noch keine.</p>}
          </Abschnitt>
        </div>
      </div>

      {offen && (
        <Abschnitt id="h-import" titel="Liste importieren" className="mb-6" beschreibung="Mehrere Gäste auf einmal, z. B. aus einer Tabelle.">
          <ImportFormular action={gaesteImportAktion.bind(null, id)} />
        </Abschnitt>
      )}

      <Abschnitt id="h-liste" titel={`Gäste (${liste.length})`} flush>
        {liste.length ? (
          <table className="table rtab">
            <caption className="sr-only">Gäste nach Nachname</caption>
            <thead><tr><th scope="col">Name</th><th scope="col" className="text-right">Karten</th><th scope="col">Plätze</th><th scope="col">Grund</th><th scope="col">Zustellung</th><th scope="col">Einlass</th><th scope="col"><span className="sr-only">Aktionen</span></th></tr></thead>
            <tbody>
              {liste.map((g) => {
                const c = g.customer;
                const name = c ? `${c.lastName} ${c.firstName}`.trim() : '–';
                const ein = g.aktiv.filter((t) => t.status === 'eingelassen').length;
                return (
                  <tr key={g.id} className={g.status === 'storniert' ? 'text-muted' : ''}>
                    <td className="rtab-kopf"><Link href={`/bestellungen/${g.id}`} className="font-semibold underline-offset-4 hover:underline">{name}</Link>{c?.company && <span className="block text-xs text-muted">{c.company}</span>}{c?.email && <span className="block text-xs text-muted">{c.email}</span>}</td>
                    <td data-label="Karten" className="num text-right">{g.aktiv.length}{g.gast.begleitung ? <span className="block text-xs text-muted">inkl. +1</span> : null}</td>
                    <td data-label="Plätze" className="text-sm">{g.aktiv.map((t) => sitzName(t.seatId)).join(' · ') || '–'}</td>
                    <td data-label="Grund">{g.gast.grund}{g.gast.notiz && <span className="block text-xs text-muted">{g.gast.notiz}</span>}</td>
                    <td data-label="Zustellung" className="text-sm">{[g.gast.mail ? 'E-Mail' : '', g.gast.hinterlegt ? (g.gast.abgeholtAm ? `Kassa, abgeholt ${fmtZeit(new Date(g.gast.abgeholtAm))}` : 'Kassa, offen') : ''].filter(Boolean).join(' · ') || '–'}</td>
                    <td data-label="Einlass">{g.status === 'storniert' ? <StatusPill status="storniert" /> : <span className="num">{ein} / {g.aktiv.length}</span>}</td>
                    <td className={g.status !== 'storniert' && offen ? 'text-right' : 'rtab-leer'}>{g.status !== 'storniert' && offen && <GastStornoDialog action={gastStornierenAktion.bind(null, id, g.id)} name={name} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <Empty icon="stern" titel="Noch keine Gäste auf der Liste">Presse, Sponsoren oder Künstler:innen oben eintragen oder als Liste importieren.</Empty>}
      </Abschnitt>
    </>
  );
}
