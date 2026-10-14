// Gutschein zum Ausdrucken (A6 hoch) in den Markenschriften. Ohne Backend-Navigation.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import DruckKnopf from '@/components/DruckKnopf';
import GutscheinKarte from '@/components/gutschein/GutscheinKarte';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Gutschein drucken' };

const CSS = `
@page{size:105mm 148mm;margin:0}
.gs-seite{width:min(105mm,100%);aspect-ratio:105/148;margin:0 auto;overflow:hidden;background:#070b14;-webkit-print-color-adjust:exact;print-color-adjust:exact}
@media screen{.gs-seite{box-shadow:0 2px 18px rgba(7,11,20,.25);border-radius:8px}}
@media print{.gs-seite{width:105mm;height:148mm}.nicht-drucken{display:none !important}html,body,.druck-seite{background:#070b14 !important;padding:0 !important;min-height:0 !important}.gs-seite{border-radius:0}}
`;

export default async function GutscheinDruck({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('leitung', 'buchhaltung');
  const { id } = await params;
  const v = await db.voucher.findUnique({ where: { id } });
  if (!v) notFound();
  return (
    <main id="inhalt" className="druck-seite min-h-dvh bg-paper p-4">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <h1 className="sr-only">Gutschein {v.code} drucken</h1>
      <div className="nicht-drucken mx-auto mb-4 flex max-w-[105mm] flex-wrap items-center justify-between gap-2">
        <Link href={`/gutscheine/${v.id}`} className="btn-secondary">Zurück zum Gutschein</Link>
        <DruckKnopf>Gutschein drucken</DruckKnopf>
      </div>
      <section className="gs-seite"><GutscheinKarte v={v} druck /></section>
      <p className="nicht-drucken mx-auto mt-3 max-w-[105mm] text-center text-xs text-muted">Format A6 hoch. Im Druckdialog „Hintergrundgrafiken“ einschalten.</p>
    </main>
  );
}
