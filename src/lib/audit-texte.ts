// Lesbare Namen für Protokollaktionen, Bereiche und Felder (auch für ältere Schreibweisen)

export const AKTION: Record<string, string> = {
  bestellung_angelegt: 'Bestellung angelegt', telefonverkauf: 'Telefonverkauf', bezahlt: 'Zahlung eingegangen', zahlung_erhalten: 'Zahlung manuell verbucht',
  zahlung_abgelehnt: 'Zahlung abgelehnt', zahlung_ohne_plaetze: 'Zahlung ohne Plätze', zahlung_erstattet_plaetze_weg: 'Zahlung erstattet (Plätze vergeben)', zahlung_ohne_reservierung: 'Zahlung ohne Reservierung',
  bestellung_verwerfen: 'Bestellung verworfen', bestellung_verfallen: 'Bestellung verfallen', storno: 'Storno', storno_selbst: 'Selbst-Storno (Shop)', partner_storno: 'Storno durch Partner', partner_bestellung: 'Partnerbestellung',
  ticket_storniert: 'Ticket storniert', umbuchung: 'Umgebucht', umbuchung_von: 'Aus Umbuchung entstanden', umbuchung_fehlgeschlagen: 'Umbuchung fehlgeschlagen',
  tickets_senden: 'Tickets erneut gesendet', kunde_bearbeiten: 'Kundendaten geändert', kunde_angelegt: 'Kundendaten angelegt', kunde_anonymisieren: 'Kundendaten anonymisiert', notiz: 'Notiz geändert',
  rechnung_erstellt: 'Rechnung erstellt', stornorechnung_erstellt: 'Stornorechnung erstellt', rechnung_storniert: 'Rechnung storniert', rechnung_bezahlt: 'Rechnung bezahlt', rechnung_gesendet: 'Rechnung gesendet', rechnung_senden_fehler: 'Rechnungsversand fehlgeschlagen',
  'rechnung.anlegen': 'Rechnung erstellt', 'rechnung.bezahlt': 'Rechnung bezahlt', 'rechnung.storno': 'Rechnung storniert', 'rechnung.senden': 'Rechnung gesendet',
  gutschein_ausgestellt: 'Gutschein ausgestellt', gutschein_verkauft: 'Gutschein verkauft', gutschein_verkaufen: 'Gutschein verkauft', gutschein_importiert: 'Partnergutschein importiert', gutscheine_ausstellen: 'Gutscheine ausgestellt',
  partnergutscheine_import: 'Partnergutscheine importiert', gutschein_eingeloest: 'Gutschein eingelöst', gutschein_aktivieren: 'Gutschein aktiviert', gutschein_deaktivieren: 'Gutschein deaktiviert',
  vorstellung_anlegen: 'Vorstellung angelegt', vorstellung_bearbeiten: 'Vorstellung geändert', vorstellung_absagen: 'Vorstellung abgesagt', vorstellung_absagen_ergebnis: 'Absage: Ergebnis', serie_anlegen: 'Serie angelegt',
  verkauf_pausieren: 'Verkauf pausiert', verkauf_oeffnen: 'Verkauf geöffnet', plaetze_sperren: 'Plätze gesperrt', plaetze_entsperren: 'Plätze entsperrt', gaesteliste_export: 'Gästeliste exportiert',
  einlass_ok: 'Eingelassen', einlass_doppelt: 'Einlass abgelehnt: schon eingelassen', einlass_storniert: 'Einlass abgelehnt: storniert', einlass_falsche_vorstellung: 'Einlass abgelehnt: falsche Vorstellung',
  einlass_unbekannt: 'Einlass abgelehnt: unbekannter Code', einlass_ungueltig: 'Einlass abgelehnt: ungültiger QR-Code', einlass_zuruecknehmen: 'Einlass zurückgenommen', einlass_sync: 'Offline-Scans übertragen',
  kassa_verkauf: 'Kassaverkauf', kassa_training: 'Trainingsbeleg', kassa_storno: 'Stornobeleg', beleg_storniert: 'Beleg storniert', kassa_beleg_fehler: 'Kassabeleg fehlgeschlagen', beleg_druck: 'Beleg gedruckt',
  kassa_startbeleg: 'Startbeleg', kassa_nullbeleg: 'Nullbeleg', kassa_monatbeleg: 'Monatsbeleg', kassa_jahrbeleg: 'Jahresbeleg', kassa_schlussbeleg: 'Schlussbeleg', kasse_anlegen: 'Kasse angelegt', kasse_signatur: 'Signatur geändert',
  schicht_oeffnen: 'Schicht geöffnet', schicht_schliessen: 'Schicht geschlossen', dep_export: 'DEP exportiert', artikel_anlegen: 'Artikel angelegt', artikel_aendern: 'Artikel geändert',
  buchung_manuell: 'Manuelle Buchung', 'buchung.manuell': 'Manuelle Buchung', buchung_storniert: 'Buchung storniert', 'buchung.storno': 'Buchung storniert', uva_gebucht: 'UVA gebucht', 'uva.buchen': 'UVA gebucht',
  festschreiben: 'Festgeschrieben', 'buchhaltung.festschreiben': 'Festgeschrieben', auszahlung_erfasst: 'Auszahlung erfasst', 'auszahlung.erfassen': 'Auszahlung erfasst',
  'vorstellungen.abrechnen': 'Vorstellungen abgerechnet', 'konto.anlegen': 'Konto angelegt', 'konto.aktivieren': 'Konto aktiviert', 'konto.deaktivieren': 'Konto deaktiviert',
  'beleg.anlegen': 'Eingangsbeleg erfasst', 'beleg.bezahlt': 'Eingangsbeleg bezahlt', 'beleg.storno': 'Eingangsbeleg storniert', 'bank.import': 'Bankumsätze importiert', 'bank.zuordnen': 'Bankumsatz zugeordnet',
  'export.bmd': 'BMD-Export', 'export.journal': 'Journal exportiert', 'export.saldenliste': 'Saldenliste exportiert', export_statistik: 'Statistik exportiert', protokoll_export: 'Protokoll exportiert', protokoll_pruefung: 'Protokoll geprüft',
  login: 'Anmeldung', logout: 'Abmeldung', login_fehlgeschlagen: 'Anmeldung fehlgeschlagen', login_gesperrt: 'Anmeldung gesperrt', passwort_geaendert: 'Passwort geändert', passwort_zurueckgesetzt: 'Passwort zurückgesetzt',
  benutzer_angelegt: 'Benutzer angelegt', benutzer_geaendert: 'Benutzer geändert', benutzer_deaktiviert: 'Benutzer deaktiviert',
  einstellungen_firma: 'Firmendaten geändert', einstellungen_rechnungen: 'Nummernkreise geändert', einstellungen_mail: 'Mail-Einstellungen geändert', einstellungen_zahlung: 'Zahlungsanbieter geändert', demo_an: 'Demo-Modus an', demo_aus: 'Demo-Modus aus',
  partner_angelegt: 'Partner angelegt', partner_geaendert: 'Partner geändert', partner_deaktiviert: 'Partner deaktiviert', partner_schluessel_neu: 'API-Schlüssel erneuert', partner_webhook_geheimnis_neu: 'Webhook-Geheimnis erneuert',
  ticket_druck: 'Ticket gedruckt', webhook_ok: 'Webhook zugestellt', webhook_fehler: 'Webhook fehlgeschlagen', mail_erneut: 'Mail erneut gesendet', vorlage_gespeichert: 'Mailvorlage geändert', vorlage_zurueckgesetzt: 'Mailvorlage zurückgesetzt',
};

