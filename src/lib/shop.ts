// Fachlogik hinter der Shop-API (light.skillful.at) und der Partner-API:
// Verfügbarkeit, Reservierungen, Bestellung mit Zahlungsstart, Abschluss nach Rückkehr vom Anbieter.
import { createHash } from 'node:crypto';
import { Prisma, type Payment } from '@prisma/client';
import { db } from './db';
import { bestePlaetze, freierRollstuhlplatz, type Wunsch } from './bestplatz';
import { bestellungAnlegen, bezahlt, gutscheinPruefen, positionen, stornoMoeglich, STORNO_FRIST_H, type KundeEingabe } from './orders';
import { zahlungStarten, type Anbieter, type Start } from './payments';
import { SITZ, SITZE, sitzName, type Kat, type Preise } from './saal';
import { ApiFehler, iso } from './schnittstelle';
import { holdAendern, MAX_VERLAENGERUNGEN, platzStatus, platzStatusGecacht, PlatzBelegt, ReservierungAbgelaufen, reservieren, zuSperren } from './seats';
import { qrInhalt } from './tickets';

export const WENIG_AB = 40; // weniger freie Sitzplätze → "wenig"

const KAT_IDS = SITZE.map((s) => s.id);
const KAT_VON = SITZE.map((s) => s.kat);
export const PLAETZE_JE_KAT: Record<Kat, number> = { I: 0, II: 0, R: 0 };
for (const s of SITZE) PLAETZE_JE_KAT[s.kat]++;

/** Freie Plätze je Kategorie für viele Vorstellungen – eine gruppierte Abfrage (+ Reihe 0 für Rollstuhlplätze) */
export async function freiJeKat(showIds: string[]): Promise<Map<string, Record<Kat, number>>> {
  const erg = new Map<string, Record<Kat, number>>();
  for (const id of showIds) erg.set(id, { ...PLAETZE_JE_KAT });
  if (!showIds.length) return erg;
  const jetzt = new Date();
  const [rows, reihe0] = await Promise.all([
    db.$queryRaw<{ showId: string; kat: Kat; n: number }[]>(Prisma.sql`
      SELECT l."showId", k.kat, COUNT(*)::int AS n
      FROM "SeatLock" l
      JOIN unnest(${KAT_IDS}::text[], ${KAT_VON}::text[]) AS k(seat, kat) ON k.seat = l."seatId"
      WHERE l."showId" = ANY(${showIds}::text[]) AND (l."expiresAt" IS NULL OR l."expiresAt" > ${jetzt})
      GROUP BY 1, 2`),
    db.seatLock.findMany({ where: { showId: { in: showIds }, OR: [{ seatId: { startsWith: '0-' } }, { seatId: { startsWith: 'R-' } }], AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: jetzt } }] }] }, select: { showId: true, seatId: true } }),
  ]);
  for (const r of rows) if (r.kat !== 'R') erg.get(r.showId)![r.kat] -= r.n;
  // Rollstuhlplatz frei = Stellplatz und beide Zusatzsitze frei
  const belegt = new Map<string, Set<string>>();
  for (const l of reihe0) (belegt.get(l.showId) ?? belegt.set(l.showId, new Set()).get(l.showId)!).add(l.seatId);
  for (const [showId, b] of belegt) {
    erg.get(showId)!.R = SITZE.filter((x) => x.rollstuhl && !b.has(x.id) && !b.has(`0-${2 * x.stellplatz! - 1}`) && !b.has(`0-${2 * x.stellplatz!}`)).length;
  }
  return erg;
}

export type ShowFilter = { from: Date; to: Date; kategorien?: Kat[] };

/** Vorstellungen mit Verfügbarkeit (öffentlich: nur ab jetzt, ohne geplante) */
export async function vorstellungen(f: ShowFilter) {
  const von = new Date(Math.max(f.from.getTime(), Date.now()));
  const shows = await db.show.findMany({ where: { startsAt: { gte: von, lte: f.to }, status: { in: ['verkauf', 'pausiert', 'abgesagt'] } }, orderBy: { startsAt: 'asc' }, select: { id: true, startsAt: true, status: true, prices: true, durationMin: true, title: true } });
  const frei = await freiJeKat(shows.map((s) => s.id));
  return shows.map((s) => {
    const fr = frei.get(s.id)!;
    const sichtbar = f.kategorien ? Object.fromEntries(f.kategorien.map((k) => [k, fr[k]])) : fr;
    const sitz = (f.kategorien ?? ['I', 'II']).filter((k) => k !== 'R').reduce((n, k) => n + fr[k as Kat], 0);
    const prices = s.prices as Preise;
    return {
      id: s.id, title: s.title, startsAt: iso(s.startsAt), durationMin: s.durationMin, status: s.status,
      prices: f.kategorien ? Object.fromEntries(f.kategorien.map((k) => [k, prices[k]])) : prices,
      frei: sichtbar as Partial<Record<Kat, number>>, wenig: sitz > 0 && sitz < WENIG_AB, ausverkauft: Object.values(sichtbar).every((n) => n === 0),
    };
  });
}

