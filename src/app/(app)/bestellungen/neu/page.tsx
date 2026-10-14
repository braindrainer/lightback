import Link from 'next/link';
import { hat, requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatumZeit } from '@/lib/dates';
import { sitzName } from '@/lib/saal';
import { Empty, Feldliste, Icon, Money, PageHeader, StatusPill } from '@/components/ui';
import { showOptionen } from '@/components/verkauf/showOptionen';
import TelefonVerkauf from '@/components/verkauf/TelefonVerkauf';
import { ART_NAME, KAT_NAME, ZAHLART_NAME } from '@/components/verkauf/texte';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Telefonverkauf' };

export default async function Telefonverkauf({ searchParams }: { searchParams: Promise<{ show?: string; fertig?: string }> }) {
  const u = await requireRole('leitung', 'kassa');
  const sp = await searchParams;
  const fertig = sp.fertig ? await db.order.findUnique({ where: { id: sp.fertig }, include: { show: true, customer: true, tickets: true, payments: true } }) : null;
  const shows = fertig ? [] : await showOptionen();
  return (
    <>
      <PageHeader title="Telefonverkauf" krumen={[{ label: 'Verkauf' }, { label: 'Telefonverkauf' }]} sub="Buchung für Kund:innen am Telefon oder an der Kassa – in drei Schritten." />
      {fertig ? (
        <section className="card mx-auto grid max-w-3xl gap-5 p-6" aria-labelledby="fertig">
          <div className="flex items-start gap-4">
            <span aria-hidden="true" className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${fertig.status === 'offen' ? 'bg-amber-50 text-warn' : 'bg-emerald-50 text-pos'}`}><Icon name={fertig.status === 'offen' ? 'uhr' : 'haken'} className="h-6 w-6" /></span>
            <div>
              <h2 id="fertig" className="text-xl font-semibold" tabIndex={-1}>Bestellung <span className="font-mono">{fertig.number}</span> {fertig.status === 'offen' ? 'angelegt – noch unbezahlt' : 'gebucht'}</h2>
          <p role="status" className="mt-1 text-sm text-muted">
            {fertig.status === 'offen' ? 'Die Plätze sind bis zur Vorstellung reserviert. Sobald die Zahlung eingeht, bitte in der Bestellung „Zahlung erhalten“ wählen.' : `Bezahlt${fertig.payments[0] ? ` (${ZAHLART_NAME[fertig.payments[0].provider] ?? fertig.payments[0].provider})` : ''}. ${fertig.customer?.email ? `Tickets gehen an ${fertig.customer.email}.` : 'Keine E-Mail-Adresse – Tickets bitte ausdrucken oder vorlesen.'}`}
          </p>
            </div>
          </div>
          <Feldliste spalten={4} className="rounded-xl bg-[#fbf9f5] p-4" felder={[
            { label: 'Vorstellung', wert: fmtDatumZeit(fertig.show.startsAt) },
            { label: 'Kund:in', wert: fertig.customer ? `${fertig.customer.firstName} ${fertig.customer.lastName}` : 'anonym' },
            { label: 'Summe', wert: <><Money cents={fertig.totalCents} className="font-semibold" />{fertig.voucherCents > 0 && <span className="block text-xs text-muted">davon Gutschein <Money cents={fertig.voucherCents} /></span>}</> },
            { label: 'Status', wert: <StatusPill status={fertig.status} /> },
          ]} />
          {fertig.tickets.length > 0 && (
            <table className="table rtab overflow-hidden rounded-lg border border-line">
              <caption className="sr-only">Tickets</caption>
              <thead><tr><th scope="col">Platz</th><th scope="col">Kategorie</th><th scope="col">Art</th><th scope="col">Ticketcode</th><th scope="col" className="text-right">Preis</th></tr></thead>
              <tbody>{fertig.tickets.map((t) => <tr key={t.id}><td className="rtab-kopf font-medium">{sitzName(t.seatId)}</td><td data-label="Kategorie">{KAT_NAME[t.kat]}</td><td data-label="Art">{ART_NAME[t.art] ?? t.art}</td><td data-label="Ticketcode" className="font-mono">{t.code}</td><td data-label="Preis" className="text-right"><Money cents={t.priceCents} /></td></tr>)}</tbody>
            </table>
          )}
          <div className="flex flex-wrap gap-2">
            <Link href="/bestellungen/neu" className="btn-gold">Nächste Buchung</Link>
            {hat(u, 'leitung') && <Link href={`/bestellungen/${fertig.id}`} className="btn-secondary">Bestellung öffnen</Link>}
          </div>
        </section>
      ) : shows.length ? (
        <TelefonVerkauf shows={shows} startShow={shows.some((s) => s.id === sp.show) ? sp.show : undefined} darfFrei={hat(u, 'leitung')} />
      ) : <div className="card"><Empty icon="kalender" titel="Keine Vorstellung im Verkauf" aktion={hat(u, 'leitung') ? <Link href="/vorstellungen" className="btn-secondary btn-sm">Zu den Vorstellungen</Link> : undefined}>Sobald eine Vorstellung im Verkauf ist, kann sie hier gebucht werden.</Empty></div>}
    </>
  );
}
