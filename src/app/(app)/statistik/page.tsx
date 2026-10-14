import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { fmtDatum, fmtTag, fmtZeit } from '@/lib/dates';
import { formatEur } from '@/lib/money';
import { KAPAZITAET } from '@/lib/saal';
import { ART_NAME, KANAL_NAME, KASSA_NAME, statistik, tagPlus, vorOrtStatistik, WOCHENTAGE, zeitraumAus } from '@/lib/statistik';
import { Balken } from '@/components/system/Balken';
import { Empty, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Statistik' };

const pct = (v: number | null, d = 1) => (v == null ? '–' : `${v.toLocaleString('de-AT', { maximumFractionDigits: d, minimumFractionDigits: d })} %`);
const PRESETS = [['heute', 'Heute'], ['7', '7 Tage'], ['monat', 'Monat'], ['jahr', 'Jahr']] as const;
const MONATE = ['Jän.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'];

function Kennzahl({ label, wert, hinweis }: { label: string; wert: string; hinweis?: string }) {
  return (
    <div className="card p-4">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num mt-1 text-2xl font-semibold">{wert}</dd>
      {hinweis && <dd className="mt-0.5 text-xs text-muted">{hinweis}</dd>}
    </div>
  );
}

function Abschnitt({ id, titel, children, className = '' }: { id: string; titel: string; children: React.ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={`card p-4 sm:p-5 ${className}`}>
      <h2 id={id} className="h2 mb-3">{titel}</h2>
      {children}
    </section>
  );
}

export default async function Statistik({ searchParams }: { searchParams: Promise<{ preset?: string; von?: string; bis?: string }> }) {
  await requireRole('leitung', 'buchhaltung');
  const sp = await searchParams;
  const z = zeitraumAus(sp);
  const [s, vo] = await Promise.all([statistik(z), vorOrtStatistik(z)]);
  const k = s.kpi;

  // Ab drei Monaten Säulen je Monat statt je Tag
  const jeMonat = z.tage > 92;
  const punkte = jeMonat
    ? [...s.reihe.reduce((m, r) => { const key = r.tag.slice(0, 7); const v = m.get(key) ?? { wert: 0, tickets: 0 }; v.wert += r.umsatz; v.tickets += r.tickets; return m.set(key, v); }, new Map<string, { wert: number; tickets: number }>())]
      .map(([key, v]) => ({ label: `${MONATE[+key.slice(5) - 1]} ${key.slice(0, 4)}`, kurz: MONATE[+key.slice(5) - 1], ...v }))
    : s.reihe.map((r) => ({ label: fmtTag(`${r.tag}T12:00:00Z`), kurz: `${+r.tag.slice(8)}.${+r.tag.slice(5, 7)}.`, wert: r.umsatz, tickets: r.tickets }));
  const csv = `/statistik/csv?von=${z.von}&bis=${z.bis}`;
  const katSumme = s.kat.reduce((n, r) => n + r.umsatz, 0) || 1;
  const kanalSumme = s.kanal.reduce((n, r) => n + r.umsatz, 0) || 1;
  const vlMax = Math.max(1, ...s.vorlauf.map((v) => v.tickets));

  return (
    <>
      <PageHeader title="Statistik" sub={`${fmtDatum(`${z.von}T12:00:00Z`)} bis ${fmtDatum(`${z.bis}T12:00:00Z`)} · Verkauf nach Zahlungstag, Auslastung nach Vorstellungstag`}>
        <a href={csv} className="btn-secondary" download>Tagesreihe als CSV</a>
      </PageHeader>

      <form method="get" className="card mb-5 flex flex-wrap items-end gap-3 p-4" aria-label="Zeitraum wählen">
        <nav aria-label="Schnellauswahl" className="flex flex-wrap gap-2">
          {PRESETS.map(([p, l]) => (
            <Link key={p} href={`/statistik?preset=${p}`} aria-current={z.preset === p ? 'true' : undefined} className={z.preset === p ? 'btn-primary' : 'btn-secondary'}>{l}</Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-end gap-2 sm:ml-auto">
          <div><label htmlFor="von" className="label">Von</label><input id="von" name="von" type="date" defaultValue={z.von} required className="input" /></div>
          <div><label htmlFor="bis" className="label">Bis</label><input id="bis" name="bis" type="date" defaultValue={z.bis} required className="input" /></div>
          <button className="btn-primary">Anzeigen</button>
        </div>
      </form>

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kennzahl label="Umsatz brutto (Tickets)" wert={formatEur(k.umsatzBrutto)} hinweis={`netto ${formatEur(k.umsatzNetto)} (13 % USt.)`} />
        <Kennzahl label="Verkaufte Tickets" wert={k.tickets.toLocaleString('de-AT')} hinweis={`Ø Ticketpreis ${formatEur(k.schnitt)}`} />
        <Kennzahl label="Auslastung" wert={pct(k.auslastung)} hinweis={`${k.shows} Vorstellungen à ${KAPAZITAET} Plätze`} />
        <Kennzahl label="Kassa-Umsatz" wert={formatEur(k.kassa)} hinweis="Belege der Registrierkasse" />
        <Kennzahl label="Stornoquote" wert={pct(k.stornoquote)} hinweis={`${k.storniert} Tickets storniert`} />
        <Kennzahl label="Check-in-Quote" wert={pct(k.checkin)} hinweis={`${k.eingelassen} eingelassen, ${k.gespielt} gespielte Vorstellungen`} />
        <Kennzahl label="Ø Ticketpreis" wert={formatEur(k.schnitt)} />
        <Kennzahl label="Netto-Umsatz" wert={formatEur(k.umsatzNetto)} />
      </dl>

      <Abschnitt id="verlauf" titel={jeMonat ? 'Umsatz je Monat' : 'Umsatz je Tag'} className="mt-5">
        {k.tickets ? <Balken id="umsatz" titel={jeMonat ? 'Ticketumsatz brutto je Monat' : 'Ticketumsatz brutto je Tag'} punkte={punkte} /> : <Empty>Im gewählten Zeitraum wurden keine Tickets verkauft.</Empty>}
      </Abschnitt>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Abschnitt id="kanal" titel="Nach Verkaufskanal">
          {s.kanal.length ? (
            <table className="table">
              <thead><tr><th scope="col">Kanal</th><th scope="col" className="text-right">Tickets</th><th scope="col" className="text-right">Umsatz</th><th scope="col" className="text-right">Anteil</th></tr></thead>
              <tbody>{s.kanal.map((r) => <tr key={r.kanal}><td>{KANAL_NAME[r.kanal] ?? r.kanal}</td><td className="num text-right">{r.tickets}</td><td className="num text-right">{formatEur(r.umsatz)}</td><td className="num text-right">{pct((r.umsatz / kanalSumme) * 100, 0)}</td></tr>)}</tbody>
            </table>
          ) : <Empty>Keine Verkäufe.</Empty>}
        </Abschnitt>

        <Abschnitt id="kat" titel="Nach Kategorie und Ticketart">
          {s.kat.length ? (
            <table className="table">
              <thead><tr><th scope="col">Kategorie</th><th scope="col">Ticketart</th><th scope="col" className="text-right">Tickets</th><th scope="col" className="text-right">Umsatz</th><th scope="col" className="text-right">Anteil</th></tr></thead>
              <tbody>{s.kat.map((r) => <tr key={r.kat + r.art}><td>{r.kat === 'R' ? 'Rollstuhl' : `Kat. ${r.kat}`}</td><td>{ART_NAME[r.art] ?? r.art}</td><td className="num text-right">{r.tickets}</td><td className="num text-right">{formatEur(r.umsatz)}</td><td className="num text-right">{pct((r.umsatz / katSumme) * 100, 0)}</td></tr>)}</tbody>
            </table>
          ) : <Empty>Keine Verkäufe.</Empty>}
        </Abschnitt>

        <Abschnitt id="partner" titel="Nach Vertriebspartner">
          {s.partner.length ? (
            <table className="table">
              <thead><tr><th scope="col">Partner</th><th scope="col" className="text-right">Tickets</th><th scope="col" className="text-right">Umsatz</th><th scope="col" className="text-right">Provision</th><th scope="col" className="text-right">Storniert</th></tr></thead>
              <tbody>{s.partner.map((r) => <tr key={r.id}><td><Link href={`/partner/${r.id}`} className="underline underline-offset-4">{r.name}</Link></td><td className="num text-right">{r.tickets}</td><td className="num text-right">{formatEur(r.umsatz)}</td><td className="num text-right">{formatEur(r.provision)} <span className="text-muted">({r.pct} %)</span></td><td className="num text-right">{r.storniert}</td></tr>)}</tbody>
            </table>
          ) : <Empty>Keine Partnerverkäufe im Zeitraum.</Empty>}
        </Abschnitt>

        <Abschnitt id="kassa" titel="Kassa-Umsatz nach Warengruppe">
          {s.kassa.length ? (
            <table className="table">
              <thead><tr><th scope="col">Warengruppe</th><th scope="col" className="text-right">Belege</th><th scope="col" className="text-right">Umsatz brutto</th></tr></thead>
              <tbody>{s.kassa.map((r) => <tr key={r.kategorie}><td>{KASSA_NAME[r.kategorie] ?? r.kategorie}</td><td className="num text-right">{r.belege}</td><td className="num text-right">{formatEur(r.cents)}</td></tr>)}</tbody>
            </table>
          ) : <Empty>Keine Kassabelege im Zeitraum.</Empty>}
        </Abschnitt>

        <Abschnitt id="vorlauf" titel="Vorlauf: Tage zwischen Kauf und Vorstellung">
          {k.tickets ? (
            <table className="table">
              <thead><tr><th scope="col">Vorlauf</th><th scope="col" className="text-right">Tickets</th><th scope="col" className="w-2/5"><span className="sr-only">Balken</span></th></tr></thead>
              <tbody>{s.vorlauf.map((v) => <tr key={v.label}><td>{v.label}</td><td className="num text-right">{v.tickets}</td><td aria-hidden="true"><div className="mt-1.5 h-2.5 rounded-full bg-accent" style={{ width: `${(v.tickets / vlMax) * 100}%` }} /></td></tr>)}</tbody>
            </table>
          ) : <Empty>Keine Verkäufe.</Empty>}
        </Abschnitt>

        <Abschnitt id="heat" titel="Ø Auslastung nach Wochentag und Beginn">
          {s.heatmap.zeiten.length ? (
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Auslastung nach Wochentag und Beginnzeit, seitlich scrollbar">
              <table className="text-sm">
                <caption className="sr-only">Durchschnittliche Auslastung in Prozent je Wochentag und Beginnzeit, in Klammern die Zahl der Vorstellungen</caption>
                <thead><tr><td /><>{s.heatmap.zeiten.map((t) => <th key={t} scope="col" className="px-2 pb-1 text-xs font-semibold text-muted">{t}</th>)}</></tr></thead>
                <tbody>
                  {WOCHENTAGE.map((tag, i) => (
                    <tr key={tag}>
                      <th scope="row" className="pr-3 text-left text-xs font-semibold text-muted">{tag}</th>
                      {s.heatmap.zellen[i].map((c, j) => {
                        const st = c ? Math.min(100, c.pct) : 0;
                        return <td key={j} className="p-0.5"><div className="num min-w-20 rounded-md px-2 py-1.5 text-center" style={{ background: c ? `rgba(138,106,31,${0.08 + (st / 100) * 0.85})` : '#f7f4ee', color: c && st > 55 ? '#fff' : '#121a2b' }}>{c ? <>{c.pct} %<span className="sr-only"> bei</span><span className="ml-1 text-[11px] opacity-90">({c.shows})</span></> : <span className="text-muted">–</span>}</div></td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>Keine Vorstellungen im Zeitraum.</Empty>}
        </Abschnitt>
      </div>

      <Abschnitt id="top" titel="Vorstellungen mit der höchsten Auslastung" className="mt-5">
        {s.top.length ? (
          <table className="table">
            <thead><tr><th scope="col">Vorstellung</th><th scope="col" className="text-right">Verkauft</th><th scope="col" className="text-right">Eingelassen</th><th scope="col" className="w-1/3">Auslastung</th></tr></thead>
            <tbody>{s.top.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/vorstellungen/${r.id}`} className="font-medium underline-offset-4 hover:underline">{fmtTag(r.startsAt)}, {fmtZeit(r.startsAt)}</Link></td>
                <td className="num text-right">{r.verkauft}</td><td className="num text-right">{r.ein}</td>
                <td><div className="flex items-center gap-2"><div className="h-2 flex-1 rounded-full bg-line" aria-hidden="true"><div className="h-2 rounded-full bg-kat1" style={{ width: `${Math.min(100, r.pct)}%` }} /></div><span className="num w-14 text-right">{pct(r.pct, 0)}</span></div></td>
              </tr>
            ))}</tbody>
          </table>
        ) : <Empty>Keine Vorstellungen im Zeitraum.</Empty>}
      </Abschnitt>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Abschnitt id="freikarten" titel="Freikarten nach Grund">
          {vo.frei.length ? (
            <table className="table">
              <thead><tr><th scope="col">Grund</th><th scope="col" className="text-right">Gäste</th><th scope="col" className="text-right">Karten</th><th scope="col" className="text-right">Eingelassen</th></tr></thead>
              <tbody>{vo.frei.map((r) => <tr key={r.grund}><td>{r.grund}</td><td className="num text-right">{r.gaeste}</td><td className="num text-right font-semibold">{r.karten}</td><td className="num text-right">{r.ein}</td></tr>)}</tbody>
              <tfoot><tr><td className="font-semibold">Summe</td><td className="num text-right">{vo.frei.reduce((n, r) => n + r.gaeste, 0)}</td><td className="num text-right font-semibold">{vo.frei.reduce((n, r) => n + r.karten, 0)}</td><td className="num text-right">{vo.frei.reduce((n, r) => n + r.ein, 0)}</td></tr></tfoot>
            </table>
          ) : <Empty>Keine Freikarten für Vorstellungen im Zeitraum.</Empty>}
        </Abschnitt>
        <Abschnitt id="noshow" titel="No-Show je gespielter Vorstellung">
          {vo.noShow.length ? (
            <div className="max-h-96 overflow-y-auto" tabIndex={0} role="region" aria-label="No-Show je Vorstellung, scrollbar">
              <table className="table">
                <thead><tr><th scope="col">Vorstellung</th><th scope="col" className="text-right">Tickets</th><th scope="col" className="text-right">Eingelassen</th><th scope="col" className="text-right">Nicht erschienen</th></tr></thead>
                <tbody>{vo.noShow.map((r) => (
                  <tr key={r.id}><td><Link href={`/vorstellungen/${r.id}`} className="underline-offset-4 hover:underline">{fmtTag(r.startsAt)}, {fmtZeit(r.startsAt)}</Link>{r.frei ? <span className="block text-xs text-muted">davon {r.frei} Freikarten</span> : null}</td><td className="num text-right">{r.verkauft}</td><td className="num text-right">{r.ein}</td><td className="num text-right font-semibold">{r.noShow} <span className="text-xs font-normal text-muted">({Math.round((r.noShow / r.verkauft) * 100)} %)</span></td></tr>
                ))}</tbody>
              </table>
            </div>
          ) : <Empty>Keine gespielten Vorstellungen im Zeitraum.</Empty>}
        </Abschnitt>
      </div>
      <p className="mt-3 text-xs text-muted">Zeitraum {z.tage} {z.tage === 1 ? 'Tag' : 'Tage'} · bis {fmtDatum(`${tagPlus(z.bis, 0)}T12:00:00Z`)} einschließlich.</p>
    </>
  );
}
