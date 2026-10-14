import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatumZeit, fmtTag, fmtZeit, wienTag } from '@/lib/dates';
import { formatEur } from '@/lib/money';
import { type Kat, type Preise } from '@/lib/saal';
import { Empty, Money, PageHeader, StatusPill } from '@/components/ui';
import { auslastungListe, KAT_KAPAZITAET, platzDaten } from '@/components/verkauf/daten';
import PlatzVerwaltung from '@/components/verkauf/PlatzVerwaltung';
import { AbsageDialog, BearbeitenFormular } from '@/components/verkauf/ShowAktionen';
import { KANAL_NAME, KAT_NAME, ZEILENKOPF } from '@/components/verkauf/texte';
import { sitzeEntsperren, sitzeSperren, vorstellungAbsagenAktion, vorstellungBearbeiten } from '../actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const s = await db.show.findUnique({ where: { id: (await params).id }, select: { startsAt: true } });
  return { title: s ? `Vorstellung ${fmtDatumZeit(s.startsAt)}` : 'Vorstellung' };
}

function Kennzahl({ label, wert, hint }: { label: string; wert: React.ReactNode; hint?: string }) {
  return <div className="card p-4"><p className="text-xs text-muted">{label}</p><p className="num mt-1 text-2xl font-semibold">{wert}</p>{hint && <p className="text-xs text-muted">{hint}</p>}</div>;
}

