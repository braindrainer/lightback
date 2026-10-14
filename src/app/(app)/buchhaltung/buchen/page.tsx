import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { STEUERCODE_TEXT } from '@/lib/finanzen/texte';
import { heute } from '@/lib/finanzen/zeitraum';
import { BuchungsFormular } from '@/components/finanzen/BuchungsFormular';
import { buchenAktion } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Buchen – Buchhaltung' };

export default async function Buchen() {
  await requireRole('buchhaltung');
  const konten = await db.account.findMany({ where: { active: true }, orderBy: { number: 'asc' }, select: { number: true, name: true, vatCode: true } });
  return (
    <section aria-labelledby="h-buchen">
      <h2 id="h-buchen" className="h2 mb-1">Manuelle Buchung</h2>
      <p className="mb-4 text-sm text-muted">Für Umbuchungen, Korrekturen und Vorgänge ohne eigenen Beleg in Lightback. Gebuchtes wird nie gelöscht, sondern im Journal storniert.</p>
      <BuchungsFormular action={buchenAktion} konten={konten} codes={STEUERCODE_TEXT} heute={heute()} />
    </section>
  );
}
