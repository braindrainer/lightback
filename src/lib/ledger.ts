// Doppelte Buchführung für die GmbH (UGB, Bilanzierung, Soll-Versteuerung).
// Kontenplan nach Österreichischem Einheitskontenrahmen (EKR) – Vorschlag, mit der Steuerberatung abstimmen.
//
// Grundsätze der Automatikbuchungen:
// - Tickets werden vor der Vorstellung bezahlt → erhaltene Anzahlung (3480). Die USt entsteht mit der
//   Zahlung (Mindest-Istbesteuerung, § 19 Abs. 2 Z 1 lit. a UStG) und geht in die UVA des Zahlungsmonats.
// - Am Tag der Vorstellung wird die Anzahlung in Erlöse (4000) umgebucht (Leistungsabgrenzung).
// - Wertgutscheine sind Mehrzweckgutscheine: keine USt beim Verkauf, erst bei Einlösung.
// - Zahlungen über Anbieter landen auf Geldtransit-Konten; die Auszahlung aufs Bank­konto gleicht sie aus.
import type { Prisma } from '@prisma/client';
import { db, getSettings } from './db';

type Tx = Prisma.TransactionClient;

export const KONTEN: { number: string; name: string; type: 'aktiv' | 'passiv' | 'aufwand' | 'ertrag'; vatCode?: string }[] = [
  // Klasse 0–2: Anlage- und Umlaufvermögen
  { number: '0600', name: 'Betriebs- und Geschäftsausstattung', type: 'aktiv' },
  { number: '2000', name: 'Lieferforderungen Inland', type: 'aktiv' },
  { number: '2010', name: 'Forderungen an Vertriebspartner', type: 'aktiv' },
  { number: '2500', name: 'Vorsteuer', type: 'aktiv' },
  { number: '2700', name: 'Kassa', type: 'aktiv' },
  { number: '2800', name: 'Bank', type: 'aktiv' },
  { number: '2880', name: 'Geldtransit hobex (online)', type: 'aktiv' },
  { number: '2881', name: 'Geldtransit Stripe', type: 'aktiv' },
  { number: '2882', name: 'Geldtransit PayPal', type: 'aktiv' },
  { number: '2885', name: 'Geldtransit Kartenterminal', type: 'aktiv' },
  // Klasse 3: Verbindlichkeiten
  { number: '3300', name: 'Lieferverbindlichkeiten', type: 'passiv' },
  { number: '3480', name: 'Erhaltene Anzahlungen Tickets (Vorverkauf)', type: 'passiv' },
  { number: '3490', name: 'Verbindlichkeiten aus Gutscheinen', type: 'passiv' },
  { number: '3495', name: 'Verbindlichkeiten aus Erstattungen', type: 'passiv' },
  { number: '3500', name: 'Umsatzsteuer 20 %', type: 'passiv' },
  { number: '3501', name: 'Umsatzsteuer 10 %', type: 'passiv' },
  { number: '3502', name: 'Umsatzsteuer 13 %', type: 'passiv' },
  { number: '3540', name: 'Verrechnung Finanzamt (USt-Zahllast)', type: 'passiv' },
  // Klasse 4: Erlöse
  { number: '4000', name: 'Erlöse Tickets 13 %', type: 'ertrag', vatCode: 'U13' },
  { number: '4100', name: 'Erlöse 10 %', type: 'ertrag', vatCode: 'U10' },
  { number: '4200', name: 'Erlöse Waren 20 %', type: 'ertrag', vatCode: 'U20' },
  { number: '4880', name: 'Erlöse Stornogebühren (nicht steuerbar)', type: 'ertrag' },
  { number: '4890', name: 'Erlöse verfallene Gutscheine', type: 'ertrag' },
  // Klasse 5–7: Aufwand
  { number: '5000', name: 'Wareneinsatz 20 %', type: 'aufwand', vatCode: 'V20' },
  { number: '7200', name: 'Instandhaltung', type: 'aufwand', vatCode: 'V20' },
  { number: '7300', name: 'Transport und Reisen', type: 'aufwand', vatCode: 'V20' },
  { number: '7380', name: 'Telefon und Internet', type: 'aufwand', vatCode: 'V20' },
  { number: '7400', name: 'Miete und Pacht', type: 'aufwand', vatCode: 'V20' },
  { number: '7600', name: 'Büromaterial', type: 'aufwand', vatCode: 'V20' },
  { number: '7650', name: 'Werbung', type: 'aufwand', vatCode: 'V20' },
  { number: '7660', name: 'Provisionen Vertriebspartner', type: 'aufwand' },
  { number: '7700', name: 'Versicherungen', type: 'aufwand' },
  { number: '7750', name: 'Rechts- und Beratungsaufwand', type: 'aufwand', vatCode: 'V20' },
  { number: '7790', name: 'Spesen des Geldverkehrs', type: 'aufwand' },
  { number: '7800', name: 'Sonstiger Aufwand', type: 'aufwand', vatCode: 'V20' },
  // Klasse 9: Kapital
  { number: '9000', name: 'Stammkapital', type: 'passiv' },
  { number: '9390', name: 'Bilanzgewinn / -verlust', type: 'passiv' },
  { number: '9800', name: 'Eröffnungsbilanzkonto', type: 'passiv' },
];

