// OpenAPI 3.1 der Partner-API. Wird als JSON ausgeliefert und auf /api-doku lesbar dargestellt.
import { PARTNER_LIMIT } from './partner';

const basis = () => (process.env.APP_ORIGIN ?? 'https://lightback.skillful.at').replace(/\/$/, '');

const fehler = { $ref: '#/components/responses/Fehler' };
const ref = (n: string) => ({ $ref: `#/components/schemas/${n}` });
const jsonBody = (schema: object, example?: object) => ({ required: true, content: { 'application/json': { schema, ...(example ? { example } : {}) } } });
const jsonAntwort = (beschreibung: string, schema: object) => ({ description: beschreibung, content: { 'application/json': { schema } } });

export function openapi() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Light of Creation – Partner-API',
      version: '1.0.0',
      description: 'Ticketverkauf für Vertriebspartner (Wiederverkäufer, Hotels, Plattformen). Beträge in Euro-Cent, Zeiten in UTC (ISO 8601). ' +
        'Ablauf: Vorstellungen abfragen → Plätze reservieren (15 Min.) → Bestellung mit eigener partnerRef anlegen → Tickets (QR) ausgeben. ' +
        'Abrechnung per Rechnung abzüglich vereinbarter Provision.',
      contact: { name: 'Parnassus Immersive GmbH', email: 'office@light-of-creation.com' },
    },
    servers: [{ url: `${basis()}/api/partner/v1` }],
    security: [{ bearer: [] }],
    tags: [{ name: 'Vorstellungen' }, { name: 'Reservierungen' }, { name: 'Bestellungen' }],
    paths: {
      '/shows': {
        get: {
          tags: ['Vorstellungen'], summary: 'Vorstellungen mit Verfügbarkeit', operationId: 'listShows',
          description: 'Nur Kategorien, die für Ihren Zugang freigegeben sind. `quota` zeigt Ihr Restkontingent je Vorstellung (null = unbegrenzt).',
          parameters: [
            { name: 'from', in: 'query', schema: { type: 'string' }, description: 'Tag (YYYY-MM-DD, Wiener Zeit) oder ISO-Zeitpunkt. Standard: jetzt', example: '2027-05-01' },
            { name: 'to', in: 'query', schema: { type: 'string' }, description: 'Tag oder ISO-Zeitpunkt. Standard: from + 90 Tage, höchstens 186 Tage', example: '2027-05-31' },
          ],
          responses: { 200: jsonAntwort('Liste', { type: 'array', items: ref('Show') }), 400: fehler, 401: fehler, 429: fehler },
        },
      },
      '/shows/{id}/seats': {
        get: {
          tags: ['Vorstellungen'], summary: 'Sitzstatus einer Vorstellung', operationId: 'showSeats',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: jsonAntwort('Status je Sitz-ID ("12-7" = Reihe 12, Platz 7; "R-3" = Rollstuhlplatz 3)', ref('Seats')), 401: fehler, 404: fehler },
        },
      },
      '/holds': {
        post: {
          tags: ['Reservierungen'], summary: 'Bestimmte Plätze reservieren', operationId: 'createHold',
          description: 'Alle Plätze oder keiner. Die Reservierung gilt 15 Minuten. Ist ein Platz vergeben, kommt 409 mit den belegten Sitz-IDs.',
          requestBody: jsonBody(ref('HoldRequest'), { showId: 'cmv8…', seats: [{ seatId: '5-10', art: 'normal' }, { seatId: '5-11', art: 'ermaessigt' }] }),
          responses: { 201: jsonAntwort('Reservierung', ref('Hold')), 400: fehler, 403: fehler, 409: fehler, 422: fehler },
        },
      },
      '/holds/best': {
        post: {
          tags: ['Reservierungen'], summary: 'Beste Plätze nebeneinander suchen und reservieren', operationId: 'createBestHold',
          requestBody: jsonBody(ref('BestRequest'), { showId: 'cmv8…', anzahl: 2, kat: 'I' }),
          responses: { 201: jsonAntwort('Reservierung', ref('Hold')), 403: fehler, 409: fehler },
        },
      },
      '/holds/{token}': {
        get: { tags: ['Reservierungen'], summary: 'Reservierung abfragen', operationId: 'getHold', parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: jsonAntwort('Reservierung', ref('Hold')), 410: fehler } },
        delete: { tags: ['Reservierungen'], summary: 'Reservierung freigeben', operationId: 'deleteHold', parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }], responses: { 204: { description: 'Freigegeben' } } },
      },
      '/orders': {
        post: {
          tags: ['Bestellungen'], summary: 'Bestellung anlegen (auf Rechnung)', operationId: 'createOrder',
          description: 'Wandelt die Reservierung in gültige Tickets um. `partnerRef` ist Ihre eindeutige Buchungsnummer: Ein zweiter Aufruf mit derselben Referenz liefert die bestehende Bestellung (200) statt einer neuen (201) – sicher bei Zeitüberschreitung wiederholbar. ' +
            'Mit `kunde.email` schicken wir die Tickets zusätzlich per E-Mail.',
          requestBody: jsonBody(ref('OrderRequest'), { holdToken: 'Zq3…', partnerRef: 'TQ-2027-000123', kunde: { name: 'Erika Muster', email: 'erika@example.org' } }),
          responses: { 200: jsonAntwort('Bestehende Bestellung', ref('Order')), 201: jsonAntwort('Neue Bestellung', ref('Order')), 403: fehler, 409: fehler, 410: fehler },
        },
      },
      '/orders/{partnerRef}': {
        get: { tags: ['Bestellungen'], summary: 'Bestellung mit Tickets', operationId: 'getOrder', parameters: [{ name: 'partnerRef', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: jsonAntwort('Bestellung', ref('Order')), 404: fehler } },
      },
      '/orders/{partnerRef}/tickets.pdf': {
        get: {
          tags: ['Bestellungen'], summary: 'Tickets als PDF (ein QR-Code je Ticket)', operationId: 'getTicketsPdf',
          parameters: [{ name: 'partnerRef', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'PDF', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } }, 404: fehler, 503: fehler },
        },
      },
      '/orders/{partnerRef}/cancel': {
        post: {
          tags: ['Bestellungen'], summary: 'Stornieren (ganz oder einzelne Tickets)', operationId: 'cancelOrder',
          description: 'Bis 24 Stunden vor Beginn. Der Ticketpreis wird in der nächsten Abrechnung gutgeschrieben; die Erstattung an Ihre Kund:innen übernehmen Sie.',
          parameters: [{ name: 'partnerRef', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: jsonBody({ type: 'object', properties: { ticketCodes: { type: 'array', items: { type: 'string' }, description: 'Leer = ganze Bestellung' } } }, { ticketCodes: ['K7P2M9XQ4A'] }),
          responses: { 200: jsonAntwort('Bestellung nach Storno', ref('Order')), 404: fehler, 422: fehler },
        },
      },
    },
    webhooks: {
      'show.cancelled': {
        post: {
          summary: 'Vorstellung abgesagt',
          description: 'POST an Ihre Webhook-URL, wenn eine Vorstellung mit Ihren Buchungen abgesagt wird. Header `X-LoC-Event` und `X-LoC-Signature: sha256=<HMAC-SHA256 des Bodys mit Ihrem Webhook-Geheimnis, hex>`. Bis zu drei Versuche; antworten Sie mit 2xx.',
          requestBody: jsonBody(ref('WebhookShowCancelled')),
          responses: { 200: { description: 'Empfangen' } },
        },
      },
    },
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'API-Schlüssel `loc_live_…` (erhalten Sie von uns, wird nur einmal angezeigt)' } },
      responses: {
        Fehler: { description: 'Fehler', content: { 'application/json': { schema: ref('Error'), example: { error: { code: 'platz_belegt', message: 'Mindestens ein Platz ist nicht mehr frei', details: { seats: ['5-10'] } } } } } },
      },
      schemas: {
        Error: { type: 'object', required: ['error'], properties: { error: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} } } } },
        Prices: { type: 'object', description: 'Preise in Cent je Kategorie', example: { I: { normal: 2800, ermaessigt: 2300 }, II: { normal: 2400, ermaessigt: 1900 }, R: { normal: 2800 } } },
        Show: {
          type: 'object', properties: {
            id: { type: 'string' }, title: { type: 'string' }, startsAt: { type: 'string', format: 'date-time' }, durationMin: { type: 'integer' },
            status: { type: 'string', enum: ['verkauf', 'pausiert', 'abgesagt'] }, prices: ref('Prices'),
            frei: { type: 'object', additionalProperties: { type: 'integer' }, example: { I: 120, II: 340 } }, wenig: { type: 'boolean' }, ausverkauft: { type: 'boolean' },
            quota: { type: ['object', 'null'], properties: { total: { type: 'integer' }, sold: { type: 'integer' }, remaining: { type: 'integer' } } },
          },
        },
        Seats: { type: 'object', properties: { showId: { type: 'string' }, status: { type: 'object', additionalProperties: { type: 'string', enum: ['frei', 'belegt'] } } } },
        HoldRequest: { type: 'object', required: ['showId', 'seats'], properties: { showId: { type: 'string' }, seats: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'object', required: ['seatId'], properties: { seatId: { type: 'string' }, art: { type: 'string', enum: ['normal', 'ermaessigt'], default: 'normal' } } } } } },
        BestRequest: { type: 'object', required: ['showId', 'anzahl', 'kat'], properties: { showId: { type: 'string' }, anzahl: { type: 'integer', minimum: 1, maximum: 10 }, kat: { type: 'string', enum: ['I', 'II', 'R'] }, art: { type: 'string', enum: ['normal', 'ermaessigt'] }, wunsch: { type: 'object', properties: { sehen: { type: 'boolean' }, hoeren: { type: 'string', enum: ['', 'naeher', 'weiter'] }, rand: { type: 'boolean' } } } } },
        Hold: { type: 'object', properties: { token: { type: 'string' }, showId: { type: 'string' }, expiresAt: { type: 'string', format: 'date-time' }, extensions: { type: 'integer' }, seats: { type: 'array', items: { type: 'object', properties: { seatId: { type: 'string' }, name: { type: 'string' }, kat: { type: 'string' }, art: { type: 'string' }, priceCents: { type: 'integer' } } } }, totalCents: { type: 'integer' } } },
        OrderRequest: { type: 'object', required: ['holdToken', 'partnerRef'], properties: { holdToken: { type: 'string' }, partnerRef: { type: 'string', maxLength: 80, pattern: '^[A-Za-z0-9._:\\-/]+$' }, kunde: { type: 'object', required: ['name', 'email'], properties: { name: { type: 'string' }, email: { type: 'string', format: 'email' } } } } },
        Ticket: { type: 'object', properties: { code: { type: 'string' }, seatId: { type: 'string' }, seat: { type: 'string' }, kat: { type: 'string' }, art: { type: 'string' }, priceCents: { type: 'integer' }, status: { type: 'string', enum: ['gueltig', 'eingelassen', 'storniert'] }, qr: { type: 'string', description: 'Inhalt für den QR-Code (signiert, wird beim Einlass geprüft)', example: 'LOC1.K7P2M9XQ4A.cmv8….AbC123xyz_-0123' } } },
        Order: {
          type: 'object', properties: {
            id: { type: 'string' }, number: { type: 'string' }, status: { type: 'string', enum: ['bezahlt', 'teilstorniert', 'storniert'] }, partnerRef: { type: 'string' },
            show: { type: 'object', properties: { id: { type: 'string' }, startsAt: { type: 'string', format: 'date-time' }, status: { type: 'string' } } },
            totalCents: { type: 'integer' }, invoiceNumber: { type: ['string', 'null'] }, stornoMoeglich: { type: 'boolean' }, stornoBis: { type: 'string', format: 'date-time' },
            tickets: { type: 'array', items: ref('Ticket') },
          },
        },
        WebhookShowCancelled: { type: 'object', properties: { event: { const: 'show.cancelled' }, createdAt: { type: 'string', format: 'date-time' }, data: { type: 'object', properties: { showId: { type: 'string' }, startsAt: { type: 'string', format: 'date-time' }, reason: { type: 'string' }, orders: { type: 'array', items: { type: 'object', properties: { partnerRef: { type: 'string' }, number: { type: 'string' }, status: { type: 'string' }, tickets: { type: 'array', items: { type: 'object' } } } } } } } } },
      },
    },
    'x-rate-limit': `${PARTNER_LIMIT} Anfragen pro Minute je API-Schlüssel; darüber 429 mit details.retryAfter (Sekunden).`,
  };
}
