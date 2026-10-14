import { describe, expect, it } from 'vitest';
import { KEY_RE, neuerSchluessel, schluesselHash } from '../src/lib/apikey';
import { bestePlaetze, freierRollstuhlplatz, REIHEN } from '../src/lib/bestplatz';
import { SITZ } from '../src/lib/saal';

describe('bestePlaetze', () => {
  it('findet zusammenhängende Plätze der gewünschten Kategorie in einer Reihe', () => {
    for (const kat of ['I', 'II'] as const) {
      const ids = bestePlaetze(4, kat, new Set())!;
      expect(ids).toHaveLength(4);
      const reihe = SITZ[ids[0]].reihe;
      ids.forEach((id, i) => {
        expect(SITZ[id].kat).toBe(kat);
        expect(SITZ[id].reihe).toBe(reihe);
        if (i) expect(SITZ[id].platz).toBe(SITZ[ids[i - 1]].platz + 1);
      });
    }
  });

  it('meidet belegte Plätze und Reihe 0', () => {
    const erst = bestePlaetze(2, 'I', new Set())!;
    const zweit = bestePlaetze(2, 'I', new Set(erst))!;
    expect(zweit.some((id) => erst.includes(id))).toBe(false);
    expect(zweit.every((id) => SITZ[id].reihe !== 0)).toBe(true);
  });

  it('liefert null, wenn alles belegt ist', () => {
    const alle = new Set([...REIHEN.values()].flat().map((s) => s.id));
    expect(bestePlaetze(1, 'II', alle)).toBeNull();
  });

  it('Wunsch Platz am Gang liefert einen Randplatz', () => {
    const ids = bestePlaetze(2, 'I', new Set(), { rand: true })!;
    const reihe = REIHEN.get(SITZ[ids[0]].reihe)!;
    const rand = (id: string) => {
      const i = reihe.findIndex((s) => s.id === id);
      return i === 0 || i === reihe.length - 1 || reihe[i].x - reihe[i - 1].x > 15 || reihe[i + 1].x - reihe[i].x > 15;
    };
    expect(rand(ids[0]) || rand(ids[1])).toBe(true);
  });

  it('Rollstuhlplatz nur, wenn beide Zusatzsitze frei sind', () => {
    expect(freierRollstuhlplatz(new Set())).toBe('R-1');
    expect(freierRollstuhlplatz(new Set(['0-2']))).toBe('R-2');
  });
});

describe('API-Schlüssel', () => {
  it('hat das Format loc_live_ + 32 Zeichen base64url', () => {
    const k = neuerSchluessel();
    expect(k.key).toMatch(KEY_RE);
    expect(k.key).toHaveLength(9 + 32);
    expect(k.prefix).toBe(k.key.slice(0, 15));
  });
  it('speichert nur den SHA-256-Hash', () => {
    const k = neuerSchluessel();
    expect(k.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(k.hash).toBe(schluesselHash(k.key));
    expect(k.hash).not.toContain(k.key);
    expect(schluesselHash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('erzeugt jedes Mal einen anderen Schlüssel', () => {
    expect(neuerSchluessel().key).not.toBe(neuerSchluessel().key);
  });
});
