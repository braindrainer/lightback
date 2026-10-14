// Kassa vor Ort: Verkauf (Waren, Abendkasse-Tickets, Wertgutscheine), Storno, Schichten, Kassabericht.
// Belege entstehen ausschließlich über rksv.belegErstellen.
import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { audit } from './audit';
import type { Nutzer } from './auth';
import { db } from './db';
import { fmtZeit } from './dates';
import { istGutschein, ticketArt, ticketPreis } from './kassa-shared';
import { buchen, bucheKassabeleg, TRANSIT, zerlegen } from './ledger';
import { bestellungAnlegen, bezahlt, gutscheinVerkaufen, stornieren } from './orders';
import { belegErstellen, type Belegart, type Position } from './rksv';
import { SITZE, TICKET_UST, type Kat, type Preise } from './saal';
import { PlatzBelegt, platzStatus, reservieren } from './seats';
import { encrypt } from './secret';

type Tx = Prisma.TransactionClient;
export type Zahlart = 'bar' | 'karte';
export const ZAHLART_NAME: Record<string, string> = { bar: 'Bar', karte: 'Karte (Terminal)' };
/** Anbieter für orders/ledger: Kartenzahlung am Terminal läuft über das Geldtransitkonto 2885 */
const anbieter = (z: string) => (z === 'karte' ? 'terminal' : 'bar');

export const belegRef = (kassenId: string, nr: number) => `${kassenId}/${nr}`;

// ─────────── Bestplatz-Vergabe für die Abendkasse ───────────

const SAAL = SITZE.filter((s) => s.reihe > 0);
const MITTE = SAAL.reduce((s, x) => s + x.x, 0) / SAAL.length;
const wert = (s: (typeof SITZE)[number]) => s.reihe * 10 + Math.abs(s.x - MITTE) / 12;

/** Beste freie Plätze: möglichst nebeneinander, vorne und mittig. Zusatzsitze in Reihe 0 nur, wenn nichts anderes frei ist. */
export async function bestePlaetze(showId: string, wuensche: { kat: Kat; art: string; anzahl: number }[]) {
  const st = await platzStatus(showId);
  const belegt = new Set(Object.entries(st).filter(([, s]) => s !== 'frei').map(([id]) => id));
  const out: { seatId: string; art: string }[] = [];
  for (const w of wuensche) {
    const frei = SITZE.filter((s) => s.kat === w.kat && !belegt.has(s.id));
    const ohneZusatz = frei.filter((s) => !s.stellplatz || s.rollstuhl);
    const pool = ohneZusatz.length >= w.anzahl ? ohneZusatz : frei;
    if (pool.length < w.anzahl) throw new Error(`Kategorie ${w.kat}: nur noch ${pool.length} Plätze frei`);
    let wahl: typeof pool | null = null;
    if (w.anzahl > 1 && w.kat !== 'R') {
      // Fenster nebeneinanderliegender Plätze je Reihe
      const reihen = new Map<number, typeof pool>();
      for (const s of pool) reihen.set(s.reihe, [...(reihen.get(s.reihe) ?? []), s]);
      let best = Infinity;
      for (const r of reihen.values()) {
        r.sort((a, b) => a.platz - b.platz);
        for (let i = 0; i + w.anzahl <= r.length; i++) {
          const f = r.slice(i, i + w.anzahl);
          const zusammen = f.every((s, j) => j === 0 || (s.platz === f[j - 1].platz + 1 && Math.abs(s.x - f[j - 1].x) < 20));
          if (!zusammen) continue;
          const v = f.reduce((a, s) => a + wert(s), 0) / f.length;
          if (v < best) { best = v; wahl = f; }
        }
      }
    }
    wahl ??= [...pool].sort((a, b) => wert(a) - wert(b)).slice(0, w.anzahl);
    for (const s of wahl) {
      belegt.add(s.id);
      out.push({ seatId: s.id, art: w.art });
    }
  }
  return out;
}

// ─────────── Verkauf ───────────

export type Warenkorb = { productId: string; quantity: number }[];

