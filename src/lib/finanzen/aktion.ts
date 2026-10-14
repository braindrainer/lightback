// Gemeinsames Muster für Server Actions mit Rückmeldung im Formular
import { unstable_rethrow } from 'next/navigation';
import type { z } from 'zod';

export type Ergebnis = { fehler?: string; ok?: string; t?: number } | null;

export async function ausfuehren(fn: () => Promise<string | void>): Promise<Ergebnis> {
  try {
    const m = await fn();
    return { ok: m || 'Gespeichert.', t: Date.now() };
  } catch (e) {
    unstable_rethrow(e);
    return { fehler: e instanceof Error ? e.message : 'Unbekannter Fehler', t: Date.now() };
  }
}

/** FormData prüfen; erste Fehlermeldung wird als Error geworfen */
export function pruefen<T extends z.ZodType>(schema: T, fd: FormData | Record<string, unknown>): z.infer<T> {
  const daten = fd instanceof FormData ? Object.fromEntries([...fd.keys()].map((k) => [k, fd.getAll(k).length > 1 ? fd.getAll(k) : fd.get(k)])) : fd;
  const r = schema.safeParse(daten);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new Error(i.message);
  }
  return r.data;
}
