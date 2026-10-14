import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { saldenliste } from '@/lib/finanzen/auswertung';
import { fmtTagStr, zeitraum } from '@/lib/finanzen/zeitraum';
import { ZeitraumFilter } from '@/components/finanzen/Zeitraum';
import { Empty, Money } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Saldenliste – Buchhaltung' };

const Saldo = ({ c }: { c: number }) => <><Money cents={Math.abs(c)} /> <span className="text-xs text-muted">{c > 0 ? 'S' : c < 0 ? 'H' : ''}</span></>;

export default async function Saldenliste({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole('buchhaltung');
  const { von, bis } = zeitraum(await searchParams);
  const z = await saldenliste(von, bis);
  const s = z.reduce((a, k) => ({ vortrag: a.vortrag + k.vortrag, soll: a.soll + k.soll, haben: a.haben + k.haben, saldo: a.saldo + k.saldo }), { vortrag: 0, soll: 0, haben: 0, saldo: 0 });
  const klassen = [...new Set(z.map((k) => k.number[0]))];
  return (
    <>
      <ZeitraumFilter von={von} bis={bis} label="Zeitraum der Saldenliste" />
      <section className="card relative" aria-labelledby="h-sl">
        <div className="flex flex-wrap items-start justify-between gap-2 px-5 pt-4">
          <div>
            <h2 id="h-sl" className="h2">Saldenliste {fmtTagStr(von)} bis {fmtTagStr(bis)} <span className="text-sm font-normal text-muted">(vorläufig)</span></h2>
            <p className="text-sm text-muted">Vortrag: Bestandskonten alle Buchungen davor, Erfolgskonten ab Beginn des Geschäftsjahres. Eröffnungsbuchungen gibt es noch keine.</p>
          </div>
          <a href={`/buchhaltung/export/saldenliste?von=${von}&bis=${bis}`} className="btn-secondary">CSV herunterladen</a>
        </div>
        {z.length ? (
          <table className="table mt-3">
            <thead><tr><th>Konto</th><th>Bezeichnung</th><th className="text-right">Vortrag</th><th className="text-right">Soll</th><th className="text-right">Haben</th><th className="text-right">Saldo</th></tr></thead>
            {klassen.map((kl) => (
              <tbody key={kl}>
                {z.filter((k) => k.number[0] === kl).map((k) => (
                  <tr key={k.id}>
                    <td className="num"><Link href={`/buchhaltung/konten/${k.number}?von=${von}&bis=${bis}`} className="underline underline-offset-4">{k.number}</Link></td>
                    <td>{k.name}</td>
                    <td className="text-right"><Saldo c={k.vortrag} /></td>
                    <td className="text-right"><Money cents={k.soll} /></td>
                    <td className="text-right"><Money cents={k.haben} /></td>
                    <td className="text-right"><Saldo c={k.saldo} /></td>
                  </tr>
                ))}
              </tbody>
            ))}
            <tfoot>
              <tr className="font-semibold"><td colSpan={2} className="px-4 py-2.5">Summe</td><td className="px-4 text-right"><Saldo c={s.vortrag} /></td><td className="px-4 text-right"><Money cents={s.soll} /></td><td className="px-4 text-right"><Money cents={s.haben} /></td><td className="px-4 text-right"><Saldo c={s.saldo} /></td></tr>
              <tr><td colSpan={6} className={`px-4 py-2 text-sm ${s.soll === s.haben ? 'text-pos' : 'text-neg'}`}>{s.soll === s.haben ? 'Kontrolle: Soll = Haben.' : 'Achtung: Soll und Haben stimmen nicht überein.'}</td></tr>
            </tfoot>
          </table>
        ) : <Empty>Keine Buchungen im Zeitraum.</Empty>}
      </section>
    </>
  );
}