export async function oeffentlicheShow(showId: string) {
  const s = await db.show.findUnique({ where: { id: showId } });
  if (!s || s.status === 'geplant') throw new ApiFehler(404, 'unbekannt', 'Vorstellung nicht gefunden');
  return s;
}

/**
 * Sitzstatus ohne Details (Reservierungen und Sperren gelten als belegt), 2 s zwischengespeichert.
 * Mit holdToken werden die Plätze der eigenen Reservierung als "meins" markiert.
 */
export async function sitzStatus(showId: string, kategorien?: Kat[], holdToken?: string | null) {
  await oeffentlicheShow(showId);
  const c = await platzStatusGecacht(showId);
  const meine = holdToken ? await db.hold.findUnique({ where: { token: holdToken }, select: { showId: true, seats: true, expiresAt: true } }) : null;
  const eigen = new Set(meine && meine.showId === showId && meine.expiresAt > new Date() ? zuSperren((meine.seats as { seatId: string }[]).map((x) => x.seatId)) : []);
  const status: Record<string, 'frei' | 'belegt' | 'meins'> = {};
  for (const [id, st] of Object.entries(c.status)) {
    if (kategorien && !kategorien.includes(SITZ[id].kat)) continue;
    status[id] = eigen.has(id) ? 'meins' : st === 'frei' ? 'frei' : 'belegt';
  }
  const etag = `"${c.etag}${eigen.size ? '-' + createHash('sha1').update([...eigen].join(',')).digest('base64url').slice(0, 8) : ''}${kategorien ? '-' + kategorien.join('') : ''}"`;
  return { etag, daten: { showId, status } };
}

export async function holdAusgabe(token: string) {
  const h = await db.hold.findUnique({ where: { token } });
  if (!h || h.expiresAt < new Date()) throw new ApiFehler(410, 'reservierung_abgelaufen', 'Die Reservierung ist abgelaufen');
  const show = await db.show.findUniqueOrThrow({ where: { id: h.showId } });
  const pos = positionen(h.seats as { seatId: string; art: string }[], show.prices as Preise);
  return {
    token: h.token, showId: h.showId, expiresAt: iso(h.expiresAt), restSekunden: Math.max(0, Math.floor((h.expiresAt.getTime() - Date.now()) / 1000)),
    extensions: h.extensions, maxExtensions: MAX_VERLAENGERUNGEN,
    seats: pos.map((p) => ({ ...p, name: sitzName(p.seatId) })), totalCents: pos.reduce((s, p) => s + p.priceCents, 0),
  };
}

// ───────── Missbrauchsschutz: höchstens 3 aktive Reservierungen je IP (im Speicher) ─────────
export const MAX_HOLDS_JE_IP = 3;
const holdsJeIp = new Map<string, string[]>();
export async function holdPlatzFrei(ip: string) {
  const tokens = holdsJeIp.get(ip) ?? [];
  if (tokens.length < MAX_HOLDS_JE_IP) return;
  const aktivNoch = await db.hold.findMany({ where: { token: { in: tokens }, expiresAt: { gt: new Date() } }, select: { token: true } });
  holdsJeIp.set(ip, aktivNoch.map((h) => h.token));
  if (aktivNoch.length >= MAX_HOLDS_JE_IP) throw new ApiFehler(429, 'zu_viele_reservierungen', `Sie haben bereits ${MAX_HOLDS_JE_IP} aktive Reservierungen. Bitte schließen Sie eine Buchung ab oder geben Sie Plätze frei.`);
}
export function holdMerken(ip: string, token: string) {
  holdsJeIp.set(ip, [...(holdsJeIp.get(ip) ?? []), token].slice(-20));
}

