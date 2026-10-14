import { db } from '@/lib/db';
import { stripeStatus } from '@/lib/payments';
import { ApiFehler, json, preflight, shopRoute } from '@/lib/schnittstelle';
import { bestellungJson, bestellungLaden, zahlungAbschliessen } from '@/lib/shop';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

// POST /orders/{manageToken oder id}/confirm – nach stripe.confirmPayment im Browser; Status wird beim Anbieter geprüft
export const POST = shopRoute<{ ref: string }>(async (_req, { ref }) => {
  const o = await db.order.findFirst({ where: { OR: [{ manageToken: ref }, { id: ref }] }, include: { payments: { orderBy: { createdAt: 'desc' } } } });
  if (!o) throw new ApiFehler(404, 'unbekannt', 'Buchung nicht gefunden');
  const z = o.payments.find((p) => p.provider === 'stripe' && p.providerRef);
  if (o.status === 'offen' && z) await zahlungAbschliessen(z, await stripeStatus(z.providerRef!));
  const neu = (await bestellungLaden({ id: o.id }))!;
  if (neu.status === 'offen') return json({ status: 'offen', orderId: neu.id }, 202);
  if (neu.status === 'storniert' && !neu.paidAt) return json({ status: 'abgelehnt', error: { code: 'zahlung_abgelehnt', message: 'Die Zahlung wurde nicht abgeschlossen' } }, 402);
  return json({ status: 'bezahlt', order: bestellungJson(neu) });
}, 30);
