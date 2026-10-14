'use client';
import { useActionState, useEffect, useState } from 'react';
import type { Ergebnis } from '@/lib/finanzen/aktion';
import { formatEur } from '@/lib/money';
import { Meldung, Senden } from './Formular';

type Konto = { number: string; name: string; vatCode: string | null };
type Zeile = { key: number; konto: string; soll: string; haben: string; vatCode: string; brutto: boolean };

const cent = (s: string) => {
  const t = s.trim().replace(/\s|€/g, '');
  if (!t) return 0;
  const last = Math.max(t.lastIndexOf(','), t.lastIndexOf('.'));
  const n = last >= 0 && /^\d{1,2}$/.test(t.slice(last + 1)) ? Number(t.slice(0, last).replace(/[.,]/g, '') + '.' + t.slice(last + 1)) : Number(t.replace(/[.,]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
const leer = (key: number): Zeile => ({ key, konto: '', soll: '', haben: '', vatCode: '', brutto: true });

export function BuchungsFormular({ action, konten, codes, heute }: { action: (p: Ergebnis, fd: FormData) => Promise<Ergebnis>; konten: Konto[]; codes: Record<string, string>; heute: string }) {
  const [st, formAction] = useActionState(action, null);
  const [zeilen, setZeilen] = useState<Zeile[]>([leer(1), leer(2)]);
  const [hinweis, setHinweis] = useState('');
  useEffect(() => { if (st?.ok) setZeilen([leer(1), leer(2)]); }, [st]);
  const aendern = (k: number, f: Partial<Zeile>) => setZeilen((z) => z.map((x) => {
    if (x.key !== k) return x;
    const n = { ...x, ...f };
    if (f.konto !== undefined) {
      const kt = konten.find((y) => y.number === (f.konto ?? '').trim().match(/^\d+/)?.[0]);
      if (kt && !x.vatCode) n.vatCode = kt.vatCode ?? '';
    }
    return n;
  }));
  const soll = zeilen.reduce((s, z) => s + (cent(z.soll) || 0), 0);
  const haben = zeilen.reduce((s, z) => s + (cent(z.haben) || 0), 0);
  const diff = soll - haben;
  const nameVon = (s: string) => konten.find((k) => k.number === s.trim().match(/^\d+/)?.[0])?.name;
  return (
    <form action={formAction} className="grid gap-4" onSubmit={(e) => {
      const fehler = zeilen.some((z) => Number.isNaN(cent(z.soll)) || Number.isNaN(cent(z.haben))) ? 'Ein Betrag ist ungültig.'
        : diff !== 0 ? `Die Buchung ist nicht ausgeglichen (Differenz ${formatEur(Math.abs(diff))}).`
        : zeilen.some((z) => z.konto && !nameVon(z.konto)) ? 'Ein Konto gibt es nicht.' : '';
      setHinweis(fehler);
      if (fehler) e.preventDefault();
    }}>
      <div className="card grid gap-3 p-5 sm:grid-cols-[160px_1fr_180px]">
        <div><label className="label" htmlFor="b-datum">Buchungsdatum</label><input id="b-datum" name="datum" type="date" required defaultValue={heute} className="input" /></div>
        <div><label className="label" htmlFor="b-text">Buchungstext</label><input id="b-text" name="text" required minLength={2} maxLength={200} className="input" /></div>
        <div><label className="label" htmlFor="b-beleg">Beleg-Nr.</label><input id="b-beleg" name="beleg" maxLength={60} className="input" /></div>
      </div>
      <datalist id="kontenliste">{konten.map((k) => <option key={k.number} value={k.number}>{k.number} {k.name}</option>)}</datalist>
      <fieldset className="card p-5">
        <legend className="h2 px-1">Zeilen</legend>
        <p className="mb-3 text-xs text-muted">Konto per Nummer oder Name suchen. Mit Steuercode und „Brutto“ wird die Steuer automatisch auf das Steuerkonto abgespalten; ohne „Brutto“ ist der Betrag die Bemessungsgrundlage und die Steuerzeile wird selbst erfasst.</p>
        <div className="grid gap-3">
          {zeilen.map((z, i) => (
            <div key={z.key} role="group" aria-label={`Zeile ${i + 1}`} className="grid items-end gap-2 border-b border-line/70 pb-3 md:grid-cols-[1.4fr_120px_120px_1fr_auto_auto]">
              <div><label className="label" htmlFor={`k-${z.key}`}>Konto</label><input id={`k-${z.key}`} list="kontenliste" className="input num" value={z.konto} onChange={(e) => aendern(z.key, { konto: e.target.value })} required aria-describedby={`kn-${z.key}`} autoComplete="off" />
                <p id={`kn-${z.key}`} className="mt-0.5 min-h-4 truncate text-xs text-muted">{z.konto ? (nameVon(z.konto) ?? 'unbekanntes Konto') : ''}</p></div>
              <div><label className="label" htmlFor={`s-${z.key}`}>Soll €</label><input id={`s-${z.key}`} inputMode="decimal" className="input num" value={z.soll} onChange={(e) => aendern(z.key, { soll: e.target.value, haben: e.target.value ? '' : z.haben })} /><p className="min-h-4" /></div>
              <div><label className="label" htmlFor={`h-${z.key}`}>Haben €</label><input id={`h-${z.key}`} inputMode="decimal" className="input num" value={z.haben} onChange={(e) => aendern(z.key, { haben: e.target.value, soll: e.target.value ? '' : z.soll })} /><p className="min-h-4" /></div>
              <div><label className="label" htmlFor={`c-${z.key}`}>Steuercode</label><select id={`c-${z.key}`} className="input" value={z.vatCode} onChange={(e) => aendern(z.key, { vatCode: e.target.value })}><option value="">ohne</option>{Object.entries(codes).map(([c, t]) => <option key={c} value={c}>{t}</option>)}</select><p className="min-h-4" /></div>
              <div className="pb-5"><label className="inline-flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={z.brutto} disabled={!z.vatCode} onChange={(e) => aendern(z.key, { brutto: e.target.checked })} />Brutto</label></div>
              <div className="pb-5"><button type="button" className="btn-secondary" disabled={zeilen.length <= 2} onClick={() => setZeilen((x) => x.filter((y) => y.key !== z.key))}>Entfernen<span className="sr-only"> Zeile {i + 1}</span></button></div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <button type="button" className="btn-secondary" onClick={() => setZeilen((x) => [...x, leer(Math.max(...x.map((y) => y.key)) + 1)])}>Zeile hinzufügen</button>
          <p className="text-sm" aria-live="polite">Soll <strong className="num">{formatEur(soll)}</strong> · Haben <strong className="num">{formatEur(haben)}</strong> · {diff === 0 ? <span className="text-pos">ausgeglichen</span> : <span className="text-neg">Differenz {formatEur(Math.abs(diff))}</span>}</p>
        </div>
      </fieldset>
      <input type="hidden" name="zeilen" value={JSON.stringify(zeilen.filter((z) => z.konto || z.soll || z.haben).map((z) => ({ konto: z.konto, soll: z.soll, haben: z.haben, vatCode: z.vatCode || null, brutto: !!z.vatCode && z.brutto })))} />
      <div><Senden>Buchen</Senden></div>
      {hinweis && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-neg">{hinweis}</p>}
      <Meldung st={st} />
    </form>
  );
}
