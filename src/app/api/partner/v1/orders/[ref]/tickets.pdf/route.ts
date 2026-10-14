import { partnerBestellungLaden, partnerRoute, ticketsPdf } from '@/lib/partner';
import { ApiFehler } from '@/lib/schnittstelle';

export const dynamic = 'force-dynamic';

export const GET = partnerRoute<{ ref: string }>(async (_req, p, { ref }) => {
  const o = await partnerBestellungLaden(p, decodeURIComponent(ref));
  if (!o.tickets.some((t) => t.status !== 'storniert')) throw new ApiFehler(409, 'keine_tickets', 'Keine gültigen Tickets');
  let pdf: Buffer;
  try { pdf = await ticketsPdf(o.id); } catch (e) { console.error('Ticket-PDF', e); throw new ApiFehler(503, 'pdf_nicht_verfuegbar', 'PDF-Erzeugung gerade nicht möglich'); }
  return new Response(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="tickets-${o.number}.pdf"`, 'Cache-Control': 'no-store' } });
});