async function offeneSchicht(sessionId: string, registerId: string) {
  const s = await db.cashSession.findUnique({ where: { id: sessionId } });
  if (!s || s.closedAt || s.registerId !== registerId) throw new Error('Keine offene Schicht an dieser Kasse. Bitte Schicht öffnen.');
  return s;
}

export async function verkaufen(p: { registerId: string; sessionId: string; user: Nutzer; items: Warenkorb; payment: Zahlart; givenCents?: number | null; training?: boolean; showId?: string | null }) {
  await offeneSchicht(p.sessionId, p.registerId);
  const reg = await db.register.findUniqueOrThrow({ where: { id: p.registerId } });
  if (!reg.active) throw new Error('Kasse außer Betrieb');
  if (!reg.startedAt) throw new Error('Startbeleg fehlt – bitte in der Einrichtung erstellen.');
  const zeilen = p.items.filter((i) => i.quantity > 0);
  if (!zeilen.length) throw new Error('Der Warenkorb ist leer.');
  const produkte = new Map((await db.product.findMany({ where: { id: { in: zeilen.map((i) => i.productId) }, active: true } })).map((x) => [x.id, x]));
  for (const z of zeilen) if (!produkte.has(z.productId)) throw new Error('Artikel nicht (mehr) verfügbar – bitte Seite neu laden.');

  const waren: Position[] = [];
  const ticketZeilen: { p: NonNullable<ReturnType<typeof produkte.get>>; anzahl: number; kat: Kat; art: string }[] = [];
  const gutscheine: { p: NonNullable<ReturnType<typeof produkte.get>>; anzahl: number }[] = [];
  for (const z of zeilen) {
    const pr = produkte.get(z.productId)!;
    const t = ticketArt(pr);
    if (t) ticketZeilen.push({ p: pr, anzahl: z.quantity, ...t });
    else if (istGutschein(pr)) gutscheine.push({ p: pr, anzahl: z.quantity });
    else waren.push({ productId: pr.id, name: pr.name, quantity: z.quantity, unitCents: pr.priceCents, vatRate: pr.vatRate, category: pr.category });
  }
  if (p.training && (ticketZeilen.length || gutscheine.length)) throw new Error('Im Trainingsmodus können keine Tickets oder Gutscheine verkauft werden.');

  // Summe vorab (Ticketpreise laut Vorstellung)
  const show = ticketZeilen.length ? await db.show.findUnique({ where: { id: p.showId ?? '' } }) : null;
  if (ticketZeilen.length && !show) throw new Error('Bitte die Vorstellung für die Tickets wählen.');
  const preise = show?.prices as Preise | undefined;
  const ticketSumme = ticketZeilen.reduce((s, t) => s + t.anzahl * ticketPreis(preise!, t.kat, t.art), 0);
  const total = waren.reduce((s, w) => s + w.quantity * w.unitCents, 0) + ticketSumme + gutscheine.reduce((s, g) => s + g.anzahl * g.p.priceCents, 0);
  let given: number | null = null;
  let change: number | null = null;
  if (p.payment === 'bar') {
    given = p.givenCents ?? total;
    if (given < total) throw new Error('Der gegebene Betrag reicht nicht.');
    change = given - total;
  }

  const items: Position[] = [...waren];
  let orderId: string | null = null;

  // Abendkasse: Plätze wählen, reservieren, Bestellung anlegen, bezahlt (Tickets, Rechnung, Buchung)
  if (ticketZeilen.length && show) {
    const anzahl = ticketZeilen.reduce((s, t) => s + t.anzahl, 0);
    if (anzahl > 10) throw new Error('Höchstens 10 Tickets je Verkauf.');
    let hold = null;
    for (let versuch = 0; versuch < 3 && !hold; versuch++) {
      const plaetze = await bestePlaetze(show.id, ticketZeilen.map((t) => ({ kat: t.kat, art: t.art, anzahl: t.anzahl })));
      try { hold = await reservieren(show.id, plaetze, { vorOrt: true }); } catch (e) { if (!(e instanceof PlatzBelegt)) throw e; }
    }
    if (!hold) throw new Error('Die Plätze wurden gerade anderweitig vergeben – bitte erneut versuchen.');
    const order = await bestellungAnlegen({ holdToken: hold.token, channel: 'abendkasse', createdById: p.user.id, note: `Kassa ${reg.kassenId}` });
    orderId = order.id;
    await bezahlt(order.id, { provider: anbieter(p.payment), providerRef: `kassa-${reg.kassenId}-${randomBytes(4).toString('hex')}`, amountCents: order.totalCents });
    const tickets = await db.ticket.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } });
    const seats = hold.seats as { seatId: string; art: string }[];
    let i = 0;
    for (const t of ticketZeilen) {
      const ids = seats.slice(i, i + t.anzahl).map((s) => tickets.find((x) => x.seatId === s.seatId)!.id);
      i += t.anzahl;
      items.push({ productId: t.p.id, name: `${t.p.name} – ${fmtZeit(show.startsAt)} Uhr`, quantity: t.anzahl, unitCents: ticketPreis(preise!, t.kat, t.art), vatRate: TICKET_UST, category: 'ticket', ticketIds: ids });
    }
  }

  for (const g of gutscheine) {
    const codes: string[] = [];
    for (let k = 0; k < g.anzahl; k++) codes.push((await gutscheinVerkaufen({ cents: g.p.priceCents, provider: anbieter(p.payment), note: `Kassa ${reg.kassenId}` })).code);
    items.push({ productId: g.p.id, name: g.p.name, quantity: g.anzahl, unitCents: g.p.priceCents, vatRate: 0, category: 'gutschein', voucherCodes: codes });
  }

  try {
    const beleg = await belegErstellen({
      registerId: reg.id, type: p.training ? 'training' : 'standard', items, payment: p.payment, givenCents: given, changeCents: change,
      cashier: { id: p.user.id, name: p.user.name }, sessionId: p.sessionId, orderId,
      // Nur Waren hier buchen: Abendkasse-Tickets bucht bereits orders.bezahlt (Anzahlung 3480 + USt 13 %),
      // Wertgutscheine bucht gutscheinVerkaufen (3490, ohne USt). Sonst stünde der Erlös doppelt im Journal.
      buchen: async (tx, b) => {
        await bucheKassabeleg(tx, { id: b.id, number: belegRef(reg.kassenId, b.number), date: b.createdAt, payment: p.payment, bruttoJeSatz: jeSatz(waren) });
        await bestand(tx, waren, -1);
      },
    });
    await audit(p.user, p.training ? 'kassa_training' : 'kassa_verkauf', 'receipt', beleg.id, { kasse: reg.kassenId, sessionId: p.sessionId, orderId, signaturAusgefallen: beleg.signerFailed || undefined }, { nachher: { number: beleg.number, type: beleg.type, totalCents: beleg.totalCents, payment: beleg.payment, givenCents: beleg.givenCents, changeCents: beleg.changeCents, items: beleg.items, signatur: beleg.signature.slice(-24) } });
    return beleg;
  } catch (e) {
    // Tickets/Gutscheine sind schon ausgestellt – festhalten, damit die Leitung nacharbeiten kann
    if (orderId || gutscheine.length) await audit(p.user, 'kassa_beleg_fehler', 'order', orderId, { fehler: (e as Error).message, items });
    throw e;
  }
}

