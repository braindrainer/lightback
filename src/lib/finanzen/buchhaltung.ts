// Vorgänge der Buchhaltung: manuelle Buchung, UVA-Umbuchung, Auszahlungen, Eingangsbelege, Bankabgleich, Festschreibung.
// Jede Buchung läuft über ledger.buchen (nie direkt ins Journal schreiben).
import { db, getSettings } from '../db';
import { bucheAuszahlung, bucheEingangsrechnung, bucheZahlungEingangsrechnung, buchen, stornoBuchung, STEUERCODES, TRANSIT, type Zeile } from '../ledger';
import { splitGross } from '../money';
import { bankDateiLesen } from './bank';
import { uva } from './auswertung';
import { uvaUmbuchung } from './uva';
import { monatsZeitraum, tag, tagStr } from './zeitraum';
import { ablegen, sha256, sichererName } from './dateien';
import { rechnungBezahlt } from './rechnungen';

export const ANBIETER: Record<string, string> = { hobex: 'hobex (online)', stripe: 'Stripe', paypal: 'PayPal', terminal: 'Kartenterminal' };
export const TRANSIT_KONTEN = ['2880', '2881', '2882', '2885'];
/** Zahlungsanbieter (Payment.provider), die über ein Geldtransit-Konto laufen */
export const anbieterVonKonto = (konto: string) => Object.entries(TRANSIT).filter(([, k]) => k === konto).map(([p]) => p);

export type ManuelleZeile = { konto: string; soll: number; haben: number; vatCode: string | null; brutto: boolean; text?: string };

/** Manuelle Zeilen in Buchungszeilen: mit Steuercode und „brutto“ wird die Steuer auf das Steuerkonto abgespalten */
export function manuelleZeilen(zeilen: ManuelleZeile[]): Zeile[] {
  return zeilen.flatMap((z) => {
    const betrag = z.soll - z.haben; // + Soll, − Haben
    const c = z.vatCode ? STEUERCODES[z.vatCode] : null;
    if (!c) return [{ konto: z.konto, soll: Math.max(betrag, 0), haben: Math.max(-betrag, 0), text: z.text }];
    // Bemessungsgrundlage positiv für Erlöse (Haben) bzw. Aufwand (Soll); Storno-Richtung ergibt negativ
    const netto = z.brutto ? Math.sign(betrag) * splitGross(Math.abs(betrag), c.satz).net : betrag;
    const steuer = betrag - netto;
    const base = c.art === 'U' ? -netto : netto;
    const r: Zeile[] = [{ konto: z.konto, soll: Math.max(netto, 0), haben: Math.max(-netto, 0), vatCode: z.vatCode, base, text: z.text }];
    if (z.brutto && steuer) r.push({ konto: c.konto, soll: Math.max(steuer, 0), haben: Math.max(-steuer, 0), vatCode: c.art === 'V' ? z.vatCode : null, base: c.art === 'V' ? base : null });
    return r;
  });
}

export async function manuellBuchen(b: { datum: Date; text: string; beleg: string; zeilen: ManuelleZeile[] }, userId?: string) {
  const nummern = [...new Set(b.zeilen.map((z) => z.konto))];
  const konten = await db.account.findMany({ where: { number: { in: nummern } } });
  for (const n of nummern) {
    const k = konten.find((x) => x.number === n);
    if (!k) throw new Error(`Konto ${n} gibt es nicht.`);
    if (!k.active) throw new Error(`Konto ${n} ist deaktiviert.`);
  }
  const e = await buchen({ date: b.datum, text: b.text, docRef: b.beleg, source: 'manual', createdById: userId, zeilen: manuelleZeilen(b.zeilen) });
  if (!e) throw new Error('Die Buchung hat keinen Betrag.');
  return e;
}

