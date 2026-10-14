import type { Preise } from '@/lib/saal';
import { euroFeld } from './texte';

/** Preise je Kategorie in € (Felder I_normal, I_erm, II_normal, II_erm, R_normal) */
export default function PreisFelder({ preise, prefix = '' }: { preise: Preise; prefix?: string }) {
  const felder: [string, string, number][] = [
    ['I_normal', 'Kat. I Vollpreis', preise.I.normal], ['I_erm', 'Kat. I ermäßigt', preise.I.ermaessigt],
    ['II_normal', 'Kat. II Vollpreis', preise.II.normal], ['II_erm', 'Kat. II ermäßigt', preise.II.ermaessigt],
    ['R_normal', 'Rollstuhlplatz inkl. Begleitung', preise.R.normal],
  ];
  return (
    <fieldset className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <legend className="mb-2 text-sm font-semibold">Preise in Euro (brutto, inkl. 13 % USt)</legend>
      {felder.map(([n, l, c]) => (
        <div key={n}>
          <label htmlFor={`${prefix}${n}`} className="label">{l}</label>
          <input id={`${prefix}${n}`} name={n} defaultValue={euroFeld(c)} inputMode="decimal" required className="input num" />
        </div>
      ))}
    </fieldset>
  );
}
