// Zeiträume, Datumswerte und Eingaben für die Finanzseiten (ohne DB, testbar).
// Buchungsdaten sind reine Kalendertage (@db.Date) → intern immer UTC-Mitternacht.
import { wienTag } from '../dates';

export const heute = () => wienTag(new Date());

/** "YYYY-MM-DD" → Date (UTC-Mitternacht), ungültig → null */
export function tag(s: string | null | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
}

export const tagStr = (d: Date) => d.toISOString().slice(0, 10);
export const fmtTagStr = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
/** Datum eines @db.Date-Felds anzeigen (ohne Zeitzonenverschiebung) */
export const fmtBuchDatum = (d: Date) => fmtTagStr(tagStr(d));

export function letzterTag(jahr: number, monat: number) {
  return new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
}

export function monatsZeitraum(monat: string) {
  const [j, m] = monat.split('-').map(Number);
  return { von: `${monat}-01`, bis: `${monat}-${String(letzterTag(j, m)).padStart(2, '0')}` };
}

/** Zeitraum aus Suchparametern: von/bis, sonst Monat (YYYY-MM), sonst Jahr, sonst laufendes Jahr */
export function zeitraum(sp: Record<string, string | string[] | undefined>, standard: 'jahr' | 'monat' = 'jahr') {
  const g = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : '');
  const von = tag(g('von'));
  const bis = tag(g('bis'));
  if (von && bis && von <= bis) return { von: tagStr(von), bis: tagStr(bis) };
  if (/^\d{4}-\d{2}$/.test(g('monat'))) return monatsZeitraum(g('monat'));
  const jahr = /^\d{4}$/.test(g('jahr')) ? g('jahr') : heute().slice(0, 4);
  if (standard === 'monat' && !g('jahr')) return monatsZeitraum(heute().slice(0, 7));
  return { von: `${jahr}-01-01`, bis: `${jahr}-12-31` };
}

/** Beginn des Geschäftsjahres, in dem der Tag liegt */
export function gjBeginn(s: string, startMonat = 1) {
  const j = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const jahr = m >= startMonat ? j : j - 1;
  return `${jahr}-${String(startMonat).padStart(2, '0')}-01`;
}

export function vortag(s: string) {
  return tagStr(new Date(tag(s)!.getTime() - 864e5));
}

/** Euro-Eingabe "1.234,56" oder "1234.56" → Cent; leer/ungültig → null */
export function euroZuCent(raw: unknown): number | null {
  const s = String(raw ?? '').trim().replace(/\s|€/g, '');
  if (!s) return null;
  if (!/^-?[\d.,]+$/.test(s)) return null;
  const neg = s.startsWith('-');
  const t = s.replace('-', '');
  const last = Math.max(t.lastIndexOf(','), t.lastIndexOf('.'));
  let cent: number;
  if (last >= 0 && /^\d{1,2}$/.test(t.slice(last + 1))) {
    cent = Number(t.slice(0, last).replace(/[.,]/g, '') || '0') * 100 + Number(t.slice(last + 1).padEnd(2, '0'));
  } else cent = Number(t.replace(/[.,]/g, '')) * 100;
  if (!Number.isFinite(cent)) return null;
  return neg ? -cent : cent;
}

/** Cent → "1234,56" für Eingabefelder */
export const centZuEingabe = (c: number) => (c / 100).toFixed(2).replace('.', ',');

/** UVA-Fälligkeit: 15. des zweitfolgenden Monats */
export function uvaFaellig(monat: string) {
  const [j, m] = monat.split('-').map(Number);
  const d = new Date(Date.UTC(j, m + 1, 15));
  return tagStr(d);
}

export const MONATE = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export const monatName = (monat: string) => `${MONATE[Number(monat.slice(5, 7)) - 1]} ${monat.slice(0, 4)}`;
