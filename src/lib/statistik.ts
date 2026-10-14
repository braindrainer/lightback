// Kennzahlen für /statistik. Verkauf zählt nach Zahlungstag (paidAt, Wiener Kalendertag),
// Auslastung und Check-in nach Vorstellungen im Zeitraum. Alles mit wenigen gruppierten Abfragen.
import { Prisma } from '@prisma/client';
import { db } from './db';
import { wienTag, wienZuUtc } from './dates';
import { KAPAZITAET } from './saal';

const WIEN = (spalte: string) => Prisma.raw(`((${spalte} AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Vienna')`);
const nettoVon = (brutto: number) => Math.round(brutto / 1.13);

export type Zeitraum = { von: string; bis: string; fromUtc: Date; toUtc: Date; tage: number };

export const tagPlus = (tag: string, n: number) => {
  const [y, m, d] = tag.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/** Voreinstellungen: heute, 7 Tage, Monat, Jahr – oder eigener Zeitraum */
export function zeitraumAus(p: { preset?: string; von?: string; bis?: string }): Zeitraum & { preset: string } {
  const heute = wienTag(new Date());
  const re = /^\d{4}-\d{2}-\d{2}$/;
  let von = heute, bis = heute, preset = p.preset ?? '';
  if (p.von && p.bis && re.test(p.von) && re.test(p.bis) && !p.preset) { von = p.von <= p.bis ? p.von : p.bis; bis = p.von <= p.bis ? p.bis : p.von; preset = 'eigen'; }
  else if (preset === '7') von = tagPlus(heute, -6);
  else if (preset === 'jahr') von = `${heute.slice(0, 4)}-01-01`;
  else if (preset === 'heute') von = heute;
  else { preset = 'monat'; von = `${heute.slice(0, 7)}-01`; }
  if (tagPlus(von, 731) < bis) von = tagPlus(bis, -731); // höchstens zwei Jahre
  const fromUtc = wienZuUtc(von, '00:00');
  const toUtc = wienZuUtc(tagPlus(bis, 1), '00:00');
  const tage = Math.round((Date.UTC(+bis.slice(0, 4), +bis.slice(5, 7) - 1, +bis.slice(8)) - Date.UTC(+von.slice(0, 4), +von.slice(5, 7) - 1, +von.slice(8))) / 864e5) + 1;
  return { von, bis, fromUtc, toUtc, tage, preset };
}

type Zeile = { tickets: number; umsatz: number; alle: number; storniert: number };
const METRIK = Prisma.sql`COUNT(*) FILTER (WHERE t.status <> 'storniert')::int AS tickets,
  COALESCE(SUM(t."priceCents") FILTER (WHERE t.status <> 'storniert'), 0)::int AS umsatz,
  COUNT(*)::int AS alle, COUNT(*) FILTER (WHERE t.status = 'storniert')::int AS storniert`;

export async function tagesreihe(z: Zeitraum) {
  const rows = await db.$queryRaw<(Zeile & { tag: string })[]>(Prisma.sql`
    SELECT to_char(${WIEN('o."paidAt"')}, 'YYYY-MM-DD') AS tag, ${METRIK}
    FROM "Ticket" t JOIN "Order" o ON o.id = t."orderId"
    WHERE o."paidAt" >= ${z.fromUtc} AND o."paidAt" < ${z.toUtc}
    GROUP BY 1 ORDER BY 1`);
  const m = new Map(rows.map((r) => [r.tag, r]));
  const reihe: (Zeile & { tag: string })[] = [];
  for (let t = z.von; t <= z.bis; t = tagPlus(t, 1)) reihe.push(m.get(t) ?? { tag: t, tickets: 0, umsatz: 0, alle: 0, storniert: 0 });
  return reihe;
}

export async function statistik(z: Zeitraum) {
  const basis = Prisma.sql`FROM "Ticket" t JOIN "Order" o ON o.id = t."orderId" WHERE o."paidAt" >= ${z.fromUtc} AND o."paidAt" < ${z.toUtc}`;
  const [reihe, kanal, kat, partner, vorlauf, shows, kassa] = await Promise.all([
    tagesreihe(z),
    db.$queryRaw<(Zeile & { kanal: string })[]>(Prisma.sql`SELECT o.channel AS kanal, ${METRIK} ${basis} GROUP BY 1 ORDER BY umsatz DESC`),
    db.$queryRaw<(Zeile & { kat: string; art: string })[]>(Prisma.sql`SELECT t.kat, t.art, ${METRIK} ${basis} GROUP BY 1, 2 ORDER BY 1, 2`),
    db.$queryRaw<(Zeile & { id: string; name: string; pct: number })[]>(Prisma.sql`
      SELECT p.id, p.name, p."commissionPct" AS pct, ${METRIK}
      FROM "Ticket" t JOIN "Order" o ON o.id = t."orderId" JOIN "Partner" p ON p.id = o."partnerId"
      WHERE o."paidAt" >= ${z.fromUtc} AND o."paidAt" < ${z.toUtc} GROUP BY 1, 2, 3 ORDER BY umsatz DESC`),
    db.$queryRaw<{ stufe: number; tickets: number }[]>(Prisma.sql`
      SELECT CASE WHEN d < 1 THEN 0 WHEN d < 3 THEN 1 WHEN d < 8 THEN 2 WHEN d < 15 THEN 3 WHEN d < 31 THEN 4 ELSE 5 END AS stufe, COUNT(*)::int AS tickets
      FROM (SELECT (${WIEN('s."startsAt"')})::date - (${WIEN('o."paidAt"')})::date AS d
            FROM "Ticket" t JOIN "Order" o ON o.id = t."orderId" JOIN "Show" s ON s.id = t."showId"
            WHERE o."paidAt" >= ${z.fromUtc} AND o."paidAt" < ${z.toUtc} AND t.status <> 'storniert') x
      GROUP BY 1 ORDER BY 1`),
    db.$queryRaw<{ id: string; startsAt: Date; dow: number; zeit: string; verkauft: number; ein: number; gueltig: number }[]>(Prisma.sql`
      SELECT s.id, s."startsAt", EXTRACT(ISODOW FROM ${WIEN('s."startsAt"')})::int AS dow, to_char(${WIEN('s."startsAt"')}, 'HH24:MI') AS zeit,
        COUNT(t.id) FILTER (WHERE t.status <> 'storniert')::int AS verkauft,
        COUNT(t.id) FILTER (WHERE t.status = 'eingelassen')::int AS ein,
        COUNT(t.id) FILTER (WHERE t.status = 'gueltig')::int AS gueltig
      FROM "Show" s LEFT JOIN "Ticket" t ON t."showId" = s.id
      WHERE s."startsAt" >= ${z.fromUtc} AND s."startsAt" < ${z.toUtc} AND s.status <> 'abgesagt'
      GROUP BY s.id`),
    db.$queryRaw<{ kategorie: string; cents: number; belege: number }[]>(Prisma.sql`
      SELECT COALESCE(p.category, CASE WHEN i ? 'ticketIds' THEN 'ticket' ELSE 'sonstiges' END) AS kategorie,
        COALESCE(SUM(CASE WHEN r.type = 'storno' THEN -ABS((i->>'quantity')::int * (i->>'unitCents')::int) ELSE (i->>'quantity')::int * (i->>'unitCents')::int END), 0)::int AS cents,
        COUNT(DISTINCT r.id)::int AS belege
      FROM "Receipt" r CROSS JOIN LATERAL jsonb_array_elements(r.items) i LEFT JOIN "Product" p ON p.id = i->>'productId'
      WHERE r."createdAt" >= ${z.fromUtc} AND r."createdAt" < ${z.toUtc} AND r.type IN ('standard', 'storno')
      GROUP BY 1 ORDER BY cents DESC`),
  ]);

  const sum = (rs: Zeile[]) => rs.reduce((a, r) => ({ tickets: a.tickets + r.tickets, umsatz: a.umsatz + r.umsatz, alle: a.alle + r.alle, storniert: a.storniert + r.storniert }), { tickets: 0, umsatz: 0, alle: 0, storniert: 0 });
  const gesamt = sum(reihe);
  const jetzt = Date.now();
  const gespielt = shows.filter((s) => new Date(s.startsAt).getTime() < jetzt);
  const ein = gespielt.reduce((n, s) => n + s.ein, 0);
  const einBasis = gespielt.reduce((n, s) => n + s.ein + s.gueltig, 0);
  const verkauftShows = shows.reduce((n, s) => n + s.verkauft, 0);

  // Wochentag × Uhrzeit: Ø Auslastung in %
  const zeiten = [...new Set(shows.map((s) => s.zeit))].sort();
  const heat = new Map<string, { n: number; summe: number }>();
  for (const s of shows) {
    const k = `${s.dow}|${s.zeit}`;
    const h = heat.get(k) ?? { n: 0, summe: 0 };
    h.n++; h.summe += s.verkauft;
    heat.set(k, h);
  }
  const heatmap = { zeiten, zellen: [1, 2, 3, 4, 5, 6, 7].map((dow) => zeiten.map((zeit) => { const h = heat.get(`${dow}|${zeit}`); return h ? { shows: h.n, pct: Math.round((h.summe / h.n / KAPAZITAET) * 100) } : null; })) };

  const VORLAUF = ['Am Vorstellungstag', '1–2 Tage', '3–7 Tage', '8–14 Tage', '15–30 Tage', 'Mehr als 30 Tage'];
  const vl = VORLAUF.map((label, i) => ({ label, tickets: vorlauf.find((v) => v.stufe === i)?.tickets ?? 0 }));

  return {
    reihe,
    kpi: {
      umsatzBrutto: gesamt.umsatz, umsatzNetto: nettoVon(gesamt.umsatz), tickets: gesamt.tickets,
      schnitt: gesamt.tickets ? Math.round(gesamt.umsatz / gesamt.tickets) : 0,
      auslastung: shows.length ? (verkauftShows / (shows.length * KAPAZITAET)) * 100 : null, shows: shows.length,
      stornoquote: gesamt.alle ? (gesamt.storniert / gesamt.alle) * 100 : null, storniert: gesamt.storniert,
      checkin: einBasis ? (ein / einBasis) * 100 : null, eingelassen: ein, gespielt: gespielt.length,
      kassa: kassa.reduce((n, k) => n + k.cents, 0),
    },
    kanal, kat, partner: partner.map((p) => ({ ...p, provision: Math.round((p.umsatz * p.pct) / 100) })), vorlauf: vl, heatmap, kassa,
    top: [...shows].sort((a, b) => b.verkauft - a.verkauft).slice(0, 10).map((s) => ({ ...s, pct: (s.verkauft / KAPAZITAET) * 100 })),
  };
}

/** Freikarten je Grund (Gästeliste) und No-Show je gespielter Vorstellung – nach Vorstellungstag */
export async function vorOrtStatistik(z: Zeitraum) {
  const [frei, shows] = await Promise.all([
    db.$queryRaw<{ grund: string; karten: number; gaeste: number; ein: number }[]>(Prisma.sql`
      SELECT COALESCE(o.meta->'gast'->>'grund', 'ohne Gästeliste') AS grund, COUNT(t.id)::int AS karten, COUNT(DISTINCT o.id)::int AS gaeste,
        COUNT(t.id) FILTER (WHERE t.status = 'eingelassen')::int AS ein
      FROM "Ticket" t JOIN "Order" o ON o.id = t."orderId" JOIN "Show" s ON s.id = t."showId"
      WHERE t.art = 'frei' AND t.status <> 'storniert' AND s."startsAt" >= ${z.fromUtc} AND s."startsAt" < ${z.toUtc}
      GROUP BY 1 ORDER BY 2 DESC`),
    db.$queryRaw<{ id: string; startsAt: Date; verkauft: number; ein: number; frei: number }[]>(Prisma.sql`
      SELECT s.id, s."startsAt", COUNT(t.id) FILTER (WHERE t.status <> 'storniert')::int AS verkauft,
        COUNT(t.id) FILTER (WHERE t.status = 'eingelassen')::int AS ein,
        COUNT(t.id) FILTER (WHERE t.status <> 'storniert' AND t.art = 'frei')::int AS frei
      FROM "Show" s LEFT JOIN "Ticket" t ON t."showId" = s.id
      WHERE s."startsAt" >= ${z.fromUtc} AND s."startsAt" < ${z.toUtc} AND s."startsAt" < now() AND s.status <> 'abgesagt'
      GROUP BY s.id ORDER BY s."startsAt" DESC LIMIT 60`),
  ]);
  return { frei, noShow: shows.filter((x) => x.verkauft > 0).map((x) => ({ ...x, noShow: x.verkauft - x.ein })) };
}

export const KANAL_NAME: Record<string, string> = { web: 'Webshop', telefon: 'Telefon', abendkasse: 'Abendkasse', partner: 'Partner', gast: 'Gästeliste' };
export const ART_NAME: Record<string, string> = { normal: 'Vollpreis', ermaessigt: 'Ermäßigt', rollstuhl: 'Rollstuhlplatz', frei: 'Freikarte' };
export const KASSA_NAME: Record<string, string> = { merch: 'Merchandise', getraenk: 'Getränke', snack: 'Snacks', ticket: 'Tickets', sonstiges: 'Sonstiges' };
export const WOCHENTAGE = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
