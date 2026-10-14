// Beste freie Plätze nebeneinander – gleicher Algorithmus wie im Shop (light/src/daten/saal.js).
import { SITZE, type Kat, type Sitz } from './saal';

export type Wunsch = { sehen?: boolean; hoeren?: '' | 'naeher' | 'weiter'; rand?: boolean };

/** Sitzreihen ohne Rollstuhlplätze, nach Platznummer sortiert */
export const REIHEN = new Map<number, Sitz[]>();
for (const s of SITZE) {
  if (s.rollstuhl) continue;
  if (!REIHEN.has(s.reihe)) REIHEN.set(s.reihe, []);
  REIHEN.get(s.reihe)!.push(s);
}
for (const r of REIHEN.values()) r.sort((a, b) => a.platz - b.platz);

// Lautsprecher: Annahme vorne links/rechts beim Altar (wie im Shop)
export const LAUTSPRECHER: [number, number][] = [[285, 200], [540, 200]];
const abstandBox = (x: number, y: number) => Math.min(...LAUTSPRECHER.map(([bx, by]) => Math.hypot(x - bx, y - by)));

// Randplatz = erster/letzter Sitz eines zusammenhängenden Abschnitts (Reihenende oder Gang)
const RAND = new Set<string>();
for (const [r, sitze] of REIHEN) {
  if (r === 0) continue;
  sitze.forEach((s, i) => {
    const vor = sitze[i - 1], nach = sitze[i + 1];
    if (!vor || s.x - vor.x > 15 || !nach || nach.x - s.x > 15) RAND.add(s.id);
  });
}

/**
 * Beste freie Plätze nebeneinander in einer Kategorie (I oder II). Grundbewertung: Nähe zur Saalmitte
 * und eine gute Reihe (Kat. I vorne, Kat. II im mittleren Bereich). Wünsche verschieben das.
 * belegt: alle nicht verfügbaren Sitz-IDs. Ergebnis: Sitz-IDs oder null.
 */
export function bestePlaetze(anzahl: number, kat: Exclude<Kat, 'R'>, belegt: Set<string>, wunsch: Wunsch = {}): string[] | null {
  const mitteX = 412;
  let best: { wert: number; ids: string[] } | null = null;
  if (anzahl < 1) return null;
  for (const [r, sitze] of REIHEN) {
    if (r === 0) continue;
    for (let i = 0; i + anzahl <= sitze.length; i++) {
      const block = sitze.slice(i, i + anzahl);
      if (block.some((s) => s.kat !== kat || belegt.has(s.id))) continue;
      if (block.some((s, j) => j > 0 && s.x - block[j - 1].x > 15)) continue; // kein Gang im Block
      const x = (block[0].x + block[anzahl - 1].x) / 2;
      const y = block[0].y;
      let reihenWert = kat === 'I' ? r : Math.abs(r - 20);
      let mitte = (Math.abs(x - mitteX) / 11.5) * 1.1;
      if (wunsch.sehen) { reihenWert = Math.abs(r - 5) * 1.5; mitte *= 2; }
      let wert = mitte + reihenWert;
      const d = abstandBox(x, y);
      if (wunsch.hoeren === 'naeher') wert += d / 25;
      if (wunsch.hoeren === 'weiter') wert += Math.max(0, 300 - d) / 4 - reihenWert * 0.5;
      if (wunsch.rand && !RAND.has(block[0].id) && !RAND.has(block[anzahl - 1].id)) wert += 60;
      if (!best || wert < best.wert) best = { wert, ids: block.map((s) => s.id) };
    }
  }
  return best?.ids ?? null;
}

/** Erster freier Rollstuhlplatz (Stellplatz und beide Zusatzsitze frei) */
export function freierRollstuhlplatz(belegt: Set<string>): string | null {
  const s = SITZE.find((x) => x.rollstuhl && !belegt.has(x.id) && !belegt.has(`0-${2 * x.stellplatz! - 1}`) && !belegt.has(`0-${2 * x.stellplatz!}`));
  return s?.id ?? null;
}
