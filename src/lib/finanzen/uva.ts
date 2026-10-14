// Umsatzsteuervoranmeldung (U30) aus dem Journal. Reine Rechenfunktionen, damit testbar.
//
// Bemessungsgrundlagen kommen aus JournalLine.baseCents der Zeilen mit Steuercode (U20/U10/U13),
// die Steuerbeträge aus den Bewegungen der Steuerkonten 3500/3501/3502 (USt) und 2500 (Vorsteuer).
// Buchungssätze, die das Verrechnungskonto 3540 berühren (UVA-Umbuchung und deren Storno), zählen nicht mit.
import { STEUERCODES } from '../ledger';

export const VERRECHNUNG_FA = '3540';
export const VORSTEUER = '2500';
export const UST_KONTEN = [...new Set(Object.values(STEUERCODES).filter((c) => c.art === 'U').map((c) => c.konto))];
export const STEUERKONTEN = new Set(Object.values(STEUERCODES).map((c) => c.konto));

export type UvaZeile = { entryId: string; konto: string; soll: number; haben: number; vatCode: string | null; base: number | null };

export type UvaErgebnis = {
  kz000: number;
  saetze: { kz: string; satz: number; code: string; konto: string; base: number; berechnet: number; gebucht: number }[];
  vorsteuer: number; // KZ 060
  vorsteuerBasis: number;
  ustSumme: number;
  zahllast: number; // > 0 Zahllast, < 0 Gutschrift (KZ 095)
  differenzen: string[];
  zeilen: number;
};

/** Buchungssätze mit einer Zeile auf 3540 ausnehmen */
export function ohneVerrechnung<T extends { entryId: string; konto: string }>(zeilen: T[]): T[] {
  const raus = new Set(zeilen.filter((z) => z.konto === VERRECHNUNG_FA).map((z) => z.entryId));
  return zeilen.filter((z) => !raus.has(z.entryId));
}

export function uvaBerechnen(alle: UvaZeile[]): UvaErgebnis {
  const zeilen = ohneVerrechnung(alle);
  const saetze = Object.entries(STEUERCODES).filter(([, c]) => c.art === 'U').map(([code, c]) => {
    const base = zeilen.filter((z) => z.vatCode === code && !STEUERKONTEN.has(z.konto)).reduce((s, z) => s + (z.base ?? 0), 0);
    const gebucht = zeilen.filter((z) => z.konto === c.konto).reduce((s, z) => s + z.haben - z.soll, 0);
    return { kz: c.kz, satz: c.satz, code, konto: c.konto, base, berechnet: Math.round((base * c.satz) / 100), gebucht };
  }).sort((a, b) => b.satz - a.satz);
  const vorsteuer = zeilen.filter((z) => z.konto === VORSTEUER).reduce((s, z) => s + z.soll - z.haben, 0);
  const vorsteuerBasis = zeilen.filter((z) => z.vatCode && STEUERCODES[z.vatCode]?.art === 'V' && !STEUERKONTEN.has(z.konto)).reduce((s, z) => s + (z.base ?? 0), 0);
  const ustSumme = saetze.reduce((s, x) => s + x.gebucht, 0);
  const differenzen: string[] = [];
  for (const s of saetze) {
    // Rundung je Buchung → wenige Cent Abweichung sind normal
    const toleranz = Math.max(5, zeilen.filter((z) => z.vatCode === s.code).length);
    if (Math.abs(s.gebucht - s.berechnet) > toleranz) differenzen.push(`USt ${s.satz} %: gebucht ${s.gebucht} Cent, aus Bemessungsgrundlage ${s.berechnet} Cent`);
  }
  return { kz000: saetze.reduce((s, x) => s + x.base, 0), saetze, vorsteuer, vorsteuerBasis, ustSumme, zahllast: ustSumme - vorsteuer, differenzen, zeilen: zeilen.length };
}

/** Zeilen des Umbuchungssatzes "UVA buchen": Steuerkonten auf 3540 (Verrechnung Finanzamt) */
export function uvaUmbuchung(e: UvaErgebnis) {
  const z: { konto: string; soll?: number; haben?: number; text?: string }[] = [];
  for (const s of e.saetze) if (s.gebucht) z.push({ konto: s.konto, soll: s.gebucht, text: `USt ${s.satz} %` });
  if (e.vorsteuer) z.push({ konto: VORSTEUER, haben: e.vorsteuer, text: 'Vorsteuer' });
  if (e.zahllast) z.push({ konto: VERRECHNUNG_FA, haben: e.zahllast, text: e.zahllast > 0 ? 'Zahllast' : 'Gutschrift' });
  return z;
}
