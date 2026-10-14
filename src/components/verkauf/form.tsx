'use client';
// Formulare mit Server Action: Meldungen barrierefrei (role="alert" bzw. "status"), Knopf mit Ladezustand
import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { toast } from '@/components/ui-client';
import type { Ergebnis } from './ergebnis';

export function Meldung({ e, id }: { e?: Ergebnis; id?: string }) {
  if (e?.fehler) return <p id={id} role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-neg">{e.fehler}</p>;
  if (e?.meldung) return <p id={id} role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-pos">{e.meldung}</p>;
  return <p id={id} role="status" className="sr-only" />;
}

export function Absenden({ children, className = 'btn-primary', name, value, disabled }: { children: React.ReactNode; className?: string; name?: string; value?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" name={name} value={value} className={className} disabled={pending || disabled} aria-disabled={pending || disabled}>{pending ? 'Bitte warten …' : children}</button>;
}

type Aktion = (prev: Ergebnis, fd: FormData) => Promise<Ergebnis>;

/** Formular, das eine Server Action ausführt und das Ergebnis darunter anzeigt */
/** leise: Ergebnis als Toast statt als Meldung unter dem Formular (für Knöpfe in Kopfzeilen) */
export function AktionForm({ action, children, className = 'grid gap-4', zuruecksetzen, onErfolg, leise, ...rest }: { action: Aktion; children: React.ReactNode; className?: string; zuruecksetzen?: boolean; onErfolg?: (e: Ergebnis) => void; leise?: boolean } & Omit<React.FormHTMLAttributes<HTMLFormElement>, 'action' | 'children' | 'className'>) {
  const [e, formAction] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (leise && (e.fehler || e.meldung)) toast(e.fehler ?? e.meldung!, e.fehler ? 'fehler' : 'ok');
    if (e.ok && !e.fehler) {
      if (zuruecksetzen) ref.current?.reset();
      onErfolg?.(e);
    }
  }, [e]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <form ref={ref} action={formAction} className={className} {...rest}>
      {children}
      {!leise && <Meldung e={e} />}
    </form>
  );
}
