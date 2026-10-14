// Hash-Kette des Protokolls – ohne Abhängigkeiten zu Next.js, damit auch scripts/schutz.ts und Tests sie nutzen.
// Jeder Eintrag enthält den Hash des Vorgängers; wer einen Eintrag ändert, löscht oder einschiebt, bricht die Kette.
import { createHash } from 'node:crypto';

/** Vorgänger des allerersten Eintrags */
export const GENESIS = '0'.repeat(64);
/** Schlüssel der Advisory-Sperre, unter der Einträge angehängt werden (gleicher Wert im Trigger) */
export const KETTEN_LOCK = 7_401_002;

export type KettenFelder = {
  createdAt: Date | string;
  userId?: string | null;
  userName?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  data?: unknown;
  vorher?: unknown;
  nachher?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  prevHash: string;
};

/** So, wie Postgres (jsonb) den Wert zurückgibt: undefined fällt weg, Datum wird ISO-Text */
export function normalisieren(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  return JSON.parse(JSON.stringify(v)) as unknown;
}

/** Kanonisches JSON: Schlüssel sortiert, keine Leerzeichen, undefined ausgelassen */
export function kanonisch(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : kanonisch(x))).join(',')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const teile = Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${kanonisch(o[k])}`);
    return `{${teile.join(',')}}`;
  }
  if (typeof v === 'number' && !Number.isFinite(v)) return 'null';
  return JSON.stringify(v);
}

export function eintragHash(e: KettenFelder): string {
  const inhalt = kanonisch({
    createdAt: new Date(e.createdAt).toISOString(),
    userId: e.userId ?? null,
    userName: e.userName ?? null,
    action: e.action,
    entity: e.entity,
    entityId: e.entityId ?? null,
    data: normalisieren(e.data),
    vorher: normalisieren(e.vorher),
    nachher: normalisieren(e.nachher),
    ip: e.ip ?? null,
    userAgent: e.userAgent ?? null,
    prevHash: e.prevHash,
  });
  return createHash('sha256').update(inhalt, 'utf8').digest('hex');
}

export type KettenZeile = KettenFelder & { seq: number; id: string; hash: string | null };
export type KettenFehler = { seq: number; id: string; art: 'hash' | 'verkettung' | 'fehlt'; text: string };

/** Prüft einen Abschnitt der Kette ab einem bekannten Vorgänger-Hash. Liefert den ersten Fehler. */
export function abschnittPruefen(zeilen: KettenZeile[], vorher: string): { letzter: string; fehler?: KettenFehler; luecken: number[]; letzteSeq?: number } {
  let prev = vorher;
  const luecken: number[] = [];
  let letzteSeq: number | undefined;
  for (const z of zeilen) {
    if (letzteSeq !== undefined && z.seq !== letzteSeq + 1) luecken.push(z.seq);
    letzteSeq = z.seq;
    if (!z.hash) return { letzter: prev, luecken, letzteSeq, fehler: { seq: z.seq, id: z.id, art: 'fehlt', text: 'Eintrag ohne Hash' } };
    if (z.prevHash !== prev) return { letzter: prev, luecken, letzteSeq, fehler: { seq: z.seq, id: z.id, art: 'verkettung', text: 'Verweis auf den Vorgänger stimmt nicht – davor wurde ein Eintrag gelöscht, eingefügt oder verändert' } };
    if (eintragHash(z) !== z.hash) return { letzter: prev, luecken, letzteSeq, fehler: { seq: z.seq, id: z.id, art: 'hash', text: 'Inhalt passt nicht zum gespeicherten Hash – der Eintrag wurde nachträglich verändert' } };
    prev = z.hash;
  }
  return { letzter: prev, luecken, letzteSeq };
}
