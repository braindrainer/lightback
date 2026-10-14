// Kassa: Ticket umsetzen oder ermäßigt → Vollpreis aufzahlen (Aufpreis mit Kassabeleg)
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtTag, fmtZeit } from '@/lib/dates';
import { sitzName, type Preise } from '@/lib/saal';
import { platzStatus } from '@/lib/seats';
import Umsetzen from '@/components/vorort/Umsetzen';
import { umsetzenKassaAction } from '../../../actions';
import { kasseWaehlen } from '../../../daten';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Umsetzen / Aufzahlen' };

export default async function KassaUmsetzen({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('kassa');
  const { id } = await params;
  const t = await db.ticket.findUnique({ where: { id }, include: { show: true, order: { include: { customer: true } } } });
  if (!t) notFound();
  const { reg, schicht } = await kasseWaehlen();
  const status = await platzStatus(t.showId);
  const kassieren = async (e: Parameters<typeof umsetzenKassaAction>[0] extends infer X ? Omit<X & object, 'ticketId' | 'registerId' | 'sessionId'> : never) => {
    'use server';
    return umsetzenKassaAction({ ...e, ticketId: id, registerId: reg?.id ?? '', sessionId: schicht?.id ?? '' });
  };
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4 px-4 py-5">
      <p><Link href="/kassa/gaeste" className="underline underline-offset-4">← Gäste &amp; Tickets</Link></p>
      <h1 className="h1">Umsetzen / Aufzahlen: {sitzName(t.seatId)}</h1>
      <p className="text-base">Ticket <span className="font-mono">{t.code}</span> · {fmtTag(t.show.startsAt)}, {fmtZeit(t.show.startsAt)} Uhr · Bestellung {t.order.number}{t.order.customer ? ` · ${t.order.customer.firstName} ${t.order.customer.lastName}` : ''}</p>
      {t.status === 'storniert' ? <p role="alert" className="card p-4 text-base text-neg">Das Ticket ist storniert.</p>
        : !reg || !schicht ? <p role="alert" className="card p-4 text-base">Für einen Aufpreis braucht es eine offene Schicht. <Link href="/kassa" className="font-semibold underline">Zur Kassa</Link></p>
          : (
            <section className="card p-4" aria-label="Neuen Platz oder Tarif wählen">
              <Umsetzen ticket={{ id: t.id, seatId: t.seatId, kat: t.kat, art: t.art, code: t.code }} status={status} preise={t.show.prices as Preise} modus="kassa" darfKulanz={false} action={kassieren} nachher="/kassa/beleg/$beleg?druck=1" />
            </section>
          )}
    </div>
  );
}
