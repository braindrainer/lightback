import { db } from '@/lib/db';
import { stripeWebhookPruefen } from '@/lib/payments';
import { zahlungAbschliessen } from '@/lib/shop';

export const dynamic = 'force-dynamic';

type Ereignis = { id: string; type: string; data: { object: Record<string, unknown> } };

// Stripe-Webhook: Signatur über den unveränderten Body prüfen
export async function POST(req: Request) {
  const roh = await req.text();
  if (!(await stripeWebhookPruefen(roh, req.headers.get('stripe-signature') ?? ''))) return new Response('Signatur ungültig', { status: 400 });
  let ev: Ereignis;
  try { ev = JSON.parse(roh); } catch { return new Response('Ungültiges JSON', { status: 400 }); }
  const obj = ev.data?.object ?? {};
  try {
    if (ev.type === 'payment_intent.succeeded' || ev.type === 'payment_intent.payment_failed') {
      const z = await db.payment.findFirst({ where: { provider: 'stripe', providerRef: String(obj.id) } });
      if (z) await zahlungAbschliessen(z, { status: ev.type === 'payment_intent.succeeded' ? 'bezahlt' : 'abgelehnt', providerRef: String(obj.id), raw: obj });
    } else if (ev.type === 'charge.refunded') {
      // Erstattungen (auch direkt im Stripe-Dashboard) am Zahlungsdatensatz nachführen
      const z = await db.payment.findFirst({ where: { provider: 'stripe', providerRef: String(obj.payment_intent) } });
      const erstattet = Number(obj.amount_refunded ?? 0);
      if (z && erstattet > z.refundedCents) await db.payment.update({ where: { id: z.id }, data: { refundedCents: erstattet, status: erstattet >= z.amountCents ? 'erstattet' : 'teilerstattet' } });
    }
  } catch (e) {
    console.error('Stripe-Webhook', ev.type, e);
    return new Response('Fehler', { status: 500 }); // Stripe versucht es erneut
  }
  return Response.json({ received: true });
}
