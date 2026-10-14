import { db } from './db';

/** Letzter Hash je Kalendertag (Wien): zum Ausdrucken oder extern Ablegen. Wer später etwas ändert, kann diesen Wert nicht mehr treffen. */
export async function tagesAnker(tage = 120) {
  return db.$queryRaw<{ tag: string; seq: number; hash: string | null; anzahl: number }[]>`
    WITH t AS (
      SELECT seq, to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Vienna', 'YYYY-MM-DD') AS tag FROM "AuditLog"
    ), g AS (
      SELECT tag, max(seq) AS seq, count(*)::int AS anzahl FROM t GROUP BY tag ORDER BY tag DESC LIMIT ${tage}
    )
    SELECT g.tag, g.seq, a.hash, g.anzahl FROM g JOIN "AuditLog" a ON a.seq = g.seq ORDER BY g.tag DESC`;
}
