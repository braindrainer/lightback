// Übergabe an BMD NTCS: Läufe mit allen noch nicht übergebenen Buchungen, Abholung durch den Konnektor
// im Netz des Veranstalters (oder Download / Mail), Rückmeldung mit BMD-Referenz.
import { createHash, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { protokoll } from '../audit';
import { schluesselHash } from '../apikey';
import { db, getSettings } from '../db';
import { fmtDatum } from '../dates';
import { layout, senden } from '../mail';
import { modulAn } from '../module';
import { ApiFehler } from '../schnittstelle';
import { exportBuchungen } from './auswertung';
import { bmdCsv, bmdZeilen } from './bmd';
import { nachLatin1 } from './csv';
import { tagStr } from './zeitraum';

/** Läufe in diesem Status halten ihre Buchungen fest; „fehler“ gibt sie für den nächsten Lauf frei */
export const GUELTIG = ['bereit', 'abgeholt', 'uebernommen'];
export const STATUS_NAME: Record<string, string> = { bereit: 'bereit zur Abholung', abgeholt: 'abgeholt', uebernommen: 'in BMD übernommen', fehler: 'Fehler – wird neu übergeben' };

export const BMD_KEY_PREFIX = 'loc_bmd_';
const LOCK = 7_401_003;

/** Buchungen bis einschließlich `bis`, die in keinem gültigen Lauf stehen */
export async function offeneBuchungen(bis?: Date) {
  const rows = await db.$queryRaw<{ id: string; date: Date }[]>(Prisma.sql`
    SELECT e.id, e.date FROM "JournalEntry" e
    WHERE ${bis ? Prisma.sql`e.date <= ${bis}` : Prisma.sql`TRUE`}
      AND NOT EXISTS (SELECT 1 FROM "BmdLauf" b WHERE e.id = ANY(b."entryIds") AND b.status = ANY(${GUELTIG}::text[]))
    ORDER BY e.date, e.number`);
  return rows;
}

const gestern = () => {
  const d = new Date(Date.now() - 864e5);
  return new Date(`${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(d)}T00:00:00Z`);
};

/** Neuen Lauf anlegen (null = nichts offen). bis = letzter Buchungstag, Standard gestern. */
export async function laufErstellen(p: { bis?: Date; userId?: string; quelle?: 'automatisch' | 'manuell' } = {}) {
  const bis = p.bis ?? gestern();
  const lauf = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK}::bigint)`;
    const offen = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT e.id FROM "JournalEntry" e WHERE e.date <= ${bis}
        AND NOT EXISTS (SELECT 1 FROM "BmdLauf" b WHERE e.id = ANY(b."entryIds") AND b.status = ANY(${GUELTIG}::text[]))`);
    if (!offen.length) return null;
    const ids = new Set(offen.map((o) => o.id));
    const erste = await tx.journalEntry.findFirst({ where: { id: { in: [...ids] } }, orderBy: { date: 'asc' }, select: { date: true } });
    const eintraege = (await exportBuchungen(tagStr(erste!.date), tagStr(bis))).filter((e) => ids.has(e.id));
    const datei = bmdCsv(eintraege);
    const zeilen = eintraege.flatMap(bmdZeilen);
    return tx.bmdLauf.create({
      data: {
        bis, entryIds: eintraege.map((e) => e.id), anzahl: eintraege.length, zeilen: zeilen.length,
        sollCents: eintraege.reduce((s, e) => s + e.lines.reduce((t, l) => t + l.soll, 0), 0),
        datei, sha256: createHash('sha256').update(datei).digest('hex'), quelle: p.quelle ?? 'manuell', createdById: p.userId,
      },
    });
  }, { timeout: 60_000, maxWait: 15_000 });
  if (!lauf) return null;
  await protokoll({ ...(p.userId ? {} : { user: null, akteur: 'System (Cron)' }), action: 'bmd_lauf_erstellt', entity: 'bmdLauf', entityId: lauf.id, data: { nummer: lauf.nummer, bis: tagStr(bis), buchungen: lauf.anzahl, zeilen: lauf.zeilen, sha256: lauf.sha256 } });
  await laufMailen(lauf.id).catch((e) => console.error('BMD-Mail', e));
  return lauf;
}

export const dateiName = (l: { nummer: number; bis: Date }) => `bmd_lauf_${String(l.nummer).padStart(5, '0')}_bis_${tagStr(l.bis)}.csv`;
export const dateiLatin1 = (datei: string) => Buffer.from(nachLatin1(datei), 'latin1');