/** Reservierung ändern (Shop: Platz für Platz). null = Reservierung ist jetzt leer und gelöscht. */
export async function holdBearbeiten(token: string, p: { add?: SitzWahl[]; remove?: string[]; art?: Record<string, 'normal' | 'ermaessigt'> }) {
  kategorienPruefen((p.add ?? []).map((x) => x.seatId));
  try {
    const h = await holdAendern(token, p);
    return h ? holdAusgabe(h.token) : null;
  } catch (e) {
    if (e instanceof ReservierungAbgelaufen) throw new ApiFehler(410, 'reservierung_abgelaufen', e.message);
    throw e;
  }
}

export type SitzWahl = { seatId: string; art: 'normal' | 'ermaessigt' };

export function kategorienPruefen(seats: string[], erlaubt?: Kat[]) {
  for (const id of seats) {
    if (!SITZ[id]) throw new ApiFehler(400, 'unbekannter_platz', `Unbekannter Platz ${id}`);
    if (erlaubt && !erlaubt.includes(SITZ[id].kat)) throw new ApiFehler(403, 'kategorie_nicht_erlaubt', `Kategorie ${SITZ[id].kat} ist für Sie nicht freigegeben (Platz ${id})`);
  }
}

export async function holdAnlegen(showId: string, seats: SitzWahl[], erlaubt?: Kat[]) {
  kategorienPruefen(seats.map((s) => s.seatId), erlaubt);
  if (new Set(seats.map((s) => s.seatId)).size !== seats.length) throw new ApiFehler(400, 'doppelt', 'Ein Platz ist mehrfach angegeben');
  const h = await reservieren(showId, seats);
  return holdAusgabe(h.token);
}

/** Beste Plätze suchen und sofort reservieren (bei gleichzeitigen Käufen bis zu drei Versuche) */
export async function besteReservieren(p: { showId: string; anzahl: number; kat: Kat; wunsch?: Wunsch; art?: 'normal' | 'ermaessigt' }, erlaubt?: Kat[]) {
  if (erlaubt && !erlaubt.includes(p.kat)) throw new ApiFehler(403, 'kategorie_nicht_erlaubt', `Kategorie ${p.kat} ist für Sie nicht freigegeben`);
  await oeffentlicheShow(p.showId);
  for (let versuch = 0; versuch < 3; versuch++) {
    const st = await platzStatus(p.showId);
    const belegt = new Set(Object.entries(st).filter(([, s]) => s !== 'frei').map(([id]) => id));
    let ids: string[] | null = null;
    if (p.kat === 'R') {
      ids = [];
      for (let i = 0; i < p.anzahl; i++) {
        const r = freierRollstuhlplatz(belegt);
        if (!r) { ids = null; break; }
        ids.push(r);
        belegt.add(r);
        belegt.add(`0-${2 * SITZ[r].stellplatz! - 1}`);
        belegt.add(`0-${2 * SITZ[r].stellplatz!}`);
      }
    } else {
      // Bei Wunsch "gute Sicht" sucht auch der Shop in Kategorie I
      ids = bestePlaetze(p.anzahl, p.wunsch?.sehen && (!erlaubt || erlaubt.includes('I')) ? 'I' : p.kat, belegt, p.wunsch);
    }
    if (!ids) throw new ApiFehler(409, 'keine_plaetze', 'Für diese Anzahl gibt es in dieser Kategorie keine freien Plätze nebeneinander');
    try {
      const h = await reservieren(p.showId, ids.map((seatId) => ({ seatId, art: p.art ?? 'normal' })));
      return holdAusgabe(h.token);
    } catch (e) {
      if (!(e instanceof PlatzBelegt)) throw e;
    }
  }
  throw new ApiFehler(409, 'keine_plaetze', 'Die Plätze wurden gerade vergeben – bitte erneut versuchen');
}

// ───────── Bestellung ─────────

type BestellungVoll = Prisma.OrderGetPayload<{ include: { tickets: true; show: true; invoices: true } }>;

export function bestellungJson(o: BestellungVoll) {
  const rechnung = o.invoices.find((i) => i.kind === 'rechnung');
  return {
    id: o.id, number: o.number, status: o.status, channel: o.channel, manageToken: o.manageToken, partnerRef: o.partnerRef,
    show: { id: o.show.id, title: o.show.title, startsAt: iso(o.show.startsAt), status: o.show.status },
    totalCents: o.totalCents, voucherCents: o.voucherCents, paidCents: o.paidCents, refundedCents: o.refundedCents,
    invoiceNumber: rechnung?.number ?? null, paidAt: iso(o.paidAt),
    stornoMoeglich: ['bezahlt', 'teilstorniert'].includes(o.status) && stornoMoeglich(o.show.startsAt),
    stornoBis: iso(new Date(o.show.startsAt.getTime() - STORNO_FRIST_H * 3600e3)),
    tickets: o.tickets.map((t) => ({ code: t.code, seatId: t.seatId, seat: sitzName(t.seatId), kat: t.kat, art: t.art, priceCents: t.priceCents, status: t.status, qr: qrInhalt(t.code, t.showId) })),
  };
}

