// Rückgabe von Server Actions an Formulare
import { ZodError } from 'zod';

export type Ergebnis = { ok?: boolean; meldung?: string; fehler?: string; daten?: Record<string, unknown> };

/** Fehler (auch Zod) in eine lesbare Meldung übersetzen */
export function fehlerText(e: unknown): string {
  if (e instanceof ZodError) {
    const i = e.issues[0];
    return i ? `${i.path.length ? `${i.path.join('.')}: ` : ''}${i.message}` : 'Eingabe ungültig';
  }
  if (e && typeof e === 'object' && 'digest' in e && String((e as { digest: unknown }).digest).startsWith('NEXT_REDIRECT')) throw e;
  return e instanceof Error ? e.message : 'Unbekannter Fehler';
}

export async function ausfuehren(fn: () => Promise<Ergebnis | void>): Promise<Ergebnis> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (e) {
    return { fehler: fehlerText(e) };
  }
}