function jeSatz(items: Position[]) {
  const m = new Map<number, number>();
  for (const i of items) m.set(i.vatRate, (m.get(i.vatRate) ?? 0) + i.quantity * i.unitCents);
  return m;
}

async function bestand(tx: Tx, items: Position[], richtung: 1 | -1) {
  for (const i of items) if (i.productId) await tx.product.updateMany({ where: { id: i.productId, stock: { not: null } }, data: { stock: { increment: richtung * i.quantity } } });
}

// ─────────── Storno ───────────

export async function stornoBeleg(p: { receiptId: string; grund: string; user: Nutzer; sessionId: string }) {
  const orig = await db.receipt.findUniqueOrThrow({ where: { id: p.receiptId }, include: { register: true } });
  if (orig.type !== 'standard') throw new Error('Nur Verkaufsbelege können storniert werden.');
  if (await db.receipt.findFirst({ where: { cancelsId: orig.id } })) throw new Error('Dieser Beleg ist bereits storniert.');
  await offeneSchicht(p.sessionId, orig.registerId);
  const items = orig.items as Position[];
  const waren = items.filter((i) => i.category !== 'ticket' && i.category !== 'gutschein');
  const ticketSumme = items.filter((i) => i.category === 'ticket').reduce((s, i) => s + i.quantity * i.unitCents, 0);
  const codes = items.flatMap((i) => i.voucherCodes ?? []);
  const gutscheinSumme = items.filter((i) => i.category === 'gutschein').reduce((s, i) => s + i.quantity * i.unitCents, 0);

  if (codes.length) {
    const vs = await db.voucher.findMany({ where: { code: { in: codes } } });
    if (vs.length !== codes.length || vs.some((v) => !v.active || v.remainingCents !== v.valueCents)) throw new Error('Ein Gutschein dieses Belegs wurde bereits (teilweise) eingelöst – Storno nicht möglich.');
  }
  if (orig.orderId) {
    const t = await db.ticket.findMany({ where: { orderId: orig.orderId } });
    if (t.some((x) => x.status === 'eingelassen')) throw new Error('Mindestens ein Ticket wurde bereits eingelassen – Storno nicht möglich.');
    if (t.some((x) => x.status === 'gueltig')) {
      // Tickets mit Methode „keine“ stornieren: Eine Erstattung über den Zahlungsanbieter gibt es bei
      // Bar/Terminal nicht, das Geld geht an der Kassa zurück. stornieren bucht dabei Anzahlung + USt
      // gegen 4880 aus; die Auszahlung aus der Kassa (4880 an Kassa/Terminal) bucht unten der Stornobeleg.
      await stornieren({ orderId: orig.orderId, methode: 'keine', grund: 'sonstiges', notiz: `Kassastorno Beleg ${belegRef(orig.register.kassenId, orig.number)}: ${p.grund} – an der Kassa erstattet`, userId: p.user.id, mail: false, fristIgnorieren: true });
    }
  }

  const neg = items.map((i) => ({ ...i, quantity: -i.quantity }));
  const kasse = TRANSIT[orig.payment] ?? '2700';
  const beleg = await belegErstellen({
    registerId: orig.registerId, type: 'storno', items: neg, payment: orig.payment, cashier: { id: p.user.id, name: p.user.name }, sessionId: p.sessionId, cancelsId: orig.id, orderId: orig.orderId,
    buchen: async (tx, b) => {
      const ref = belegRef(orig.register.kassenId, b.number);
      await bucheKassabeleg(tx, { id: b.id, number: ref, date: b.createdAt, payment: orig.payment, bruttoJeSatz: jeSatz(waren), storno: true });
      if (ticketSumme) await buchen({ date: b.createdAt, text: `Kassastorno Tickets ${ref}`, docRef: ref, source: 'receipt', sourceId: b.id, zeilen: [{ konto: '4880', soll: ticketSumme }, { konto: kasse, haben: ticketSumme }] }, tx);
      if (codes.length) {
        await tx.voucher.updateMany({ where: { code: { in: codes } }, data: { active: false, remainingCents: 0, note: `Storniert mit Beleg ${ref}` } });
        await buchen({ date: b.createdAt, text: `Kassastorno Gutscheine ${ref}`, docRef: ref, source: 'receipt', sourceId: b.id, zeilen: [{ konto: '3490', soll: gutscheinSumme }, { konto: kasse, haben: gutscheinSumme }] }, tx);
      }
      await bestand(tx, waren, 1);
    },
  });
  await audit(p.user, 'kassa_storno', 'receipt', beleg.id, { storniert: orig.id, originalNummer: orig.number, kasse: orig.register.kassenId, grund: p.grund, orderId: orig.orderId }, { nachher: { number: beleg.number, type: beleg.type, totalCents: beleg.totalCents, payment: beleg.payment, items: beleg.items } });
  await audit(p.user, 'beleg_storniert', 'receipt', orig.id, { stornobeleg: beleg.number, stornoId: beleg.id, grund: p.grund }, { vorher: { storniert: false }, nachher: { storniert: true } });
  return beleg;
}

