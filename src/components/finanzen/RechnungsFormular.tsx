'use client';
import { useActionState, useState } from 'react';
import type { Ergebnis } from '@/lib/finanzen/aktion';
import { formatEur } from '@/lib/money';
import { Meldung, Senden } from './Formular';

type Pos = { key: number; titel: string; menge: string; preis: string; satz: string };
const zahl = (s: string) => { const n = Number(s.replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };

export function RechnungsFormular({ action, heute, faellig }: { action: (p: Ergebnis, fd: FormData) => Promise<Ergebnis>; heute: string; faellig: string }) {
  const [st, formAction] = useActionState(action, null);
  const [pos, setPos] = useState<Pos[]>([{ key: 1, titel: '', menge: '1', preis: '', satz: '20' }]);
  const aendern = (k: number, f: Partial<Pos>) => setPos((p) => p.map((x) => (x.key === k ? { ...x, ...f } : x)));
  const jeSatz = new Map<number, number>();
  for (const p of pos) jeSatz.set(Number(p.satz), (jeSatz.get(Number(p.satz)) ?? 0) + Math.round(zahl(p.menge) * Math.round(zahl(p.preis) * 100)));
  const netto = [...jeSatz.values()].reduce((s, x) => s + x, 0);
  const ust = [...jeSatz.entries()].reduce((s, [r, n]) => s + Math.round((n * r) / 100), 0);
  const feld = (id: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> & { hilfe?: string }) => {
    const { hilfe, ...rest } = props;
    return <div><label className="label" htmlFor={id}>{label}</label><input id={id} className="input" aria-describedby={hilfe ? `${id}-h` : undefined} {...rest} />{hilfe && <p id={`${id}-h`} className="mt-1 text-xs text-muted">{hilfe}</p>}</div>;
  };
  return (
    <form action={formAction} className="grid gap-5">
      <fieldset className="card grid gap-3 p-5 sm:grid-cols-2">
        <legend className="h2 px-1">Empfänger:in</legend>
        {feld('r-company', 'Firma *', { name: 'company', required: true, autoComplete: 'organization' })}
        {feld('r-name', 'z. H. (Ansprechperson)', { name: 'name', autoComplete: 'name' })}
        {feld('r-street', 'Straße und Hausnummer', { name: 'street', autoComplete: 'street-address', hilfe: 'Über 400 € brutto Pflicht.' })}
        <div className="grid grid-cols-[110px_1fr] gap-3">
          {feld('r-zip', 'PLZ', { name: 'zip', autoComplete: 'postal-code' })}
          {feld('r-city', 'Ort', { name: 'city', autoComplete: 'address-level2' })}
        </div>
        {feld('r-country', 'Land', { name: 'country', defaultValue: 'Österreich', autoComplete: 'country-name' })}
        {feld('r-uid', 'UID-Nummer', { name: 'vatId', placeholder: 'ATU12345678', hilfe: 'Über 10.000 € brutto Pflicht.' })}
        {feld('r-email', 'E-Mail für den Versand', { name: 'email', type: 'email', autoComplete: 'email' })}
      </fieldset>
      <fieldset className="card grid gap-3 p-5 sm:grid-cols-3">
        <legend className="h2 px-1">Daten</legend>
        {feld('r-issue', 'Rechnungsdatum *', { name: 'issueDate', type: 'date', required: true, defaultValue: heute })}
        {feld('r-service', 'Leistungsdatum *', { name: 'serviceDate', type: 'date', required: true, defaultValue: heute, hilfe: 'Tag der Vorstellung bzw. Leistung.' })}
        {feld('r-due', 'Fällig am', { name: 'dueDate', type: 'date', defaultValue: faellig })}
      </fieldset>
      <fieldset className="card p-5">
        <legend className="h2 px-1">Positionen (Preise netto)</legend>
        <div className="grid gap-3">
          {pos.map((p, i) => (
            <div key={p.key} className="grid items-end gap-2 sm:grid-cols-[1fr_90px_130px_110px_auto]" role="group" aria-label={`Position ${i + 1}`}>
              <div><label className="label" htmlFor={`p-t-${p.key}`}>Bezeichnung</label><input id={`p-t-${p.key}`} name="titel" className="input" value={p.titel} onChange={(e) => aendern(p.key, { titel: e.target.value })} required /></div>
              <div><label className="label" htmlFor={`p-m-${p.key}`}>Menge</label><input id={`p-m-${p.key}`} name="menge" inputMode="decimal" className="input num" value={p.menge} onChange={(e) => aendern(p.key, { menge: e.target.value })} required /></div>
              <div><label className="label" htmlFor={`p-p-${p.key}`}>Einzelpreis € netto</label><input id={`p-p-${p.key}`} name="preis" inputMode="decimal" className="input num" value={p.preis} onChange={(e) => aendern(p.key, { preis: e.target.value })} placeholder="0,00" required /></div>
              <div><label className="label" htmlFor={`p-s-${p.key}`}>USt</label><select id={`p-s-${p.key}`} name="satz" className="input" value={p.satz} onChange={(e) => aendern(p.key, { satz: e.target.value })}><option value="20">20 %</option><option value="13">13 %</option><option value="10">10 %</option><option value="0">0 %</option></select></div>
              <button type="button" className="btn-secondary" onClick={() => setPos((x) => x.filter((y) => y.key !== p.key))} disabled={pos.length === 1}>Entfernen<span className="sr-only"> Position {i + 1}</span></button>
            </div>
          ))}
        </div>
        <button type="button" className="btn-secondary mt-3" onClick={() => setPos((x) => [...x, { key: Math.max(...x.map((y) => y.key)) + 1, titel: '', menge: '1', preis: '', satz: '20' }])}>Position hinzufügen</button>
        <dl className="mt-4 grid justify-end gap-1 text-right text-sm" aria-live="polite">
          <div className="flex justify-end gap-6"><dt className="text-muted">Netto</dt><dd className="num w-32">{formatEur(netto)}</dd></div>
          <div className="flex justify-end gap-6"><dt className="text-muted">USt</dt><dd className="num w-32">{formatEur(ust)}</dd></div>
          <div className="flex justify-end gap-6 font-semibold"><dt>Brutto</dt><dd className="num w-32">{formatEur(netto + ust)}</dd></div>
        </dl>
      </fieldset>
      <div className="card p-5"><label className="label" htmlFor="r-note">Hinweis auf der Rechnung</label><textarea id="r-note" name="note" rows={2} className="input" /></div>
      <div className="flex flex-wrap items-center gap-3">
        <Senden>Rechnung anlegen und buchen</Senden>
        <p className="text-sm text-muted">Die Rechnung bekommt die nächste fortlaufende Nummer und kann danach nicht mehr geändert, nur storniert werden.</p>
      </div>
      <Meldung st={st} />
    </form>
  );
}
