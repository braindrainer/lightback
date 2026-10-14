// Revisionssicheres Protokoll. Jeder Eintrag wird unter einer Advisory-Sperre an die Hash-Kette gehängt
// (src/lib/audit-kette.ts); die Datenbank lässt nur Anhängen zu (Trigger, src/lib/schutz.ts).
import type { Prisma } from '@prisma/client';
import type { Nutzer } from './auth';
import { eintragHash, GENESIS, KETTEN_LOCK, normalisieren } from './audit-kette';
import { db } from './db';
import { ketteAusDb } from './schutz';

export type Eintrag = {
  /** undefined: angemeldete Person aus der Sitzung ermitteln; null: ohne Person (dann akteur bzw. „System“) */
  user?: Nutzer | null;
  /** Name für Ereignisse ohne Anmeldung: „Webshop“, „Partner Tiqets“, „System“ … */
  akteur?: string;
  action: string;
  entity: string;
  entityId?: string | null;
  data?: unknown;
  vorher?: unknown;
  nachher?: unknown;
};

/** Einheitliche Bereichsnamen (früher teils groß geschrieben: Order, Show …) */
export const bereich = (e: string) => e.charAt(0).toLowerCase() + e.slice(1);
/** Für Abfragen: alte Schreibweise mitnehmen */
export const bereiche = (e: string) => [...new Set([bereich(e), e.charAt(0).toUpperCase() + e.slice(1)])];

async function kontext(sitzung: boolean) {
  let u: Nutzer | null = null;
  let ip: string | null = null;
  let ua: string | null = null;
  try {
    const { headers } = await import('next/headers');
    const h = await headers();
    ip = h.get('x-real-ip') ?? h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    ua = h.get('user-agent');
  } catch { /* außerhalb einer Anfrage (Cron, Skript) */ }
  if (sitzung) {
    try {
      const { currentUser } = await import('./auth');
      u = await currentUser();
    } catch { u = null; }
  }
  return { u, ip: ip?.slice(0, 64) ?? null, ua: ua?.slice(0, 300) ?? null };
}

const leer = (v: unknown) => v === undefined || v === null || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v as object).length);
const json = (v: unknown) => (leer(v) ? undefined : (normalisieren(v) as Prisma.InputJsonValue));

/** Einträge anhängen (eine Transaktion, eine Sperre). Fehler werden geloggt, brechen den Vorgang aber nicht ab. */
export async function protokollMehrere(eintraege: Eintrag[]) {
  if (!eintraege.length) return;
  try {
    const k = await kontext(eintraege.some((e) => e.user === undefined));
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${KETTEN_LOCK})`);
      const letzter = await tx.auditLog.findFirst({ orderBy: { seq: 'desc' }, select: { hash: true } });
      let prev = letzter?.hash ?? GENESIS;
      for (const e of eintraege) {
        const u = e.user === undefined ? k.u : e.user;
        const zeile = {
          createdAt: new Date(),
          userId: u?.id ?? null,
          userName: u?.name ?? e.akteur ?? 'System',
          action: e.action,
          entity: bereich(e.entity),
          entityId: e.entityId ?? null,
          data: json(e.data),
          vorher: json(e.vorher),
          nachher: json(e.nachher),
          ip: k.ip,
          userAgent: k.ua,
          prevHash: prev,
        };
        const hash = eintragHash(zeile);
        await tx.auditLog.create({ data: { ...zeile, hash } });
        prev = hash;
      }
    }, { maxWait: 10_000, timeout: 60_000 });
  } catch (e) {
    console.error('Protokoll konnte nicht geschrieben werden', eintraege.map((x) => x.action), e);
  }
}

export const protokoll = (e: Eintrag) => protokollMehrere([e]);

/** Kurzform: audit(user, 'aktion', 'bereich', id, daten, { vorher, nachher }) */
export function audit(u: Nutzer | null | undefined, action: string, entity: string, entityId?: string | null, data?: unknown, opt: { vorher?: unknown; nachher?: unknown; akteur?: string } = {}) {
  return protokoll({ user: u, action, entity, entityId, data, ...opt });
}

/** Nur geänderte Felder: { vorher, nachher } (leer, wenn nichts geändert wurde) */
export function aenderung(alt: object | null | undefined, neu: object, felder?: string[]) {
  const a0 = (alt ?? {}) as Record<string, unknown>;
  const n0 = neu as Record<string, unknown>;
  const vorher: Record<string, unknown> = {};
  const nachher: Record<string, unknown> = {};
  for (const k of felder ?? Object.keys(n0)) {
    const a = normalisieren(a0[k]);
    const b = normalisieren(n0[k]);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      vorher[k] = a;
      nachher[k] = b;
    }
  }
  return { vorher, nachher, geaendert: Object.keys(nachher).length > 0 };
}

const GEHEIM = /pass|secret|geheim|token|hash|pin$|key$|enc$/i;
/** Geheimnisse nie ins Protokoll: Werte durch Hinweis ersetzen */
export function maskieren<T>(v: T): T {
  if (Array.isArray(v)) return v.map(maskieren) as T;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, GEHEIM.test(k) && x != null && x !== '' && typeof x !== 'object' ? '••• (gesetzt)' : maskieren(x)])) as T;
  }
  return v;
}

/** Ganze Kette prüfen: erster Bruch, Anzahl, letzter Hash */
export async function pruefeKette() {
  return ketteAusDb(db);
}