export async function bestellungLaden(where: Prisma.OrderWhereUniqueInput | Prisma.OrderWhereInput) {
  return db.order.findFirst({ where: where as Prisma.OrderWhereInput, include: { tickets: { orderBy: { seatId: 'asc' } }, show: true, invoices: true } });
}

/** Frühere, nicht abgeschlossene Versuche zu dieser Reservierung schließen (Reservierung bleibt) */
async function alteVersucheSchliessen(holdId: string) {
  const alt = await db.order.findMany({ where: { holdId, status: 'offen' }, select: { id: true } });
  for (const o of alt) {
    await db.$transaction([
      db.order.update({ where: { id: o.id }, data: { status: 'storniert', cancelledAt: new Date(), holdId: null, note: 'Zahlung nicht abgeschlossen – neuer Versuch' } }),
      db.payment.updateMany({ where: { orderId: o.id, status: 'offen' }, data: { status: 'fehlgeschlagen' } }),
    ]);
  }
}

const appOrigin = () => (process.env.APP_ORIGIN ?? 'https://lightback.skillful.at').replace(/\/$/, '');
export const shopOrigin = () => (process.env.PUBLIC_ORIGIN ?? '').replace(/\/$/, '');

export type ShopBestellung = { holdToken: string; kunde: KundeEingabe; voucherCode?: string; provider: Anbieter | 'gutschein'; demoKarte?: string; locale: string };

export async function shopBestellen(p: ShopBestellung) {
  const hold = await db.hold.findUnique({ where: { token: p.holdToken } });
  if (!hold || hold.expiresAt < new Date()) throw new ApiFehler(410, 'reservierung_abgelaufen', 'Die Reservierung ist abgelaufen. Bitte wählen Sie die Plätze erneut.');
  const show = await db.show.findUniqueOrThrow({ where: { id: hold.showId } });
  if (show.status !== 'verkauf') throw new ApiFehler(409, 'kein_verkauf', 'Für diese Vorstellung ist kein Verkauf möglich');
  const summe = positionen(hold.seats as { seatId: string; art: string }[], show.prices as Preise).reduce((s, x) => s + x.priceCents, 0);
  let gutschein = 0;
  if (p.voucherCode) {
    try { gutschein = Math.min((await gutscheinPruefen(p.voucherCode)).remainingCents, summe); } catch (e) { throw new ApiFehler(422, 'gutschein_ungueltig', (e as Error).message); }
  }
  const zahl = summe - gutschein;
  if (zahl > 0 && p.provider === 'gutschein') throw new ApiFehler(422, 'gutschein_reicht_nicht', 'Der Gutschein deckt den Betrag nicht – bitte eine Zahlungsart wählen');
  await alteVersucheSchliessen(hold.id);
  const o = await bestellungAnlegen({ holdToken: p.holdToken, kunde: { ...p.kunde, locale: p.locale }, channel: 'web', voucherCode: p.voucherCode, locale: p.locale });

  if (zahl === 0) {
    if (!(await bezahlt(o.id, { provider: 'gutschein', providerRef: o.voucherCode ?? 'gratis', amountCents: 0 }))) throw new ApiFehler(409, 'plaetze_vergeben', 'Die Plätze sind nicht mehr frei – bitte wählen Sie neue Plätze.');
    return { status: 'bezahlt' as const, order: bestellungJson((await bestellungLaden({ id: o.id }))!) };
  }
  const anbieter = p.provider as Anbieter;
  const start = await zahlungStarten(anbieter, zahl, o.number, { rueck: `${appOrigin()}/api/zahlung/paypal/return?order=${o.id}`, demoKarte: p.demoKarte });
  if (start.status === 'bezahlt') {
    if (!(await bezahlt(o.id, { provider: anbieter, providerRef: start.providerRef, amountCents: zahl, raw: start.raw }))) throw new ApiFehler(409, 'plaetze_vergeben', 'Die Plätze waren nicht mehr frei. Die Zahlung wurde erstattet – bitte wählen Sie neue Plätze.');
    return { status: 'bezahlt' as const, order: bestellungJson((await bestellungLaden({ id: o.id }))!) };
  }
  if (start.status === 'weiter') {
    await db.payment.create({ data: { orderId: o.id, provider: anbieter, status: 'offen', amountCents: zahl, providerRef: start.providerRef, raw: (start.raw ?? undefined) as object | undefined } });
    return {
      status: 'weiter' as const, orderId: o.id, number: o.number, manageToken: o.manageToken, provider: anbieter, amountCents: zahl,
      redirectUrl: start.redirectUrl ?? null, clientData: start.clientData ?? null,
      // hobex: Formular schickt die Kund:innen hierher zurück (OPP hängt ?id=… an)
      shopperResultUrl: anbieter === 'hobex' || anbieter === 'applepay' ? `${appOrigin()}/api/zahlung/hobex/return?order=${o.id}` : null,
    };
  }
  // Abgelehnt: Versuch schließen, Reservierung bleibt für den nächsten Versuch
  await db.$transaction([
    db.payment.create({ data: { orderId: o.id, provider: anbieter, status: 'fehlgeschlagen', amountCents: zahl, providerRef: start.providerRef || null, raw: (start.raw ?? undefined) as object | undefined } }),
    db.order.update({ where: { id: o.id }, data: { status: 'storniert', cancelledAt: new Date(), holdId: null, note: `Zahlung abgelehnt: ${start.fehler ?? ''}`.trim() } }),
  ]);
  return { status: 'abgelehnt' as const, message: start.fehler ?? 'Die Zahlung wurde abgelehnt', holdToken: p.holdToken };
}

