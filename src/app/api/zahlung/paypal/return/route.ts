import { db } from '@/lib/db';
import { weiter } from '@/lib/http';
import { paypalCapture } from '@/lib/payments';
import { shopZiel, zahlungAbschliessen } from '@/lib/shop';

export const dynamic = 'force-dynamic';

// Rücksprung von PayPal: ?order=<Bestell-ID>&token=<PayPal-Order-ID>[&PayerID=…]. Ohne PayerID = abgebrochen.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const orderId = url.searchParams.get('order');
  const token = url.searchParams.get('token');
  const z = token ? await db.payment.findFirst({ where: { providerRef: token, provider: 'paypal', ...(orderId ? { orderId } : {}) } }) : null;
  if (!z) return weiter(await shopZiel(orderId, 'abgelehnt'));
  if (z.status === 'bezahlt') return weiter(await shopZiel(z.orderId, 'bezahlt'));
  if (!url.searchParams.get('PayerID')) return weiter(await shopZiel(z.orderId, 'abgelehnt')); // Reservierung bleibt
  let ergebnis = 'offen';
  try { ergebnis = await zahlungAbschliessen(z, await paypalCapture(token!)); } catch (e) { console.error('PayPal Capture', e); }
  return weiter(await shopZiel(z.orderId, ergebnis === 'fehler' ? 'offen' : ergebnis));
}
