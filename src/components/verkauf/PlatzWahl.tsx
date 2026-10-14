'use client';
// Vorstellung + Plätze wählen (Telefonverkauf, Umbuchung): Saalplan im Auswahlmodus oder „beste Plätze“
import { useEffect, useId, useState, useTransition } from 'react';
import { plaetzeLaden } from '@/app/(app)/vorstellungen/actions';
import { formatEur } from '@/lib/money';
import { preis, SITZ, sitzName, type Kat, type Preise } from '@/lib/saal';
import type { Status } from '@/lib/seats';
import { bestePlaetze } from './bestePlaetze';
import Saalplan from './Saalplan';
import { ART_NAME, KAT_NAME, ZEILENKOPF } from './texte';

export type ShowOption = { id: string; label: string; frei: number };
export type Platz = { seatId: string; art: 'normal' | 'ermaessigt' | 'frei' };
export type Wahl = { showId: string; seats: Platz[]; summe: number };

const MAX = 10;

export default function PlatzWahl({ shows, startShow = '', darfFrei, onChange, neuLaden = 0, ausser }: { shows: ShowOption[]; startShow?: string; darfFrei: boolean; onChange: (w: Wahl) => void; neuLaden?: number; ausser?: string }) {
  const id = useId();
  const [showId, setShowId] = useState(startShow);
  const [daten, setDaten] = useState<{ status: Record<string, Status>; preise: Preise } | null>(null);
  const [seats, setSeats] = useState<Platz[]>([]);
  const [anzahl, setAnzahl] = useState(2);
  const [kat, setKat] = useState<Kat>('I');
  const [hinweis, setHinweis] = useState('');
  const [laedt, start] = useTransition();

  useEffect(() => {
    if (!showId) { setDaten(null); return; }
    start(async () => {
      try { setDaten(await plaetzeLaden(showId)); } catch { setHinweis('Saalplan konnte nicht geladen werden.'); }
    });
  }, [showId, neuLaden]);

  // Nach dem Neuladen gewählte Plätze entfernen, die inzwischen belegt sind
  useEffect(() => {
    if (daten) setSeats((s) => s.filter((x) => daten.status[x.seatId] === 'frei'));
  }, [daten]);

  const summe = daten ? seats.reduce((s, x) => s + preis(daten.preise, SITZ[x.seatId].kat, x.art), 0) : 0;
  useEffect(() => { onChange({ showId, seats, summe }); }, [showId, seats, summe]); // eslint-disable-line react-hooks/exhaustive-deps

  const setAuswahl = (ids: string[]) => {
    if (ids.length > MAX) { setHinweis(`Höchstens ${MAX} Plätze je Bestellung.`); return; }
    setHinweis('');
    setSeats(ids.map((i) => seats.find((s) => s.seatId === i) ?? { seatId: i, art: 'normal' }));
  };
  const beste = () => {
    if (!daten) return;
    const ids = bestePlaetze(daten.status, anzahl, kat);
    if (ids.length < anzahl) setHinweis(`Nur ${ids.length} freie Plätze in ${KAT_NAME[kat]} gefunden.`);
    else setHinweis(`${ids.length} Plätze vorgeschlagen: ${ids.map(sitzName).join(', ')}.`);
    setAuswahl(ids.slice(0, MAX));
  };

  return (
    <div className="grid gap-4">
      <div>
        <label htmlFor={`${id}-show`} className="label">Vorstellung</label>
        <select id={`${id}-show`} value={showId} onChange={(e) => { setShowId(e.target.value); setSeats([]); setHinweis(''); }} className="input max-w-md" required>
          <option value="">Bitte wählen …</option>
          {shows.filter((s) => s.id !== ausser).map((s) => <option key={s.id} value={s.id}>{s.label} – {s.frei} frei</option>)}
        </select>
      </div>
      {showId && (
        <>
          <fieldset className="flex flex-wrap items-end gap-3 rounded-lg bg-paper p-3">
            <legend className="sr-only">Beste Plätze vorschlagen</legend>
            <div><label htmlFor={`${id}-n`} className="label">Anzahl</label><input id={`${id}-n`} type="number" min={1} max={MAX} value={anzahl} onChange={(e) => setAnzahl(Math.max(1, Math.min(MAX, Number(e.target.value) || 1)))} className="input w-24" /></div>
            <div><label htmlFor={`${id}-kat`} className="label">Kategorie</label>
              <select id={`${id}-kat`} value={kat} onChange={(e) => setKat(e.target.value as Kat)} className="input"><option value="I">Kategorie I</option><option value="II">Kategorie II</option><option value="R">Rollstuhlplatz</option></select></div>
            <button type="button" className="btn-secondary" onClick={beste} disabled={!daten || laedt}>Beste Plätze wählen</button>
            {seats.length > 0 && <button type="button" className="btn-secondary" onClick={() => setAuswahl([])}>Auswahl leeren</button>}
          </fieldset>
          <p role="status" aria-live="polite" className="text-sm text-muted">{laedt ? 'Saalplan wird geladen …' : hinweis}</p>
          {daten && <Saalplan status={daten.status} modus="auswahl" auswahl={seats.map((s) => s.seatId)} onAuswahl={setAuswahl} titel="Saalplan, freie Plätze wählen" />}
          {seats.length > 0 && daten && (
            <div className="card">
              <table className="table">
                <caption className="sr-only">Gewählte Plätze</caption>
                <thead><tr><th scope="col">Platz</th><th scope="col">Kategorie</th><th scope="col">Ticketart</th><th scope="col" className="text-right">Preis</th><th scope="col"><span className="sr-only">Entfernen</span></th></tr></thead>
                <tbody>
                  {seats.map((s) => {
                    const sz = SITZ[s.seatId];
                    return (
                      <tr key={s.seatId}>
                        <th scope="row" className={ZEILENKOPF}>{sitzName(s.seatId)}</th>
                        <td>{KAT_NAME[sz.kat]}</td>
                        <td>
                          {sz.kat === 'R' ? ART_NAME.rollstuhl : (
                            <select aria-label={`Ticketart für ${sitzName(s.seatId)}`} value={s.art} className="input py-1" onChange={(e) => setSeats(seats.map((x) => (x.seatId === s.seatId ? { ...x, art: e.target.value as Platz['art'] } : x)))}>
                              <option value="normal">Vollpreis</option><option value="ermaessigt">Ermäßigt</option>{darfFrei && <option value="frei">Freikarte</option>}
                            </select>
                          )}
                        </td>
                        <td className="num text-right">{formatEur(preis(daten.preise, sz.kat, s.art))}</td>
                        <td><button type="button" className="btn-secondary btn-sm" onClick={() => setSeats(seats.filter((x) => x.seatId !== s.seatId))} aria-label={`${sitzName(s.seatId)} entfernen`}>Entfernen</button></td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot><tr><th scope="row" colSpan={3} className={`${ZEILENKOPF} !font-semibold`}>Summe ({seats.length} {seats.length === 1 ? 'Ticket' : 'Tickets'})</th><td className="num px-4 py-2.5 text-right font-semibold">{formatEur(summe)}</td><td /></tr></tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