export default async function Vorstellung({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('leitung');
  const { id } = await params;
  const show = await db.show.findUnique({ where: { id }, include: { series: { select: { name: true } } } });
  if (!show) notFound();
  const [plaetze, zahlenMap, bestellungen, offenAnzahl] = await Promise.all([
    platzDaten(id),
    auslastungListe([id]),
    db.order.findMany({ where: { showId: id }, orderBy: { createdAt: 'desc' }, take: 100, include: { customer: true, _count: { select: { tickets: { where: { status: { not: 'storniert' } } } } } } }),
    db.order.count({ where: { showId: id, status: { in: ['bezahlt', 'teilstorniert'] } } }),
  ]);
  const z = zahlenMap.get(id)!;
  const st = plaetze.status;
  const anz = (s: string) => Object.values(st).filter((x) => x === s).length;
  const titel = `${fmtTag(show.startsAt)} ${wienTag(show.startsAt).slice(0, 4)}, ${fmtZeit(show.startsAt)}`;
  const preise = show.prices as Preise;
  const abgesagt = show.status === 'abgesagt';
  return (
    <>
      <PageHeader title={`Vorstellung ${titel}`} sub={<>{show.title}{show.series && <> · Serie „{show.series.name}“</>} · <Link href="/vorstellungen" className="underline underline-offset-4">Alle Vorstellungen</Link></>}>
        <StatusPill status={show.status} />
        <a href={`/vorstellungen/${id}/gaesteliste.csv`} className="btn-secondary" download>Gästeliste (CSV)</a>
        {!abgesagt && show.status === 'verkauf' && show.startsAt > new Date() && <Link href={`/bestellungen/neu?show=${id}`} className="btn-gold">Tickets verkaufen</Link>}
        <AbsageDialog action={vorstellungAbsagenAktion.bind(null, id)} titel={titel} bestellungen={offenAnzahl} versteckt={abgesagt} />
      </PageHeader>
      {abgesagt && <p role="status" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">Abgesagt{show.cancelReason ? `: ${show.cancelReason}` : ''}</p>}

      <section aria-labelledby="kennzahlen" className="mb-6">
        <h2 id="kennzahlen" className="sr-only">Kennzahlen</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Kennzahl label="Verkauft (Tickets)" wert={z.gesamt.verkauft} />
          <Kennzahl label="Reserviert (Warenkorb)" wert={anz('reserviert')} />
          <Kennzahl label="Frei (Plätze)" wert={anz('frei')} />
          <Kennzahl label="Gesperrt" wert={anz('gesperrt')} />
          <Kennzahl label="Eingelassen" wert={z.gesamt.eingelassen} hint={z.gesamt.verkauft ? `${Math.round((z.gesamt.eingelassen / z.gesamt.verkauft) * 100)} % der Tickets` : undefined} />
          <Kennzahl label="Umsatz (brutto)" wert={formatEur(z.gesamt.umsatz)} />
        </div>
      </section>

      <section className="card mb-6" aria-labelledby="kategorien">
        <h2 id="kategorien" className="h2 px-5 pt-4">Nach Kategorie</h2>
        <table className="table mt-3">
          <thead><tr><th scope="col">Kategorie</th><th scope="col" className="text-right">Preis</th><th scope="col" className="text-right">Kapazität</th><th scope="col" className="text-right">Verkauft</th><th scope="col" className="text-right">Eingelassen</th><th scope="col" className="text-right">Reserviert</th><th scope="col" className="text-right">Gesperrt</th><th scope="col" className="text-right">Frei</th><th scope="col" className="text-right">Umsatz</th></tr></thead>
          <tbody>
            {(['I', 'II', 'R'] as Kat[]).map((k) => {
              const x = z.jeKat[k];
              return (
                <tr key={k}>
                  <th scope="row" className={ZEILENKOPF}>{KAT_NAME[k]}</th>
                  <td className="num text-right">{k === 'R' ? formatEur(preise.R.normal) : `${formatEur(preise[k].normal)} / ${formatEur(preise[k].ermaessigt)}`}</td>
                  <td className="num text-right">{KAT_KAPAZITAET[k]}</td>
                  <td className="num text-right font-semibold">{x.verkauft}</td>
                  <td className="num text-right">{x.eingelassen}</td>
                  <td className="num text-right">{x.reserviert}</td>
                  <td className="num text-right">{x.gesperrt}</td>
                  <td className="num text-right">{x.frei}</td>
                  <td className="text-right"><Money cents={x.umsatz} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="card mb-6 p-5" aria-labelledby="saalplan">
        <h2 id="saalplan" className="h2 mb-3">Saalplan</h2>
        <PlatzVerwaltung status={plaetze.status} info={plaetze.info} sperren={sitzeSperren.bind(null, id)} entsperren={sitzeEntsperren.bind(null, id)} bearbeitbar={!abgesagt} />
      </section>

      {!abgesagt && (
        <section className="card mb-6 p-5" aria-labelledby="bearbeiten">
          <h2 id="bearbeiten" className="h2 mb-3">Vorstellung bearbeiten</h2>
          <BearbeitenFormular action={vorstellungBearbeiten.bind(null, id)} werte={{ datum: wienTag(show.startsAt), zeit: fmtZeit(show.startsAt), status: show.status, notes: show.notes, titel: show.title, preise }} />
        </section>
      )}

      <section className="card" aria-labelledby="bestellungen">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
          <h2 id="bestellungen" className="h2">Bestellungen</h2>
          <Link href={`/bestellungen?show=${id}`} className="text-sm underline underline-offset-4">Alle Bestellungen dieser Vorstellung durchsuchen</Link>
        </div>
        {bestellungen.length ? (
          <table className="table mt-3">
            <thead><tr><th scope="col">Nummer</th><th scope="col">Kund:in</th><th scope="col">Kanal</th><th scope="col">Status</th><th scope="col" className="text-right">Tickets</th><th scope="col" className="text-right">Summe</th><th scope="col">Erstellt</th></tr></thead>
            <tbody>
              {bestellungen.map((o) => (
                <tr key={o.id}>
                  <td><Link href={`/bestellungen/${o.id}`} className="font-mono font-medium underline-offset-4 hover:underline">{o.number}</Link></td>
                  <td>{o.customer ? `${o.customer.firstName} ${o.customer.lastName}`.trim() : '–'}</td>
                  <td>{KANAL_NAME[o.channel] ?? o.channel}</td>
                  <td><StatusPill status={o.status} /></td>
                  <td className="num text-right">{o._count.tickets}</td>
                  <td className="text-right"><Money cents={o.totalCents} /></td>
                  <td className="whitespace-nowrap">{fmtDatumZeit(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>Noch keine Bestellungen.</Empty>}
      </section>
    </>
  );
}