export async function buchungStornieren(entryId: string, datum: Date, userId?: string) {
  const e = await db.journalEntry.findUniqueOrThrow({ where: { id: entryId } });
  if (e.reversesId) throw new Error('Eine Stornobuchung kann nicht nochmals storniert werden.');
  if (await db.journalEntry.findFirst({ where: { reversesId: entryId } })) throw new Error('Diese Buchung ist bereits storniert.');
  return stornoBuchung(entryId, datum, userId);
}

// ─────────── UVA ───────────

/** UVA-Umbuchung eines Monats auf 3540 (idempotent: source „uva“, sourceId „YYYY-MM“; nach Storno neue Fassung) */
export async function uvaBuchen(monat: string, userId?: string) {
  const { von, bis } = monatsZeitraum(monat);
  const vorhandene = await db.journalEntry.findMany({ where: { source: 'uva', sourceId: monat }, orderBy: { number: 'asc' } });
  const storniert = new Set((await db.journalEntry.findMany({ where: { reversesId: { in: vorhandene.map((v) => v.id) } }, select: { reversesId: true } })).map((x) => x.reversesId));
  const aktiv = vorhandene.find((v) => !storniert.has(v.id));
  if (aktiv) throw new Error(`Die UVA ${monat} ist bereits gebucht (Buchung Nr. ${aktiv.number}). Zum Neubuchen zuerst im Journal stornieren.`);
  const { ergebnis } = await uva(von, bis);
  const zeilen = uvaUmbuchung(ergebnis);
  if (!zeilen.length) throw new Error('Für diesen Monat gibt es keine Umsatz- oder Vorsteuer.');
  const text = `UVA ${monat}${vorhandene.length ? ` (Fassung ${vorhandene.length + 1})` : ''}`;
  return buchen({ date: tag(bis)!, text, docRef: `UVA ${monat}`, source: 'uva', sourceId: monat, createdById: userId, zeilen });
}

export async function uvaStatus(monat: string) {
  const v = await db.journalEntry.findMany({ where: { source: 'uva', sourceId: monat }, orderBy: { number: 'desc' } });
  const storniert = new Set((await db.journalEntry.findMany({ where: { reversesId: { in: v.map((x) => x.id) } }, select: { reversesId: true } })).map((x) => x.reversesId));
  return v.find((x) => !storniert.has(x.id)) ?? null;
}

// ─────────── Auszahlungen der Zahlungsanbieter ───────────

export async function auszahlungErfassen(p: { provider: string; datum: Date; bruttoCents: number; gebuehrCents: number; ref: string; paymentIds: string[]; quelle?: string }, userId?: string) {
  if (!ANBIETER[p.provider]) throw new Error('Unbekannter Zahlungsanbieter');
  if (p.bruttoCents <= 0) throw new Error('Der Auszahlungsbetrag muss größer als 0 sein.');
  if (p.gebuehrCents < 0 || p.gebuehrCents > p.bruttoCents) throw new Error('Die Gebühren sind ungültig.');
  const id = p.quelle ?? `${p.provider}-${tagStr(p.datum)}-${p.ref || Date.now().toString(36)}`;
  const vorher = await db.journalEntry.findFirst({ where: { source: 'settlement', sourceId: id } });
  if (vorher) throw new Error('Diese Auszahlung ist bereits erfasst.');
  const e = await bucheAuszahlung({ id, date: p.datum, provider: p.provider, bruttoCents: p.bruttoCents, gebuehrCents: p.gebuehrCents, ref: p.ref, userId });
  const provider = anbieterVonKonto(TRANSIT[p.provider]);
  const n = p.paymentIds.length
    ? (await db.payment.updateMany({ where: { id: { in: p.paymentIds }, provider: { in: provider }, settledAt: null }, data: { settledAt: p.datum, settlementRef: p.ref || id } })).count
    : 0;
  return { entry: e, abgerechnet: n };
}

// ─────────── Eingangsbelege ───────────

export type BelegEingabe = { supplier: string; docNumber: string; docDate: Date; dueDate: Date | null; grossCents: number; vatRate: number; vatCents?: number | null; accountNumber: string; note: string };

