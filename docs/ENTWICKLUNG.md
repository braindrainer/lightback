# Lightback – Konventionen für die Entwicklung

Backend für Light of Creation (Parnassus Immersive GmbH, Wien). Next.js 15 App Router, React 19, TypeScript strict,
Prisma 6 + PostgreSQL 18, Tailwind v4. Live: https://lightback.skillful.at (Docker, `./deploy.sh`).

## Grundregeln
- Sprache: Oberfläche Deutsch (per Sie), Bezeichner und Kommentare deutsch, kurz und sachlich wie im vorhandenen Code.
- Geld immer in ganzen Cent (`Int`), Anzeige mit `formatEur` aus `src/lib/money.ts`. Steuersätze ganze Prozent.
- Zeiten: gespeichert UTC, angezeigt in Europe/Vienna über `src/lib/dates.ts` (`fmtDatum`, `fmtZeit`, `wienZuUtc`, `wienTag`).
- Zugriff: Seiten `await requireRole('leitung')`, Server Actions/API `await assertRole(...)` aus `src/lib/auth.ts`.
  Rollen: admin (alles), leitung, buchhaltung, kassa, einlass.
- Wichtige Aktionen protokollieren: `audit(user, 'aktion', 'entity', id, daten, { vorher, nachher })` bzw. `protokoll({...})` aus `src/lib/audit.ts`
  (Details siehe „Revisionssicheres Protokoll“). Geänderte Felder mit `aenderung(alt, neu)`, Geheimnisse nie protokollieren (`maskieren`).
- UI: Klassen aus `src/app/globals.css` (`card`, `btn-primary`, `btn-gold`, `btn-secondary`, `btn-danger`, `btn-ghost`, `input`, `label`, `table`, `pill`, `chip`,
  `titel` (Seitentitel in Cormorant), `h2`, `eyebrow`, `link`, `tabbar`; `rtab` = Tabelle wird unter 768 px zu Karten, Spaltenname per `data-label`,
  Kopfzelle `rtab-kopf`; `tabelle-frei` an der Karte = Tabellenkopf bleibt ab 1280 px stehen) und Komponenten aus `src/components/ui.tsx`:
  `PageHeader` (mit `krumen`), `DetailKopf` (Brotkrumen, Status, Eckdaten, Aktionen, Menü „⋯“), `Kennzahlen`, `Feldliste` (kopierbare Werte), `Abschnitt`,
  `LeerZustand`/`Empty`, `Hinweis`, `FilterChips`, `Fortschritt`, `Money`, `StatusPill`, dazu aus `ui-client.tsx` `Menue`, `Drawer`/`DrawerKnopf`, `Modal`,
  `Bestaetigen`, `Kopieren` und `toast()` (Ausgabe über `ToastBereich` im Layout). Schrift: Figtree (UI), Cormorant nur für Titel und große Zahlen.
  Seitenbreite max. 1400 px (Layout). Symbole: `Icon` aus `src/components/icons.tsx`.
- Barrierefreiheit WCAG 2.2 AA: echte Überschriften, Labels an jedem Feld, Fehlermeldungen mit `role="alert"`,
  Tastaturbedienung, Kontrast ≥ 4,5:1, Ziele ≥ 24 px, keine reine Farbcodierung.
- Server Components + Server Actions bevorzugen; Client-Komponenten nur wo Interaktion nötig ist.
- Navigation steht in `src/lib/nav.ts` (alle Bereiche sind schon eingetragen).

## Fachliche Kernlogik (nicht duplizieren, sondern verwenden)
- `src/lib/saal.ts` – 655 Sitzplätze + 7 Rollstuhlplätze (Koordinaten wie im Shop), `konflikte`, `sitzName`, Preise.
- `src/lib/seats.ts` – `platzStatus`, `auslastung`, `reservieren` (Hold), `verlaengern`, `freigeben`, `sperren`/`entsperren`.
- `src/lib/orders.ts` – `bestellungAnlegen` (aus Hold), `bezahlt` (Tickets, Rechnung, Buchung, Mail),
  `stornieren` (ganz/einzeln, zahlungsmittel|gutschein|keine, Gebühr, 24-h-Frist), `vorstellungAbsagen`, `gutscheinVerkaufen`, `ticketMail`.
