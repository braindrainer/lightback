// Bezeichnungen für den Verkauf (Anzeige)
export const KAT_NAME: Record<string, string> = { I: 'Kategorie I', II: 'Kategorie II', R: 'Rollstuhlplatz' };
export const ART_NAME: Record<string, string> = { normal: 'Vollpreis', ermaessigt: 'Ermäßigt', frei: 'Freikarte', rollstuhl: 'Rollstuhl + Begleitung' };
export const KANAL_NAME: Record<string, string> = { web: 'Webshop', telefon: 'Telefon', abendkasse: 'Abendkasse', partner: 'Partner', gast: 'Gästeliste' };
export const ZAHLART_NAME: Record<string, string> = {
  hobex: 'Karte online (hobex)', stripe: 'Stripe', paypal: 'PayPal', applepay: 'Apple Pay', gutschein: 'Gutschein',
  bar: 'Bar', terminal: 'Karte (Terminal)', rechnung: 'Rechnung / Überweisung', partner: 'Partner', zahlungslink: 'Zahlungslink', gast: 'Freikarte (0 €)',
};
export const METHODE_NAME: Record<string, string> = { zahlungsmittel: 'Erstattung aufs Zahlungsmittel', gutschein: 'Gutschein', keine: 'Keine Erstattung' };
export const GRUND_NAME: Record<string, string> = { kunde: 'Wunsch der Kund:in', kulanz: 'Kulanz', absage: 'Absage', umbuchung: 'Umbuchung', partner: 'Partner', sonstiges: 'Sonstiges' };
export const SPERRGRUENDE = ['Presse', 'Technik', 'Kontingent', 'Sonstiges'] as const;
export const SHOW_STATUS = ['verkauf', 'pausiert', 'geplant'] as const;
export const WOCHENTAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

/** Cent → "28,00" für Eingabefelder */
export const euroFeld = (c: number) => (c / 100).toFixed(2).replace('.', ',');
export const ISSUER_NAME: Record<string, string> = { eigen: 'Eigener', storno: 'Aus Storno' };
/** <th scope="row"> wie eine normale Zelle darstellen (.table th ist als Spaltenkopf gestaltet) */
export const ZEILENKOPF = '!normal-case !tracking-normal !text-sm !font-medium !text-ink !bg-transparent !whitespace-normal';
