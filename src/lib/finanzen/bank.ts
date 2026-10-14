// Kontoauszüge lesen: CSV (George, ELBA, N26, Bank Austria, generisch) und CAMT.053.
// Angepasst aus skillfinance (src/lib/bank/parse.ts), ohne Fremdbibliothek.
import { createHash } from 'node:crypto';
import { amountNeedsReview, parseAmountToCents } from '../money';
import { csvLesen } from './csv';

export type BankZeile = { externalId: string; bookingDate: Date; amountCents: number; counterparty: string; iban: string; reference: string; pruefen: string };
export type BankErgebnis = { format: string; zeilen: BankZeile[]; uebersprungen: { zeile: number; grund: string }[] };

export function datumLesen(raw: string): Date | null {
  const s = String(raw ?? '').trim();
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return utc(+m[3], +m[2], +m[1]);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return utc(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return utc(+m[3], +m[1], +m[2]);
  return null;
}
function utc(y: number, mo: number, d: number) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 ? dt : null;
}

export function dateiText(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  let b = buf;
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3);
  const utf8 = b.toString('utf8');
  return utf8.includes('�') ? b.toString('latin1') : utf8;
}

export function bankDateiLesen(buf: Buffer): BankErgebnis {
  const text = dateiText(buf);
  if (/<Document|camt\.05[234]/i.test(text.slice(0, 4096))) return camtLesen(text);
  return csvBankLesen(text);
}

type Spalte = 'date' | 'amount' | 'name' | 'iban' | 'currency' | 'reference' | 'remittance';

export function kopfZuordnen(kopf: string[]): Partial<Record<Spalte, number>> {
  const idx: Partial<Record<Spalte, number>> = {};
  kopf.forEach((raw, i) => {
    const h = raw.trim().toLowerCase();
    if (h.startsWith('own ') || h.includes('eigene') || h.includes('valuta') || h.includes('value date') || h.includes('zeitstempel') || h.includes('kategorie') || h.includes('category') || h.includes('umsatzart')) return;
    if (h.includes('buchungsdatum') || h === 'datum' || h === 'date' || h.includes('booking date') || h === 'buchungstag') idx.date ??= i;
    else if (h.includes('iban') || h.includes('kontonummer')) idx.iban ??= i;
    else if (h.includes('betrag') || h.includes('amount')) idx.amount ??= i;
    else if (h.includes('währung') || h.includes('waehrung') || h === 'currency') idx.currency ??= i;
    else if (h.includes('referenz') || h.includes('reference')) idx.reference ??= i;
    else if (h.includes('verwendungszweck') || h.includes('zweck') || h.includes('buchungstext') || h.includes('description') || h.includes('details') || h === 'text' || h.includes('umsatztext')) idx.remittance ??= i;
    else if (h.includes('partner') || h.includes('name') || h.includes('payee') || h.includes('empfänger') || h.includes('auftraggeber')) idx.name ??= i;
  });
  return idx;
}

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');

export function csvBankLesen(text: string): BankErgebnis {
  const daten = csvLesen(text.trim());
  const uebersprungen: BankErgebnis['uebersprungen'] = [];
  if (!daten.length) return { format: 'csv-leer', zeilen: [], uebersprungen };
  let idx = kopfZuordnen(daten[0]);
  let start = 1;
  let format = 'csv';
  // ELBA exportiert ohne Kopfzeile: Buchungsdatum;Text;Valutadatum;Betrag;Währung;Zeitstempel
  if (idx.amount === undefined && datumLesen(daten[0][0]) && daten[0].length >= 4) {
    idx = { date: 0, remittance: 1, amount: 3, currency: daten[0].length > 4 ? 4 : undefined };
    start = 0;
    format = 'csv-elba';
  } else if (idx.amount === undefined) throw new Error('Keine Betragsspalte gefunden – Format nicht erkannt.');
  const gesehen = new Map<string, number>();
  const zeilen: BankZeile[] = [];
  for (let i = start; i < daten.length; i++) {
    const r = daten[i];
    const g = (c: Spalte) => (idx[c] !== undefined ? String(r[idx[c]!] ?? '').trim() : '');
    const betrag = g('amount');
    if (!betrag) { uebersprungen.push({ zeile: i + 1, grund: 'kein Betrag' }); continue; }
    const waehrung = g('currency').toUpperCase();
    if (waehrung && waehrung !== 'EUR') { uebersprungen.push({ zeile: i + 1, grund: `Währung ${waehrung}` }); continue; }
    const datum = datumLesen(g('date'));
    if (!datum) { uebersprungen.push({ zeile: i + 1, grund: 'Datum unklar' }); continue; }
    const z = {
      bookingDate: datum, amountCents: parseAmountToCents(betrag), counterparty: g('name').slice(0, 140),
      iban: g('iban').replace(/\s+/g, '').toUpperCase(), reference: [g('reference'), g('remittance')].filter(Boolean).join(' ').slice(0, 500),
    };
    // Gleiche Datei zweimal importieren ändert nichts; zwei gleiche Zahlungen am selben Tag bleiben erhalten
    const sig = [g('date'), z.amountCents, z.iban, z.reference, z.counterparty].join('|');
    const n = (gesehen.get(sig) ?? 0) + 1;
    gesehen.set(sig, n);
    zeilen.push({ ...z, externalId: 'csv_' + sha1(n > 1 ? `${sig}|#${n}` : sig), pruefen: amountNeedsReview(betrag) ? 'Betrag mehrdeutig' : '' });
  }
  return { format, zeilen, uebersprungen };
}

