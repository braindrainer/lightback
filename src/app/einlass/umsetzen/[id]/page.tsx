// Einlass: Gast vor Ort umsetzen (gleich teuer oder günstiger, ohne Ausgleich). Mit Aufpreis → Kassa.
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtTag, fmtZeit } from '@/lib/dates';
import { sitzName, type Preise } from '@/lib/saal';
import { platzStatus } from '@/lib/seats';
import Umsetzen from '@/components/vorort/Umsetzen';
import { umsetzenAktion } from '@/app/(app)/tickets/actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Umsetzen' };

export default async function EinlassUmsetzen({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('einlass');
  const { id } = await params;
  const t = await db.ticket.findUnique({ where: { id }, include: { show: true, order: { include: { customer: true } } } });
  if (!t) notFound();
  const status = await platzStatus(t.showId);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-3xl gap-4 px-4 pb-8 pt-[max(1rem,env(safe-area-inset-top))]">
        <p><a href="/einlass" className="inline-flex min-h-11 items-center text-base font-semibold text-gold underline underline-offset-4">← Zurück zum Scanner</a></p>
        <h1 className="text-2xl font-bold">Umsetzen: {sitzName(t.seatId)}</h1>
        <p className="text-base text-white/85">{t.order.customer ? `${t.order.customer.firstName} ${t.order.customer.lastName} · ` : ''}{fmtTag(t.show.startsAt)}, {fmtZeit(t.show.startsAt)} Uhr · Ticket <span className="font-mono">{t.code}</span></p>
        {t.status === 'storniert' ? <p role="alert" className="rounded-xl bg-white p-4 text-base text-neg">Das Ticket ist storniert.</p> : (
          <section className="rounded-2xl bg-white p-4 text-ink" aria-label="Neuen Platz wählen">
            <Umsetzen ticket={{ id: t.id, seatId: t.seatId, kat: t.kat, art: t.art, code: t.code }} status={status} preise={t.show.prices as Preise} modus="einlass" darfKulanz={false} action={umsetzenAktion.bind(null, t.id)} />
          </section>
        )}
      </div>
    </div>
  );
}