/** UVA-Kennzahlen je Steuercode (U = Umsatzsteuer, V = Vorsteuer) */
export const STEUERCODES: Record<string, { satz: number; art: 'U' | 'V'; kz: string; konto: string }> = {
  U20: { satz: 20, art: 'U', kz: '022', konto: '3500' },
  U10: { satz: 10, art: 'U', kz: '029', konto: '3501' },
  U13: { satz: 13, art: 'U', kz: '006', konto: '3502' },
  V20: { satz: 20, art: 'V', kz: '060', konto: '2500' },
  V13: { satz: 13, art: 'V', kz: '060', konto: '2500' },
  V10: { satz: 10, art: 'V', kz: '060', konto: '2500' },
};
export const ust = (satz: number) => (`U${satz}` in STEUERCODES ? `U${satz}` : null);
export const ERLOESKONTO: Record<number, string> = { 20: '4200', 10: '4100', 13: '4000', 0: '4200' };
export const TRANSIT: Record<string, string> = { hobex: '2880', applepay: '2880', stripe: '2881', paypal: '2882', terminal: '2885', karte: '2885', bar: '2700', rechnung: '2000', partner: '2010' };

export async function seedKonten() {
  for (const k of KONTEN) {
    await db.account.upsert({ where: { number: k.number }, update: {}, create: { ...k, system: true } });
  }
}

export type Zeile = { konto: string; soll?: number; haben?: number; vatCode?: string | null; base?: number | null; text?: string };
export type Buchung = { date: Date; text: string; docRef?: string; source: string; sourceId?: string | null; createdById?: string | null; zeilen: Zeile[] };

/** Bucht einen ausgeglichenen Buchungssatz. Gleiche Quelle (source+sourceId+text) wird nicht doppelt gebucht. */
export async function buchen(b: Buchung, tx: Tx | typeof db = db) {
  const zeilen = b.zeilen.filter((z) => (z.soll ?? 0) !== 0 || (z.haben ?? 0) !== 0);
  // negative Beträge auf die andere Seite drehen
  for (const z of zeilen) {
    if ((z.soll ?? 0) < 0) { z.haben = (z.haben ?? 0) - (z.soll ?? 0); z.soll = 0; }
    if ((z.haben ?? 0) < 0) { z.soll = (z.soll ?? 0) - (z.haben ?? 0); z.haben = 0; }
  }
  const soll = zeilen.reduce((s, z) => s + (z.soll ?? 0), 0);
  const haben = zeilen.reduce((s, z) => s + (z.haben ?? 0), 0);
  if (soll !== haben) throw new Error(`Buchung nicht ausgeglichen: Soll ${soll} ≠ Haben ${haben} (${b.text})`);
  if (soll === 0) return null;
  const st = await (tx as typeof db).settings.findUnique({ where: { id: 1 } });
  if (st?.lockedUntil && b.date <= st.lockedUntil) throw new Error(`Zeitraum bis ${st.lockedUntil.toISOString().slice(0, 10)} ist festgeschrieben`);
  if (b.sourceId) {
    const da = await tx.journalEntry.findFirst({ where: { source: b.source, sourceId: b.sourceId, text: b.text } });
    if (da) return da;
  }
  const nummern = [...new Set(zeilen.map((z) => z.konto))];
  const konten = await tx.account.findMany({ where: { number: { in: nummern } } });
  const id = new Map(konten.map((k) => [k.number, k.id]));
  for (const n of nummern) if (!id.has(n)) throw new Error(`Konto ${n} fehlt`);
  return tx.journalEntry.create({
    data: {
      date: b.date, text: b.text, docRef: b.docRef ?? '', source: b.source, sourceId: b.sourceId ?? null, createdById: b.createdById ?? null,
      lines: { create: zeilen.map((z) => ({ accountId: id.get(z.konto)!, debitCents: z.soll ?? 0, creditCents: z.haben ?? 0, vatCode: z.vatCode ?? null, baseCents: z.base ?? null, text: z.text ?? null })) },
    },
  });
}

