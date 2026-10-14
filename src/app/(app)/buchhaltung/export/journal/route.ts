import { audit } from '@/lib/audit';
import { exportBuchungen } from '@/lib/finanzen/auswertung';
import { csv, csvAntwort, dezimal } from '@/lib/finanzen/csv';
import { exportZugriff } from '@/lib/finanzen/export';
import { quelle } from '@/lib/finanzen/texte';

export const dynamic = 'force-dynamic';

/** Alle Journalzeilen als CSV (eine Zeile je Konto-Bewegung) */
export async function GET(req: Request) {
  const z = await exportZugriff(req);
  if ('fehler' in z) return z.fehler;
  const e = await exportBuchungen(z.von, z.bis);
  await audit(z.u, 'export.journal', 'journal', null, { von: z.von, bis: z.bis, buchungen: e.length });
  return csvAntwort(csv([
    ['Buchungsnr', 'Datum', 'Beleg', 'Buchungstext', 'Quelle', 'Konto', 'Kontobezeichnung', 'Soll', 'Haben', 'Steuercode', 'Bemessungsgrundlage', 'Zeilentext'],
    ...e.flatMap((b) => b.lines.map((l) => [b.number, b.date, b.docRef, b.text, quelle(b.source), l.konto, (l as { name?: string }).name ?? '', dezimal(l.soll), dezimal(l.haben), l.vatCode ?? '', l.base == null ? '' : dezimal(l.base), l.text ?? ''])),
  ]), `journal_${z.von}_${z.bis}.csv`);
}
