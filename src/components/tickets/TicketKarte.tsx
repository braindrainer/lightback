// Ticketseite: das Ticket so, wie die Kund:in es am Handy sieht (gleiches Layout wie PDF und Mail).
import { bestellungMitTickets, qrFuer, ticketCss, ticketKarte, ticketsAusBestellung } from '@/lib/ticket-html';

export default async function TicketKarte({ ticketId, orderId }: { ticketId: string; orderId: string }) {
  const o = await bestellungMitTickets({ id: orderId });
  const t = o ? ticketsAusBestellung(o).find((x) => x.id === ticketId) : undefined;
  if (!t) return null;
  const html = ticketKarte(t, { variante: 'digital', modus: 'web', qr: t.status === 'storniert' ? '' : await qrFuer(t), ueberschrift: 'h2' });
  return (
    <section className="grid content-start justify-items-center gap-3" aria-label="Ticket wie für die Kund:in">
      <style dangerouslySetInnerHTML={{ __html: `${ticketCss('web')}.tk-karte{width:100%;max-width:340px;font-size:13.5px}.tk-karte .lt{box-shadow:0 10px 30px rgba(7,11,20,.25)}` }} />
      <div className="tk-karte" dangerouslySetInnerHTML={{ __html: html }} />
    </section>
  );
}
