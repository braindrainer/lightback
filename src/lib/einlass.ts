// Einlasskontrolle: Ticket prüfen und atomar entwerten. Online über den signierten QR-Inhalt,
// offline in der App über die Codeliste der Vorstellung (die Codes sind nicht erratbar).
import { audit, protokoll } from './audit';
import type { Nutzer } from './auth';
import { db } from './db';
import { fmtDatumZeit } from './dates';
import { sitzName } from './saal';
import { qrPruefen } from './tickets';

export type Ergebnis = 'ok' | 'doppelt' | 'falsche_vorstellung' | 'storniert' | 'unbekannt' | 'ungueltig';
export const RUECKNAHME_MIN = 2;

export type ScanAntwort = {
  result: Ergebnis;
  checkInId?: string;
  code?: string;
  ticket?: { code: string; seatId: string; sitz: string; kat: string; art: string };
  vorher?: { am: string; von: string | null };
  vorstellung?: string;
};

/** Code aus QR-Inhalt oder Handeingabe. null = Signatur falsch / unlesbar. */
export function codeAus(eingabe: string): { code: string; showId?: string } | null {
  const s = eingabe.trim();
  if (s.startsWith('LOC1.')) return qrPruefen(s);
  const code = s.toUpperCase().replace(/[\s-]/g, '');
  return /^[A-Z0-9]{6,16}$/.test(code) ? { code } : null;
}

export async function scannen(p: { eingabe: string; showId: string; user: Nutzer; offline?: boolean; scannedAt?: Date; deviceId?: string }): Promise<ScanAntwort> {
  const c = codeAus(p.eingabe);
  // Jeder Scan landet in CheckIn und knapp im revisionssicheren Protokoll
  const merken = async (result: Ergebnis, code: string, ticketId?: string) => {
    const ci = await db.checkIn.create({ data: { result, code: code.slice(0, 80), ticketId, showId: p.showId, userId: p.user.id, deviceId: p.deviceId, offline: !!p.offline, createdAt: p.scannedAt } });
    await protokoll({
      user: p.user, action: `einlass_${result}`, entity: ticketId ? 'ticket' : 'checkIn', entityId: ticketId ?? ci.id,
      data: { code: code.slice(0, 40), showId: p.showId, checkInId: ci.id, geraet: p.deviceId, offline: p.offline || undefined, gescannt: p.scannedAt },
      ...(result === 'ok' ? { vorher: { status: 'gueltig' }, nachher: { status: 'eingelassen' } } : {}),
    });
    return ci;
  };
  if (!c) {
    await merken('ungueltig', p.eingabe);
    return { result: 'ungueltig' };
  }
  const t = await db.ticket.findUnique({ where: { code: c.code }, include: { show: true } });
  if (!t) {
    await merken('unbekannt', c.code);
    return { result: 'unbekannt', code: c.code };
  }
  const ticket = { code: t.code, seatId: t.seatId, sitz: sitzName(t.seatId), kat: t.kat, art: t.art };
  if (t.showId !== p.showId) {
    await merken('falsche_vorstellung', t.code, t.id);
    return { result: 'falsche_vorstellung', code: t.code, ticket, vorstellung: fmtDatumZeit(t.show.startsAt) };
  }
  if (t.status === 'storniert') {
    await merken('storniert', t.code, t.id);
    return { result: 'storniert', code: t.code, ticket };
  }
  // Atomar: nur ein Gerät gewinnt, auch bei gleichzeitigen Scans
  const am = p.scannedAt ?? new Date();
  const n = await db.ticket.updateMany({ where: { id: t.id, status: 'gueltig' }, data: { status: 'eingelassen', checkedInAt: am, checkedInBy: p.user.name } });
  if (!n.count) {
    const jetzt = await db.ticket.findUniqueOrThrow({ where: { id: t.id } });
    const r: Ergebnis = jetzt.status === 'storniert' ? 'storniert' : 'doppelt';
    await merken(r, t.code, t.id);
    return { result: r, code: t.code, ticket, vorher: jetzt.checkedInAt ? { am: jetzt.checkedInAt.toISOString(), von: jetzt.checkedInBy } : undefined };
  }
  const ci = await merken('ok', t.code, t.id);
  return { result: 'ok', code: t.code, ticket, checkInId: ci.id };
}

/** Letzten Einlass zurücknehmen (Fehlscan), nur innerhalb von RUECKNAHME_MIN Minuten und nur eigene Scans */
export async function zuruecknehmen(checkInId: string, user: Nutzer) {
  const ci = await db.checkIn.findUnique({ where: { id: checkInId } });
  if (!ci || ci.result !== 'ok' || !ci.ticketId) throw new Error('Dieser Einlass kann nicht zurückgenommen werden.');
  if (ci.userId !== user.id && !user.roles.includes('admin')) throw new Error('Nur eigene Scans können zurückgenommen werden.');
  if (Date.now() - ci.createdAt.getTime() > RUECKNAHME_MIN * 60e3) throw new Error(`Rücknahme ist nur ${RUECKNAHME_MIN} Minuten lang möglich.`);
  const n = await db.ticket.updateMany({ where: { id: ci.ticketId, status: 'eingelassen' }, data: { status: 'gueltig', checkedInAt: null, checkedInBy: null } });
  if (!n.count) throw new Error('Ticket ist nicht mehr als eingelassen markiert.');
  await db.checkIn.update({ where: { id: ci.id }, data: { result: 'zurueckgenommen' } });
  await audit(user, 'einlass_zuruecknehmen', 'ticket', ci.ticketId, { checkInId, code: ci.code, eingelassenAm: ci.createdAt }, { vorher: { status: 'eingelassen' }, nachher: { status: 'gueltig' } });
  return true;
}

/** Leitung: Einlass eines Tickets ohne Zeitlimit zurücknehmen (z. B. versehentlich entwertet) */
export async function einlassZuruecknehmenLeitung(ticketId: string, grund: string, user: Nutzer) {
  const t = await db.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  if (t.status !== 'eingelassen') throw new Error('Das Ticket ist nicht als eingelassen markiert.');
  const n = await db.ticket.updateMany({ where: { id: ticketId, status: 'eingelassen' }, data: { status: 'gueltig', checkedInAt: null, checkedInBy: null } });
  if (!n.count) throw new Error('Das Ticket ist nicht mehr als eingelassen markiert.');
  // Neue Zeile statt die alte zu ändern: der ursprüngliche Scan bleibt sichtbar
  const ci = await db.checkIn.create({ data: { ticketId, showId: t.showId, code: t.code, result: 'zurueckgenommen', userId: user.id, deviceId: 'backend' } });
  await audit(user, 'einlass_zuruecknehmen', 'ticket', ticketId, { checkInId: ci.id, code: t.code, grund, durch: 'leitung' }, { vorher: { status: 'eingelassen', checkedInAt: t.checkedInAt, checkedInBy: t.checkedInBy }, nachher: { status: 'gueltig', checkedInAt: null, checkedInBy: null } });
}

export async function stand(showId: string) {
  const [eingelassen, verkauft] = await Promise.all([
    db.ticket.count({ where: { showId, status: 'eingelassen' } }),
    db.ticket.count({ where: { showId, status: { not: 'storniert' } } }),
  ]);
  return { eingelassen, verkauft };
}
