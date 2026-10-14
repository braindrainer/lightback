// Einfache Begrenzung der Anfragen je Schlüssel (IP oder Partner) im Speicher – reicht für einen Container.
const fenster = new Map<string, { start: number; n: number }>();
let aufgeraeumt = Date.now();

/** true = erlaubt. limit Anfragen je windowMs. */
export function erlaubt(key: string, limit: number, windowMs = 60_000): { ok: boolean; rest: number; retryAfter: number } {
  const jetzt = Date.now();
  if (jetzt - aufgeraeumt > 5 * 60_000) {
    for (const [k, v] of fenster) if (jetzt - v.start > 10 * 60_000) fenster.delete(k);
    aufgeraeumt = jetzt;
  }
  const e = fenster.get(key);
  if (!e || jetzt - e.start >= windowMs) {
    fenster.set(key, { start: jetzt, n: 1 });
    return { ok: true, rest: limit - 1, retryAfter: 0 };
  }
  e.n++;
  const retryAfter = Math.ceil((e.start + windowMs - jetzt) / 1000);
  return { ok: e.n <= limit, rest: Math.max(0, limit - e.n), retryAfter };
}