// ─────────── Kasse, Schicht, Sonderbelege ───────────

export async function kasseAnlegen(p: { name: string; kassenId: string; user: Nutzer }) {
  const r = await db.register.create({ data: { name: p.name, kassenId: p.kassenId, aesKeyEnc: encrypt(randomBytes(32).toString('base64')) } });
  await audit(p.user, 'kasse_anlegen', 'register', r.id, { kassenId: p.kassenId });
  return r;
}

export async function sonderbeleg(registerId: string, type: Extract<Belegart, 'start' | 'null' | 'monat' | 'jahr' | 'schluss'>, user: Nutzer) {
  const b = await belegErstellen({ registerId, type, cashier: { id: user.id, name: user.name } });
  await audit(user, `kassa_${type}beleg`, 'receipt', b.id, { number: b.number, registerId, signaturAusgefallen: b.signerFailed || undefined });
  return b;
}

export async function schichtOeffnen(registerId: string, floatCents: number, user: Nutzer) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Register" WHERE id = ${registerId} FOR UPDATE`;
    if (await tx.cashSession.findFirst({ where: { registerId, closedAt: null } })) throw new Error('An dieser Kasse ist bereits eine Schicht offen.');
    const s = await tx.cashSession.create({ data: { registerId, openedById: user.id, openedByName: user.name, floatCents } });
    await audit(user, 'schicht_oeffnen', 'cashSession', s.id, { registerId }, { nachher: { floatCents, openedAt: s.openedAt } });
    return s;
  });
}

