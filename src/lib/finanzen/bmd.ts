// Export für die Steuerberatung: BMD NTCS Buchungsimport (CSV, Semikolon).
//
// Zuordnung (mit der Steuerberatung per Testimport abstimmen):
// - Jede Journalzeile wird zu einer BMD-Zeile „konto gegen gkonto“. Gegenkonto ist das Hauptkonto des
//   Buchungssatzes (größter Betrag, bevorzugt ohne Steuercode, z. B. Bank, Geldtransit, Forderung,
//   Lieferverbindlichkeit). Das Hauptkonto selbst bekommt keine eigene Zeile, es ergibt sich als Summe
//   der Gegenbuchungen – so bleibt auch ein Satz mit mehreren Soll- und Haben-Zeilen vollständig.
// - Steuerzeilen (3500/3501/3502 USt, 2500 Vorsteuer) werden mit der zugehörigen Zeile mit Steuercode
//   zusammengefasst: betrag = brutto, steuer = Steuerbetrag, prozent = Satz. BMD bucht die Steuer dann
//   selbst auf sein Steuerkonto. Steuerzeilen ohne passende Grundzeile (z. B. UVA-Umbuchung) gehen als
//   normale Zeile ohne Steuercode hinaus.
// - buchcode 1 = Soll, 2 = Haben (bezogen auf „konto“); betrag und steuer tragen zusätzlich das
//   Vorzeichen (Soll +, Haben −).
// - steuercode: 1 = Vorsteuer, 3 = Umsatzsteuer (BMD-Standard, prüfen), leer = ohne Steuer.
// - buchsymbol aus der Quelle: AR Ausgangsrechnung/Ticketverkauf, ER Eingangsrechnung, BK Bank,
//   KA Kassa, SO sonstige/Umbuchung.
import { STEUERCODES } from '../ledger';
import { csv, dezimal } from './csv';

export type BmdLine = { konto: string; soll: number; haben: number; vatCode: string | null; base: number | null; text?: string | null };
export type BmdEntry = { number: number; date: string; docRef: string; text: string; source: string; lines: BmdLine[] };
export type BmdRow = { satzart: number; konto: string; gkonto: string; belegnr: string; belegdatum: string; buchsymbol: string; buchcode: 1 | 2; prozent: number | ''; steuercode: number | ''; betrag: number; steuer: number; text: string };

export const BMD_SPALTEN = ['satzart', 'konto', 'gkonto', 'belegnr', 'belegdatum', 'buchsymbol', 'buchcode', 'prozent', 'steuercode', 'betrag', 'steuer', 'text'] as const;

const STEUERKONTEN = new Set(Object.values(STEUERCODES).map((c) => c.konto));

export function buchsymbol(source: string) {
  if (['order', 'refund', 'voucher', 'invoice', 'partner'].includes(source)) return 'AR';
  if (source === 'expense') return 'ER';
  if (['expense-paid', 'settlement', 'invoice-paid', 'bank'].includes(source)) return 'BK';
  if (source === 'receipt') return 'KA';
  return 'SO';
}

const datumBmd = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;

export function bmdZeilen(e: BmdEntry): BmdRow[] {
  const lines = e.lines.map((l, i) => ({ ...l, i, betrag: l.soll - l.haben, steuer: 0, satz: 0 as number, code: '' as '' | 'U' | 'V' }));
  const grund = lines.filter((l) => l.vatCode && STEUERCODES[l.vatCode] && !STEUERKONTEN.has(l.konto));
  const weg = new Set<number>();
  // Steuerzeilen auf die Grundzeilen verteilen (anteilig nach Betrag)
  for (const t of lines.filter((l) => STEUERKONTEN.has(l.konto))) {
    const passend = grund.filter((g) => STEUERCODES[g.vatCode!].konto === t.konto && Math.sign(g.betrag) === Math.sign(t.betrag));
    if (!passend.length) continue;
    const summe = passend.reduce((s, g) => s + Math.abs(g.betrag), 0);
    let rest = t.betrag;
    passend.forEach((g, k) => {
      const anteil = k === passend.length - 1 ? rest : Math.round((t.betrag * Math.abs(g.betrag)) / summe);
      rest -= anteil;
      g.steuer += anteil;
    });
    weg.add(t.i);
  }
  for (const g of grund) {
    const c = STEUERCODES[g.vatCode!];
    g.satz = c.satz;
    g.code = c.art;
    g.betrag += g.steuer;
  }
  const rest = lines.filter((l) => !weg.has(l.i));
  // Hauptkonto: größter Betrag, bevorzugt ohne Steuercode
  const kandidaten = rest.filter((l) => !l.code && !STEUERKONTEN.has(l.konto));
  const haupt = (kandidaten.length ? kandidaten : rest).reduce((a, b) => (Math.abs(b.betrag) > Math.abs(a.betrag) ? b : a));
  return rest.filter((l) => l !== haupt && l.betrag !== 0).map((l) => ({
    satzart: 0, konto: l.konto, gkonto: haupt.konto, belegnr: e.docRef || String(e.number), belegdatum: datumBmd(e.date),
    buchsymbol: buchsymbol(e.source), buchcode: l.betrag > 0 ? 1 : 2,
    prozent: l.code ? l.satz : '', steuercode: l.code === 'V' ? 1 : l.code === 'U' ? 3 : '',
    betrag: l.betrag, steuer: l.code ? l.steuer : 0, text: (l.text ? `${e.text} – ${l.text}` : e.text).slice(0, 120),
  }));
}

export function bmdCsv(entries: BmdEntry[]): string {
  const rows = entries.flatMap(bmdZeilen);
  return csv([[...BMD_SPALTEN], ...rows.map((r) => [r.satzart, r.konto, r.gkonto, r.belegnr, r.belegdatum, r.buchsymbol, r.buchcode, r.prozent, r.steuercode, dezimal(r.betrag), dezimal(r.steuer), r.text])]);
}

/** Kontrolle: Wirkung der BMD-Zeilen je Konto (Soll − Haben) – muss dem Journal entsprechen (Steuer auf eigenen Konten) */
export function bmdWirkung(rows: BmdRow[]) {
  const m = new Map<string, number>();
  const add = (k: string, c: number) => m.set(k, (m.get(k) ?? 0) + c);
  for (const r of rows) {
    add(r.konto, r.betrag - r.steuer);
    if (r.steuer) {
      const code = Object.values(STEUERCODES).find((c) => c.satz === r.prozent && (r.steuercode === 1 ? c.art === 'V' : c.art === 'U'));
      add(code?.konto ?? '?', r.steuer);
    }
    add(r.gkonto, -r.betrag);
  }
  return m;
}