/** Storniert einen Buchungssatz durch Gegenbuchung (Buchungen werden nie gelöscht) */
export async function stornoBuchung(entryId: string, datum: Date, userId?: string) {
  const e = await db.journalEntry.findUniqueOrThrow({ where: { id: entryId }, include: { lines: { include: { account: true } } } });
  const neu = await buchen({
    date: datum, text: `Storno: ${e.text}`, docRef: e.docRef, source: 'storno', sourceId: e.id, createdById: userId,
    zeilen: e.lines.map((l) => ({ konto: l.account.number, soll: l.creditCents, haben: l.debitCents, vatCode: l.vatCode, base: l.baseCents == null ? null : -l.baseCents })),
  });
  if (neu) await db.journalEntry.update({ where: { id: neu.id }, data: { reversesId: e.id } });
  return neu;
}

/** Brutto je Steuersatz in Netto + USt zerlegen (USt je Satz auf die Summe) */
export function zerlegen(bruttoJeSatz: Map<number, number>) {
  return [...bruttoJeSatz.entries()].filter(([, b]) => b !== 0).map(([satz, brutto]) => {
    const netto = satz > 0 ? Math.round(brutto / (1 + satz / 100)) : brutto;
    return { satz, brutto, netto, ust: brutto - netto };
  });
}

// ─────────── Automatikbuchungen ───────────

/** Ticketverkauf bezahlt: Geldtransit/Forderung an Anzahlungen + USt 13 % (Gutscheinanteil aus 3490) */
export async function bucheTicketverkauf(tx: Tx, o: { id: string; number: string; paidAt: Date; totalCents: number; voucherCents: number; provider: string; partner?: boolean; feeCommissionCents?: number }) {
  const z = zerlegen(new Map([[13, o.totalCents]]))[0];
  if (!z) return null;
  const zahlung = o.totalCents - o.voucherCents;
  const provision = o.feeCommissionCents ?? 0;
  return buchen({
    date: o.paidAt, text: `Ticketverkauf ${o.number}`, docRef: o.number, source: 'order', sourceId: o.id,
    zeilen: [
      { konto: TRANSIT[o.partner ? 'partner' : o.provider] ?? '2880', soll: zahlung - provision },
      { konto: '7660', soll: provision, text: 'Provision Vertriebspartner' },
      { konto: '3490', soll: o.voucherCents, text: 'Gutschein eingelöst' },
      { konto: '3480', haben: z.netto, vatCode: 'U13', base: z.netto },
      { konto: '3502', haben: z.ust },
    ],
  }, tx);
}

/** Am Vorstellungstag: Anzahlung → Erlös (ohne USt, die ist schon erfasst) */
export async function bucheLeistung(tx: Tx, show: { id: string; startsAt: Date }, nettoCents: number) {
  if (!nettoCents) return null;
  return buchen({
    date: show.startsAt, text: `Leistung Vorstellung ${show.startsAt.toISOString().slice(0, 16).replace('T', ' ')}`, source: 'leistung', sourceId: show.id,
    zeilen: [{ konto: '3480', soll: nettoCents }, { konto: '4000', haben: nettoCents }],
  }, tx);
}

/** Storno vor der Vorstellung: Anzahlung + USt zurück; Erstattung, Gutschein oder Stornogebühr */
export async function bucheStorno(tx: Tx, r: { id: string; date: Date; orderNumber: string; bruttoCents: number; feeCents: number; method: string; provider: string; nachLeistung?: boolean }) {
  const z = zerlegen(new Map([[13, r.bruttoCents]]))[0];
  if (!z) return null;
  const aus = r.bruttoCents - r.feeCents;
  const gegen = r.method === 'gutschein' ? '3490' : r.method === 'keine' ? null : (TRANSIT[r.provider] ?? '3495');
  return buchen({
    date: r.date, text: `Storno ${r.orderNumber}`, docRef: r.orderNumber, source: 'refund', sourceId: r.id,
    zeilen: [
      { konto: r.nachLeistung ? '4000' : '3480', soll: z.netto, vatCode: 'U13', base: -z.netto },
      { konto: '3502', soll: z.ust },
      ...(gegen ? [{ konto: gegen, haben: aus }] : []),
      { konto: '4880', haben: r.feeCents + (gegen ? 0 : aus), text: 'Stornogebühr' },
    ],
  }, tx);
}

