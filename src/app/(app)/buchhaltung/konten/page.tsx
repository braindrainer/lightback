import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { saldenliste, TYP_NAME } from '@/lib/finanzen/auswertung';
import { STEUERCODE_TEXT } from '@/lib/finanzen/texte';
import { zeitraum } from '@/lib/finanzen/zeitraum';
import { Formular, Senden } from '@/components/finanzen/Formular';
import { ZeitraumFilter } from '@/components/finanzen/Zeitraum';
import { Money } from '@/components/ui';
import { kontoAktivAktion, kontoAnlegenAktion } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Konten – Buchhaltung' };

export default async function Konten({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole('buchhaltung');
  const { von, bis } = zeitraum(await searchParams);
  const konten = await saldenliste(von, bis, true);
  return (
    <>
      <ZeitraumFilter von={von} bis={bis} label="Zeitraum für die Salden" />
      <section className="card relative mb-6" aria-labelledby="h-konten">
        <h2 id="h-konten" className="h2 px-5 pt-4">Kontenplan</h2>
        <p className="px-5 text-sm text-muted">Einheitskontenrahmen (EKR) – Vorschlag, mit der Steuerberatung abzustimmen. Systemkonten werden von Automatikbuchungen verwendet.</p>
        <table className="table mt-3">
          <thead><tr><th>Nummer</th><th>Bezeichnung</th><th>Art</th><th>Steuercode</th><th className="text-right">Soll</th><th className="text-right">Haben</th><th className="text-right">Saldo</th><th>Status</th></tr></thead>
          <tbody>
            {konten.map((k) => (
              <tr key={k.id} className={k.active ? '' : 'text-muted'}>
                <td className="num"><Link href={`/buchhaltung/konten/${k.number}?von=${von}&bis=${bis}`} className="font-medium underline underline-offset-4">{k.number}</Link></td>
                <td>{k.name}{k.system && <span className="pill ml-2 bg-gray-100 text-gray-700">System</span>}</td>
                <td>{TYP_NAME[k.type] ?? k.type}</td>
                <td>{k.vatCode ?? ''}</td>
                <td className="text-right"><Money cents={k.soll} /></td>
                <td className="text-right"><Money cents={k.haben} /></td>
                <td className="text-right"><Money cents={Math.abs(k.saldo)} /> <span className="text-xs text-muted">{k.saldo > 0 ? 'S' : k.saldo < 0 ? 'H' : ''}</span></td>
                <td>{k.system ? 'aktiv' : (
                  <Formular action={kontoAktivAktion.bind(null, k.id, !k.active)}><Senden className="btn-secondary btn-sm">{k.active ? 'Deaktivieren' : 'Aktivieren'}<span className="sr-only"> Konto {k.number}</span></Senden></Formular>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card relative p-5" aria-labelledby="h-neu">
        <h2 id="h-neu" className="h2 mb-3">Konto hinzufügen</h2>
        <Formular action={kontoAnlegenAktion} zuruecksetzen className="flex flex-wrap items-end gap-3">
          <div><label className="label" htmlFor="kn-nr">Nummer</label><input id="kn-nr" name="number" inputMode="numeric" pattern="\d{4,5}" required className="input w-28" /></div>
          <div className="min-w-56 flex-1"><label className="label" htmlFor="kn-name">Bezeichnung</label><input id="kn-name" name="name" required className="input" /></div>
          <div><label className="label" htmlFor="kn-typ">Art</label><select id="kn-typ" name="type" className="input" required><option value="aufwand">Aufwand</option><option value="ertrag">Ertrag</option><option value="aktiv">Aktivkonto</option><option value="passiv">Passivkonto</option></select></div>
          <div><label className="label" htmlFor="kn-st">Standard-Steuercode</label><select id="kn-st" name="vatCode" className="input"><option value="">ohne</option>{Object.entries(STEUERCODE_TEXT).map(([c, t]) => <option key={c} value={c}>{t}</option>)}</select></div>
          <Senden>Anlegen</Senden>
        </Formular>
      </section>
    </>
  );
}
