import { audit } from '@/lib/audit';
import { saldenliste, TYP_NAME } from '@/lib/finanzen/auswertung';
import { csv, csvAntwort, dezimal } from '@/lib/finanzen/csv';
import { exportZugriff } from '@/lib/finanzen/export';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const z = await exportZugriff(req);
  if ('fehler' in z) return z.fehler;
  const rows = await saldenliste(z.von, z.bis);
  await audit(z.u, 'export.saldenliste', 'journal', null, { von: z.von, bis: z.bis });
  return csvAntwort(csv([
    ['Konto', 'Bezeichnung', 'Art', 'Vortrag', 'Soll', 'Haben', 'Saldo'],
    ...rows.map((k) => [k.number, k.name, TYP_NAME[k.type] ?? k.type, dezimal(k.vortrag), dezimal(k.soll), dezimal(k.haben), dezimal(k.saldo)]),
  ]), `saldenliste_${z.von}_${z.bis}.csv`);
}
