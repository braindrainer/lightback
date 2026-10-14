// Druckticket (A6 hoch) im gleichen Layout wie PDF und Handy-Ansicht. Ohne Backend-Navigation.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { audit } from '@/lib/audit';
import { hat, requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { bestellungMitTickets, qrFuer, seitenCss, ticketCss, ticketKarte, ticketsAusBestellung } from '@/lib/ticket-html';
import DruckKnopf from '@/components/DruckKnopf';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ticket drucken' };

const CSS = `
.druck-seite .seite{box-sizing:border-box;overflow:hidden;margin:0 auto;background:#fff}
@media screen{.druck-seite .seite{box-shadow:0 2px 14px rgba(7,11,20,.18);border-radius:6px}}
@media print{.nicht-drucken{display:none !important}html,body,.druck-seite{background:#fff !important;padding:0 !important;min-height:0 !important}}
`;

export default async function Druck({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireRole('leitung', 'kassa', 'einlass');
  const { id } = await params;
  const ref = await db.ticket.findUnique({ where: { id }, select: { orderId: true } });
  const o = ref ? await bestellungMitTickets({ id: ref.orderId }) : null;
  const t = o ? ticketsAusBestellung(o).find((x) => x.id === id) : undefined;
  if (!o || !t) notFound();
  await audit(u, 'ticket_druck', 'ticket', t.id, { code: t.code, status: t.status });
  const html = ticketKarte(t, { variante: 'druck', modus: 'web', qr: t.status === 'storniert' ? '' : await qrFuer(t), ueberschrift: 'h1' });
  return (
    <main id="inhalt" className="druck-seite min-h-dvh bg-paper p-4">
      <style dangerouslySetInnerHTML={{ __html: ticketCss('web') + seitenCss('a6') + CSS }} />
      <div className="nicht-drucken mx-auto mb-4 flex max-w-[105mm] flex-wrap items-center justify-between gap-2">
        <Link href={`/tickets/${t.id}`} className="btn-secondary">Zurück zum Ticket</Link>
        <DruckKnopf>Ticket drucken</DruckKnopf>
        {hat(u, 'leitung', 'kassa') && <a href={`/bestellungen/${o.id}/tickets`} target="_blank" rel="noopener" className="w-full text-center text-sm underline underline-offset-4">Alle Tickets der Bestellung als PDF (A4)<span className="sr-only"> – neues Fenster</span></a>}
      </div>
      <section className="seite" dangerouslySetInnerHTML={{ __html: html }} />
    </main>
  );
}
