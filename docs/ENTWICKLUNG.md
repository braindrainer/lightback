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
- UI: Klassen aus `src/app/globals.css` (`card`, `btn-primary`, `btn-gold`, `btn-secondary`, `btn-danger`, `input`, `label`, `table`, `pill`, `h1`, `h2`, `tabbar`)
  und Komponenten aus `src/components/ui.tsx` (`PageHeader`, `Money`, `StatusPill`, `Stat`, `Empty`).
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
