// Saal der Votivkirche – gleiche Daten wie im Shop (light). 655 Sitzplätze + 7 Rollstuhlplätze.
// Reihe 0 hat sieben Stellplätze: entweder Rollstuhlplatz mit Begleitsitz (ein Ticket) oder zwei Zusatzsitze.
import { SAEULEN, SITZE_ROH, STELLPLAETZE } from './saalplan';

export type Kat = 'I' | 'II' | 'R';
export type Sitz = { id: string; reihe: number; platz: number; kat: Kat; x: number; y: number; rollstuhl?: boolean; stellplatz?: number };

export const SITZE: Sitz[] = [];
for (const [reihe, platz, k, x, y] of SITZE_ROH) SITZE.push({ id: `${reihe}-${platz}`, reihe, platz, kat: k === 1 ? 'I' : 'II', x, y });
for (const [nr, x] of STELLPLAETZE as number[][]) {
  SITZE.push({ id: `0-${2 * nr - 1}`, reihe: 0, platz: 2 * nr - 1, kat: 'I', stellplatz: nr, x: x - 6, y: 194 });
  SITZE.push({ id: `0-${2 * nr}`, reihe: 0, platz: 2 * nr, kat: 'I', stellplatz: nr, x: x + 6, y: 194 });
  SITZE.push({ id: `R-${nr}`, reihe: 0, platz: nr, kat: 'R', rollstuhl: true, stellplatz: nr, x, y: 194 });
}
export const SITZ: Record<string, Sitz> = Object.fromEntries(SITZE.map((s) => [s.id, s]));
export const KAPAZITAET = SITZE.filter((s) => !s.rollstuhl).length; // 655
export const ROLLSTUHL = (STELLPLAETZE as number[][]).length; // 7
export { SAEULEN, STELLPLAETZE };

/** Plätze, die mit diesem Platz nicht gleichzeitig verkauft werden können */
export function konflikte(id: string): string[] {
  const s = SITZ[id];
  if (!s?.stellplatz) return [];
  const nr = s.stellplatz;
  return s.rollstuhl ? [`0-${2 * nr - 1}`, `0-${2 * nr}`] : [`R-${nr}`];
}

export function sitzName(id: string): string {
  const s = SITZ[id];
  if (!s) return id;
  return s.rollstuhl ? `Rollstuhlplatz ${s.stellplatz} mit Begleitsitz` : `Reihe ${s.reihe}, Platz ${s.platz}`;
}

export type Preise = { I: { normal: number; ermaessigt: number }; II: { normal: number; ermaessigt: number }; R: { normal: number } };
export const STANDARD_PREISE: Preise = { I: { normal: 2800, ermaessigt: 2300 }, II: { normal: 2400, ermaessigt: 1900 }, R: { normal: 2800 } };
export const TICKET_UST = 13;

export function preis(p: Preise, kat: Kat, art: string): number {
  if (art === 'frei') return 0;
  if (kat === 'R') return p.R.normal;
  return art === 'ermaessigt' ? p[kat].ermaessigt : p[kat].normal;
}
