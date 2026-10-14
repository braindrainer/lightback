'use client';
// Saalplan für das Backend: jeder Platz ist ein echter Button an der Position aus dem Shop.
// Nur ein Platz ist im Tab-Fluss (Roving Tabindex), Pfeiltasten wandern durch den Saal.
// Status: Farbe UND Zeichen, Kategorie: Form (Kreis Kat. I, Quadrat Kat. II, Rechteck Rollstuhl).
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { konflikte, SAEULEN, SITZ, SITZE, sitzName, STELLPLAETZE, type Sitz } from '@/lib/saal';
import type { Status } from '@/lib/seats';
import type { PlatzInfo } from './daten';

const KX = 2.15;
const KY = 1.65;
const X0 = 262;
const Y0 = 90;
const px = (x: number) => (x - X0) * KX;
const py = (y: number) => (y - Y0) * KY;
const BREITE = px(590);
const HOEHE = py(925);
const STUFEN = [0.4, 0.5, 0.6, 0.8, 1, 1.25, 1.5, 2];
// Reihe 0: Zusatzsitze oben, Rollstuhlplatz darunter im selben Stellplatz
const pos = (s: Sitz) => (s.reihe === 0 ? { x: s.x, y: s.rollstuhl ? 192 : 175 } : { x: s.x, y: s.y });

const REIHEN = new Map<number, Sitz[]>();
for (const s of SITZE) {
  if (s.rollstuhl) continue;
  if (!REIHEN.has(s.reihe)) REIHEN.set(s.reihe, []);
  REIHEN.get(s.reihe)!.push(s);
}
for (const r of REIHEN.values()) r.sort((a, b) => a.x - b.x);

export const STATUS_TEXT: Record<Status, string> = { frei: 'frei', reserviert: 'reserviert', verkauft: 'verkauft', eingelassen: 'eingelassen', gesperrt: 'gesperrt' };
const ZEICHEN: Record<Status, string> = { frei: '', reserviert: '…', verkauft: 'V', eingelassen: 'E', gesperrt: '×' };
const FARBE: Record<Status, string> = {
  frei: '',
  reserviert: 'bg-[#8a5800] text-white',
  verkauft: 'bg-ink text-white',
  eingelassen: 'bg-[#0b5f8a] text-white',
  gesperrt: 'bg-[#b3261e] text-white',
};
const KATFARBE = { I: 'bg-[#7a5c16] text-white', II: 'bg-[#5b4bc4] text-white', R: 'bg-[#1f63a0] text-white' };

function nachbar(s: Sitz, richtung: string) {
  let best: { wert: number; k: Sitz } | null = null;
  const a = pos(s);
  for (const k of SITZE) {
    if (k.id === s.id) continue;
    const b = pos(k);
    const dx = b.x - a.x, dy = b.y - a.y;
    const vor = ({ ArrowRight: dx, ArrowLeft: -dx, ArrowDown: dy, ArrowUp: -dy } as Record<string, number>)[richtung];
    const quer = richtung === 'ArrowRight' || richtung === 'ArrowLeft' ? Math.abs(dy) : Math.abs(dx);
    if (vor <= 2) continue;
    if ((richtung === 'ArrowRight' || richtung === 'ArrowLeft') && quer > 6) continue;
    const wert = vor + quer * 3;
    if (!best || wert < best.wert) best = { wert, k };
  }
  return best?.k;
}

export type SaalplanProps = {
  status: Record<string, Status>;
  info?: Record<string, PlatzInfo>;
  /** verwalten: freie und gesperrte Plätze wählbar, belegte öffnen die Bestellung; auswahl: nur freie Plätze */
  modus: 'verwalten' | 'auswahl';
  auswahl: string[];
  onAuswahl: (ids: string[]) => void;
  onOeffnen?: (orderId: string) => void;
  titel?: string;
};

