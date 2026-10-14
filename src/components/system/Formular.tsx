'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

/** Ergebnis einer Server Action: Meldung, Fehler, einmalig anzuzeigendes Geheimnis */
export type Ergebnis = { ok?: string; fehler?: string; geheim?: { label: string; wert: string; hinweis?: string }; html?: string } | null;
type Aktion = (prev: Ergebnis, fd: FormData) => Promise<Ergebnis>;

function Knopf({ text, variante, bestaetigen }: { text: string; variante: string; bestaetigen?: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={variante} disabled={pending} aria-disabled={pending}
      onClick={(e) => { if (bestaetigen && !confirm(bestaetigen)) e.preventDefault(); }}>
      {pending ? 'Bitte warten …' : text}
    </button>
  );
}

export function Geheimnis({ label, wert, hinweis }: { label: string; wert: string; hinweis?: string }) {
  const [kopiert, setKopiert] = useState(false);
  return (
    <div className="rounded-lg border-2 border-accent bg-accent-soft p-3">
      <p className="text-sm font-semibold">{label}</p>
      <p className="mt-1 text-xs text-ink">{hinweis ?? 'Wird nur jetzt angezeigt. Bitte sicher speichern oder weitergeben.'}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="break-all rounded bg-white px-2 py-1.5 font-mono text-sm">{wert}</code>
        <button type="button" className="btn-secondary btn-sm" onClick={() => { navigator.clipboard?.writeText(wert).then(() => setKopiert(true)); }}>{kopiert ? 'Kopiert' : 'Kopieren'}</button>
      </div>
    </div>
  );
}

/** Formular mit Server Action, Statusmeldung (role=status/alert) und Sende-Knopf */
export function Formular({ action, knopf, variante = 'btn-primary', bestaetigen, children, className = '', zuruecksetzen = false, id }: {
  action: Aktion; knopf: string; variante?: string; bestaetigen?: string; children?: React.ReactNode; className?: string; zuruecksetzen?: boolean; id?: string;
}) {
  const [erg, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (erg?.ok && zuruecksetzen) ref.current?.reset(); }, [erg, zuruecksetzen]);
  return (
    <form ref={ref} action={formAction} className={className} id={id}>
      {children}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Knopf text={knopf} variante={variante} bestaetigen={bestaetigen} />
        <p role="status" aria-live="polite" className="text-sm text-pos">{erg?.ok ?? ''}</p>
      </div>
      {erg?.fehler && <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-neg">{erg.fehler}</p>}
      {erg?.geheim && <div className="mt-3"><Geheimnis {...erg.geheim} /></div>}
    </form>
  );
}
