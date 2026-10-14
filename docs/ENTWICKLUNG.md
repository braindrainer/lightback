# Lightback – Konventionen für die Entwicklung

Backend für Light of Creation (Parnassus Immersive GmbH, Wien). Next.js 15 App Router, React 19, TypeScript strict,
Prisma 6 + PostgreSQL 18, Tailwind v4. Live: https://lightback.skillful.at (Docker, `./deploy.sh`).

## Grundregeln
- Sprache: Oberfläche Deutsch (per Sie), Bezeichner und Kommentare deutsch, kurz und sachlich wie im vorhandenen Code.
- Geld immer in ganzen Cent (`Int`), Anzeige mit `formatEur` aus `src/lib/money.ts`. Steuersätze ganze Prozent.
- Zeiten: gespeichert UTC, angezeigt in Europe/Vienna über `src/lib/dates.ts` (`fmtDatum`, `fmtZeit`, `wienZuUtc`, `wienTag`).
- Zugriff: Seiten `await requireRole('leitung')`, Server Actions/API `await assertRole(...)` aus `src/lib/auth.ts`.
  Rollen: admin (alles), leitung, buchhaltung, kassa, einlass.
- Wichtige Aktionen protokollieren: `audit(user, 'aktion', 'entity', id, daten)` aus `src/lib/audit.ts`.
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
