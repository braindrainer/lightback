// "Beste Plätze": n nebeneinanderliegende freie Plätze einer Kategorie, möglichst weit vorne und mittig
import { konflikte, SITZE, type Kat, type Sitz } from '@/lib/saal';
import type { Status } from '@/lib/seats';

const MITTE = 412;

export function bestePlaetze(status: Record<string, Status>, n: number, kat: Kat): string[] {
  const frei = (s: Sitz) => (status[s.id] ?? 'frei') === 'frei' && konflikte(s.id).every((k) => (status[k] ?? 'frei') === 'frei');
  const kandidaten = SITZE.filter((s) => s.kat === kat && frei(s));
  if (kat === 'R') return kandidaten.slice(0, n).map((s) => s.id);
  const reihen = new Map<number, Sitz[]>();
  for (const s of kandidaten) {
    if (!reihen.has(s.reihe)) reihen.set(s.reihe, []);
    reihen.get(s.reihe)!.push(s);
  }
  let best: { wert: number; ids: string[] } | null = null;
  for (const [reihe, sitze] of reihen) {
    sitze.sort((a, b) => a.x - b.x);
    for (let i = 0; i + n <= sitze.length; i++) {
      const block = sitze.slice(i, i + n);
      // nebeneinander: keine Lücke größer als ein Sitzabstand (Gang, belegter Platz)
      if (block.some((s, j) => j > 0 && s.x - block[j - 1].x > 16)) continue;
      const mitte = (block[0].x + block[n - 1].x) / 2;
      const wert = (reihe === 0 ? 45 : reihe) * 10 + Math.abs(mitte - MITTE) / 12;
      if (!best || wert < best.wert) best = { wert, ids: block.map((s) => s.id) };
    }
  }
  if (best) return best.ids;
  // Keine zusammenhängenden Plätze: die n besten einzelnen
  return kandidaten.sort((a, b) => a.reihe - b.reihe || Math.abs(a.x - MITTE) - Math.abs(b.x - MITTE)).slice(0, n).map((s) => s.id);
}
