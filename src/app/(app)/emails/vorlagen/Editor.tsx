'use client';
import { useState, useTransition } from 'react';
import type { Ergebnis } from '@/components/system/Formular';
import { testmail, vorlageSpeichern, vorlageZuruecksetzen, vorschau } from '../actions';

export function Editor({ k, subject, body, standard, angepasst }: { k: string; subject: string; body: string; standard: { subject: string; body: string }; angepasst: boolean }) {
  const [betreff, setBetreff] = useState(subject);
  const [text, setText] = useState(body);
  const [erg, setErg] = useState<Ergebnis>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [laeuft, start] = useTransition();
  const tu = (f: () => Promise<Ergebnis>) => start(async () => { const r = await f(); setErg(r); if (r?.html) setHtml(r.html); });
  return (
    <div className="grid gap-3">
      <div><label htmlFor={`${k}-betreff`} className="label">Betreff</label><input id={`${k}-betreff`} value={betreff} onChange={(e) => setBetreff(e.target.value)} className="input" maxLength={200} /></div>
      <div><label htmlFor={`${k}-text`} className="label">Text (HTML mit Platzhaltern)</label><textarea id={`${k}-text`} value={text} onChange={(e) => setText(e.target.value)} rows={10} className="input font-mono text-[13px]" spellCheck={false} /></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" disabled={laeuft} onClick={() => tu(() => vorlageSpeichern(k, betreff, text))}>Speichern</button>
        <button type="button" className="btn-secondary" disabled={laeuft} onClick={() => tu(() => vorschau(k, betreff, text))}>Vorschau</button>
        <button type="button" className="btn-secondary" disabled={laeuft} onClick={() => tu(() => testmail(k, betreff, text))}>Testmail an mich</button>
        {angepasst && <button type="button" className="btn-danger" disabled={laeuft} onClick={() => { if (confirm('Eigenen Text verwerfen und den Standardtext verwenden?')) tu(async () => { const r = await vorlageZuruecksetzen(k); if (r?.ok) { setBetreff(standard.subject); setText(standard.body); } return r; }); }}>Auf Standard zurücksetzen</button>}
      </div>
      <p role="status" aria-live="polite" className="text-sm text-pos">{laeuft ? 'Bitte warten …' : (erg?.ok ?? '')}</p>
      {erg?.fehler && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-neg">{erg.fehler}</p>}
      {html && <iframe title={`Vorschau ${k}`} srcDoc={html} sandbox="" className="h-[560px] w-full rounded-lg border border-line bg-white" />}
    </div>
  );
}
