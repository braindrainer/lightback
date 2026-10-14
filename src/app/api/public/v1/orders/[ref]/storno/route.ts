import { z } from 'zod';
import { audit } from '@/lib/audit';
import { db } from '@/lib/db';
import { stornieren } from '@/lib/orders';
import { ApiFehler, clientIp, json, koerper, preflight, shopRoute } from '@/lib/schnittstelle';
import { bestellungJson, bestellungLaden } from '@/lib/shop';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

const schema = z.object({ ticketCodes: z.array(z.string().min(4).max(20)).max(10).optional(), methode: z.enum(['zahlungsmittel', 'gutschein']) });

// POST /orders/{manageToken}/storno → Selbst-Storno bis 24 h vor Beginn (Erstattung oder Gutschein)
export const POST = shopRoute<{ ref: string }>(async (req, { ref }) => {
  const e = await koerper(req, schema);
  const o = await bestellungLaden({ manageToken: ref });
  if (!o) throw new ApiFehler(404, 'unbekannt', 'Buchung nicht gefunden');
  if (o.channel === 'partner') throw new ApiFehler(403, 'ueber_partner', 'Diese Buchung wurde über einen Vertriebspartner gekauft. Bitte wenden Sie sich an ihn.');
  let ticketIds: string[] | undefined;
  if (e.ticketCodes?.length) {
    ticketIds = o.tickets.filter((t) => e.ticketCodes!.includes(t.code)).map((t) => t.id);
    if (ticketIds.length !== e.ticketCodes.length) throw new ApiFehler(400, 'unbekanntes_ticket', 'Mindestens ein Ticketcode gehört nicht zu dieser Buchung');
  }
  const r = await stornieren({ orderId: o.id, ticketIds, methode: e.methode, grund: 'kunde', notiz: 'Selbst-Storno im Shop' });
  await audit(null, 'storno_selbst', 'order', o.id, { methode: e.methode, tickets: e.ticketCodes ?? 'alle', ip: clientIp(req) });
  const neu = (await bestellungLaden({ id: o.id }))!;
  const gutschein = r.voucherId ? await db.voucher.findUnique({ where: { id: r.voucherId }, select: { code: true, valueCents: true, validUntil: true } }) : null;
  return json({ order: bestellungJson(neu), refund: { amountCents: r.refund.amountCents, method: r.refund.method }, voucher: gutschein });
}, 10);
