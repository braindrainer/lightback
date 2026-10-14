import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtTag, fmtZeit, wienTag, wienZuUtc } from '@/lib/dates';
import { KAPAZITAET, ROLLSTUHL } from '@/lib/saal';
import { Empty, FilterChips, Hinweis, Icon, Money, PageHeader, StatusPill } from '@/components/ui';
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
  const href = (p: Record<string, string | undefined>) => `/vorstellungen?${new URLSearchParams(Object.entries({ ...params, ...p }).filter((e): e is [string, string] => !!e[1]))}`;
  return (
    <>
      <PageHeader title="Vorstellungen" krumen={[{ label: 'Verkauf' }, { label: 'Vorstellungen' }]}
        sub={<><span className="num font-semibold text-ink">{anzahl}</span> Vorstellungen · Kapazität {KAPAZITAET} Sitzplätze + {ROLLSTUHL} Rollstuhlplätze</>}>
        <Link href="/vorstellungen/neu" className="btn-primary"><Icon name="plus" className="h-4 w-4" />Vorstellung oder Serie anlegen</Link>
      </PageHeader>
      {sp.meldung && <Hinweis art="ok" rolle="status">{sp.meldung}</Hinweis>}
      <div className="card mb-4 flex flex-wrap items-end justify-between gap-3 !overflow-visible p-4">
        <FilterChips label="Zeitraum" chips={FILTER.map(([k, l]) => ({ label: l, href: href({ zeit: k, seite: undefined }), aktiv: zeit === k }))} />
        <form method="get" className="flex flex-wrap items-end gap-2" aria-label="Monat wählen">
          <input type="hidden" name="zeit" value={zeit} />
          <div><label htmlFor="monat" className="label">Monat</label><input id="monat" name="monat" type="month" defaultValue={monat} className="input" /></div>
          <button className="btn-secondary">Anzeigen</button>
          {monat && <Link href={`/vorstellungen?zeit=${zeit}`} className="btn-ghost">Monat zurücksetzen</Link>}
        </form>
      </div>
      <form action={sammelStatus} className="card tabelle-frei">
        <input type="hidden" name="zurueck" value={zurueck} />
        {shows.length ? (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-2.5">
              <span className="text-sm text-muted">Ausgewählte:</span>
              <button name="aktion" value="pausiert" className="btn-secondary btn-sm">Verkauf pausieren</button>
              <button name="aktion" value="verkauf" className="btn-secondary btn-sm">Verkauf öffnen</button>
            </div>
            <table className="table rtab">
              <caption className="sr-only">Vorstellungen mit Verkaufszahlen je Kategorie</caption>
              <thead>
                <tr>
                  <th scope="col" className="w-10"><AlleWaehlen name="ids" label="Alle Vorstellungen dieser Seite auswählen" /></th>
                  <th scope="col">Termin</th><th scope="col">Status</th>
                  <th scope="col" className="text-right">Kat. I<span className="sr-only"> verkauft / frei</span></th>
                  <th scope="col" className="text-right">Kat. II<span className="sr-only"> verkauft / frei</span></th>
                  <th scope="col" className="text-right">Rollstuhl<span className="sr-only"> verkauft / frei</span></th>
                  <th scope="col" className="text-right">Verkauft</th><th scope="col">Auslastung</th><th scope="col" className="text-right">Umsatz</th>
                </tr>
              </thead>
              <tbody>
                {shows.map((s) => {
                  const z = zahlen.get(s.id)!;
                  const titel = `${fmtTag(s.startsAt)} ${wienTag(s.startsAt).slice(0, 4)}, ${fmtZeit(s.startsAt)}`;
                  return (
                    <tr key={s.id}>
                      <td className="max-md:!absolute max-md:right-4 max-md:!w-auto"><input type="checkbox" name="ids" value={s.id} aria-label={`${titel} auswählen`} className="h-5 w-5 accent-accent" /></td>
                      <td className="rtab-kopf whitespace-nowrap"><Link href={`/vorstellungen/${s.id}`} className="font-semibold underline-offset-4 hover:underline">{titel}</Link>{s.title !== 'Light of Creation' && <span className="block text-xs font-normal text-muted">{s.title}</span>}</td>
                      <td data-label="Status"><StatusPill status={s.status} /></td>
                      {(['I', 'II', 'R'] as const).map((k) => <td key={k} data-label={k === 'R' ? 'Rollstuhl' : `Kat. ${k}`} className="num text-right whitespace-nowrap">{z.jeKat[k].verkauft} <span className="text-muted">/ {z.jeKat[k].frei} frei</span></td>)}
                      <td data-label="Verkauft" className="num text-right font-semibold">{z.gesamt.verkauft}<span className="font-normal text-muted"> / {z.gesamt.frei} frei</span></td>
                      <td data-label="Auslastung"><Balken wert={z.gesamt.verkauft} max={KAPAZITAET} label="Auslastung" /></td>
                      <td data-label="Umsatz" className="text-right"><Money cents={z.gesamt.umsatz} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        ) : <Empty icon="kalender" titel="Keine Vorstellungen" aktion={<Link href="/vorstellungen/neu" className="btn-secondary btn-sm">Vorstellung anlegen</Link>}>Für diesen Zeitraum{monat ? ' und Monat' : ''} gibt es keine Vorstellungen.</Empty>}
        <Seiten seite={seite} seiten={Math.ceil(anzahl / PRO_SEITE)} basis="/vorstellungen" params={params} gesamt={anzahl} pro={PRO_SEITE} />
      </form>
      <p className="mt-3 text-xs text-muted">Kapazität je Kategorie: Kat. I {KAT_KAPAZITAET.I} (inkl. 14 Zusatzsitze in Reihe 0), Kat. II {KAT_KAPAZITAET.II}, Rollstuhl {KAT_KAPAZITAET.R}. Zusatzsitze und Rollstuhlplatz schließen einander aus.</p>
    </>
  );
}
