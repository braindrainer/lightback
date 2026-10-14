// Tickets einer Bestellung als PDF für Leitung und Kassa: ?format=a6, ?variante=digital, ?download=1
import { audit } from '@/lib/audit';
import { currentUser, hat } from '@/lib/auth';
import { bestellungMitTickets, ticketsPdf } from '@/lib/ticket-html';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await currentUser();
  if (!hat(u, 'leitung', 'kassa')) return new Response('Keine Berechtigung', { status: 403 });
  const { id } = await params;
  const o = await bestellungMitTickets({ id });
  if (!o) return new Response('Nicht gefunden', { status: 404 });
  const url = new URL(req.url);
  try {
    const erg = await ticketsPdf(o, { format: url.searchParams.get('format') === 'a6' ? 'a6' : 'a4', variante: url.searchParams.get('variante') === 'digital' ? 'digital' : 'druck' });
    if (!erg) return new Response('Diese Bestellung hat keine gültigen Tickets.', { status: 404 });
    await audit(u, 'ticket_druck', 'order', o.id, { pdf: true, format: url.searchParams.get('format') ?? 'a4', tickets: o.tickets.filter((t) => t.status !== 'storniert').length });
    return new Response(new Uint8Array(erg.pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `${url.searchParams.get('download') ? 'attachment' : 'inline'}; filename="${erg.name}"`, 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    return new Response(`PDF konnte nicht erstellt werden: ${(e as Error).message}`, { status: 500 });
  }
}