export default function Saalplan({ status, info = {}, modus, auswahl, onAuswahl, onOeffnen, titel = 'Saalplan der Votivkirche, Altar oben' }: SaalplanProps) {
  const [fokusId, setFokusId] = useState<string>(() => auswahl[0] ?? '1-1');
  const [zoom, setZoom] = useState(1);
  const [ansage, setAnsage] = useState('');
  const rahmen = useRef<HTMLDivElement>(null);
  const plan = useRef<HTMLDivElement>(null);
  const hilfeId = `hilfe${useId()}`;

  useLayoutEffect(() => {
    const r = rahmen.current;
    if (r) setZoom(Math.max(0.4, Math.min(1, (r.clientWidth - 24) / BREITE)));
  }, []);

  const gewaehlt = useMemo(() => new Set(auswahl), [auswahl]);
  // Im Auswahlmodus: Platz ist nur wählbar, wenn er und seine Konfliktplätze frei sind
  const waehlbar = (id: string) => {
    const st = status[id] ?? 'frei';
    if (modus === 'verwalten') return st === 'frei' || st === 'gesperrt';
    if (gewaehlt.has(id)) return true;
    return st === 'frei' && konflikte(id).every((k) => (status[k] ?? 'frei') === 'frei' && !gewaehlt.has(k));
  };

  const label = (s: Sitz) => {
    const st = status[s.id] ?? 'frei';
    const i = info[s.id];
    const kat = s.rollstuhl ? '' : `, Kategorie ${s.kat}${s.reihe === 0 ? ', Zusatzsitz vorne' : ''}`;
    let zusatz = '';
    if (i?.bestellung) zusatz = ` – Bestellung ${i.bestellung}${i.durch ? ` (belegt durch ${i.durch})` : ''}`;
    else if (i?.grund) zusatz = ` – ${i.grund}`;
    const nichtWaehlbar = modus === 'auswahl' && st === 'frei' && !waehlbar(s.id) ? ', nicht verfügbar' : '';
    return `${sitzName(s.id)}${kat}, ${STATUS_TEXT[st]}${nichtWaehlbar}${zusatz}${gewaehlt.has(s.id) ? ', ausgewählt' : ''}`;
  };

  const klick = (s: Sitz) => {
    const st = status[s.id] ?? 'frei';
    if (modus === 'verwalten' && info[s.id]?.orderId && onOeffnen && st !== 'frei' && st !== 'gesperrt') {
      onOeffnen(info[s.id].orderId!);
      return;
    }
    if (!waehlbar(s.id)) return;
    const neu = gewaehlt.has(s.id) ? auswahl.filter((x) => x !== s.id) : [...auswahl, s.id];
    onAuswahl(neu);
    setAnsage(`${sitzName(s.id)} ${gewaehlt.has(s.id) ? 'abgewählt' : 'ausgewählt'}. ${neu.length} ${neu.length === 1 ? 'Platz' : 'Plätze'} gewählt.`);
  };

  const stufe = (r: number) => {
    const z = r > 0 ? STUFEN.find((x) => x > zoom + 0.01) : [...STUFEN].reverse().find((x) => x < zoom - 0.01);
    if (z) { setZoom(z); setAnsage(`Zoom ${Math.round(z * 100)} %`); }
  };
  const ganz = () => {
    const r = rahmen.current;
    if (!r) return;
    const z = Math.max(0.3, Math.min((r.clientWidth - 24) / BREITE, (r.clientHeight - 24) / HOEHE));
    setZoom(z);
    setAnsage('Ganzer Saal');
  };

  const springe = (id: string) => {
    setFokusId(id);
    plan.current?.querySelector<HTMLButtonElement>(`[data-sitz="${id}"]`)?.focus();
  };
  const taste = (e: React.KeyboardEvent) => {
    if (e.key === '+' || e.key === '=') { e.preventDefault(); stufe(1); return; }
    if (e.key === '-') { e.preventDefault(); stufe(-1); return; }
    const s = SITZ[fokusId];
    if (!s) return;
    let ziel: Sitz | undefined;
    if (e.key.startsWith('Arrow')) ziel = nachbar(s, e.key);
    if (e.key === 'Home' || e.key === 'End') {
      const reihe = s.rollstuhl ? SITZE.filter((x) => x.rollstuhl) : REIHEN.get(s.reihe)!;
      ziel = e.key === 'Home' ? reihe[0] : reihe[reihe.length - 1];
    }
    if (ziel) { e.preventDefault(); springe(ziel.id); }
  };

  useEffect(() => {
    // Fokus-Sitz ins Bild scrollen, wenn er per Tastatur gewechselt wird
    const el = plan.current?.querySelector<HTMLElement>(`[data-sitz="${fokusId}"]`);
    if (el && document.activeElement === el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [fokusId]);

  const zaehler = useMemo(() => {
    const z: Record<Status, number> = { frei: 0, reserviert: 0, verkauft: 0, eingelassen: 0, gesperrt: 0 };
    for (const s of SITZE) z[status[s.id] ?? 'frei']++;
    return z;
  }, [status]);

  const rund = 'grid h-10 w-10 place-items-center rounded-full border border-line bg-white text-ink shadow hover:border-accent disabled:opacity-40';
  return (
    <div className="grid gap-3">
      <p role="status" aria-live="polite" className="sr-only">{ansage}</p>
      <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm" aria-label="Legende">
        <li className="flex items-center gap-2"><span aria-hidden="true" className={`h-4 w-4 rounded-full ${KATFARBE.I}`} />Kategorie I (Kreis)</li>
        <li className="flex items-center gap-2"><span aria-hidden="true" className={`h-4 w-4 rounded-[3px] ${KATFARBE.II}`} />Kategorie II (Quadrat)</li>
        <li className="flex items-center gap-2"><span aria-hidden="true" className={`h-4 w-5 rounded-md ${KATFARBE.R}`} />Rollstuhl (Rechteck)</li>
        {(['reserviert', 'verkauft', 'eingelassen', 'gesperrt'] as Status[]).map((st) => (
          <li key={st} className="flex items-center gap-2"><span aria-hidden="true" className={`grid h-4 w-4 place-items-center rounded-full text-[10px] font-bold ${FARBE[st]}`}>{ZEICHEN[st]}</span>{STATUS_TEXT[st]} ({zaehler[st]})</li>
        ))}
        <li className="flex items-center gap-2"><span aria-hidden="true" className="grid h-4 w-4 place-items-center rounded-full bg-white text-[10px] font-bold text-ink ring-2 ring-accent">✓</span>ausgewählt ({auswahl.length})</li>
      </ul>
      <p id={hilfeId} className="text-sm text-muted">
        Pfeiltasten wechseln den Platz, Eingabe oder Leertaste {modus === 'verwalten' ? 'wählt ihn aus (verkaufte Plätze öffnen die Bestellung)' : 'wählt ihn aus'}. Pos1/Ende springen an den Rand der Reihe, + und − zoomen. Frei: {zaehler.frei}.
      </p>
      <div className="relative">
        <div role="group" aria-label="Zoom" className="absolute right-3 top-3 z-10 flex flex-col items-center gap-2">
          <button type="button" onClick={() => stufe(1)} disabled={zoom >= STUFEN[STUFEN.length - 1] - 0.001} aria-label="Vergrößern" className={rund}><span aria-hidden="true" className="text-lg font-bold">+</span></button>
          <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold tabular-nums text-muted" aria-hidden="true">{Math.round(zoom * 100)} %</span>
          <button type="button" onClick={() => stufe(-1)} disabled={zoom <= STUFEN[0] + 0.001} aria-label="Verkleinern" className={rund}><span aria-hidden="true" className="text-lg font-bold">−</span></button>
          <button type="button" onClick={ganz} aria-label="Ganzer Saal" className={rund}>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
          </button>
        </div>
        <div ref={rahmen} className="h-[min(75dvh,900px)] min-h-[380px] overflow-auto rounded-xl border border-line bg-[#fbf9f5] p-3 pr-16">
          <div className="relative mx-auto" style={{ width: BREITE * zoom, height: HOEHE * zoom }}>
            <div ref={plan} role="group" aria-label={titel} aria-describedby={hilfeId} onKeyDown={taste}
              className="absolute left-0 top-0 origin-top-left" style={{ width: BREITE, height: HOEHE, transform: `scale(${zoom})` }}>
              <div aria-hidden="true">
                <div className="absolute rounded-b-[40px] rounded-t-md border border-accent/50 bg-accent-soft text-center text-[12px] font-semibold uppercase leading-[30px] tracking-[0.25em] text-accent-deep" style={{ left: px(360), top: py(142) - 15, width: px(470) - px(360), height: 30 }}>Altar</div>
                {SAEULEN.map(([x, y, d]) => <span key={`${x}-${y}`} className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-line bg-[#ece6da]" style={{ left: px(x), top: py(y), width: d * 0.9, height: d * 0.9 }} />)}
                <div className="absolute border-y border-dashed border-line text-center text-[10px] uppercase leading-5 tracking-[0.25em] text-muted" style={{ left: px(300), width: px(528) - px(300), top: py(566), height: 22 }}>Quergang</div>
                {[...REIHEN].filter(([r]) => r > 0).map(([r, sitze]) => (
                  <span key={r} className="absolute w-6 -translate-y-1/2 text-right text-[10.5px] tabular-nums text-muted" style={{ left: px(sitze[0].x) - 36, top: py(sitze[0].y) }}>{r}</span>
                ))}
                <span className="absolute -translate-y-1/2 text-[10.5px] text-muted" style={{ left: px(298) - 40, top: py(183) }}>0</span>
                {(STELLPLAETZE as number[][]).map(([nr, x]) => <span key={nr} className="absolute -translate-x-1/2 -translate-y-1/2 rounded-lg border border-rs/40" style={{ left: px(x), top: py(183), width: 30 * KX, height: 58 }} />)}
              </div>
              {SITZE.map((s) => {
                const st = status[s.id] ?? 'frei';
                const sel = gewaehlt.has(s.id);
                const p = pos(s);
                const aus = modus === 'auswahl' && !sel && !waehlbar(s.id);
                const form = s.rollstuhl ? 'rounded-md h-6 w-7' : s.kat === 'II' ? 'rounded-[4px] h-5 w-5' : 'rounded-full h-5 w-5';
                const farbe = sel ? 'bg-white text-ink ring-[3px] ring-accent' : st === 'frei' ? KATFARBE[s.kat] : FARBE[st];
                return (
                  <button key={s.id} type="button" data-sitz={s.id} tabIndex={fokusId === s.id ? 0 : -1}
                    aria-label={label(s)} aria-pressed={sel} aria-disabled={aus || undefined}
                    onClick={() => klick(s)} onFocus={() => setFokusId(s.id)}
                    style={{ left: px(p.x), top: py(p.y) }}
                    className={`absolute grid -translate-x-1/2 -translate-y-1/2 place-items-center text-[10px] font-bold leading-none before:absolute before:-inset-[3px] before:content-[''] focus-visible:z-10 focus-visible:scale-125 ${form} ${farbe} ${aus ? 'cursor-not-allowed opacity-45' : 'cursor-pointer hover:scale-125'}`}>
                    <span aria-hidden="true">{sel ? '✓' : st !== 'frei' ? ZEICHEN[st] : s.rollstuhl ? '♿' : s.platz}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
