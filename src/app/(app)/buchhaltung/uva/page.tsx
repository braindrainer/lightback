import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { uva } from '@/lib/finanzen/auswertung';
import { uvaStatus } from '@/lib/finanzen/buchhaltung';
import { ohneVerrechnung, STEUERKONTEN, VORSTEUER } from '@/lib/finanzen/uva';
import { fmtBuchDatum, fmtTagStr, heute, letzterTag, monatName, uvaFaellig } from '@/lib/finanzen/zeitraum';
import { STEUERCODES } from '@/lib/ledger';
import { Formular, Senden } from '@/components/finanzen/Formular';
import { Money } from '@/components/ui';
import { uvaBuchenAktion } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'UVA – Buchhaltung' };

type Zeile = Awaited<ReturnType<typeof uva>>['zeilen'][number];

function Zeilen({ zeilen, titel }: { zeilen: Zeile[]; titel: string }) {
  if (!zeilen.length) return <p className="px-4 pb-3 text-sm text-muted">Keine Buchungen.</p>;
  return (
    <table className="table">
      <caption className="sr-only">{titel}</caption>
      <thead><tr><th>Datum</th><th>Nr.</th><th>Text</th><th>Konto</th><th>Code</th><th className="text-right">Soll</th><th className="text-right">Haben</th><th className="text-right">BMG</th></tr></thead>
      <tbody>{zeilen.map((l) => (
        <tr key={l.id}>
          <td className="whitespace-nowrap">{fmtBuchDatum(l.entry.date)}</td>
          <td className="num"><Link href={`/buchhaltung?nr=${l.entry.number}`} className="underline underline-offset-4">{l.entry.number}</Link></td>
          <td>{l.entry.text}</td><td className="num">{l.account.number}</td><td>{l.vatCode ?? ''}</td>
          <td className="text-right">{l.debitCents ? <Money cents={l.debitCents} /> : ''}</td>
          <td className="text-right">{l.creditCents ? <Money cents={l.creditCents} /> : ''}</td>
          <td className="text-right">{l.baseCents != null ? <Money cents={l.baseCents} /> : ''}</td>
        </tr>))}
      </tbody>
    </table>
  );
}

