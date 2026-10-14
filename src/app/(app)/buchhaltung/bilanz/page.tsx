import { requireRole } from '@/lib/auth';
import { bilanz, erfolgsrechnung, type Posten } from '@/lib/finanzen/auswertung';
import { fmtTagStr, zeitraum } from '@/lib/finanzen/zeitraum';
import { ZeitraumFilter } from '@/components/finanzen/Zeitraum';
import { Money } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'GuV und Bilanz – Buchhaltung' };

function PostenListe({ posten, art }: { posten: Posten[]; art?: string }) {
  return (
    <>
      {posten.map((p) => (
        <tbody key={p.titel}>
          <tr className="bg-paper/60"><td colSpan={2} className="font-semibold">{art ? `${art} ` : ''}{p.titel}</td><td className="text-right font-semibold"><Money cents={p.summe} /></td></tr>
          {p.konten.map((k) => <tr key={k.number + k.name}><td className="num w-20 text-muted">{k.number}</td><td>{k.name}</td><td className="text-right"><Money cents={k.betrag} /></td></tr>)}
        </tbody>
      ))}
    </>
  );
}

export default async function GuvBilanz({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole('buchhaltung');
  const { von, bis } = zeitraum(await searchParams);
  const [guv, b] = await Promise.all([erfolgsrechnung(von, bis), bilanz(bis)]);
  return (
    <>
      <ZeitraumFilter von={von} bis={bis} label="Zeitraum der Erfolgsrechnung, Bilanzstichtag ist das Bis-Datum" />
      <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-warn">Vorläufig: ohne Abschlussbuchungen (Abschreibungen, Abgrenzungen, Rückstellungen, Körperschaftsteuer). Gliederung vereinfacht nach UGB; maßgeblich ist der Jahresabschluss der Steuerberatung.</p>
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="card relative" aria-labelledby="h-guv">
          <h2 id="h-guv" className="h2 px-5 pt-4">Erfolgsrechnung (GuV) {fmtTagStr(von)} bis {fmtTagStr(bis)}</h2>
          <table className="table mt-3">
            <caption className="sr-only">Erträge und Aufwendungen je Posten</caption>
            <PostenListe posten={guv.posten} />
            <tfoot>
              <tr><td colSpan={2} className="px-4 py-1.5">Erträge</td><td className="px-4 text-right"><Money cents={guv.ertraege} /></td></tr>
              <tr><td colSpan={2} className="px-4 py-1.5">Aufwendungen</td><td className="px-4 text-right"><Money cents={-guv.aufwand} /></td></tr>
              <tr className="font-semibold"><td colSpan={2} className="px-4 py-2.5">{guv.ergebnis >= 0 ? 'Gewinn' : 'Verlust'} (vorläufig)</td><td className="px-4 text-right"><Money cents={guv.ergebnis} colored /></td></tr>
            </tfoot>
          </table>
        </section>
        <section className="card relative" aria-labelledby="h-bil">
          <h2 id="h-bil" className="h2 px-5 pt-4">Bilanz zum {fmtTagStr(bis)}</h2>
          <p className="px-5 text-sm text-muted">Ergebnis des laufenden Geschäftsjahres ab {fmtTagStr(b.gjBeginn)} im Eigenkapital.</p>
          <table className="table mt-3">
            <caption className="sr-only">Aktiva</caption>
            <thead><tr><th colSpan={2}>Aktiva</th><th className="text-right">Betrag</th></tr></thead>
            <PostenListe posten={b.aktiva} />
            <tfoot><tr className="font-semibold"><td colSpan={2} className="px-4 py-2.5">Summe Aktiva</td><td className="px-4 text-right"><Money cents={b.summeA} /></td></tr></tfoot>
          </table>
          <table className="table mt-4">
            <caption className="sr-only">Passiva</caption>
            <thead><tr><th colSpan={2}>Passiva</th><th className="text-right">Betrag</th></tr></thead>
            <PostenListe posten={b.passiva} />
            <tfoot>
              <tr className="font-semibold"><td colSpan={2} className="px-4 py-2.5">Summe Passiva</td><td className="px-4 text-right"><Money cents={b.summeP} /></td></tr>
              <tr><td colSpan={3} className={`px-4 py-2 text-sm ${b.summeA === b.summeP ? 'text-pos' : 'text-neg'}`}>{b.summeA === b.summeP ? 'Kontrolle: Aktiva = Passiva.' : 'Achtung: Aktiva und Passiva weichen ab.'}</td></tr>
            </tfoot>
          </table>
        </section>
      </div>
    </>
  );
}
