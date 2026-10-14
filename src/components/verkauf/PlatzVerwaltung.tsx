'use client';
// Saalplan auf der Vorstellungsseite: Plätze sperren/entsperren, verkaufte Plätze öffnen die Bestellung
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { sitzName } from '@/lib/saal';
import type { Status } from '@/lib/seats';
import type { PlatzInfo } from './daten';
import type { Ergebnis } from './ergebnis';
import { Meldung } from './form';
import Saalplan from './Saalplan';
import { SPERRGRUENDE } from './texte';

export default function PlatzVerwaltung({ status, info, sperren, entsperren, bearbeitbar }: {
  status: Record<string, Status>; info: Record<string, PlatzInfo>;
  sperren: (ids: string[], grund: string) => Promise<Ergebnis>; entsperren: (ids: string[]) => Promise<Ergebnis>; bearbeitbar: boolean;
}) {
  const router = useRouter();
  const [auswahl, setAuswahl] = useState<string[]>([]);
  const [grund, setGrund] = useState<string>(SPERRGRUENDE[0]);
  const [e, setE] = useState<Ergebnis>();
  const [laeuft, start] = useTransition();
  const freie = auswahl.filter((id) => status[id] === 'frei');
  const gesperrte = auswahl.filter((id) => status[id] === 'gesperrt');
  const los = (f: () => Promise<Ergebnis>) => start(async () => {
    const r = await f();
    setE(r);
    if (!r.fehler) { setAuswahl([]); router.refresh(); }
  });
  return (
    <div className="grid gap-4">
      {bearbeitbar && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg bg-paper p-3" aria-label="Auswahl bearbeiten" role="group">
          <p className="min-w-48 flex-1 text-sm" aria-live="polite">
            {auswahl.length ? <><strong>{auswahl.length} {auswahl.length === 1 ? 'Platz' : 'Plätze'} gewählt:</strong> {auswahl.slice(0, 8).map(sitzName).join(' · ')}{auswahl.length > 8 ? ' …' : ''}</> : 'Wählen Sie freie oder gesperrte Plätze im Plan aus.'}
          </p>
          <div>
            <label htmlFor="sperrgrund" className="label">Grund der Sperre</label>
            <select id="sperrgrund" className="input" value={grund} onChange={(x) => setGrund(x.target.value)}>
              {SPERRGRUENDE.map((g) => <option key={g}>{g}</option>)}
            </select>
          </div>
          <button type="button" className="btn-primary" disabled={!freie.length || laeuft} onClick={() => los(() => sperren(freie, grund))}>{freie.length || ''} Sperren</button>
          <button type="button" className="btn-secondary" disabled={!gesperrte.length || laeuft} onClick={() => los(() => entsperren(gesperrte))}>{gesperrte.length || ''} Entsperren</button>
          <button type="button" className="btn-secondary" disabled={!auswahl.length} onClick={() => setAuswahl([])}>Auswahl aufheben</button>
          <div className="basis-full"><Meldung e={e} /></div>
        </div>
      )}
      <Saalplan status={status} info={info} modus="verwalten" auswahl={auswahl} onAuswahl={bearbeitbar ? setAuswahl : () => {}} onOeffnen={(id) => router.push(`/bestellungen/${id}`)} />
    </div>
  );
}
