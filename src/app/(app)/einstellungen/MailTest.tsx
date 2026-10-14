'use client';
import { useState, useTransition } from 'react';
import type { Ergebnis } from '@/components/system/Formular';
import { mailTesten } from './actions';

export function MailTest() {
  const [erg, setErg] = useState<Ergebnis>(null);
  const [laeuft, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className="btn-secondary" disabled={laeuft} onClick={() => start(async () => setErg(await mailTesten()))}>{laeuft ? 'Prüfe …' : 'Verbindung testen'}</button>
      <p role="status" aria-live="polite" className="text-sm text-pos">{erg?.ok ?? ''}</p>
      {erg?.fehler && <p role="alert" className="w-full rounded-lg bg-red-50 px-3 py-2 text-sm text-neg">{erg.fehler}</p>}
    </div>
  );
}
