import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { kontenblatt, TYP_NAME } from '@/lib/finanzen/auswertung';
import { fmtTagStr, zeitraum } from '@/lib/finanzen/zeitraum';
import { ZeitraumFilter } from '@/components/finanzen/Zeitraum';
import { Empty, Money } from '@/components/ui';

export const dynamic = 'force-dynamic';

const Saldo = ({ c }: { c: number }) => <><Money cents={Math.abs(c)} /> <span className="text-xs text-muted">{c > 0 ? 'S' : c < 0 ? 'H' : ''}</span></>;

export default async function Kontenblatt({ params, searchParams }: { params: Promise<{ nummer: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole('buchhaltung');
  const { nummer } = await params;
  const { von, bis } = zeitraum(await searchParams);
  const kb = await kontenblatt(nummer, von, bis);
  if (!kb) notFound();
  const soll = kb.zeilen.reduce((s, z) => s + z.soll, 0);
  const haben = kb.zeilen.reduce((s, z) => s + z.haben, 0);
  return (
    <>
      <p className="mb-2 text-sm"><Link href={`/buchhaltung/konten?von=${von}&bis=${bis}`} className="underline underline-offset-4">Zurück zum Kontenplan</Link></p>
      <ZeitraumFilter von={von} bis={bis} label="Zeitraum des Kontenblatts" />
      <section className="card relative" aria-labelledby="h-kb">
        <h2 id="h-kb" className="h2 px-5 pt-4">Kontenblatt {kb.konto.number} {kb.konto.name}</h2>
        <p className="px-5 text-sm text-muted">{TYP_NAME[kb.konto.type]} · {fmtTagStr(von)} bis {fmtTagStr(bis)}{!kb.konto.active && ' · deaktiviert'}</p>
        <table className="table mt-3">
          <thead><tr><th>Datum</th><th>Nr.</th><th>Beleg</th><th>Text</th><th>Gegenkonto</th><th className="text-right">Soll</th><th className="text-right">Haben</th><th className="text-right">Saldo</th></tr></thead>
          <tbody>
            <tr><td colSpan={7} className="text-muted">Vortrag</td><td className="text-right"><Saldo c={kb.vortrag} /></td></tr>
            {kb.zeilen.map((z) => (
              <tr key={z.id}>
                <td className="whitespace-nowrap">{fmtTagStr(z.datum)}</td>
                <td className="num"><Link href={`/buchhaltung?nr=${z.nr}`} className="underline underline-offset-4">{z.nr}</Link></td>
                <td>{z.beleg}</td><td>{z.text}{z.vatCode && <span className="text-xs text-muted"> ({z.vatCode})</span>}</td>
                <td className="num">{z.gegen.map((g) => <Link key={g} href={`/buchhaltung/konten/${g}?von=${von}&bis=${bis}`} className="mr-1 underline underline-offset-4">{g}</Link>)}</td>
                <td className="text-right">{z.soll ? <Money cents={z.soll} /> : ''}</td>
                <td className="text-right">{z.haben ? <Money cents={z.haben} /> : ''}</td>
                <td className="text-right"><Saldo c={z.saldo} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="font-semibold"><td colSpan={5} className="px-4 py-2.5">Summe Zeitraum</td><td className="px-4 text-right"><Money cents={soll} /></td><td className="px-4 text-right"><Money cents={haben} /></td><td className="px-4 text-right"><Saldo c={kb.vortrag + soll - haben} /></td></tr></tfoot>
        </table>
        {!kb.zeilen.length && <Empty>Keine Buchungen im Zeitraum.</Empty>}
      </section>
    </>
  );
}
