import { db } from '@/lib/db';
import { ApiFehler, preflight, shopRoute } from '@/lib/schnittstelle';
import { qrInhalt, qrPng } from '@/lib/tickets';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

// GET /orders/{manageToken}/tickets/{code}.png → QR-Code des Tickets
export const GET = shopRoute<{ ref: string; datei: string }>(async (_req, { ref, datei }) => {
  const code = datei.replace(/\.png$/i, '');
  const t = await db.ticket.findFirst({ where: { code, order: { manageToken: ref } } });
  if (!t || t.status === 'storniert') throw new ApiFehler(404, 'unbekannt', 'Ticket nicht gefunden');
  const png = await qrPng(qrInhalt(t.code, t.showId));
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=300' } });
}, 120);