export async function schichtSchliessen(sessionId: string, countedCents: number, note: string, user: Nutzer) {
  const s = await db.cashSession.findUniqueOrThrow({ where: { id: sessionId } });
  if (s.closedAt) throw new Error('Schicht ist bereits geschlossen.');
  const b = await kassenbericht(sessionId);
  const neu = await db.cashSession.update({ where: { id: sessionId }, data: { closedAt: new Date(), closedByName: user.name, countedCents, expectedCents: b.erwartet, note } });
  await audit(user, 'schicht_schliessen', 'cashSession', sessionId, { registerId: s.registerId, umsatzCents: b.umsatz, belege: b.anzahl, differenzCents: countedCents - b.erwartet }, { vorher: { closedAt: null }, nachher: { closedAt: neu.closedAt, countedCents, expectedCents: b.erwartet, note: note || undefined } });
  return neu;
}

/** Kassabericht einer Schicht (X-Bericht laufend, Z-Bericht nach Abschluss) */
export async function kassenbericht(sessionId: string) {
  const s = await db.cashSession.findUniqueOrThrow({ where: { id: sessionId }, include: { register: true, receipts: { orderBy: { number: 'asc' } } } });
  const echt = s.receipts.filter((r) => r.type === 'standard' || r.type === 'storno');
  const summe = (rs: typeof echt) => rs.reduce((a, r) => a + r.totalCents, 0);
  const satz = new Map<number, number>();
  let tickets = 0;
  let gutscheine = 0;
  for (const r of echt) {
    for (const i of r.items as Position[]) {
      const b = i.quantity * i.unitCents;
      satz.set(i.vatRate, (satz.get(i.vatRate) ?? 0) + b);
      if (i.category === 'ticket') tickets += b;
      if (i.category === 'gutschein') gutscheine += b;
    }
  }
  const bar = summe(echt.filter((r) => r.payment === 'bar'));
  const training = s.receipts.filter((r) => r.type === 'training');
  return {
    session: s,
    register: s.register,
    anzahl: echt.filter((r) => r.type === 'standard').length,
    umsatz: summe(echt),
    jeZahlart: { bar, karte: summe(echt.filter((r) => r.payment === 'karte')) },
    jeSatz: zerlegen(new Map([...satz.entries()].sort((a, b) => b[0] - a[0]))),
    storno: { anzahl: echt.filter((r) => r.type === 'storno').length, summe: summe(echt.filter((r) => r.type === 'storno')) },
    training: { anzahl: training.length, summe: training.reduce((a, r) => a + r.totalCents, 0) },
    tickets, gutscheine,
    ausgefallen: s.receipts.filter((r) => r.signerFailed).length,
    erwartet: s.floatCents + bar,
    von: s.receipts[0]?.number ?? null,
    bis: s.receipts.at(-1)?.number ?? null,
  };
}