- `src/lib/payments.ts` – hobex (OPP), Stripe, PayPal, Demo; `zahlungStarten`, `erstatten`, Status-Abfragen, Stripe-Webhook-Prüfung.
- `src/lib/ledger.ts` – doppelte Buchhaltung (EKR), `buchen`, `stornoBuchung`, Automatikbuchungen, `vorstellungenAbrechnen`, `STEUERCODES` (UVA-Kennzahlen).
- `src/lib/tickets.ts` – Ticketcodes, signierter QR-Inhalt `LOC1.<code>.<showId>.<sig>`, `qrPruefen`, `qrSvg`/`qrPng`.
- `src/lib/mail.ts` – Versand mit Protokoll (`EmailLog`), Vorlagen, Layout.
- `src/lib/pdf.ts` – HTML → PDF über Gotenberg (`GOTENBERG_URL`).

## Datenbank
- Schema `prisma/schema.prisma`. Änderungen nur additiv; `npx prisma db push` (lokal mit `set -a; . ./.env; set +a`).
- Danach bzw. bei jedem Containerstart: `npx tsx scripts/schutz.ts` (Schutz-Trigger, siehe unten). Der Container macht das selbst
  (`docker-entrypoint.sh`: `schutz.ts --spalten` → `prisma db push` → `schutz.ts` → Server).

## Revisionssicheres Protokoll (AuditLog)
- Jeder Eintrag: Zeit, Benutzer (oder „Webshop“, „Partner …“, „System“), Aktion, Objekt + ID, `data`, `vorher`/`nachher` (nur geänderte Felder),
  IP und User-Agent der Anfrage, fortlaufende Nummer `seq`, `prevHash` und `hash`.
- Hash-Kette (`src/lib/audit-kette.ts`): `hash = SHA-256(kanonisches JSON von {createdAt, userId, userName, action, entity, entityId, data,
  vorher, nachher, ip, userAgent, prevHash})`, Schlüssel sortiert, ohne Leerzeichen; erster Vorgänger = 64 × „0“. Angehängt wird in einer
  Transaktion unter `pg_advisory_xact_lock(7401002)`.
- Ohne `user` ermittelt `protokoll()` die angemeldete Person aus der Sitzung; `user: null` + `akteur` für Shop, Partner-API, Zahlungsrückmeldungen, Cron.
- Protokolliert wird in den Lib-Funktionen (orders, umbuchung, seats, einlass, kassa, finanzen/…), damit Backend, Shop, Partner-API und Kassa
  gleich erfasst werden: Bestellung angelegt/bezahlt/storniert/umgebucht/verfallen, Tickets (Storno, jeder Einlass-Scan, Rücknahme, Druck),
  Rechnungen (erstellt, Storno, bezahlt, gesendet), Gutscheine (ausgestellt, verkauft, eingelöst, (de)aktiviert), Sperren, Vorstellungen,
  Buchhaltung (manuell, Storno, UVA, Auszahlung, Festschreibung), Kassabelege und Schichten, Benutzer/Rollen/Passwörter (ohne Geheimnisse),
  Einstellungen (Geheimnisse maskiert), Partner-Schlüssel, Login/Logout/Fehlversuche, Exporte.
- Prüfung: `pruefeKette()` bzw. Seite `/protokoll` → „Integrität prüfen“, auf der Kommandozeile `npx tsx scripts/schutz.ts --pruefen`.
  Export (CSV/JSON mit Hashes) unter `/protokoll/export`, Tagesanker (letzter Hash je Tag) unter `/protokoll/anker` – regelmäßig extern ablegen.
- Verlauf je Datensatz: `<Verlauf ziele={[{ entity: 'order', ids: [id] }, …]} />` aus `src/components/Verlauf.tsx`.

### Datenbank-Trigger (`src/lib/schutz.ts`)
| Tabelle | gesperrt |
|---|---|
| AuditLog | UPDATE, DELETE, TRUNCATE; INSERT nur mit gültigem Hash, der an den letzten Eintrag anschließt |
| JournalEntry | DELETE, TRUNCATE; UPDATE nur zum einmaligen Setzen von `reversesId` (Storno-Verweis) |
| JournalLine, Receipt | UPDATE, DELETE, TRUNCATE |
| Ticket, Invoice, Payment, Refund, Order, CheckIn, VoucherRedemption | DELETE, TRUNCATE (Statusänderungen bleiben erlaubt) |

Fehler lauten „Lightback-Schutz: …“. Nie Trigger abschwächen, sondern Aufrufer korrigieren (stornieren statt löschen).
Grenzen: Wer Superuser-Rechte auf der Datenbank hat, kann Trigger entfernen – das deckt die Hash-Kette zusammen mit den extern
abgelegten Tagesankern auf. Beim ersten Start werden ältere Einträge ohne Hash einmalig in `seq`-Reihenfolge versiegelt.

