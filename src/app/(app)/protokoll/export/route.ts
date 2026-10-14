import { audit } from '@/lib/audit';
import { currentUser, hat } from '@/lib/auth';
import { db } from '@/lib/db';
import { tagesAnker } from '@/lib/protokoll-anker';
import { filterLesen, filterWhere } from '@/lib/protokoll-filter';

export const dynamic = 'force-dynamic';
const MAX = 100_000;

const csvFeld = (v: unknown) => {
  const s = v === null || v === undefined ? '' : typeof v === 'string' ? v : v instanceof Date ? v.toISOString() : JSON.stringify(v);
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Export des gefilterten Protokolls für Prüfer:innen: CSV (Excel) oder JSON, jeweils mit seq, prevHash und hash
export async function GET(req: Request) {
  const u = await currentUser();
  if (!hat(u, 'admin')) return new Response('Keine Berechtigung', { status: 403 });
  const url = new URL(req.url);
  const format = url.searchParams.get('format') ?? 'csv';
  const stempel = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  if (format === 'anker') {
    const anker = await tagesAnker(3660);
    await audit(u, 'protokoll_export', 'auditLog', null, { format, tage: anker.length });
    const text = ['Lightback – Tagesanker des Protokolls (SHA-256, letzter Eintrag je Tag, Europe/Vienna)', `Erstellt: ${new Date().toISOString()}`, '', 'Tag;Letzte Nr.;Einträge;Hash', ...anker.map((a) => `${a.tag};${a.seq};${a.anzahl};${a.hash ?? ''}`)].join('\r\n');
    return new Response(`${text}\r\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="protokoll-anker-${stempel}.txt"`, 'Cache-Control': 'no-store' } });
  }
  const f = filterLesen(Object.fromEntries(url.searchParams));
  const where = await filterWhere(f);
  const zeilen = await db.auditLog.findMany({ where, orderBy: { seq: 'asc' }, take: MAX });
  await audit(u, 'protokoll_export', 'auditLog', null, { format, filter: f, eintraege: zeilen.length, bisSeq: zeilen.at(-1)?.seq });
  if (format === 'json') {
    const body = {
      erzeugt: new Date().toISOString(), filter: f, anzahl: zeilen.length, abgeschnitten: zeilen.length >= MAX,
      pruefung: 'hash = SHA-256 (hex) über kanonisches JSON (Schlüssel sortiert, ohne Leerzeichen) von {action, createdAt (ISO), data, entity, entityId, ip, nachher, prevHash, userAgent, userId, userName, vorher}; fehlende Werte = null. prevHash = hash des Eintrags mit der nächstkleineren seq (erster Eintrag: 64 × "0"). Bei gefilterten Exporten ist die Kette nur zwischen direkt aufeinanderfolgenden seq-Nummern prüfbar.',
      eintraege: zeilen,
    };
    return new Response(JSON.stringify(body, null, 1), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="protokoll-${stempel}.json"`, 'Cache-Control': 'no-store' } });
  }
  const kopf = ['seq', 'zeit_utc', 'benutzer_id', 'benutzer', 'aktion', 'bereich', 'datensatz', 'daten', 'vorher', 'nachher', 'ip', 'user_agent', 'prev_hash', 'hash'];
  const csv = [kopf.join(';'), ...zeilen.map((z) => [z.seq, z.createdAt, z.userId, z.userName, z.action, z.entity, z.entityId, z.data, z.vorher, z.nachher, z.ip, z.userAgent, z.prevHash, z.hash].map(csvFeld).join(';'))];
  return new Response(`﻿${csv.join('\r\n')}\r\n`, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="protokoll-${stempel}.csv"`, 'Cache-Control': 'no-store' } });
}
