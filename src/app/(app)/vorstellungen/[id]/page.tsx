import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { Verlauf } from '@/components/Verlauf';
import { db } from '@/lib/db';
import { fmtDatumZeit, fmtTag, fmtZeit, wienTag } from '@/lib/dates';
import { formatEur } from '@/lib/money';
import { KAPAZITAET, type Kat, type Preise } from '@/lib/saal';
import { Abschnitt, DetailKopf, DrawerKnopf, Empty, Hinweis, Icon, Kennzahlen, Money, StatusPill } from '@/components/ui';
import { auslastungListe, KAT_KAPAZITAET, platzDaten } from '@/components/verkauf/daten';
import PlatzVerwaltung from '@/components/verkauf/PlatzVerwaltung';
import { AbsageDialog, BearbeitenFormular } from '@/components/verkauf/ShowAktionen';
import { KANAL_NAME, KAT_NAME, ZEILENKOPF } from '@/components/verkauf/texte';
import { sitzeEntsperren, sitzeSperren, vorstellungAbsagenAktion, vorstellungBearbeiten } from '../actions';
import { abbruchAktion, nachrichtAktion } from '../ablauf-actions';
import { AbbruchDialog, NachrichtDialog } from '@/components/verkauf/Gaeste';
import { stand } from '@/lib/einlass';
import { freikartenStand, gaesteListe, nachGrund } from '@/lib/gaeste';
import { abbruchMoeglich, empfaenger, noShow, offeneReservierungen } from '@/lib/vorstellung';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const s = await db.show.findUnique({ where: { id: (await params).id }, select: { startsAt: true } });
  return { title: s ? `Vorstellung ${fmtDatumZeit(s.startsAt)}` : 'Vorstellung' };
}

function Ablauf({ label, wert, einheit, text, children }: { label: string; wert: React.ReactNode; einheit?: string; text: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col p-5">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 font-serif text-4xl font-semibold leading-none">{wert}{einheit && <span className="ml-1.5 font-sans text-sm font-normal text-muted">{einheit}</span>}</p>
      <p className="mt-2 flex-1 text-xs text-muted">{text}</p>
      {children && <div className="mt-3 text-sm">{children}</div>}
    </div>
  );
}