## Abläufe rund um eine Vorstellung
Hilfe fürs Team: `/hilfe/vorstellung`. Logik in den Lib-Funktionen, alle Aktionen mit Rolle, zod und Protokoll.

| Fall | Wo | Logik |
|---|---|---|
| Freikarten / Gästeliste | `/vorstellungen/[id]/gaeste`, Druck A4 `/vorstellungen/[id]/gaeste/druck` | `src/lib/gaeste.ts` |
| Hinterlegte Karten ausgeben | Kassa → Gäste & Tickets (`/kassa/gaeste`), 80-mm-Druck `/kassa/gaeste/druck/[id]` | `gaeste.gastAusgeben` |
| Namenssuche, „Alle einlassen“, Einlass verweigern | Scanner (`/einlass`), API `einlass/suche`, `manuell`, `verweigern` | `einlass.suchen`, `manuellEinlassen`, `verweigern` |
| Falsche Vorstellung → umbuchen | Scanner (roter Bildschirm), API `einlass/umbuchen` | `einlass.umbuchenAmEinlass` → `umbuchung.umbuchen` |
| Umsetzen / ermäßigt → Vollpreis | Ticketseite, `/kassa/gaeste/ticket/[id]` (mit Aufpreis), `/einlass/umsetzen/[id]` | `src/lib/umsetzen.ts`, `kassa.aufpreisKassieren` |
| Im Saal / Anwesenheitsliste | Scanner, Vorstellungsseite, `/vorstellungen/[id]/anwesenheit` | `einlass.stand` |
| Nachricht an alle Gäste | Vorstellungsseite | `vorstellung.nachrichtAnGaeste` (Vorlage `info`, 5 Min. Sperre) |
| Abbruch während der Vorstellung | Vorstellungsseite (ab Einlassbeginn) | `vorstellung.vorstellungAbbrechen` → `orders.stornieren` |
| Unbezahlte Reservierungen verfallen | Cron, Anzeige auf der Vorstellungsseite | `cron.reservierungenVerfallen` (`Settings.reservierungVerfallMin`, Standard 60) |
| No-Show | Vorstellungsseite, Statistik | `vorstellung.noShow`, `statistik.vorOrtStatistik` |

Daten (alle Felder additiv):
- `Order.channel = 'gast'`, `Order.meta.gast = { grund, notiz, mail, hinterlegt, begleitung, abgeholtAm, abgeholtVon }`, Tickets `art = 'frei'`, 0 €.
  „Begleitung (+1)“ ist eine zusätzliche Karte (zählt für Saal und Einlass). Rollstuhlplatz-Tickets enthalten den Begleitsitz schon.
- `Show.freikartenLimit` (Kontingent, leer = ohne Grenze; Überschreiten nur mit Hinweis), `Show.abgebrochenAt`, `Show.abbruchGrund`.
- `CheckIn.method` (leer = Scan, `manuell`, `umbuchung`), `CheckIn.reason` (bei `result = 'verweigert'`). Verweigern lässt das Ticket gültig.
- `Settings.reservierungVerfallMin`, `Settings.reservierungVerfallMail`.

Buchhaltung:
- Freikarten: `orders.bezahlt` mit Anbieter `gast` und 0 € – keine Zahlung (`Payment` nur bei Betrag > 0), keine Rechnung
  (`rechnungFuerBestellung` überspringt 0-€-Bestellungen), keine Buchung (`buchen` legt bei 0 nichts an). Kein Kassabeleg beim Ausgeben.
- Aufpreis (Umsetzen in höhere Kategorie, ermäßigt → Vollpreis): Kassabeleg mit Position `category: 'ticket-aufpreis'`, gebucht über
  `bucheKassabeleg` als Ticketerlös 13 % auf 4000 (Leistung wird jetzt erbracht). `Ticket.priceCents` bleibt der über die Bestellung bezahlte
  Preis, sonst stünde der Aufpreis in der Leistungsabgrenzung doppelt. Storno des Belegs bucht zurück und setzt eine reine Tarifänderung
  zurück; ein Platzwechsel bleibt bestehen.
