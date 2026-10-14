import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtTag, fmtZeit, wienTag, wienZuUtc } from '@/lib/dates';
import { KAPAZITAET, ROLLSTUHL } from '@/lib/saal';
import { Empty, Money, PageHeader, StatusPill } from '@/components/ui';
import AlleWaehlen from '@/components/verkauf/AlleWaehlen';
import { auslastungListe, KAT_KAPAZITAET } from '@/components/verkauf/daten';
import { Balken, Seiten } from '@/components/verkauf/Seiten';
import { sammelStatus } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Vorstellungen' };
const PRO_SEITE = 50;

const FILTER = [['kommend', 'Kommend'], ['vergangen', 'Vergangen'], ['abgesagt', 'Abgesagt'], ['alle', 'Alle']] as const;

export default async function Vorstellungen({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole('leitung');
  const sp = await searchParams;
  const zeit = FILTER.some(([k]) => k === sp.zeit) ? sp.zeit! : 'kommend';
  const monat = /^\d{4}-\d{2}$/.test(sp.monat ?? '') ? sp.monat! : '';
  const seite = Math.max(1, Number(sp.seite) || 1);
  const jetzt = new Date();
  const where: Prisma.ShowWhereInput = {};
  if (zeit === 'kommend') Object.assign(where, { startsAt: { gte: new Date(jetzt.getTime() - 3600e3) }, status: { not: 'abgesagt' } });
  if (zeit === 'vergangen') Object.assign(where, { startsAt: { lt: jetzt } });
  if (zeit === 'abgesagt') where.status = 'abgesagt';
  if (monat) {
    const [y, m] = monat.split('-').map(Number);
    const von = wienZuUtc(`${monat}-01`, '00:00');
    const bis = wienZuUtc(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`, '00:00');
    where.AND = [{ startsAt: { gte: von, lt: bis } }];
  }
  const [anzahl, shows] = await Promise.all([
    db.show.count({ where }),
    db.show.findMany({ where, orderBy: { startsAt: zeit === 'vergangen' ? 'desc' : 'asc' }, skip: (seite - 1) * PRO_SEITE, take: PRO_SEITE }),
  ]);
  const zahlen = await auslastungListe(shows.map((s) => s.id));
  const params = { zeit, monat: monat || undefined };
  const zurueck = `/vorstellungen?${new URLSearchParams(Object.entries({ ...params, seite: String(seite) }).filter(([, v]) => v) as [string, string][])}`;
  return (
    <>
      <PageHeader title="Vorstellungen" sub={`${anzahl} Vorstellungen · Kapazität ${KAPAZITAET} Sitzplätze + ${ROLLSTUHL} Rollstuhlplätze`}>
        <Link href="/vorstellungen/neu" className="btn-primary">Vorstellung oder Serie anlegen</Link>
      </PageHeader>
      {sp.meldung && <p role="status" className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-pos">{sp.meldung}</p>}
      <form method="get" className="card mb-4 flex flex-wrap items-end gap-3 p-4" aria-label="Filter">
        <fieldset className="flex flex-wrap gap-1.5">
          <legend className="label">Zeitraum</legend>
          {FILTER.map(([k, l]) => (
            <label key={k} className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm font-medium has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-accent ${zeit === k ? 'border-nacht bg-nacht text-white' : 'border-line bg-white hover:border-accent'}`}>
              <input type="radio" name="zeit" value={k} defaultChecked={zeit === k} className="sr-only" />{l}
            </label>
          ))}
        </fieldset>
        <div><label htmlFor="monat" className="label">Monat</label><input id="monat" name="monat" type="month" defaultValue={monat} className="input" /></div>
        <button className="btn-secondary">Anzeigen</button>
        {monat && <Link href={`/vorstellungen?zeit=${zeit}`} className="btn-secondary">Monat zurücksetzen</Link>}
      </form>
      <form action={sammelStatus} className="card">
        <input type="hidden" name="zurueck" value={zurueck} />
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <span className="text-sm text-muted">Ausgewählte Vorstellungen:</span>
          <button name="aktion" value="pausiert" className="btn-secondary btn-sm">Verkauf pausieren</button>
          <button name="aktion" value="verkauf" className="btn-secondary btn-sm">Verkauf öffnen</button>
        </div>
        {shows.length ? (
          <table className="table">
            <caption className="sr-only">Vorstellungen mit Verkaufszahlen je Kategorie</caption>
            <thead>
              <tr>
                <th scope="col" className="w-10"><AlleWaehlen name="ids" label="Alle Vorstellungen dieser Seite auswählen" /></th>
                <th scope="col">Termin</th><th scope="col">Status</th>
                <th scope="col" className="text-right">Kat. I<span className="sr-only"> verkauft / frei</span></th>
                <th scope="col" className="text-right">Kat. II<span className="sr-only"> verkauft / frei</span></th>
                <th scope="col" className="text-right">Rollstuhl<span className="sr-only"> verkauft / frei</span></th>
                <th scope="col" className="text-right">Verkauft</th><th scope="col" className="text-right">Frei</th><th scope="col">Auslastung</th><th scope="col" className="text-right">Umsatz</th>
              </tr>
            </thead>
            <tbody>
              {shows.map((s) => {
                const z = zahlen.get(s.id)!;
                const titel = `${fmtTag(s.startsAt)} ${wienTag(s.startsAt).slice(0, 4)}, ${fmtZeit(s.startsAt)}`;
                return (
                  <tr key={s.id}>
                    <td><input type="checkbox" name="ids" value={s.id} aria-label={`${titel} auswählen`} className="h-5 w-5 accent-accent" /></td>
                    <td className="whitespace-nowrap"><Link href={`/vorstellungen/${s.id}`} className="font-medium underline-offset-4 hover:underline">{titel}</Link>{s.title !== 'Light of Creation' && <span className="block text-xs text-muted">{s.title}</span>}</td>
                    <td><StatusPill status={s.status} /></td>
                    {(['I', 'II', 'R'] as const).map((k) => <td key={k} className="num text-right whitespace-nowrap">{z.jeKat[k].verkauft} <span className="text-muted">/ {z.jeKat[k].frei} frei</span></td>)}
                    <td className="num text-right font-semibold">{z.gesamt.verkauft}</td>
                    <td className="num text-right">{z.gesamt.frei}</td>
                    <td><Balken wert={z.gesamt.verkauft} max={KAPAZITAET} label="Auslastung" /></td>
                    <td className="text-right"><Money cents={z.gesamt.umsatz} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <Empty>Keine Vorstellungen für diesen Filter.</Empty>}
        <Seiten seite={seite} seiten={Math.ceil(anzahl / PRO_SEITE)} basis="/vorstellungen" params={params} />
      </form>
      <p className="mt-3 text-xs text-muted">Kapazität je Kategorie: Kat. I {KAT_KAPAZITAET.I} (inkl. 14 Zusatzsitze in Reihe 0), Kat. II {KAT_KAPAZITAET.II}, Rollstuhl {KAT_KAPAZITAET.R}. Zusatzsitze und Rollstuhlplatz schließen einander aus.</p>
    </>
  );
}