export function belegBetraege(grossCents: number, vatRate: number, vatCents?: number | null) {
  if (vatCents != null) return { net: grossCents - vatCents, vat: vatCents };
  return splitGross(grossCents, vatRate);
}

export async function belegAnlegen(b: BelegEingabe, datei: { name: string; inhalt: Buffer } | null, userId?: string) {
  const k = await db.account.findUnique({ where: { number: b.accountNumber } });
  if (!k || k.type !== 'aufwand' || !k.active) throw new Error('Bitte ein aktives Aufwandskonto wählen.');
  const { net, vat } = belegBetraege(b.grossCents, b.vatRate, b.vatCents);
  let filePath: string | null = null;
  if (datei) {
    const h = sha256(datei.inhalt);
    const doppelt = await db.expense.findFirst({ where: { filePath: { contains: h } } });
    if (doppelt) throw new Error(`Diese Datei ist schon als Beleg erfasst (${doppelt.supplier} ${doppelt.docNumber}).`);
    const ext = (datei.name.split('.').pop() ?? 'pdf').toLowerCase();
    filePath = await ablegen(`belege/${b.docDate.getUTCFullYear()}/${h}.${ext}`, datei.inhalt);
  }
  const e = await db.expense.create({ data: { supplier: b.supplier, docNumber: b.docNumber, docDate: b.docDate, dueDate: b.dueDate, netCents: net, vatCents: vat, grossCents: b.grossCents, vatRate: vat ? b.vatRate : 0, accountNumber: b.accountNumber, note: b.note, filePath, fileName: datei ? sichererName(datei.name) : null } });
  try {
    await bucheEingangsrechnung({ id: e.id, date: b.docDate, supplier: b.supplier, docNumber: b.docNumber, konto: b.accountNumber, netto: net, ust: vat, satz: b.vatRate, userId });
  } catch (err) {
    await db.expense.delete({ where: { id: e.id } });
    throw err;
  }
  return e;
}

export async function belegBezahlt(id: string, datum: Date, userId?: string, bankTxId?: string) {
  const e = await db.expense.findUniqueOrThrow({ where: { id } });
  if (e.status !== 'offen') throw new Error('Dieser Beleg ist nicht offen.');
  const entry = await bucheZahlungEingangsrechnung({ id: e.id, date: datum, supplier: e.supplier, docNumber: e.docNumber, brutto: e.grossCents, userId });
  await db.expense.update({ where: { id }, data: { status: 'bezahlt', paidAt: datum } });
  if (bankTxId && entry) await db.bankTransaction.update({ where: { id: bankTxId }, data: { status: 'gebucht', entryId: entry.id } });
  return entry;
}

export async function belegStornieren(id: string, datum: Date, userId?: string) {
  const e = await db.expense.findUniqueOrThrow({ where: { id } });
  if (e.status !== 'offen') throw new Error('Nur offene Belege können storniert werden (bezahlte zuerst im Journal ausgleichen).');
  const b = await db.journalEntry.findFirst({ where: { source: 'expense', sourceId: id } });
  if (b) await buchungStornieren(b.id, datum, userId);
  await db.expense.update({ where: { id }, data: { status: 'storniert' } });
}

// ─────────── Bank ───────────

export async function bankImport(inhalt: Buffer) {
  const r = bankDateiLesen(inhalt);
  let neu = 0;
  for (const z of r.zeilen) {
    const da = await db.bankTransaction.findUnique({ where: { externalId: z.externalId } });
    if (da) continue;
    await db.bankTransaction.create({ data: { externalId: z.externalId, bookingDate: z.bookingDate, amountCents: z.amountCents, counterparty: z.counterparty, iban: z.iban, reference: z.reference } });
    neu++;
  }
  return { format: r.format, gelesen: r.zeilen.length, neu, uebersprungen: r.uebersprungen };
}