export default async function Uva({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole('buchhaltung');
  const sp = await searchParams;
  const quartal = /^\d{4}-Q[1-4]$/.test(sp.quartal ?? '') ? sp.quartal! : '';
  const monat = !quartal && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.monat ?? '') ? sp.monat! : (!quartal ? heute().slice(0, 7) : '');
  let von: string, bis: string, titel: string, letzterMonat: string;
  if (quartal) {
    const j = Number(quartal.slice(0, 4));
    const q = Number(quartal.slice(6));
    const m1 = (q - 1) * 3 + 1;
    von = `${j}-${String(m1).padStart(2, '0')}-01`;
    letzterMonat = `${j}-${String(m1 + 2).padStart(2, '0')}`;
    bis = `${letzterMonat}-${letzterTag(j, m1 + 2)}`;
    titel = `${q}. Quartal ${j}`;
  } else {
    const [j, m] = monat.split('-').map(Number);
    von = `${monat}-01`;
    bis = `${monat}-${String(letzterTag(j, m)).padStart(2, '0')}`;
    titel = monatName(monat);
    letzterMonat = monat;
  }
  const { ergebnis: e, zeilen } = await uva(von, bis);
  const gebucht = monat ? await uvaStatus(monat) : null;
  const relevant = ohneVerrechnung(zeilen.map((l) => ({ ...l, konto: l.account.number })));
  const jahr = Number((monat || quartal).slice(0, 4));
  return (
    <>
      <div className="card relative mb-4 flex flex-wrap items-end gap-3 p-4">
        <form className="flex flex-wrap items-end gap-2" aria-label="Monat wählen">
          <div><label className="label" htmlFor="u-monat">Monat</label><input id="u-monat" type="month" name="monat" defaultValue={monat || letzterMonat} className="input" /></div>
          <button className="btn-secondary">Anzeigen</button>
        </form>
        <form className="flex flex-wrap items-end gap-2" aria-label="Quartal wählen">
          <div><label className="label" htmlFor="u-q">Quartal</label><select id="u-q" name="quartal" defaultValue={quartal} className="input">{[jahr - 1, jahr].flatMap((j) => [1, 2, 3, 4].map((q) => <option key={`${j}-${q}`} value={`${j}-Q${q}`}>{q}. Quartal {j}</option>))}</select></div>
          <button className="btn-secondary">Anzeigen</button>
        </form>
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <section className="card relative" aria-labelledby="h-uva">
          <h2 id="h-uva" className="h2 px-5 pt-4">Umsatzsteuervoranmeldung {titel} <span className="text-sm font-normal text-muted">(vorläufig)</span></h2>
          <p className="px-5 text-sm text-muted">{fmtTagStr(von)} bis {fmtTagStr(bis)} · Soll-Versteuerung; Ticket-Vorverkauf mit Mindest-Istbesteuerung im Zahlungsmonat. Fällig am {fmtTagStr(uvaFaellig(letzterMonat))}.</p>
          <table className="table mt-3">
            <thead><tr><th>KZ</th><th>Bezeichnung</th><th className="text-right">Bemessungsgrundlage</th><th className="text-right">Steuer</th></tr></thead>
            <tbody>
              <tr className="font-semibold"><td className="num">000</td><td>Gesamtbetrag der Bemessungsgrundlagen (Lieferungen und sonstige Leistungen)</td><td className="text-right"><Money cents={e.kz000} /></td><td /></tr>
              {e.saetze.map((s) => (
                <tr key={s.kz}><td className="num">{s.kz}</td><td>Davon steuerpflichtig mit {s.satz} %<div className="text-xs text-muted">gebucht auf {s.konto}: <Money cents={s.gebucht} /></div></td><td className="text-right"><Money cents={s.base} /></td><td className="text-right"><Money cents={s.berechnet} /></td></tr>
              ))}
              <tr><td className="num">060</td><td>Gesamtbetrag der Vorsteuern<div className="text-xs text-muted">Bemessungsgrundlage der Eingangsrechnungen: <Money cents={e.vorsteuerBasis} /></div></td><td /><td className="text-right"><Money cents={-e.vorsteuer} /></td></tr>
            </tbody>
            <tfoot>
              <tr className="font-semibold"><td className="num px-4 py-2.5">095</td><td className="px-4">{e.zahllast >= 0 ? 'Zahllast' : 'Gutschrift (Überschuss)'}</td><td /><td className="px-4 text-right"><Money cents={e.zahllast} /></td></tr>
            </tfoot>
          </table>
          {e.differenzen.length > 0 && <div className="mx-5 mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-warn"><p className="font-semibold">Abweichung zwischen Bemessungsgrundlage und gebuchter Steuer</p><ul className="ml-4 list-disc">{e.differenzen.map((d) => <li key={d}>{d}</li>)}</ul></div>}
          <p className="px-5 pb-4 text-xs text-muted">Zahllast aus der gebuchten Steuer (Steuerkonten), Kennzahlen aus den Bemessungsgrundlagen der Buchungen mit Steuercode. Die Umbuchung auf 3540 („UVA buchen“) zählt nicht mit.</p>
        </section>
        <aside className="grid content-start gap-5" aria-label="UVA buchen">
          {monat ? (
            <section className="card relative p-5" aria-labelledby="h-ub">
              <h2 id="h-ub" className="h2 mb-2">UVA buchen</h2>
              {gebucht ? (
                <p className="text-sm">Gebucht mit <Link href={`/buchhaltung?nr=${gebucht.number}`} className="underline underline-offset-4">Nr. {gebucht.number}</Link> am {fmtBuchDatum(gebucht.date)}. Nach Korrekturen: diese Buchung im Journal stornieren und neu buchen.</p>
              ) : (
                <>
                  <p className="mb-3 text-sm text-muted">Bucht die Umsatzsteuer- und Vorsteuersalden des Monats auf 3540 Verrechnung Finanzamt (Stichtag Monatsletzter). Die Zahlung ans Finanzamt dann im Bankabgleich auf 3540 buchen.</p>
                  <Formular action={uvaBuchenAktion.bind(null, monat)} bestaetigen={`UVA ${monatName(monat)} buchen?`}><Senden>UVA {monatName(monat)} buchen</Senden></Formular>
                </>
              )}
            </section>
          ) : <p className="card p-5 text-sm text-muted">Bei Quartalszahlern wird die Umbuchung je Monat gebucht – bitte den Monat wählen.</p>}
        </aside>
      </div>
      <section className="card relative mt-6" aria-labelledby="h-drill">
        <h2 id="h-drill" className="h2 px-5 pt-4">Buchungen zu den Kennzahlen</h2>
        {e.saetze.map((s) => {
          const z = relevant.filter((l) => l.vatCode === s.code || l.konto === s.konto);
          return <details key={s.kz} className="border-t border-line first-of-type:mt-3"><summary className="cursor-pointer px-5 py-3 font-medium">KZ {s.kz} – {s.satz} % ({z.length} Zeilen)</summary><Zeilen zeilen={z} titel={`Buchungen zu KZ ${s.kz}`} /></details>;
        })}
        <details className="border-t border-line"><summary className="cursor-pointer px-5 py-3 font-medium">KZ 060 – Vorsteuer ({relevant.filter((l) => l.konto === VORSTEUER || (l.vatCode && STEUERCODES[l.vatCode]?.art === 'V' && !STEUERKONTEN.has(l.konto))).length} Zeilen)</summary>
          <Zeilen zeilen={relevant.filter((l) => l.konto === VORSTEUER || (l.vatCode && STEUERCODES[l.vatCode]?.art === 'V' && !STEUERKONTEN.has(l.konto)))} titel="Buchungen zu KZ 060" />
        </details>
      </section>
    </>
  );
}
