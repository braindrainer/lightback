'use client';
// Modaler Dialog (natives <dialog>): Fokus bleibt im Dialog, Escape schließt, Fokus kehrt zum Auslöser zurück
import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '@/components/icons';

export function DialogKnopf({ titel, knopf, knopfKlasse = 'btn-secondary', children, breit, versteckt, anfangsOffen }: { titel: string; knopf: React.ReactNode; knopfKlasse?: string; children: React.ReactNode | ((schliessen: () => void) => React.ReactNode); breit?: boolean; versteckt?: boolean; anfangsOffen?: boolean }) {
  const [offen, setOffen] = useState(!!anfangsOffen);
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
        className={`m-auto w-[calc(100vw-1.5rem)] ${breit ? 'max-w-5xl' : 'max-w-lg'} max-h-[92dvh] rounded-2xl border border-line bg-card p-0 text-ink shadow-schwebend backdrop:bg-nacht/60`}>
        {offen && (
          <div className="grid gap-4 p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <h2 id={id} className="text-lg font-semibold">{titel}</h2>
              <button type="button" onClick={schliessen} className="-mr-2 -mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-paper-deep hover:text-ink" aria-label="Dialog schließen"><Icon name="x" className="h-5 w-5" /></button>
            </div>
            {typeof children === 'function' ? children(schliessen) : children}
          </div>
        )}
      </dialog>
    </>
  );
}