export type BankZuordnung =
  | { art: 'beleg'; id: string }
  | { art: 'rechnung'; id: string }
  | { art: 'auszahlung'; provider: string; gebuehrCents: number; von?: Date | null; bis?: Date | null }
  | { art: 'konto'; konto: string; vatCode: string | null; text: string }
  | { art: 'ignorieren' };

export async function bankZuordnen(txId: string, z: BankZuordnung, userId?: string) {
  const t = await db.bankTransaction.findUniqueOrThrow({ where: { id: txId } });
  if (t.status !== 'neu') throw new Error('Diese Bankbuchung ist bereits erledigt.');
  const datum = t.bookingDate;
  const fertig = (entryId: string | null) => db.bankTransaction.update({ where: { id: txId }, data: { status: entryId ? 'gebucht' : 'ignoriert', entryId } });
  if (z.art === 'ignorieren') return fertig(null);
  if (z.art === 'beleg') {
    const e = await db.expense.findUniqueOrThrow({ where: { id: z.id } });
    if (e.grossCents !== -t.amountCents) throw new Error('Betrag von Beleg und Bankbuchung stimmen nicht überein.');
    await belegBezahlt(z.id, datum, userId, txId);
    return;
  }
  if (z.art === 'rechnung') {
    const inv = await db.invoice.findUniqueOrThrow({ where: { id: z.id } });
    if (inv.grossCents !== t.amountCents) throw new Error('Betrag von Rechnung und Bankbuchung stimmen nicht überein.');
    const e = await rechnungBezahlt(z.id, datum, userId, '2800', { source: 'bank', sourceId: txId });
    return fertig(e?.id ?? null);
  }
  if (z.art === 'auszahlung') {
    if (t.amountCents <= 0) throw new Error('Eine Auszahlung muss ein Zahlungseingang sein.');
    const provider = anbieterVonKonto(TRANSIT[z.provider] ?? '');
    const zahlungen = z.von && z.bis ? await db.payment.findMany({ where: { provider: { in: provider }, settledAt: null, status: { in: ['bezahlt', 'teilerstattet', 'erstattet'] }, paidAt: { gte: z.von, lt: new Date(z.bis.getTime() + 864e5) } }, select: { id: true } }) : [];
    const r = await auszahlungErfassen({ provider: z.provider, datum, bruttoCents: t.amountCents + z.gebuehrCents, gebuehrCents: z.gebuehrCents, ref: t.reference.slice(0, 60) || t.externalId.slice(0, 20), paymentIds: zahlungen.map((x) => x.id), quelle: `bank-${txId}` }, userId);
    await fertig(r.entry?.id ?? null);
    return r;
  }
  const k = await db.account.findUnique({ where: { number: z.konto } });
  if (!k || !k.active) throw new Error('Konto nicht gefunden oder deaktiviert.');
  if (z.konto === '2800') throw new Error('Gegenkonto darf nicht das Bankkonto sein.');
  const zeilen = manuelleZeilen([
    { konto: '2800', soll: Math.max(t.amountCents, 0), haben: Math.max(-t.amountCents, 0), vatCode: null, brutto: false },
    { konto: z.konto, soll: Math.max(-t.amountCents, 0), haben: Math.max(t.amountCents, 0), vatCode: z.vatCode, brutto: true },
  ]);
  const e = await buchen({ date: datum, text: z.text || `Bank ${t.counterparty} ${t.reference}`.trim().slice(0, 120), docRef: t.externalId.slice(0, 30), source: 'bank', sourceId: txId, createdById: userId, zeilen });
  return fertig(e?.id ?? null);
}

// ─────────── Festschreibung ───────────

export async function festschreiben(bis: Date) {
  const s = await getSettings();
  if (s.lockedUntil && bis < s.lockedUntil) throw new Error(`Bereits festgeschrieben bis ${tagStr(s.lockedUntil)} – das Datum kann nicht zurückgesetzt werden.`);
  if (bis > new Date()) throw new Error('Festschreiben geht nur für vergangene Tage.');
  await db.settings.update({ where: { id: 1 }, data: { lockedUntil: bis } });
}