export const BEREICH: Record<string, string> = {
  order: 'Bestellung', ticket: 'Ticket', invoice: 'Rechnung', voucher: 'Gutschein', show: 'Vorstellung', showSeries: 'Serie', customer: 'Kund:in', refund: 'Erstattung',
  receipt: 'Kassabeleg', register: 'Kasse', cashSession: 'Kassenschicht', checkIn: 'Einlass', journal: 'Buchhaltung', journalEntry: 'Buchung', settlement: 'Auszahlung', settings: 'Einstellungen',
  user: 'Benutzer', partner: 'Partner', email: 'E-Mail', emailTemplate: 'Mailvorlage', expense: 'Eingangsbeleg', bank: 'Bank', account: 'Konto', product: 'Artikel', statistik: 'Statistik', auditLog: 'Protokoll',
};

export const FELD: Record<string, string> = {
  status: 'Status', startsAt: 'Beginn', title: 'Titel', notes: 'Notizen', note: 'Notiz', prices: 'Preise', durationMin: 'Dauer (Min.)', cancelReason: 'Absagegrund',
  firstName: 'Vorname', lastName: 'Nachname', email: 'E-Mail', phone: 'Telefon', company: 'Firma', vatId: 'UID', street: 'Straße', zip: 'PLZ', city: 'Ort', country: 'Land', newsletter: 'Newsletter',
  paidCents: 'Bezahlt', refundedCents: 'Erstattet', paidAt: 'Bezahlt am', remainingCents: 'Restwert', valueCents: 'Wert', validUntil: 'Gültig bis', active: 'Aktiv', code: 'Code',
  vorstellung: 'Vorstellung', plaetze: 'Plätze', tickets: 'Tickets', bestellung: 'Bestellung', number: 'Nummer', kind: 'Art', netCents: 'Netto', vatCents: 'USt', grossCents: 'Brutto', sentAt: 'Gesendet am',
  roles: 'Rollen', name: 'Name', pin: 'PIN', lockedUntil: 'Festgeschrieben bis', gesperrt: 'Gesperrte Plätze', checkedInAt: 'Eingelassen am', checkedInBy: 'Eingelassen von', demoMode: 'Demo-Modus',
  totalCents: 'Summe', voucherCents: 'Gutschein', voucherCode: 'Gutscheincode', channel: 'Kanal', partnerRef: 'Partner-Referenz', kunde: 'Kund:in', storniert: 'Storniert', durch: 'Durch', zeilen: 'Buchungszeilen',
  floatCents: 'Wechselgeld', countedCents: 'Gezählt', expectedCents: 'Erwartet', closedAt: 'Geschlossen am', schluesselPraefix: 'Schlüssel-Präfix', subject: 'Betreff', body: 'Text',
};

