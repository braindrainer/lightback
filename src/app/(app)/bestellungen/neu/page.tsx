import Link from 'next/link';
import { hat, requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatumZeit } from '@/lib/dates';
import { sitzName } from '@/lib/saal';
import { Money, PageHeader, StatusPill } from '@/components/ui';
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
      <PageHeader title="Telefonverkauf" sub="Buchung für Kund:innen am Telefon oder an der Kassa" />
      {fertig ? (
        <section className="card grid gap-4 p-5" aria-labelledby="fertig">
          <h2 id="fertig" className="h2 text-lg" tabIndex={-1}>Bestellung {fertig.number} {fertig.status === 'offen' ? 'angelegt – noch unbezahlt' : 'gebucht'}</h2>
          <p role="status" className={`rounded-lg px-3 py-2 text-sm ${fertig.status === 'offen' ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-pos'}`}>
            {fertig.status === 'offen' ? 'Die Plätze sind bis zur Vorstellung reserviert. Sobald die Zahlung eingeht, bitte in der Bestellung „Zahlung erhalten“ wählen.' : `Bezahlt${fertig.payments[0] ? ` (${ZAHLART_NAME[fertig.payments[0].provider] ?? fertig.payments[0].provider})` : ''}. ${fertig.customer?.email ? `Tickets gehen an ${fertig.customer.email}.` : 'Keine E-Mail-Adresse – Tickets bitte ausdrucken oder vorlesen.'}`}
          </p>
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted">Vorstellung</dt><dd>{fmtDatumZeit(fertig.show.startsAt)}</dd>
            <dt className="text-muted">Kund:in</dt><dd>{fertig.customer ? `${fertig.customer.firstName} ${fertig.customer.lastName}` : 'anonym'}</dd>
            <dt className="text-muted">Summe</dt><dd><Money cents={fertig.totalCents} />{fertig.voucherCents > 0 && <> (davon Gutschein <Money cents={fertig.voucherCents} />)</>}</dd>
            <dt className="text-muted">Status</dt><dd><StatusPill status={fertig.status} /></dd>
          </dl>
          {fertig.tickets.length > 0 && (
            <table className="table">
              <caption className="sr-only">Tickets</caption>
              <thead><tr><th scope="col">Platz</th><th scope="col">Kategorie</th><th scope="col">Art</th><th scope="col">Ticketcode</th><th scope="col" className="text-right">Preis</th></tr></thead>
              <tbody>{fertig.tickets.map((t) => <tr key={t.id}><td>{sitzName(t.seatId)}</td><td>{KAT_NAME[t.kat]}</td><td>{ART_NAME[t.art] ?? t.art}</td><td className="font-mono">{t.code}</td><td className="text-right"><Money cents={t.priceCents} /></td></tr>)}</tbody>
            </table>
          )}
          <div className="flex flex-wrap gap-2">
            <Link href="/bestellungen/neu" className="btn-gold">Nächste Buchung</Link>
            {hat(u, 'leitung') && <Link href={`/bestellungen/${fertig.id}`} className="btn-secondary">Bestellung öffnen</Link>}
          </div>
        </section>
      ) : shows.length ? (
        <TelefonVerkauf shows={shows} startShow={shows.some((s) => s.id === sp.show) ? sp.show : undefined} darfFrei={hat(u, 'leitung')} />
      ) : <p className="card p-5 text-sm">Derzeit ist keine Vorstellung im Verkauf.</p>}
    </>
  );
}
