import { audit } from '@/lib/audit';
import { currentUser, hat } from '@/lib/auth';
import { tagesreihe, zeitraumAus } from '@/lib/statistik';

export const dynamic = 'force-dynamic';

const eur = (c: number) => (c / 100).toFixed(2).replace('.', ',');

// Tagesreihe als CSV (Semikolon, deutsches Dezimalkomma, UTF-8 mit BOM für Excel)
export async function GET(req: Request) {
  const u = await currentUser();
  if (!hat(u, 'leitung', 'buchhaltung')) return new Response('Keine Berechtigung', { status: 403 });
  const url = new URL(req.url);
  const z = zeitraumAus({ von: url.searchParams.get('von') ?? undefined, bis: url.searchParams.get('bis') ?? undefined });
  const reihe = await tagesreihe(z);
  await audit(u, 'export_statistik', 'statistik', null, { von: z.von, bis: z.bis, zeilen: reihe.length });
  const zeilen = ['Tag;Tickets;Umsatz brutto EUR;Umsatz netto EUR;Stornierte Tickets', ...reihe.map((r) => `${r.tag};${r.tickets};${eur(r.umsatz)};${eur(Math.round(r.umsatz / 1.13))};${r.storniert}`)];
  return new Response('﻿' + zeilen.join('\r\n') + '\r\n', { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="verkauf-${z.von}-bis-${z.bis}.csv"`, 'Cache-Control': 'no-store' } });
}
