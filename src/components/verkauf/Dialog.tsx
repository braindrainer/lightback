'use client';
// Modaler Dialog (natives <dialog>): Fokus bleibt im Dialog, Escape schließt, Fokus kehrt zum Auslöser zurück
import { useEffect, useId, useRef, useState } from 'react';

export function DialogKnopf({ titel, knopf, knopfKlasse = 'btn-secondary', children, breit, versteckt }: { titel: string; knopf: React.ReactNode; knopfKlasse?: string; children: React.ReactNode | ((schliessen: () => void) => React.ReactNode); breit?: boolean; versteckt?: boolean }) {
  const [offen, setOffen] = useState(false);
  const d = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const el = d.current;
    if (!el) return;
    if (offen && !el.open) el.showModal();
    if (!offen && el.open) el.close();
  }, [offen]);
  const schliessen = () => setOffen(false);
  return (
    <>
      {/* versteckt: Aktion nicht mehr möglich, ein offener Dialog bleibt aber mit seinem Ergebnis stehen */}
      {!versteckt && <button type="button" className={knopfKlasse} onClick={() => setOffen(true)} aria-haspopup="dialog">{knopf}</button>}
      <dialog ref={d} aria-labelledby={id} onClose={() => setOffen(false)}
        className={`m-auto w-[calc(100vw-1.5rem)] ${breit ? 'max-w-5xl' : 'max-w-lg'} rounded-xl border border-line bg-card p-0 text-ink shadow-2xl backdrop:bg-nacht/60`}>
        {offen && (
          <div className="grid gap-4 p-5">
            <div className="flex items-start justify-between gap-3">
              <h2 id={id} className="h2 text-lg">{titel}</h2>
              <button type="button" onClick={schliessen} className="btn-secondary btn-sm" aria-label="Dialog schließen">Schließen</button>
            </div>
            {typeof children === 'function' ? children(schliessen) : children}
          </div>
        )}
      </dialog>
    </>
  );
}
