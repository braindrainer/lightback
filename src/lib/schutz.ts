// Schutz auf Datenbankebene: Protokoll nur anhängen, Buchhaltung, Belege, Tickets, Rechnungen, Zahlungen
// und Erstattungen nie löschen. Idempotent, läuft bei jedem Start (scripts/schutz.ts) vor dem Server.
// Nur relative Importe – das Skript läuft im Container mit tsx ohne tsconfig.
import type { PrismaClient } from '@prisma/client';
import { abschnittPruefen, eintragHash, GENESIS, KETTEN_LOCK, type KettenZeile } from './audit-kette';

/** Tabellen, deren Zeilen nie gelöscht werden dürfen */
export const NIE_LOESCHEN = ['JournalEntry', 'JournalLine', 'Receipt', 'Ticket', 'Invoice', 'Payment', 'Refund', 'Order', 'CheckIn', 'VoucherRedemption'];

/** Spalten, die vor dem Prisma-Schemaabgleich angelegt sein müssen (db push verlangt sonst --accept-data-loss für seq) */
const SPALTEN: [string, string][] = [['seq', 'SERIAL NOT NULL'], ['vorher', 'JSONB'], ['nachher', 'JSONB'], ['ip', 'TEXT'], ['userAgent', 'TEXT'], ['prevHash', 'TEXT'], ['hash', 'TEXT']];

const FUNKTIONEN = [
  // Protokoll: nichts ändern, nichts löschen
  `CREATE OR REPLACE FUNCTION lb_unveraenderlich() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Lightback-Schutz: % auf "%" ist nicht erlaubt (revisionssicher)', TG_OP, TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$`,
  // Neuer Protokolleintrag muss an den letzten anschließen
  `CREATE OR REPLACE FUNCTION lb_auditlog_anhaengen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE letzter text;
BEGIN
  PERFORM pg_advisory_xact_lock(${KETTEN_LOCK});
  IF NEW.hash IS NULL OR NEW.hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Lightback-Schutz: Protokolleintrag ohne gültigen Hash' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT hash INTO letzter FROM "AuditLog" ORDER BY seq DESC LIMIT 1;
  IF NEW."prevHash" IS DISTINCT FROM COALESCE(letzter, '${GENESIS}') THEN
    RAISE EXCEPTION 'Lightback-Schutz: Protokolleintrag schließt nicht an die Kette an' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$`,
  // Buchungssatz: nur reversesId darf einmal gesetzt werden (Storno-Verweis), sonst unveränderlich
  `CREATE OR REPLACE FUNCTION lb_journal_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."reversesId" IS NULL AND (to_jsonb(NEW) - 'reversesId') = (to_jsonb(OLD) - 'reversesId') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Lightback-Schutz: Buchungssätze sind unveränderlich – bitte stornieren' USING ERRCODE = 'insufficient_privilege';
END $$`,
];

const trigger = (name: string, tabelle: string, wann: string, funktion: string, ebene = 'ROW') => [
  `DROP TRIGGER IF EXISTS ${name} ON "${tabelle}"`,
  `CREATE TRIGGER ${name} ${wann} ON "${tabelle}" FOR EACH ${ebene} EXECUTE FUNCTION ${funktion}()`,
];

export function schutzSql(): string[] {
  return [
    ...FUNKTIONEN,
    ...trigger('lb_auditlog_anhaengen', 'AuditLog', 'BEFORE INSERT', 'lb_auditlog_anhaengen'),
    ...trigger('lb_auditlog_schutz', 'AuditLog', 'BEFORE UPDATE OR DELETE', 'lb_unveraenderlich'),
    ...trigger('lb_auditlog_truncate', 'AuditLog', 'BEFORE TRUNCATE', 'lb_unveraenderlich', 'STATEMENT'),
    ...NIE_LOESCHEN.flatMap((t) => [
      ...trigger(`lb_${t.toLowerCase()}_loeschen`, t, 'BEFORE DELETE', 'lb_unveraenderlich'),
      ...trigger(`lb_${t.toLowerCase()}_truncate`, t, 'BEFORE TRUNCATE', 'lb_unveraenderlich', 'STATEMENT'),
    ]),
    ...trigger('lb_journalline_aendern', 'JournalLine', 'BEFORE UPDATE', 'lb_unveraenderlich'),
    ...trigger('lb_receipt_aendern', 'Receipt', 'BEFORE UPDATE', 'lb_unveraenderlich'),
    ...trigger('lb_journalentry_aendern', 'JournalEntry', 'BEFORE UPDATE', 'lb_journal_update'),
  ];
}