/** Kassabeleg: Kassa/Terminal an Erlöse je Steuersatz + USt */
export async function bucheKassabeleg(tx: Tx, b: { id: string; number: string; date: Date; payment: string; bruttoJeSatz: Map<number, number>; storno?: boolean }) {
  const teile = zerlegen(b.bruttoJeSatz);
  const summe = teile.reduce((s, t) => s + t.brutto, 0);
  const sg = b.storno ? -1 : 1;
  return buchen({
    date: b.date, text: `${b.storno ? 'Storno ' : ''}Kassabeleg ${b.number}`, docRef: b.number, source: 'receipt', sourceId: b.id,
    zeilen: [
      { konto: TRANSIT[b.payment] ?? '2700', soll: sg * summe },
      ...teile.flatMap((t) => [
        { konto: ERLOESKONTO[t.satz] ?? '4200', haben: sg * t.netto, vatCode: ust(t.satz), base: sg * t.netto },
        ...(t.ust ? [{ konto: STEUERCODES[ust(t.satz)!].konto, haben: sg * t.ust }] : []),
      ]),
    ],
  }, tx);
}

/** Gutscheinverkauf (Mehrzweck): Zahlung an Gutscheinverbindlichkeit, keine USt */
export async function bucheGutscheinverkauf(tx: Tx, v: { id: string; code: string; date: Date; cents: number; provider: string }) {
  return buchen({ date: v.date, text: `Gutscheinverkauf ${v.code}`, docRef: v.code, source: 'voucher', sourceId: v.id, zeilen: [{ konto: TRANSIT[v.provider] ?? '2700', soll: v.cents }, { konto: '3490', haben: v.cents }] }, tx);
}

/** Auszahlung eines Zahlungsanbieters: Bank + Gebühren an Geldtransit */
export async function bucheAuszahlung(p: { id: string; date: Date; provider: string; bruttoCents: number; gebuehrCents: number; ref: string; userId?: string }) {
  return buchen({
    date: p.date, text: `Auszahlung ${p.provider} ${p.ref}`, docRef: p.ref, source: 'settlement', sourceId: p.id, createdById: p.userId,
    zeilen: [{ konto: '2800', soll: p.bruttoCents - p.gebuehrCents }, { konto: '7790', soll: p.gebuehrCents }, { konto: TRANSIT[p.provider] ?? '2880', haben: p.bruttoCents }],
  });
}

/** Eingangsrechnung: Aufwand + Vorsteuer an Lieferverbindlichkeit */
export async function bucheEingangsrechnung(e: { id: string; date: Date; supplier: string; docNumber: string; konto: string; netto: number; ust: number; satz: number; userId?: string }) {
  const vc = e.ust ? `V${e.satz}` : null;
  return buchen({
    date: e.date, text: `ER ${e.supplier} ${e.docNumber}`.trim(), docRef: e.docNumber, source: 'expense', sourceId: e.id, createdById: e.userId,
    zeilen: [{ konto: e.konto, soll: e.netto, vatCode: vc, base: vc ? e.netto : null }, { konto: '2500', soll: e.ust, vatCode: vc, base: vc ? e.netto : null }, { konto: '3300', haben: e.netto + e.ust }],
  });
}

export async function bucheZahlungEingangsrechnung(e: { id: string; date: Date; supplier: string; docNumber: string; brutto: number; userId?: string }) {
  return buchen({ date: e.date, text: `Zahlung ER ${e.supplier} ${e.docNumber}`.trim(), docRef: e.docNumber, source: 'expense-paid', sourceId: e.id, createdById: e.userId, zeilen: [{ konto: '3300', soll: e.brutto }, { konto: '2800', haben: e.brutto }] });
}

/** Leistungsabgrenzung für alle vergangenen Vorstellungen nachholen (idempotent) */
export async function vorstellungenAbrechnen(bis = new Date()) {
  const shows = await db.show.findMany({ where: { startsAt: { lte: bis }, status: { not: 'abgesagt' } }, select: { id: true, startsAt: true } });
  const erledigt = new Set((await db.journalEntry.findMany({ where: { source: 'leistung' }, select: { sourceId: true } })).map((e) => e.sourceId));
  let n = 0;
  for (const s of shows) {
    if (erledigt.has(s.id)) continue;
    const t = await db.ticket.aggregate({ where: { showId: s.id, status: { not: 'storniert' }, order: { status: { in: ['bezahlt', 'teilstorniert'] } } }, _sum: { priceCents: true } });
    const brutto = t._sum.priceCents ?? 0;
    const netto = zerlegen(new Map([[13, brutto]]))[0]?.netto ?? 0;
    await db.$transaction((tx) => bucheLeistung(tx, s, netto));
    n++;
  }
  return n;
}

export async function gesperrtBis() {
  return (await getSettings()).lockedUntil;
}
