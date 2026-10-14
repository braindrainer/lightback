// Bestellung: Tickets so, wie die Kund:in sie bekommt – PDF, Handy-Ansicht, Link und kleine Vorschau je Ticket.
import Link from 'next/link';
import { bestellungMitTickets, qrFuer, ticketCss, ticketKarte, ticketLabel, ticketsAusBestellung } from '@/lib/ticket-html';
import LinkKopieren from './LinkKopieren';

export default async function TicketBlock({ orderId }: { orderId: string }) {
  const o = await bestellungMitTickets({ id: orderId });
  if (!o || !['bezahlt', 'teilstorniert'].includes(o.status) || !o.tickets.length) return null;
  const liste = ticketsAusBestellung(o);
  const aktiv = liste.filter((t) => t.status !== 'storniert').length;
  const karten = await Promise.all(liste.map(async (t) => ({ t, html: ticketKarte(t, { variante: 'digital', modus: 'web', qr: t.status === 'storniert' ? '' : await qrFuer(t), ueberschrift: 'p' }) })));
  const mobil = `/t/${o.manageToken}`;
  const pdf = `/bestellungen/${o.id}/tickets`;
  return (
    <section className="card" aria-labelledby="h-ticketdokumente">
      <style dangerouslySetInnerHTML={{ __html: `${ticketCss('web')}.tb-vorschau .lt{font-size:7.5px;width:28em;border:1px solid #2a3654}.tb-vorschau .lt-hinweise{display:none}.tb-vorschau a,.tb-vorschau a>div{height:100%}.tb-vorschau .lt{height:100%}` }} />
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
        <h2 id="h-ticketdokumente" className="h2">Tickets für die Kund:in</h2>
        <span className="text-sm text-muted">{aktiv} gültig{liste.length > aktiv ? `, ${liste.length - aktiv} storniert` : ''}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 px-5">
        {aktiv > 0 && <a href={pdf} target="_blank" rel="noopener" className="btn-primary btn-sm">Tickets als PDF<span className="sr-only"> (A4, neues Fenster)</span></a>}
        {aktiv > 0 && <a href={`${pdf}?format=a6&variante=digital`} target="_blank" rel="noopener" className="btn-secondary btn-sm">PDF für das Handy (A6)<span className="sr-only">, neues Fenster</span></a>}
        <a href={mobil} target="_blank" rel="noopener" className="btn-secondary btn-sm">Mobile Ansicht öffnen<span className="sr-only"> (neues Fenster)</span></a>
        <LinkKopieren pfad={mobil} />
      </div>
      <ul className="tb-vorschau flex gap-3 overflow-x-auto px-5 pb-5 pt-4" aria-label="Vorschau der Tickets">
        {karten.map(({ t, html }) => (
          <li key={t.id} className="flex-none">
            <Link href={`/tickets/${t.id}`} className="block rounded-[9px] transition hover:opacity-90">
              <span className="sr-only">{ticketLabel(t)} – Ticket {t.code} öffnen</span>
              <div aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