async function laufMailen(id: string) {
  const s = await getSettings();
  if (!s.bmdMail) return;
  const l = await db.bmdLauf.findUniqueOrThrow({ where: { id } });
  await senden({
    to: s.bmdMail, subject: `BMD-Übergabe Lauf ${l.nummer} (bis ${fmtDatum(l.bis)})`, template: 'bmd_lauf',
    html: layout(`BMD-Übergabe Lauf ${l.nummer}`, `<p>Im Anhang die Importdatei für BMD NTCS mit ${l.anzahl} Buchungen (${l.zeilen} Zeilen) bis ${fmtDatum(l.bis)}.</p><p>Prüfsumme (SHA-256): <code>${l.sha256}</code></p><p>Nach dem Import bitte in Lightback unter „BMD-Übergabe“ als übernommen bestätigen.</p>`, ''),
    anhaenge: [{ filename: dateiName(l), content: dateiLatin1(l.datei), contentType: 'text/csv; charset=iso-8859-1' }],
  });
}

/** Täglich nach 2 Uhr einmal: Lauf für den Vortag (Cron alle 5 Minuten) */
export async function bmdTaeglich(jetzt = new Date()) {
  if (!(await modulAn('bmd'))) return 0;
  const stunde = Number(new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', hour12: false }).format(jetzt));
  if (stunde < 2) return 0;
  const bis = gestern();
  if (await db.bmdLauf.findFirst({ where: { quelle: 'automatisch', bis: { gte: bis } }, select: { id: true } })) return 0;
  const l = await laufErstellen({ bis, quelle: 'automatisch' });
  return l?.anzahl ?? 0;
}

export async function rueckmeldung(p: { nummer: number; ok: boolean; referenz?: string; fehler?: string; userId?: string; akteur?: string }) {
  const l = await db.bmdLauf.findUnique({ where: { nummer: p.nummer } });
  if (!l) throw new ApiFehler(404, 'unbekannt', `Lauf ${p.nummer} gibt es nicht`);
  if (l.status === 'uebernommen' || l.status === 'fehler') throw new ApiFehler(409, 'abgeschlossen', `Lauf ${p.nummer} ist bereits abgeschlossen (${STATUS_NAME[l.status]})`);
  const status = p.ok ? 'uebernommen' : 'fehler';
  await db.bmdLauf.update({ where: { id: l.id }, data: { status, bmdReferenz: p.referenz || null, fehler: p.ok ? null : p.fehler || 'ohne Angabe', rueckmeldungAt: new Date() } });
  await protokoll({ ...(p.userId ? {} : { user: null, akteur: p.akteur ?? 'BMD-Konnektor' }), action: p.ok ? 'bmd_uebernommen' : 'bmd_fehler', entity: 'bmdLauf', entityId: l.id, data: { nummer: l.nummer, referenz: p.referenz, fehler: p.fehler }, vorher: { status: l.status }, nachher: { status } });
  return status;
}

export async function abgeholt(l: { id: string; nummer: number; status: string }, von: string, userId?: string) {
  if (l.status !== 'bereit') return;
  await db.bmdLauf.update({ where: { id: l.id }, data: { status: 'abgeholt', abgeholtAt: new Date(), abgeholtVon: von } });
  await protokoll({ ...(userId ? {} : { user: null, akteur: von }), action: 'bmd_abgeholt', entity: 'bmdLauf', entityId: l.id, data: { nummer: l.nummer }, vorher: { status: 'bereit' }, nachher: { status: 'abgeholt' } });
}

/** Bearer-Schlüssel des Konnektors prüfen */
export async function konnektorPruefen(req: Request) {
  if (!(await modulAn('bmd'))) throw new ApiFehler(403, 'funktion_aus', 'Die BMD-Übergabe ist ausgeschaltet.');
  const m = (req.headers.get('authorization') ?? '').match(/^Bearer\s+(loc_bmd_[A-Za-z0-9_-]{32})$/i);
  const s = await getSettings();
  if (!m || !s.bmdKeyHash) throw new ApiFehler(401, 'nicht_angemeldet', 'Schlüssel fehlt oder ist ungültig (Authorization: Bearer loc_bmd_…)');
  const a = Buffer.from(schluesselHash(m[1]), 'hex');
  const b = Buffer.from(s.bmdKeyHash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ApiFehler(401, 'nicht_angemeldet', 'Schlüssel fehlt oder ist ungültig');
}

export const laufJson = (l: { nummer: number; bis: Date; anzahl: number; zeilen: number; sollCents: number; sha256: string; status: string; bmdReferenz: string | null; fehler: string | null; createdAt: Date; abgeholtAt: Date | null; rueckmeldungAt: Date | null }) => ({
  nummer: l.nummer, bis: tagStr(l.bis), buchungen: l.anzahl, zeilen: l.zeilen, sollCents: l.sollCents, sha256: l.sha256, status: l.status,
  bmdReferenz: l.bmdReferenz, fehler: l.fehler, erstellt: l.createdAt.toISOString(), abgeholt: l.abgeholtAt?.toISOString() ?? null, rueckmeldung: l.rueckmeldungAt?.toISOString() ?? null,
  datei: dateiName(l),
});
