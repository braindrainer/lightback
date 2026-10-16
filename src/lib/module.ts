// Funktionen, die je Veranstalter ein- und ausgeschaltet werden. Standard: alles an.
import { notFound } from 'next/navigation';
import { getSettings } from './db';
import { ApiFehler } from './schnittstelle';

export const MODULE = {
  selbstservice: { name: 'Buchung verwalten im Shop', text: 'Kund:innen stornieren und buchen selbst um (Buchungsnummer + E-Mail), bis 24 Stunden vor Beginn.' },
  kassa: { name: 'Kassa vor Ort', text: 'Registrierkasse mit RKSV, Schichten, Kassenbuch, Ausgabe hinterlegter Karten. Aus = Verkauf nur online und telefonisch.' },
  partner: { name: 'Vertriebspartner & Partner-API', text: 'Verkauf über Partner mit eigenem API-Schlüssel und Kontingenten.' },
  buchhaltung: { name: 'Eigene Buchhaltung', text: 'Buchen, Konten, Saldenliste, GuV & Bilanz, UVA, Belege, Bank, Abschluss. Das Journal läuft immer mit – es ist die Grundlage für BMD.' },
  bmd: { name: 'Übergabe an BMD NTCS', text: 'Täglicher Lauf mit allen neuen Buchungen, Abholung durch den BMD-Konnektor oder per Mail, Rückmeldung mit BMD-Referenz.' },
  stripe: { name: 'Zahlung mit Stripe', text: 'Karte, Apple Pay, Google Pay über das Stripe-Konto des Veranstalters.' },
  paypal: { name: 'Zahlung mit PayPal', text: 'PayPal-Checkout im Shop.' },
  hobex: { name: 'Zahlung mit hobex', text: 'Karte und Apple Pay über hobex (auch Terminal an der Kassa).' },
} as const;

export type Modul = keyof typeof MODULE;
export type ModulStand = Record<Modul, boolean>;

export const MODUL_KEYS = Object.keys(MODULE) as Modul[];

export function modulStand(roh: unknown): ModulStand {
  const m = (roh && typeof roh === 'object' ? roh : {}) as Record<string, unknown>;
  return Object.fromEntries(MODUL_KEYS.map((k) => [k, m[k] !== false])) as ModulStand;
}

export async function modulListe() {
  return modulStand((await getSettings()).module);
}

export async function modulAn(k: Modul) {
  return (await modulListe())[k];
}

/** Seiten: ausgeschaltete Funktion → 404 */
export async function requireModul(k: Modul) {
  if (!(await modulAn(k))) notFound();
}

/** Schnittstellen: ausgeschaltete Funktion → 403 mit Klartext */
export async function assertModulApi(k: Modul) {
  if (!(await modulAn(k))) throw new ApiFehler(403, 'funktion_aus', `${MODULE[k].name} ist bei diesem Veranstalter nicht aktiviert.`);
}

/** Server Actions: ausgeschaltete Funktion → Fehler */
export async function assertModul(k: Modul) {
  if (!(await modulAn(k))) throw new Error(`${MODULE[k].name} ist ausgeschaltet (Einstellungen → Funktionen).`);
}
