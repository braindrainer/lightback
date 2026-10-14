// Platzhalter je Vorlage mit Erklärung und Beispielwerten für die Vorschau
export const PLATZHALTER: Record<string, [string, string][]> = {
  buchung: [['vorname', 'Vorname'], ['nachname', 'Nachname'], ['datum', 'Datum der Vorstellung'], ['uhrzeit', 'Beginn'], ['bestellnummer', 'Buchungsnummer'], ['summe', 'Gesamtbetrag'], ['verwalten_url', 'Link „Buchung verwalten“'], ['tickets_html', 'Tickets mit QR-Codes (fertiges HTML)']],
  storno: [['vorname', 'Vorname'], ['nachname', 'Nachname'], ['bestellnummer', 'Buchungsnummer'], ['plaetze', 'Stornierte Plätze'], ['erstattung', 'Satz zu Erstattung/Gutschein/Gebühr']],
  absage: [['vorname', 'Vorname'], ['nachname', 'Nachname'], ['datum', 'Datum'], ['uhrzeit', 'Beginn'], ['grund', 'Grund der Absage'], ['erstattung', 'Satz zu Erstattung oder Gutschein']],
  erinnerung: [['vorname', 'Vorname'], ['nachname', 'Nachname'], ['datum', 'Datum'], ['uhrzeit', 'Beginn'], ['bestellnummer', 'Buchungsnummer'], ['verwalten_url', 'Link „Buchung verwalten“']],
  freikarte: [['vorname', 'Vorname'], ['nachname', 'Nachname'], ['datum', 'Datum der Vorstellung'], ['uhrzeit', 'Beginn'], ['bestellnummer', 'Buchungsnummer'], ['anzahl', 'Anzahl Freikarten'], ['tickets_html', 'Tickets mit QR-Codes (fertiges HTML)']],
  info: [['betreff', 'Betreff der Nachricht'], ['text_html', 'Text der Nachricht (Absätze)'], ['vorname', 'Vorname'], ['nachname', 'Nachname'], ['datum', 'Datum'], ['uhrzeit', 'Beginn'], ['bestellnummer', 'Buchungsnummer']],
  abbruch: [['vorname', 'Vorname'], ['nachname', 'Nachname'], ['datum', 'Datum'], ['uhrzeit', 'Beginn'], ['grund', 'Grund des Abbruchs'], ['erstattung', 'Satz zum Gutschein']],
  reservierung_verfallen: [['vorname', 'Vorname'], ['nachname', 'Nachname'], ['datum', 'Datum'], ['uhrzeit', 'Beginn'], ['bestellnummer', 'Buchungsnummer'], ['frist', 'Uhrzeit, bis zu der bezahlt sein musste']],
};

export const VORLAGE_NAME: Record<string, string> = { buchung: 'Buchungsbestätigung', storno: 'Stornobestätigung', absage: 'Absage einer Vorstellung', erinnerung: 'Erinnerung am Vortag', freikarte: 'Freikarten (Gästeliste)', info: 'Nachricht an alle Gäste einer Vorstellung', abbruch: 'Abbruch einer Vorstellung', reservierung_verfallen: 'Reservierung verfallen' };

const tickets = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0"><tr><td style="padding:12px 0;border-top:1px solid #e2dacb"><div style="width:140px;height:140px;background:#e2dacb;display:flex;align-items:center;justify-content:center;font-size:12px">QR-Code</div></td><td style="padding:12px 0 12px 16px;border-top:1px solid #e2dacb;vertical-align:middle"><strong>Reihe 5, Platz 10</strong><br>Kategorie I · € 28,00<br><span style="font-family:monospace">K7P2M9XQ4A</span></td></tr></table>`;

export const BEISPIEL: Record<string, Record<string, string>> = {
  buchung: { vorname: 'Erika', nachname: 'Muster', datum: '12.05.2027', uhrzeit: '19:00', bestellnummer: 'LOC-2027-000123', summe: '€ 51,00', verwalten_url: 'https://light.skillful.at/de/buchung/beispiel', tickets_html: tickets },
  storno: { vorname: 'Erika', nachname: 'Muster', bestellnummer: 'LOC-2027-000123', plaetze: 'Reihe 5, Platz 10', erstattung: 'Wir erstatten € 28,00 auf Ihr ursprüngliches Zahlungsmittel. Das kann einige Tage dauern.' },
  absage: { vorname: 'Erika', nachname: 'Muster', datum: '12.05.2027', uhrzeit: '19:00', grund: 'Wegen einer kurzfristigen Veranstaltung in der Kirche.', erstattung: 'Wir erstatten € 51,00 auf Ihr ursprüngliches Zahlungsmittel.' },
  erinnerung: { vorname: 'Erika', nachname: 'Muster', datum: '12.05.2027', uhrzeit: '19:00', bestellnummer: 'LOC-2027-000123', verwalten_url: 'https://light.skillful.at/de/buchung/beispiel' },
  freikarte: { vorname: 'Erika', nachname: 'Muster', datum: '12.05.2027', uhrzeit: '19:00', bestellnummer: 'LOC-2027-000123', anzahl: '2', tickets_html: tickets.replace('€ 28,00', 'Freikarte') },
  info: { betreff: 'Beginn verschiebt sich um 15 Minuten', text_html: '<p>Wegen einer Probe beginnt die Vorstellung heute 15 Minuten später. Der Einlass startet wie gewohnt.</p>', vorname: 'Erika', nachname: 'Muster', datum: '12.05.2027', uhrzeit: '19:00', bestellnummer: 'LOC-2027-000123' },
  abbruch: { vorname: 'Erika', nachname: 'Muster', datum: '12.05.2027', uhrzeit: '19:00', grund: 'Wegen einer technischen Störung.', erstattung: 'Sie erhalten einen Gutschein über € 28,00: Code LOC-ABCD2345, gültig bis 12.05.2030.' },
  reservierung_verfallen: { vorname: 'Erika', nachname: 'Muster', datum: '12.05.2027', uhrzeit: '19:00', bestellnummer: 'LOC-2027-000123', frist: '18:00' },
};