/**
 * Einträge aus der Zeit vor der Hash-Kette einmalig versiegeln (in seq-Reihenfolge an die Kette hängen).
 * Läuft nur, solange der Anhänge-Trigger noch nicht existiert – danach kann es keine Einträge ohne Hash geben.
 */
async function altbestandVersiegeln(db: PrismaClient) {
  const da = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'lb_auditlog_anhaengen'`;
  if (da[0]?.n) return 0;
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${KETTEN_LOCK})`);
    const zeilen = await tx.auditLog.findMany({ orderBy: { seq: 'asc' } });
    let prev = GENESIS;
    let n = 0;
    for (const z of zeilen) {
      if (z.hash) {
        // schon versiegelt (z. B. zweiter Lauf nach Abbruch) – nur weiterketten
        prev = z.hash;
        continue;
      }
      const hash = eintragHash({ ...z, prevHash: prev });
      await tx.auditLog.update({ where: { id: z.id }, data: { prevHash: prev, hash } });
      prev = hash;
      n++;
    }
    return n;
  }, { timeout: 120_000, maxWait: 30_000 });
}

/** Spalten anlegen, Altbestand versiegeln, Funktionen und Trigger (neu) anlegen – alles idempotent */
export async function schutzAnwenden(db: PrismaClient, opt: { nurSpalten?: boolean } = {}) {
  const tabelle = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'AuditLog'`;
  if (!tabelle[0]?.n) return { versiegelt: 0, trigger: 0, hinweis: 'Tabelle AuditLog fehlt noch' };
  const da = new Set((await db.$queryRaw<{ c: string }[]>`SELECT column_name AS c FROM information_schema.columns WHERE table_name = 'AuditLog'`).map((x) => x.c));
  for (const [name, typ] of SPALTEN) if (!da.has(name)) await db.$executeRawUnsafe(`ALTER TABLE "AuditLog" ADD COLUMN "${name}" ${typ}`);
  await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "AuditLog_seq_key" ON "AuditLog"("seq")`);
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AuditLog_entity_entityId_createdAt_idx" ON "AuditLog"("entity", "entityId", "createdAt")`);
  if (opt.nurSpalten) return { versiegelt: 0, trigger: 0 };
  const versiegelt = await altbestandVersiegeln(db);
  const sql = schutzSql();
  await db.$transaction(async (tx) => {
    for (const s of sql) await tx.$executeRawUnsafe(s);
  });
  return { versiegelt, trigger: sql.filter((s) => s.startsWith('CREATE TRIGGER')).length };
}

/** Kette aus der Datenbank prüfen (auch für das Skript ohne Next.js) */
export async function ketteAusDb(db: PrismaClient, opt: { block?: number } = {}) {
  const block = opt.block ?? 2000;
  let prev = GENESIS;
  let nach = 0;
  let anzahl = 0;
  const luecken: number[] = [];
  let letzteSeq: number | undefined;
  for (;;) {
    const zeilen = (await db.auditLog.findMany({ where: { seq: { gt: nach } }, orderBy: { seq: 'asc' }, take: block })) as unknown as KettenZeile[];
    if (!zeilen.length) break;
    if (letzteSeq !== undefined && zeilen[0].seq !== letzteSeq + 1) luecken.push(zeilen[0].seq);
    const r = abschnittPruefen(zeilen, prev);
    luecken.push(...r.luecken);
    if (r.fehler) return { ok: false as const, anzahl: anzahl + zeilen.findIndex((z) => z.seq === r.fehler!.seq), letzterHash: r.letzter, fehler: r.fehler, luecken };
    anzahl += zeilen.length;
    prev = r.letzter;
    letzteSeq = r.letzteSeq;
    nach = zeilen[zeilen.length - 1].seq;
  }
  return { ok: true as const, anzahl, letzterHash: prev, letzteSeq, luecken };
}