/**
 * Ergebnis einer Zahlung beim Anbieter verarbeiten (Rückkehr, Webhook, Bestätigung aus dem Browser).
 * Idempotent: bezahlt() tut beim zweiten Aufruf nichts.
 */
export async function zahlungAbschliessen(zahlung: Payment, e: Start) {
  if (!zahlung.orderId) return 'unbekannt' as const;
  if (e.status === 'bezahlt') {
    if (zahlung.status === 'bezahlt') return 'bezahlt' as const;
    try {
      const ok = await bezahlt(zahlung.orderId, { provider: zahlung.provider, providerRef: e.providerRef || zahlung.providerRef || '', amountCents: zahlung.amountCents, raw: e.raw });
      if (!ok && (await db.order.findUnique({ where: { id: zahlung.orderId }, select: { status: true } }))?.status === 'offen') return 'fehler' as const; // Plätze weg, erstattet
    } catch (err) {
      // Geld ist da, Reservierung aber weg → manuell erstatten oder Plätze zuweisen
      console.error('Zahlung ohne Reservierung', zahlung.id, err);
      await db.payment.update({ where: { id: zahlung.id }, data: { status: 'bezahlt', paidAt: new Date(), raw: { fehler: (err as Error).message, anbieter: (e.raw ?? null) as object } } });
      await db.auditLog.create({ data: { action: 'zahlung_ohne_reservierung', entity: 'order', entityId: zahlung.orderId, data: { paymentId: zahlung.id, fehler: (err as Error).message } } });
      return 'fehler' as const;
    }
    return 'bezahlt' as const;
  }
  if (e.status === 'abgelehnt' && zahlung.status === 'offen') {
    await db.$transaction([
      db.payment.update({ where: { id: zahlung.id }, data: { status: 'fehlgeschlagen', raw: (e.raw ?? undefined) as object | undefined } }),
      db.order.updateMany({ where: { id: zahlung.orderId, status: 'offen' }, data: { status: 'storniert', cancelledAt: new Date(), holdId: null, note: `Zahlung abgelehnt: ${e.fehler ?? ''}`.trim() } }),
    ]);
    return 'abgelehnt' as const;
  }
  return 'offen' as const;
}

/** Ziel im Shop nach der Rückkehr vom Zahlungsanbieter */
export async function shopZiel(orderId: string | null | undefined, ergebnis: string) {
  const o = orderId ? await db.order.findUnique({ where: { id: orderId }, select: { manageToken: true, locale: true } }) : null;
  const lang = o?.locale === 'en' ? 'en' : 'de';
  if (ergebnis === 'bezahlt' && o) return `${shopOrigin()}/${lang}/confirmation?order=${encodeURIComponent(o.manageToken)}`;
  return `${shopOrigin()}/${lang}/checkout?zahlung=${ergebnis === 'offen' ? 'offen' : 'abgelehnt'}`;
}
