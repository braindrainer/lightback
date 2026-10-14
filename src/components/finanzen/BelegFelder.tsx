'use client';
import { useState } from 'react';
import { formatEur } from '@/lib/money';

const cent = (s: string) => { const n = Number(s.trim().replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) : 0; };

/** Beträge eines Eingangsbelegs: aus Brutto und Steuersatz wird Netto/USt berechnet (USt überschreibbar) */
export function BelegFelder({ konten, heute }: { konten: { number: string; name: string; vatCode: string | null }[]; heute: string }) {
  const [brutto, setBrutto] = useState('');
  const [satz, setSatz] = useState('20');
  const [ust, setUst] = useState('');
  const b = cent(brutto);
  const r = Number(satz);
  const auto = r ? b - Math.round(b / (1 + r / 100)) : 0;
  const u = ust.trim() ? cent(ust) : auto;
  return (
    <>
      <div className="min-w-56 flex-1"><label className="label" htmlFor="e-lief">Lieferant *</label><input id="e-lief" name="supplier" required className="input" /></div>
      <div><label className="label" htmlFor="e-nr">Rechnungsnummer</label><input id="e-nr" name="docNumber" className="input" /></div>
      <div><label className="label" htmlFor="e-dat">Rechnungsdatum *</label><input id="e-dat" name="docDate" type="date" required defaultValue={heute} className="input" /></div>
      <div><label className="label" htmlFor="e-due">Fällig am</label><input id="e-due" name="dueDate" type="date" className="input" /></div>
      <div><label className="label" htmlFor="e-kto">Aufwandskonto *</label><select id="e-kto" name="accountNumber" required className="input" onChange={(e) => { const k = konten.find((x) => x.number === e.target.value); if (k) setSatz(k.vatCode ? k.vatCode.slice(1) : '0'); }}>{konten.map((k) => <option key={k.number} value={k.number}>{k.number} {k.name}</option>)}</select></div>
      <div><label className="label" htmlFor="e-brutto">Bruttobetrag € *</label><input id="e-brutto" name="gross" required inputMode="decimal" className="input num w-36" value={brutto} onChange={(e) => setBrutto(e.target.value)} /></div>
      <div><label className="label" htmlFor="e-satz">USt-Satz</label><select id="e-satz" name="vatRate" className="input" value={satz} onChange={(e) => { setSatz(e.target.value); setUst(''); }}><option value="20">20 %</option><option value="13">13 %</option><option value="10">10 %</option><option value="0">0 % / keine Vorsteuer</option></select></div>
      <div><label className="label" htmlFor="e-ust">USt € (berechnet)</label><input id="e-ust" name="vat" inputMode="decimal" className="input num w-32" value={ust} placeholder={(auto / 100).toFixed(2).replace('.', ',')} onChange={(e) => setUst(e.target.value)} aria-describedby="e-ust-h" /><p id="e-ust-h" className="mt-1 text-xs text-muted">Nur ändern, wenn der Beleg anders rundet.</p></div>
      <p className="basis-full text-sm" aria-live="polite">Netto <strong className="num">{formatEur(b - u)}</strong> · Vorsteuer <strong className="num">{formatEur(u)}</strong> · Brutto <strong className="num">{formatEur(b)}</strong></p>
      <div><label className="label" htmlFor="e-datei">Datei (PDF oder Bild)</label><input id="e-datei" name="datei" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="input" /></div>
      <div className="min-w-56 flex-1"><label className="label" htmlFor="e-notiz">Notiz</label><input id="e-notiz" name="note" className="input" /></div>
    </>
  );
}
