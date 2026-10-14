// Öffentlich mit dem Link „Buchung verwalten“ (manageToken): Tickets als PDF bzw. Kalendereintrag.
// /api/tickets/<token>.pdf[?format=a6&variante=digital] · /api/tickets/<token>.ics
import { clientIp } from '@/lib/schnittstelle';
import { erlaubt } from '@/lib/ratelimit';
import { sitzName } from '@/lib/saal';
import { backendUrl, bestellungMitTickets, kalenderIcs, ticketsPdf } from '@/lib/ticket-html';

export const dynamic = 'force-dynamic';

const KOPF = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' };

export async function GET(req: Request, { params }: { params: Promise<{ datei: string }> }) {
  const { datei } = await params;
  const m = datei.match(/^([a-z0-9]{20,40})\.(pdf|ics)$/);
  if (!m) return new Response('Nicht gefunden', { status: 404 });
  const r = erlaubt(`tickets:${clientIp(req)}`, 30);
  if (!r.ok) return new Response('Zu viele Anfragen', { status: 429, headers: { 'Retry-After': String(r.retryAfter) } });
  const o = await bestellungMitTickets({ manageToken: m[1] });
  if (!o || !['bezahlt', 'teilstorniert'].includes(o.status)) return new Response('Nicht gefunden', { status: 404, headers: KOPF });
  const url = new URL(req.url);
  if (m[2] === 'ics') {
    const aktiv = o.tickets.filter((t) => t.status !== 'storniert');
    const show = aktiv[0]?.show ?? o.show;
    const ics = kalenderIcs(o, { startsAt: show.startsAt, durationMin: show.durationMin, titel: show.title }, aktiv.map((t) => sitzName(t.seatId)), backendUrl() || url.origin);
    return new Response(ics, { headers: { ...KOPF, 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="Light-of-Creation-${o.number}.ics"` } });
  }
  try {
    const erg = await ticketsPdf(o, { format: url.searchParams.get('format') === 'a6' ? 'a6' : 'a4', variante: url.searchParams.get('variante') === 'digital' ? 'digital' : 'druck' });
    if (!erg) return new Response('Keine gültigen Tickets', { status: 404, headers: KOPF });
    return new Response(new Uint8Array(erg.pdf), { headers: { ...KOPF, 'Content-Type': 'application/pdf', 'Content-Disposition': `${url.searchParams.get('download') ? 'attachment' : 'inline'}; filename="${erg.name}"` } });
  } catch (e) {
    console.error('Ticket-PDF', o.number, e);
    return new Response('Das PDF kann gerade nicht erstellt werden. Bitte versuchen Sie es später noch einmal.', { status: 503, headers: KOPF });
  }
}