- Günstigere Kategorie mit Gutschein: wie Storno als Gutschein (`bucheStorno`, 3490), `Ticket.priceCents` sinkt um die Differenz.
- `stornieren` erkennt selbst, ob die Leistung schon abgegrenzt ist (`journalEntry source 'leistung'`), und bucht dann gegen 4000 statt 3480
  (`nachLeistung`). Abbruch: `mitEingelassen` storniert auch eingelassene Tickets; `gutscheinProzent` < 100 → Gutschein nur über den Anteil,
  der Rest bleibt Erlös (vor der Abgrenzung wird er von 3480 auf 4000 umgebucht); die Stornorechnung lautet dann auf den Gutscheinbetrag.

## Prüfen
- `npx tsc --noEmit`, `npx next build`.

## Schnittstellen (Shop, Partner, Zahlung, Cron)
- Shop-API `src/app/api/public/v1/…` (CORS nur für `PUBLIC_ORIGIN`), Partner-API `src/app/api/partner/v1/…` (Bearer `loc_live_…`),
  Doku öffentlich unter `/api-doku`, OpenAPI unter `/api/partner/v1/openapi.json`. Logik in `src/lib/shop.ts`, `partner.ts`, `schnittstelle.ts`.
- Zahlungsrückkehr: `/api/zahlung/hobex/return`, `/api/zahlung/paypal/return`, Stripe-Webhook `/api/zahlung/stripe/webhook`.
- Umgebungsvariable `CRON_KEY` (mind. 16 Zeichen). Crontab auf dem Server:
  `*/5 * * * * curl -fsS -X POST -H "X-Cron-Key: $CRON_KEY" https://lightback.skillful.at/api/cron >/dev/null`
- nginx muss `X-Real-IP` selbst setzen (`proxy_set_header X-Real-IP $remote_addr;`), sonst greifen die Limits je IP nicht.
- Lasttest: `npx tsx scripts/lasttest.ts <basisUrl> <showId> [anzahl]` (nur gegen Testvorstellungen).

## Funktionen ein/aus (`src/lib/module.ts`)
- `Settings.module` (JSON, fehlender Schlüssel = an): selbstservice, kassa, partner, buchhaltung, bmd, stripe, paypal, hobex. Schalter unter Einstellungen → Funktionen.
- Seiten: `requireModul(k)` (404), Server Actions: `assertModul(k)`, Schnittstellen: `assertModulApi(k)` (403). Menüpunkte tragen `modul` in `src/lib/nav.ts`.
- Das Journal läuft immer mit, auch bei ausgeschalteter Buchhaltung – es ist die Quelle für BMD.

## Buchung verwalten (Shop)
- Shop-Seite `/{de|en}/buchung` (Nummer + E-Mail) und `/{de|en}/buchung/{manageToken}` im Repo `/opt/light`.
- API: `POST /api/public/v1/orders/lookup` (`{ nummer, email }` → manageToken, Buchungs- oder Ticketnummer), `POST /orders/{token}/storno`,
  `POST /orders/{token}/rebook` (`{ showId, ticketCodes? }`, gleiche Kategorie und Tarif, beste freie Plätze, nur ohne Aufpreis; Rest bleibt Gutschein).
  Logik in `src/lib/selbstservice.ts`, Frist `STORNO_FRIST_H` (24 h laut AGB).

## BMD-Übergabe (`src/lib/finanzen/bmd-uebergabe.ts`)
- `BmdLauf` = eine Importdatei (Format wie `bmd.ts`). Jede Buchung steht in genau einem gültigen Lauf (bereit | abgeholt | uebernommen);
  „fehler“ gibt die Buchungen für den nächsten Lauf frei. Läufe werden nie gelöscht (Schutz-Trigger).
- Cron legt nach 2 Uhr einmal täglich einen Lauf bis zum Vortag an; manuell unter `/bmd`. Optional Kopie per Mail (`Settings.bmdMail`).
- Konnektor-API mit `Authorization: Bearer loc_bmd_…` (nur Hash in `Settings.bmdKeyHash`): `GET /api/bmd/v1/laeufe`,
  `GET /api/bmd/v1/laeufe/{nummer}/datei`, `POST /api/bmd/v1/laeufe/{nummer}/rueckmeldung` `{ ok, referenz?, fehler? }`.

## Backup
- `scripts/backup.sh` täglich 03:15 (pg_dump + `data/` nach `/var/backups/lightback`, 30 Tage), `scripts/backup-pruefen.sh` monatlicher
  Restore-Test in eine Wegwerf-Datenbank. Cron: `scripts/lightback-backup.cron` → `/etc/cron.d/lightback-backup`.