export default async function Vorstellung({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('leitung');
  const { id } = await params;
  const show = await db.show.findUnique({ where: { id }, include: { series: { select: { name: true } } } });
  if (!show) notFound();
  const [plaetze, zahlenMap, bestellungen, offenAnzahl, imSaal, gaeste, fk, reserv, empf, ns] = await Promise.all([
    platzDaten(id),
    auslastungListe([id]),
    db.order.findMany({ where: { showId: id }, orderBy: { createdAt: 'desc' }, take: 100, include: { customer: true, _count: { select: { tickets: { where: { status: { not: 'storniert' } } } } } } }),
    db.order.count({ where: { showId: id, status: { in: ['bezahlt', 'teilstorniert'] } } }),
    stand(id),
    gaesteListe(id),
    freikartenStand(id),
    offeneReservierungen(id),
    empfaenger(id),
    noShow(id),
  ]);
  const begonnen = show.startsAt.getTime() <= Date.now();
  const freiNachGrund = nachGrund(await db.order.findMany({ where: { showId: id, status: { in: ['bezahlt', 'teilstorniert'] }, tickets: { some: { art: 'frei', status: { not: 'storniert' } } } }, select: { meta: true, tickets: { select: { status: true, art: true } } } }));
  const z = zahlenMap.get(id)!;
  const st = plaetze.status;
  const anz = (s: string) => Object.values(st).filter((x) => x === s).length;
  const titel = `${fmtTag(show.startsAt)} ${wienTag(show.startsAt).slice(0, 4)}, ${fmtZeit(show.startsAt)}`;
  const preise = show.prices as Preise;
  const abgesagt = show.status === 'abgesagt';
  const quote = z.gesamt.verkauft ? Math.round((z.gesamt.eingelassen / z.gesamt.verkauft) * 100) : 0;
  const auslastung = Math.round((z.gesamt.verkauft / KAPAZITAET) * 100);
  return (
    <>
      <DetailKopf
        krumen={[{ label: 'Verkauf' }, { label: 'Vorstellungen', href: '/vorstellungen' }, { label: titel }]}
        titel={titel}
        status={<StatusPill status={show.status} />}
        untertitel={<>{show.title}{show.series && <> · Serie „{show.series.name}“</>} · {show.durationMin} Min. · Auslastung {auslastung} %</>}
        aktionen={<>
          {!abgesagt && show.status === 'verkauf' && show.startsAt > new Date() && <Link href={`/bestellungen/neu?show=${id}`} className="btn-gold"><Icon name="ticket" className="h-4 w-4" />Tickets verkaufen</Link>}
          <Link href={`/vorstellungen/${id}/gaeste`} className="btn-secondary"><Icon name="stern" className="h-4 w-4" />Gästeliste</Link>
          {!abgesagt && (
            <DrawerKnopf knopf="Bearbeiten" icon="bearbeiten" titel="Vorstellung bearbeiten" untertitel={titel} breit>
              <BearbeitenFormular action={vorstellungBearbeiten.bind(null, id)} werte={{ datum: wienTag(show.startsAt), zeit: fmtZeit(show.startsAt), status: show.status, notes: show.notes, titel: show.title, preise }} />
            </DrawerKnopf>
          )}
          <AbsageDialog action={vorstellungAbsagenAktion.bind(null, id)} titel={titel} bestellungen={offenAnzahl} versteckt={abgesagt} />
        </>}
        menue={[
          { label: 'Bestellungen dieser Vorstellung', href: `/bestellungen?show=${id}`, icon: 'liste' },
          { label: 'Besucherliste (CSV)', href: `/vorstellungen/${id}/gaesteliste.csv`, icon: 'download' },
          { label: 'Anwesenheitsliste drucken', href: `/vorstellungen/${id}/anwesenheit`, extern: true, icon: 'druck' },
          { label: 'Gästeliste drucken (A4)', href: `/vorstellungen/${id}/gaeste/druck`, extern: true, icon: 'druck' },
        ]}
      />
      {abgesagt && <Hinweis art="fehler" rolle="status" titel="Abgesagt">{show.cancelReason || 'Ohne Angabe eines Grundes.'}</Hinweis>}
      {show.abgebrochenAt && <Hinweis art="fehler" rolle="status" titel={`Abgebrochen um ${fmtZeit(show.abgebrochenAt)} Uhr`}>{show.abbruchGrund || 'Ohne Angabe eines Grundes.'}</Hinweis>}

      <Kennzahlen items={[
        { label: 'Verkauft', wert: z.gesamt.verkauft, hinweis: `von ${KAPAZITAET} Plätzen · ${auslastung} %`, icon: 'ticket' },
        { label: 'Frei', wert: anz('frei'), hinweis: 'Plätze im Saalplan', icon: 'sitz' },
        { label: 'Reserviert', wert: anz('reserviert'), hinweis: 'im Warenkorb' },
        { label: 'Gesperrt', wert: anz('gesperrt'), icon: 'schloss' },
        { label: 'Eingelassen', wert: z.gesamt.eingelassen, hinweis: z.gesamt.verkauft ? `${quote} % der Tickets` : undefined, icon: 'scan' },
        { label: 'Umsatz (brutto)', wert: formatEur(z.gesamt.umsatz), ton: 'gold', icon: 'euro' },
      ]} />

      <section className="card mb-6" aria-labelledby="ablauf">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-5 py-4">
          <div><h2 id="ablauf" className="h2">Rund um die Vorstellung</h2><p className="text-sm text-muted">Einlass, offene Reservierungen und Gästeliste – siehe auch <Link href="/hilfe/vorstellung" className="link">Hilfe</Link>.</p></div>
          {!abgesagt && (
            <div className="flex flex-wrap gap-2">
              <NachrichtDialog action={nachrichtAktion.bind(null, id)} empfaenger={empf.length} titel={titel} />
              {/* immer rendern: nach dem Abbruch bleibt der offene Dialog mit seinem Ergebnis stehen */}
              <AbbruchDialog action={abbruchAktion.bind(null, id)} titel={titel} bestellungen={offenAnzahl} versteckt={!abbruchMoeglich(show)} />
            </div>
          )}
        </div>
        <div className="grid divide-y divide-line-soft md:grid-cols-3 md:divide-x md:divide-y-0">
          <Ablauf label="Im Saal (laut Einlass)" wert={imSaal.imSaal} einheit="Personen" text={`${imSaal.eingelassen} Tickets eingelassen, Rollstuhlplätze zählen mit Begleitperson`}>
            <a href={`/vorstellungen/${id}/anwesenheit`} target="_blank" rel="noopener" className="link">Anwesenheitsliste drucken<span className="sr-only"> (neues Fenster)</span></a>
          </Ablauf>
          <Ablauf label="Offene Reservierungen (unbezahlt)" wert={reserv.plaetze} einheit="Plätze" text={reserv.bestellungen ? `${reserv.bestellungen} Bestellungen, verfallen um ${fmtZeit(reserv.verfallAm)} Uhr (${reserv.minuten} Min. vor Beginn) – dann frei für die Abendkasse` : 'Keine offenen Telefon-, Rechnungs- oder Zahlungslink-Reservierungen.'}>
            {reserv.bestellungen > 0 && <Link href={`/bestellungen?show=${id}&status=offen`} className="link">Offene Bestellungen ansehen</Link>}
          </Ablauf>
          <Ablauf label="Freikarten (Gästeliste)" wert={<>{fk.vergeben}{fk.limit != null && <span className="font-sans text-sm font-normal text-muted"> von {fk.limit}</span>}</>} text={`${gaeste.length} Gäste${freiNachGrund.length ? ` · ${freiNachGrund.map(([g, n]) => `${g} ${n}`).join(', ')}` : ''}`}>
            <Link href={`/vorstellungen/${id}/gaeste`} className="link">Gästeliste verwalten</Link>
          </Ablauf>
        </div>
      </section>

      <div className="mb-6 grid items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_440px]">
        <Abschnitt id="saalplan" titel="Saalplan" beschreibung={abgesagt ? undefined : 'Plätze auswählen, um sie zu sperren oder freizugeben. Verkaufte Plätze öffnen die Bestellung.'}>
          <PlatzVerwaltung status={plaetze.status} info={plaetze.info} sperren={sitzeSperren.bind(null, id)} entsperren={sitzeEntsperren.bind(null, id)} bearbeitbar={!abgesagt} />
        </Abschnitt>
        <div className="grid gap-6 lg:grid-cols-2 2xl:grid-cols-1">
          <Abschnitt id="kategorien" titel="Nach Kategorie" flush>
            <table className="table rtab">
              <thead><tr><th scope="col">Kategorie</th><th scope="col" className="text-right">Verkauft</th><th scope="col" className="text-right">Frei</th><th scope="col" className="text-right">Umsatz</th></tr></thead>
              <tbody>
                {(['I', 'II', 'R'] as Kat[]).map((k) => {
                  const x = z.jeKat[k];
                  return (
                    <tr key={k}>
                      <th scope="row" className={`${ZEILENKOPF} rtab-kopf`}>{KAT_NAME[k]}<span className="block text-xs font-normal text-muted">{k === 'R' ? formatEur(preise.R.normal) : `${formatEur(preise[k].normal)} / ${formatEur(preise[k].ermaessigt)}`} · {KAT_KAPAZITAET[k]} Plätze{x.gesperrt ? ` · ${x.gesperrt} gesperrt` : ''}{x.reserviert ? ` · ${x.reserviert} reserviert` : ''}</span></th>
                      <td data-label="Verkauft" className="num text-right font-semibold">{x.verkauft}{x.eingelassen > 0 && <span className="block text-xs font-normal text-muted">{x.eingelassen} eingelassen</span>}</td>
                      <td data-label="Frei" className="num text-right">{x.frei}</td>
                      <td data-label="Umsatz" className="text-right"><Money cents={x.umsatz} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Abschnitt>
          {begonnen && ns.gesamt.verkauft > 0 ? (
            <Abschnitt id="noshow" titel="No-Show" flush beschreibung={`${ns.gesamt.noShow} von ${ns.gesamt.verkauft} Tickets nicht eingelassen (${Math.round((ns.gesamt.noShow / ns.gesamt.verkauft) * 100)} %)`}>
              <table className="table rtab">
                <thead><tr><th scope="col">Nach</th><th scope="col" className="text-right">Verkauft</th><th scope="col" className="text-right">Eingelassen</th><th scope="col" className="text-right">Nicht da</th></tr></thead>
                <tbody>
                  {(['I', 'II', 'R'] as Kat[]).filter((k) => ns.jeKat[k].verkauft).map((k) => (
                    <tr key={k}><th scope="row" className={`${ZEILENKOPF} rtab-kopf`}>{KAT_NAME[k]}</th><td data-label="Verkauft" className="num text-right">{ns.jeKat[k].verkauft}</td><td data-label="Eingelassen" className="num text-right">{ns.jeKat[k].eingelassen}</td><td data-label="Nicht da" className="num text-right font-semibold">{ns.jeKat[k].noShow}</td></tr>
                  ))}
                  {ns.jeKanal.map((k) => (
                    <tr key={k.channel}><th scope="row" className={`${ZEILENKOPF} rtab-kopf`}>Kanal {KANAL_NAME[k.channel] ?? k.channel}</th><td data-label="Verkauft" className="num text-right">{k.verkauft}</td><td data-label="Eingelassen" className="num text-right">{k.ein}</td><td data-label="Nicht da" className="num text-right font-semibold">{k.noShow}</td></tr>
                  ))}
                </tbody>
              </table>
            </Abschnitt>
          ) : (
            <Abschnitt id="notiz" titel="Notiz (intern)">
              {show.notes ? <p className="whitespace-pre-line text-sm">{show.notes}</p> : <p className="text-sm text-muted">Keine Notiz. Über „Bearbeiten“ hinzufügen.</p>}
            </Abschnitt>
          )}
        </div>
      </div>

      <Abschnitt id="bestellungen" titel={`Bestellungen${bestellungen.length ? ` (${bestellungen.length}${bestellungen.length === 100 ? '+' : ''})` : ''}`} flush className="mb-6"
        aktionen={<Link href={`/bestellungen?show=${id}`} className="btn-secondary btn-sm">In der Bestellliste öffnen<Icon name="pfeil" className="h-3.5 w-3.5" /></Link>}>
        {bestellungen.length ? (
          <table className="table rtab">
            <thead><tr><th scope="col">Nummer</th><th scope="col">Kund:in</th><th scope="col">Kanal</th><th scope="col">Status</th><th scope="col" className="text-right">Tickets</th><th scope="col" className="text-right">Summe</th><th scope="col">Erstellt</th></tr></thead>
            <tbody>
              {bestellungen.map((o) => (
                <tr key={o.id}>
                  <td className="rtab-kopf"><Link href={`/bestellungen/${o.id}`} className="font-mono text-[13px] font-semibold underline-offset-4 hover:underline">{o.number}</Link></td>
                  <td data-label="Kund:in">{o.customer ? `${o.customer.firstName} ${o.customer.lastName}`.trim() || '–' : <span className="text-muted">anonym</span>}</td>
                  <td data-label="Kanal">{KANAL_NAME[o.channel] ?? o.channel}</td>
                  <td data-label="Status"><StatusPill status={o.status} /></td>
                  <td data-label="Tickets" className="num text-right">{o._count.tickets}</td>
                  <td data-label="Summe" className="text-right"><Money cents={o.totalCents} /></td>
                  <td data-label="Erstellt" className="whitespace-nowrap">{fmtDatumZeit(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty icon="ticket" titel="Noch keine Bestellungen" aktion={!abgesagt && show.status === 'verkauf' && show.startsAt > new Date() ? <Link href={`/bestellungen/neu?show=${id}`} className="btn-secondary btn-sm">Tickets verkaufen</Link> : undefined}>Verkäufe aus Webshop, Telefon, Kassa und Partnern erscheinen hier.</Empty>}
      </Abschnitt>
      <Verlauf ziele={[{ entity: 'show', ids: [show.id] }, { entity: 'showSeries', ids: [show.seriesId] }]} titel="Verlauf der Vorstellung" />
    </>
  );
}
