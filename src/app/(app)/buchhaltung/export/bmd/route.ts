import { audit } from '@/lib/audit';
import { exportBuchungen } from '@/lib/finanzen/auswertung';
import { bmdCsv } from '@/lib/finanzen/bmd';
import { csvAntwort } from '@/lib/finanzen/csv';
import { exportZugriff } from '@/lib/finanzen/export';

export const dynamic = 'force-dynamic';

/** BMD NTCS Buchungsimport – Zuordnung siehe src/lib/finanzen/bmd.ts */
export async function GET(req: Request) {
  const z = await exportZugriff(req);
  if ('fehler' in z) return z.fehler;
  const e = await exportBuchungen(z.von, z.bis);
  await audit(z.u, 'export.bmd', 'journal', null, { von: z.von, bis: z.bis, buchungen: e.length });
  return csvAntwort(bmdCsv(e), `bmd_buchungen_${z.von}_${z.bis}.csv`, { latin1: true });
}
