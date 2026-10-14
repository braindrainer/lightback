'use client';
import { createContext, useActionState, useContext, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { Ergebnis } from '@/lib/finanzen/aktion';

type Aktion = (prev: Ergebnis, fd: FormData) => Promise<Ergebnis>;

// Erfolgsmeldungen bleiben stehen, auch wenn das Formular nach dem Speichern verschwindet (z. B. erledigte Zeile)
const MeldungCtx = createContext<((m: string) => void) | null>(null);

export function Meldungsbereich({ children }: { children: React.ReactNode }) {
  const [m, setM] = useState('');
  return (
    <MeldungCtx.Provider value={setM}>
      {children}
      <div className="pointer-events-none fixed inset-x-3 bottom-3 z-40 flex justify-end sm:inset-x-6">
        <div role="status" className={m ? 'pointer-events-auto flex max-w-xl items-start gap-3 rounded-lg bg-nacht px-4 py-3 text-sm text-white shadow-lg' : 'sr-only'}>
          <span>{m}</span>
          {m && <button type="button" onClick={() => setM('')} className="min-h-6 rounded px-1 text-gold underline underline-offset-4">Schließen</button>}
        </div>
      </div>
    </MeldungCtx.Provider>
  );
}

/** Formular mit Server Action und Rückmeldung (Fehler als role="alert", Erfolg als role="status") */
export function Formular({ action, children, className, zuruecksetzen, bestaetigen, id }: { action: Aktion; children: React.ReactNode; className?: string; zuruecksetzen?: boolean; bestaetigen?: string; id?: string }) {
  const melden = useContext(MeldungCtx);
  const [st, formAction] = useActionState<Ergebnis, FormData>(async (p, fd) => {
    const r = await action(p, fd);
    if (r?.ok && melden) melden(r.ok);
    return r;
  }, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (st?.ok && zuruecksetzen) ref.current?.reset(); }, [st, zuruecksetzen]);
  return (
    <form ref={ref} id={id} action={formAction} className={className} onSubmit={(e) => { if (bestaetigen && !window.confirm(bestaetigen)) e.preventDefault(); }}>
      {children}
      <Meldung st={melden && st?.ok ? null : st} />
    </form>
  );
}

export function Meldung({ st }: { st: Ergebnis }) {
  return (
    <>
      <p role="alert" className={st?.fehler ? 'mt-2 basis-full rounded-lg bg-red-50 px-3 py-2 text-sm text-neg' : 'sr-only'}>{st?.fehler ?? ''}</p>
      <p role="status" className={st?.ok ? 'mt-2 basis-full rounded-lg bg-emerald-50 px-3 py-2 text-sm text-pos' : 'sr-only'}>{st?.ok ?? ''}</p>
    </>
  );
}

export function Senden({ children, className = 'btn-primary', name, value }: { children: React.ReactNode; className?: string; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" name={name} value={value} className={className} disabled={pending} aria-disabled={pending}>{pending ? 'Bitte warten …' : children}</button>;
}
