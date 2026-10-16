import { db } from '@/lib/db';
import { abgeholt, dateiLatin1, dateiName } from '@/lib/finanzen/bmd-uebergabe';
import { bmdRoute, nummerAus } from '@/lib/finanzen/bmd-route';
import { ApiFehler } from '@/lib/schnittstelle';

export const dynamic = 'force-dynamic';

// GET → Importdatei (CSV, ISO-8859-1); der Lauf gilt danach als abgeholt
export const GET = bmdRoute<{ nummer: string }>(async (req, { nummer }) => {
  const l = await db.bmdLauf.findUnique({ where: { nummer: nummerAus(nummer) } });
  if (!l) throw new ApiFehler(404, 'unbekannt', 'Lauf nicht gefunden');
  await abgeholt(l, `BMD-Konnektor (${req.headers.get('user-agent')?.slice(0, 60) ?? 'unbekannt'})`);
  return new Response(new Uint8Array(dateiLatin1(l.datei)), {
    headers: { 'Content-Type': 'text/csv; charset=iso-8859-1', 'Content-Disposition': `attachment; filename="${dateiName(l)}"`, 'X-Sha256': l.sha256, 'Cache-Control': 'no-store' },
  });
});
