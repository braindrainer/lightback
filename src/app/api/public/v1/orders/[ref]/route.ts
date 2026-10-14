import { ApiFehler, json, preflight, shopRoute } from '@/lib/schnittstelle';
import { bestellungJson, bestellungLaden } from '@/lib/shop';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

// GET /orders/{manageToken} → Buchung mit Tickets (für "Buchung verwalten" und die Bestätigungsseite)
export const GET = shopRoute<{ ref: string }>(async (_req, { ref }) => {
  const o = await bestellungLaden({ manageToken: ref });
  if (!o) throw new ApiFehler(404, 'unbekannt', 'Buchung nicht gefunden');
  return json(bestellungJson(o));
}, 60);
