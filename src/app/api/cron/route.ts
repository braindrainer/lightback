import { timingSafeEqual } from 'node:crypto';
import { cronLauf } from '@/lib/cron';

export const dynamic = 'force-dynamic';

// Alle 5 Minuten aufrufen (Crontab auf dem Server):
// */5 * * * * curl -fsS -X POST -H "X-Cron-Key: $CRON_KEY" https://lightback.skillful.at/api/cron >/dev/null
export async function POST(req: Request) {
  const soll = process.env.CRON_KEY ?? '';
  const ist = req.headers.get('x-cron-key') ?? '';
  if (soll.length < 16 || ist.length !== soll.length || !timingSafeEqual(Buffer.from(ist), Buffer.from(soll))) return Response.json({ error: 'Nicht berechtigt' }, { status: 401 });
  return Response.json(await cronLauf());
}