export const aktionName = (a: string) => AKTION[a] ?? a.replace(/[._]/g, ' ');
export const bereichName = (e: string) => BEREICH[e.charAt(0).toLowerCase() + e.slice(1)] ?? e;
export const feldName = (f: string) => FELD[f] ?? f;

/** Link zum Datensatz im Backend (falls es eine Seite gibt) */
export function bereichLink(entity: string, id: string | null | undefined): string | null {
  if (!id) return null;
  const e = entity.charAt(0).toLowerCase() + entity.slice(1);
  const pfad: Record<string, string> = { order: '/bestellungen/', ticket: '/tickets/', invoice: '/rechnungen/', voucher: '/gutscheine/', show: '/vorstellungen/', customer: '/kunden/', user: '/benutzer/', partner: '/partner/', email: '/emails/', receipt: '/kassa/beleg/' };
  return pfad[e] ? `${pfad[e]}${encodeURIComponent(id)}` : null;
}

/** Ein Feldwert lesbar: Cent-Beträge als Euro, ISO-Zeiten als Wiener Zeit, Listen und Objekte kurz */
export function wertText(feld: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '–';
  if (typeof v === 'boolean') return v ? 'ja' : 'nein';
  if (typeof v === 'number' && /cents$/i.test(feld)) return new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(v / 100);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
    return new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(v));
  }
  if (Array.isArray(v)) return v.length ? v.map((x) => (x && typeof x === 'object' ? Object.entries(x).filter(([k]) => k !== 'id' && k !== 'seatId').map(([k, y]) => wertText(k, y)).join(' · ') : String(x))).join('; ') : '(keine)';
  if (typeof v === 'object') return Object.entries(v).filter(([k, y]) => k !== 'id' && y !== null && y !== '').map(([k, y]) => wertText(k, y)).join(' · ') || '–';
  return String(v);
}
