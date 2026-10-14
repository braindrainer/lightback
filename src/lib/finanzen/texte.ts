// Bezeichnungen für die Oberfläche
export const QUELLEN: Record<string, string> = {
  order: 'Ticketverkauf', leistung: 'Leistungsabgrenzung', refund: 'Storno Bestellung', receipt: 'Kassa', voucher: 'Gutschein',
  settlement: 'Auszahlung Anbieter', expense: 'Eingangsrechnung', 'expense-paid': 'Zahlung Eingangsrechnung', invoice: 'Ausgangsrechnung',
  'invoice-paid': 'Zahlungseingang', manual: 'Manuell', storno: 'Storno', uva: 'UVA', bank: 'Bank', eroeffnung: 'Eröffnung',
};
export const quelle = (s: string) => QUELLEN[s] ?? s;
export const STEUERCODE_TEXT: Record<string, string> = {
  U20: 'U20 – Umsatzsteuer 20 %', U13: 'U13 – Umsatzsteuer 13 %', U10: 'U10 – Umsatzsteuer 10 %',
  V20: 'V20 – Vorsteuer 20 %', V13: 'V13 – Vorsteuer 13 %', V10: 'V10 – Vorsteuer 10 %',
};
export const HINWEIS_VORSCHLAG = 'Kontenplan (EKR) und Automatikbuchungen sind ein Vorschlag und mit der Steuerberatung abzustimmen. Alle Auswertungen sind vorläufig.';
