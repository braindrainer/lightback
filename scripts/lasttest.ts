// Lasttest für die Shop-API: N gleichzeitige Käufer:innen auf einer Vorstellung.
// Aufruf: npx tsx scripts/lasttest.ts <basisUrl> <showId> [anzahl=200]
// Jede:r Käufer:in bekommt eine eigene X-Real-IP (nur sinnvoll, wenn der Server diesen Header vertraut –
// in Produktion setzt nginx ihn selbst). Prüft am Ende in der Datenbank (DATABASE_URL) auf Doppelverkauf.
import { PrismaClient } from '@prisma/client';

const [basis = 'http://localhost:3304', showId, anzahlArg] = process.argv.slice(2);
if (!showId) { console.error('Aufruf: tsx scripts/lasttest.ts <basisUrl> <showId> [anzahl]'); process.exit(1); }
const N = Number(anzahlArg ?? 200);
const API = `${basis.replace(/\/$/, '')}/api/public/v1`;

const zeiten = new Map<string, number[]>();
const status = new Map<string, Map<number, number>>();
let fehler = 0;

async function rufe(name: string, ip: string, pfad: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  const t0 = performance.now();
  try {
    const r = await fetch(API + pfad, { ...init, headers: { 'Content-Type': 'application/json', 'X-Real-IP': ip, ...(init.headers ?? {}) } });
    const text = await r.text();
    const ms = performance.now() - t0;
    (zeiten.get(name) ?? zeiten.set(name, []).get(name)!).push(ms);
    const s = status.get(name) ?? status.set(name, new Map()).get(name)!;
    s.set(r.status, (s.get(r.status) ?? 0) + 1);
    return { status: r.status, body: text ? JSON.parse(text) : null, etag: r.headers.get('etag') };
  } catch (e) {
    fehler++;
    (status.get(name) ?? status.set(name, new Map()).get(name)!).set(0, ((status.get(name)!.get(0)) ?? 0) + 1);
    return { status: 0, body: { error: String(e) }, etag: null };
  }
}

const zufall = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];

async function kaeufer(i: number) {
  const ip = `10.${(i >> 8) & 255}.${i & 255}.${7 + (i % 200)}`;
  const s = await rufe('GET seats', ip, `/shows/${showId}/seats`);
  if (s.status !== 200) return 'kein_status';
  let frei = Object.entries(s.body.status as Record<string, string>).filter(([id, v]) => v === 'frei' && !id.startsWith('R-')).map(([id]) => id);
  const anzahl = 1 + Math.floor(Math.random() * 4);
  // Shop-Verhalten: erster Platz per POST, weitere einzeln per PATCH (Klick für Klick)
  let token = '';
  for (let v = 0; v < 5 && !token; v++) {
    const h = await rufe('POST holds', ip, '/holds', { method: 'POST', body: JSON.stringify({ showId, seats: [{ seatId: zufall(frei), art: 'normal' }] }) });
    if (h.status === 201) token = h.body.token;
    else if (h.status === 409) frei = frei.filter((x) => !(h.body.error.details?.seats ?? []).includes(x));
    else return `hold_${h.status}`;
  }
  if (!token) return 'kein_hold';
  for (let k = 1; k < anzahl; k++) {
    const p = await rufe('PATCH holds', ip, `/holds/${token}`, { method: 'PATCH', body: JSON.stringify({ add: [{ seatId: zufall(frei), art: Math.random() < 0.3 ? 'ermaessigt' : 'normal' }] }) });
    if (p.status === 409) continue;
  }
  let etag = s.etag ?? '';
  for (let k = 0; k < 2; k++) {
    const r = await rufe('GET seats (poll)', ip, `/shows/${showId}/seats`, { headers: { 'X-Hold-Token': token, ...(etag ? { 'If-None-Match': etag } : {}) } });
    if (r.etag) etag = r.etag;
  }
  if (Math.random() < 0.3) {
    if (Math.random() < 0.5) await rufe('DELETE holds', ip, `/holds/${token}`, { method: 'DELETE' });
    return 'abgebrochen';
  }
  const o = await rufe('POST orders', ip, '/orders', { method: 'POST', body: JSON.stringify({ holdToken: token, kunde: { firstName: 'Last', lastName: `Test ${i}`, email: `last${i}@example.org` }, provider: 'hobex', demoKarte: '4111111111111111', locale: 'de' }) });
  return o.status === 201 ? 'bezahlt' : `order_${o.status}`;
}

const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0; };

(async () => {
  console.log(`Lasttest: ${N} Käufer:innen gleichzeitig auf ${showId} (${API})`);
  const t0 = performance.now();
  const erg = await Promise.all(Array.from({ length: N }, (_, i) => kaeufer(i)));
  const dauer = (performance.now() - t0) / 1000;
  const zaehl = erg.reduce((m, e) => m.set(e, (m.get(e) ?? 0) + 1), new Map<string, number>());
  console.log(`Dauer ${dauer.toFixed(1)} s · Ergebnisse:`, Object.fromEntries(zaehl));
  console.log('\nEndpunkt              Anz.   p50 ms   p95 ms   max ms   Status');
  for (const [n, z] of zeiten) console.log(`${n.padEnd(20)} ${String(z.length).padStart(5)} ${q(z, 50).toFixed(0).padStart(8)} ${q(z, 95).toFixed(0).padStart(8)} ${Math.max(...z).toFixed(0).padStart(8)}   ${JSON.stringify(Object.fromEntries(status.get(n)!))}`);
  const holds = [...(status.get('POST holds') ?? new Map()).entries()].reduce((n, [, c]) => n + c, 0) + [...(status.get('PATCH holds') ?? new Map()).entries()].reduce((n, [, c]) => n + c, 0);
  const k409 = (status.get('POST holds')?.get(409) ?? 0) + (status.get('PATCH holds')?.get(409) ?? 0);
  console.log(`\n409-Quote Reservierungen: ${((k409 / Math.max(1, holds)) * 100).toFixed(1)} % (${k409}/${holds}) · Netzwerkfehler: ${fehler}`);

  const db = new PrismaClient();
  const doppelt = await db.$queryRaw<{ seatId: string; n: number }[]>`SELECT "seatId", COUNT(*)::int AS n FROM "Ticket" WHERE "showId" = ${showId} AND status <> 'storniert' GROUP BY 1 HAVING COUNT(*) > 1`;
  const rs = await db.$queryRaw<{ seatId: string }[]>`
    SELECT z."seatId" FROM "Ticket" z JOIN "Ticket" r ON r."showId" = z."showId" AND r."seatId" LIKE 'R-%' AND r.status <> 'storniert'
    WHERE z."showId" = ${showId} AND z.status <> 'storniert'
      AND z."seatId" IN ('0-' || (2 * substr(r."seatId", 3)::int - 1), '0-' || (2 * substr(r."seatId", 3)::int))`;
  const tickets = await db.ticket.count({ where: { showId, status: { not: 'storniert' } } });
  console.log(`DB: ${tickets} gültige Tickets · doppelt verkaufte Sitze: ${doppelt.length} · Konflikte mit Rollstuhlplätzen: ${rs.length}`);
  await db.$disconnect();
  process.exit(doppelt.length || rs.length ? 2 : 0);
})();