const xmlText = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export function camtLesen(xml: string): BankErgebnis {
  const zeilen: BankZeile[] = [];
  const uebersprungen: BankErgebnis['uebersprungen'] = [];
  const eintraege = xml.match(/<(?:\w+:)?Ntry>[\s\S]*?<\/(?:\w+:)?Ntry>/g) ?? [];
  const tag = (src: string, pfad: string[]): string => {
    let cur = src;
    for (const t of pfad) {
      const m = cur.match(new RegExp(`<(?:\\w+:)?${t}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${t}>`));
      if (!m) return '';
      cur = m[1];
    }
    return xmlText(cur.trim());
  };
  eintraege.forEach((e, i) => {
    const sts = tag(e, ['Sts', 'Cd']) || tag(e, ['Sts']);
    if (sts && !/^BOOK/.test(sts)) { uebersprungen.push({ zeile: i + 1, grund: `Status ${sts}` }); return; }
    const amt = e.match(/<(?:\w+:)?Amt[^>]*Ccy="([A-Z]{3})"[^>]*>([^<]+)</);
    if (!amt) { uebersprungen.push({ zeile: i + 1, grund: 'kein Betrag' }); return; }
    if (amt[1] !== 'EUR') { uebersprungen.push({ zeile: i + 1, grund: `Währung ${amt[1]}` }); return; }
    const soll = tag(e, ['CdtDbtInd']) === 'DBIT';
    const cent = Math.round(parseFloat(amt[2]) * 100) * (soll ? -1 : 1);
    const datum = datumLesen(tag(e, ['BookgDt', 'Dt']) || tag(e, ['BookgDt', 'DtTm']));
    if (!datum) { uebersprungen.push({ zeile: i + 1, grund: 'Datum unklar' }); return; }
    const partei = soll ? 'Cdtr' : 'Dbtr';
    const name = tag(e, ['RltdPties', partei, 'Nm']) || tag(e, ['RltdPties', partei, 'Pty', 'Nm']);
    const iban = tag(e, ['RltdPties', `${partei}Acct`, 'Id', 'IBAN']);
    const ref = tag(e, ['CdtrRefInf', 'Ref']);
    const ustrd = [...e.matchAll(/<(?:\w+:)?Ustrd>([\s\S]*?)<\/(?:\w+:)?Ustrd>/g)].map((m) => xmlText(m[1].trim())).join(' ');
    const zusatz = tag(e, ['AddtlNtryInf']);
    const id = tag(e, ['AcctSvcrRef']) || tag(e, ['NtryRef']) || sha1(e);
    zeilen.push({ externalId: 'camt_' + id, bookingDate: datum, amountCents: cent, counterparty: name.slice(0, 140), iban: iban.replace(/\s+/g, ''), reference: [ref, ustrd || zusatz].filter(Boolean).join(' ').slice(0, 500), pruefen: '' });
  });
  return { format: 'camt.053', zeilen, uebersprungen };
}

// ─────────── Vorschläge für die Zuordnung ───────────

const kompakt = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
export const enthaelt = (text: string, nadel: string) => { const n = kompakt(nadel); return n.length >= 4 && kompakt(text).includes(n); };

export type Vorschlag = { art: 'rechnung' | 'beleg' | 'auszahlung'; id: string; label: string; stark: boolean };

export function vorschlaege(
  tx: { amountCents: number; counterparty: string; reference: string },
  offen: { rechnungen: { id: string; number: string; grossCents: number; name: string }[]; belege: { id: string; docNumber: string; grossCents: number; supplier: string }[] },
): Vorschlag[] {
  const text = `${tx.counterparty} ${tx.reference}`;
  const v: Vorschlag[] = [];
  if (tx.amountCents > 0) {
    for (const r of offen.rechnungen) {
      const ref = enthaelt(text, r.number);
      if (ref || r.grossCents === tx.amountCents) v.push({ art: 'rechnung', id: r.id, label: `Rechnung ${r.number} · ${r.name}`, stark: ref && r.grossCents === tx.amountCents });
    }
    const anbieter = /hobex/i.test(text) ? 'hobex' : /stripe/i.test(text) ? 'stripe' : /paypal/i.test(text) ? 'paypal' : null;
    if (anbieter) v.push({ art: 'auszahlung', id: anbieter, label: `Auszahlung ${anbieter}`, stark: true });
  } else if (tx.amountCents < 0) {
    for (const b of offen.belege) {
      const ref = !!b.docNumber && enthaelt(text, b.docNumber);
      const name = enthaelt(text, b.supplier.split(/\s+/)[0] ?? '');
      if (ref || b.grossCents === -tx.amountCents) v.push({ art: 'beleg', id: b.id, label: `Beleg ${b.supplier} ${b.docNumber}`.trim(), stark: (ref || name) && b.grossCents === -tx.amountCents });
    }
  }
  return v.sort((a, b) => Number(b.stark) - Number(a.stark));
}
