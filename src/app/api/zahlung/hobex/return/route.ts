import { db } from '@/lib/db';
import { weiter } from '@/lib/http';
import { hobexStatus } from '@/lib/payments';
import { shopZiel, zahlungAbschliessen } from '@/lib/shop';

export const dynamic = 'force-dynamic';

// Rücksprung aus dem hobex-Formular (shopperResultUrl): ?id=<checkoutId>&resourcePath=…
async function handler(req: Request) {
  const url = new URL(req.url);
  let id = url.searchParams.get('id');
  if (!id && req.method === 'POST') id = String((await req.formData().catch(() => null))?.get('id') ?? '') || null;
  const z = id ? await db.payment.findFirst({ where: { providerRef: id, provider: { in: ['hobex', 'applepay'] } } }) : null;
  if (!z) return weiter(await shopZiel(url.searchParams.get('order'), 'abgelehnt'));
  let ergebnis: string = z.status === 'bezahlt' ? 'bezahlt' : 'offen';
  if (z.status === 'offen') {
    try { ergebnis = await zahlungAbschliessen(z, await hobexStatus(id!)); } catch (e) { console.error('hobex Rücksprung', e); }
  }
  return weiter(await shopZiel(z.orderId, ergebnis === 'fehler' ? 'offen' : ergebnis));
}
export const GET = handler;
export const POST = handler;
