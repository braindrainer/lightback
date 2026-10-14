// Anwesenheitsliste (A4): wer ist laut Einlass im Saal – für Evakuierung und Brandschutz
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { audit } from '@/lib/audit';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatum, fmtDatumZeit, fmtZeit } from '@/lib/dates';
import { stand } from '@/lib/einlass';
import { sitzName, SITZ } from '@/lib/saal';
import DruckKnopf from '@/components/DruckKnopf';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Anwesenheitsliste' };

export default async function Anwesenheit({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireRole('leitung', 'einlass');
  const { id } = await params;
  const show = await db.show.findUnique({ where: { id } });
  if (!show) notFound();
  const [tickets, z] = await Promise.all([
    db.ticket.findMany({ where: { showId: id, status: 'eingelassen' }, include: { order: { include: { customer: true } } } }),
    stand(id),
  ]);
  tickets.sort((a, b) => (SITZ[a.seatId]?.reihe ?? 0) - (SITZ[b.seatId]?.reihe ?? 0) || (SITZ[a.seatId]?.platz ?? 0) - (SITZ[b.seatId]?.platz ?? 0));
  await audit(u, 'anwesenheit_druck', 'show', id, { imSaal: z.imSaal });
  return (
    <main id="inhalt" className="min-h-dvh bg-white p-6 text-ink print:p-0">
      <style>{`@page { size: A4 portrait; margin: 12mm; } @media print { .nicht-drucken { display: none !important; } } table.liste td, table.liste th { border-bottom: 1px solid #c9c2b3; padding: 3px 6px; text-align: left; } table.liste thead th { border-bottom: 2px solid #121a2b; font-size: 12px; } table.liste tr { break-inside: avoid; }`}</style>
      <div className="nicht-drucken mb-4 flex flex-wrap gap-2">
        <Link href={`/vorstellungen/${id}`} className="btn-secondary">Zurück zur Vorstellung</Link>
        <DruckKnopf>Anwesenheitsliste drucken</DruckKnopf>
      </div>
      <h1 className="text-xl font-semibold">Anwesenheitsliste {fmtDatum(show.startsAt)}, {fmtZeit(show.startsAt)} Uhr</h1>
      <p className="mb-1 text-lg"><strong>Im Saal: {z.imSaal} Personen</strong> ({z.eingelassen} Tickets eingelassen, davon {z.imSaal - z.eingelassen} Rollstuhlplätze mit Begleitperson)</p>
      <p className="mb-3 text-sm">Stand {fmtDatumZeit(new Date())} – laut Einlass-Scans. Personal und Mitwirkende sind nicht enthalten.</p>
      <div className="overflow-x-auto print:overflow-visible" tabIndex={0} role="region" aria-label="Liste, seitlich scrollbar">
      <table className="liste w-full min-w-[36rem] border-collapse text-[13px]">
        <thead><tr><th scope="col">Platz</th><th scope="col">Name</th><th scope="col">Personen</th><th scope="col">Eingelassen</th><th scope="col">Ticket</th></tr></thead>
        <tbody>
          {tickets.map((t) => (
            <tr key={t.id}>
              <td>{sitzName(t.seatId)}</td>
              <td>{t.order.customer ? `${t.order.customer.lastName} ${t.order.customer.firstName}`.trim() : '–'}</td>
              <td>{t.kat === 'R' ? 2 : 1}</td>
              <td>{t.checkedInAt ? fmtZeit(t.checkedInAt) : '–'}</td>
              <td className="font-mono text-[11px]">{t.code}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {!tickets.length && <p className="mt-4">Noch niemand eingelassen.</p>}
    </main>
  );
}
