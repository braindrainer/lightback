import { openapi } from '@/lib/openapi';
import { PARTNER_LIMIT } from '@/lib/partner';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Partner-API', robots: { index: false, follow: false } };

const METHODE: Record<string, string> = { get: 'bg-emerald-50 text-emerald-900', post: 'bg-sky-50 text-sky-900', delete: 'bg-red-50 text-red-900' };

function Code({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-lg bg-nacht p-4 font-mono text-[13px] leading-relaxed text-[#f3ecdc]" tabIndex={0}><code>{children}</code></pre>;
}

const FEHLER: [number, string, string][] = [
  [400, 'ungueltig / json', 'Eingabe passt nicht zum Schema – details listet die Felder'],
  [401, 'nicht_angemeldet', 'Schlüssel fehlt, ist falsch oder deaktiviert'],
  [403, 'kategorie_nicht_erlaubt', 'Kategorie ist für Ihren Zugang nicht freigegeben'],
  [404, 'unbekannt', 'Vorstellung, Bestellung oder Ticket nicht gefunden'],
  [409, 'platz_belegt', 'Platz vergeben – details.seats nennt die belegten Sitze'],
  [409, 'kontingent_erschoepft', 'Ihr Kontingent für diese Vorstellung ist ausgeschöpft'],
  [409, 'keine_plaetze', 'Für holds/best keine passenden Plätze nebeneinander'],
  [410, 'reservierung_abgelaufen', 'Reservierung nach 15 Minuten verfallen – neu reservieren'],
  [422, 'abgelehnt', 'Fachlich nicht möglich, z. B. Storno weniger als 24 h vor Beginn'],
  [429, 'zu_viele_anfragen', 'Rate-Limit überschritten – Header Retry-After beachten'],
];

export default function ApiDoku() {
  const spec = openapi();
  const basis = spec.servers[0].url;
  const pfade = Object.entries(spec.paths) as [string, Record<string, { summary: string; description?: string }>][];
  return (
    <main id="inhalt" className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <p className="font-serif text-[20px] tracking-wide text-accent-deep">Light of Creation</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">Partner-API</h1>
      <p className="mt-3 text-[17px] leading-relaxed">Mit der Partner-API verkaufen Vertriebspartner Tickets für Light of Creation in der Votivkirche Wien direkt aus dem eigenen System: Verfügbarkeit abfragen, Plätze reservieren, Bestellung anlegen, Tickets mit QR-Code ausgeben, stornieren.</p>
      <p lang="en" className="mt-3 rounded-lg bg-accent-soft px-4 py-3 text-[15px] leading-relaxed"><strong>English summary:</strong> REST/JSON API for resellers. Authenticate with <code>Authorization: Bearer loc_live_…</code>. Flow: <code>GET /shows</code> → <code>POST /holds</code> (15-minute reservation) → <code>POST /orders</code> with your unique <code>partnerRef</code> (idempotent) → deliver the signed QR payload or <code>tickets.pdf</code>. Amounts are in euro cents, times in UTC. Cancellation up to 24 h before the show. Machine-readable spec: <a className="underline" href="/api/partner/v1/openapi.json">OpenAPI 3.1</a>.</p>

      <nav aria-label="Inhalt" className="mt-6 flex flex-wrap gap-2 text-sm">
        {[['start', 'Schnellstart'], ['auth', 'Anmeldung'], ['endpunkte', 'Endpunkte'], ['fehler', 'Fehler'], ['webhooks', 'Webhooks'], ['limits', 'Limits']].map(([id, l]) => <a key={id} href={`#${id}`} className="btn-secondary btn-sm">{l}</a>)}
        <a href="/api/partner/v1/openapi.json" className="btn-secondary btn-sm">OpenAPI (JSON)</a>
      </nav>

      <section aria-labelledby="start" className="mt-10">
        <h2 id="start" className="text-xl font-semibold">Schnellstart</h2>
        <p className="mt-2">Basis-URL: <code className="font-mono">{basis}</code>. Alle Beträge in Euro-Cent, alle Zeiten in UTC (ISO 8601). Sitz-IDs: <code>Reihe-Platz</code>, z. B. <code>12-7</code>; Rollstuhlplätze <code>R-1</code> bis <code>R-7</code> (inkl. Begleitsitz).</p>
        <h3 className="mt-4 font-semibold">1. Vorstellungen mit freien Plätzen</h3>
        <Code>{`curl -H "Authorization: Bearer $LOC_KEY" \\
  "${basis}/shows?from=2027-05-01&to=2027-05-31"`}</Code>
        <h3 className="mt-4 font-semibold">2. Plätze reservieren (gilt 15 Minuten)</h3>
        <Code>{`curl -X POST -H "Authorization: Bearer $LOC_KEY" -H "Content-Type: application/json" \\
  -d '{"showId":"cmv8…","seats":[{"seatId":"5-10","art":"normal"},{"seatId":"5-11","art":"ermaessigt"}]}' \\
  "${basis}/holds"

# oder: beste Plätze nebeneinander
curl -X POST -H "Authorization: Bearer $LOC_KEY" -H "Content-Type: application/json" \\
  -d '{"showId":"cmv8…","anzahl":2,"kat":"I"}' "${basis}/holds/best"`}</Code>
        <h3 className="mt-4 font-semibold">3. Bestellen</h3>
        <Code>{`curl -X POST -H "Authorization: Bearer $LOC_KEY" -H "Content-Type: application/json" \\
  -d '{"holdToken":"Zq3…","partnerRef":"TQ-2027-000123","kunde":{"name":"Erika Muster","email":"erika@example.org"}}' \\
  "${basis}/orders"`}</Code>
        <p className="mt-2 text-sm">Antwort <code>201</code> mit Tickets. Jedes Ticket hat <code>qr</code> – diesen Text als QR-Code drucken oder anzeigen. Wiederholen Sie den Aufruf mit derselben <code>partnerRef</code> (z. B. nach einer Zeitüberschreitung), kommt die bestehende Bestellung mit <code>200</code> zurück – es wird nie doppelt gebucht.</p>
        <h3 className="mt-4 font-semibold">4. Tickets abrufen, als PDF, stornieren</h3>
        <Code>{`curl -H "Authorization: Bearer $LOC_KEY" "${basis}/orders/TQ-2027-000123"
curl -H "Authorization: Bearer $LOC_KEY" -o tickets.pdf "${basis}/orders/TQ-2027-000123/tickets.pdf"
curl -X POST -H "Authorization: Bearer $LOC_KEY" -H "Content-Type: application/json" \\
  -d '{"ticketCodes":["K7P2M9XQ4A"]}' "${basis}/orders/TQ-2027-000123/cancel"`}</Code>
      </section>

      <section aria-labelledby="auth" className="mt-10">
        <h2 id="auth" className="text-xl font-semibold">Anmeldung</h2>
        <p className="mt-2">Jede Anfrage braucht den Header <code className="font-mono">Authorization: Bearer loc_live_…</code>. Den Schlüssel erhalten Sie von uns; er wird nur einmal angezeigt und bei uns nur als Hash gespeichert. Bei Verlust erzeugen wir einen neuen – der alte gilt dann sofort nicht mehr. Halten Sie den Schlüssel auf Ihrem Server; nie in Browser- oder App-Code.</p>
        <p className="mt-2">Abrechnung: Bestellungen über die API gelten als bezahlt und werden Ihnen monatlich abzüglich der vereinbarten Provision in Rechnung gestellt. Freigegebene Kategorien und ein mögliches Kontingent je Vorstellung sind vertraglich festgelegt; <code>GET /shows</code> zeigt nur diese Kategorien und Ihr Restkontingent.</p>
      </section>

      <section aria-labelledby="endpunkte" className="mt-10">
        <h2 id="endpunkte" className="text-xl font-semibold">Endpunkte</h2>
        <ul className="mt-3 grid gap-3">
          {pfade.flatMap(([pfad, ops]) => Object.entries(ops).map(([m, op]) => (
            <li key={m + pfad} className="rounded-lg border border-line bg-white p-4">
              <p className="flex flex-wrap items-center gap-2"><span className={`pill uppercase ${METHODE[m] ?? ''}`}>{m}</span><code className="font-mono text-[14px] font-semibold">{pfad}</code></p>
              <p className="mt-1 font-medium">{op.summary}</p>
              {op.description && <p className="mt-1 text-sm text-muted">{op.description}</p>}
            </li>
          )))}
        </ul>
      </section>

      <section aria-labelledby="fehler" className="mt-10">
        <h2 id="fehler" className="text-xl font-semibold">Fehler</h2>
        <p className="mt-2">Fehler kommen immer im selben Format:</p>
        <Code>{`{ "error": { "code": "platz_belegt", "message": "Mindestens ein Platz ist nicht mehr frei", "details": { "seats": ["5-10"] } } }`}</Code>
        <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-white">
          <table className="table">
            <thead><tr><th scope="col">HTTP</th><th scope="col">code</th><th scope="col">Bedeutung</th></tr></thead>
            <tbody>{FEHLER.map(([s, c, t]) => <tr key={c}><td className="num">{s}</td><td className="font-mono text-[13px]">{c}</td><td>{t}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="webhooks" className="mt-10">
        <h2 id="webhooks" className="text-xl font-semibold">Webhooks</h2>
        <p className="mt-2">Wird eine Vorstellung mit Ihren Buchungen abgesagt, senden wir <code>POST</code> an Ihre Webhook-URL (Ereignis <code>show.cancelled</code>; zum Testen <code>ping</code>). Die Tickets sind dann bereits storniert. Bis zu drei Versuche; bitte mit 2xx antworten.</p>
        <Code>{`POST /ihr/webhook
X-LoC-Event: show.cancelled
X-LoC-Signature: sha256=5f1c…   (HMAC-SHA256 des Bodys mit Ihrem Webhook-Geheimnis, hex)

{ "event": "show.cancelled", "createdAt": "2027-05-10T09:12:00.000Z",
  "data": { "showId": "cmv8…", "startsAt": "2027-05-12T17:00:00.000Z", "reason": "…",
            "orders": [ { "partnerRef": "TQ-2027-000123", "number": "LOC-2027-000456", "status": "storniert", "tickets": [ … ] } ] } }`}</Code>
        <p className="mt-2 text-sm">Signatur prüfen (Node.js):</p>
        <Code>{`const soll = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
const ok = crypto.timingSafeEqual(Buffer.from(soll), Buffer.from(req.headers['x-loc-signature']));`}</Code>
      </section>

      <section aria-labelledby="limits" className="mt-10">
        <h2 id="limits" className="text-xl font-semibold">Limits und Regeln</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>{PARTNER_LIMIT} Anfragen pro Minute je Schlüssel; darüber <code>429</code> mit <code>Retry-After</code>.</li>
          <li>Höchstens 10 Plätze je Reservierung; Reservierungen verfallen nach 15 Minuten.</li>
          <li>Storno ganzer Bestellungen oder einzelner Tickets bis 24 Stunden vor Beginn.</li>
          <li><code>GET /shows/&#123;id&#125;/seats</code> unterstützt <code>ETag</code>/<code>If-None-Match</code> (Antwort <code>304</code>) – bitte höchstens alle 5 Sekunden abfragen.</li>
          <li>Ein Rollstuhlplatz (<code>R-n</code>) belegt beide Zusatzsitze am selben Stellplatz in Reihe 0.</li>
        </ul>
        <p className="mt-6 text-sm text-muted">Fragen zur Anbindung: office@light-of-creation.com · Parnassus Immersive GmbH, Wien</p>
      </section>
    </main>
  );
}
