import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { Verlauf } from '@/components/Verlauf';
import { db } from '@/lib/db';
import { fmtDatumZeit } from '@/lib/dates';
import { Empty, Money, PageHeader, StatusPill } from '@/components/ui';
import { KundeFormular } from '@/components/verkauf/BestellungAktionen';
import { AnonymisierenDialog } from '@/components/verkauf/KundeAktionen';
import { KANAL_NAME } from '@/components/verkauf/texte';
import { gleichePerson } from '@/components/verkauf/daten';
import { anonymisieren, kundeBearbeiten } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Kund:in' };

export default async function Kunde({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('leitung');
  const { id } = await params;
  const c = await db.customer.findUnique({ where: { id } });
  if (!c) notFound();
  const alle = await gleichePerson(id);
  const orders = await db.order.findMany({
    where: { customerId: { in: alle.map((x) => x.id) } }, orderBy: { createdAt: 'desc' },
    include: { show: { select: { startsAt: true } }, tickets: { where: { status: { not: 'storniert' } }, select: { priceCents: true } } },
  });
  const umsatz = orders.reduce((s, o) => s + o.tickets.reduce((a, t) => a + t.priceCents, 0), 0);
  const anonym = c.firstName === 'Anonymisiert' && !c.email;
  return (
    <>
      <PageHeader title={`${c.firstName} ${c.lastName}`.trim() || '(ohne Namen)'} sub={<><Link href="/kunden" className="underline underline-offset-4">Alle Kund:innen</Link> · {orders.length} Bestellungen · Umsatz <Money cents={umsatz} />{alle.length > 1 ? ` · ${alle.length} Datensätze mit dieser E-Mail` : ''}</>}>
        <AnonymisierenDialog action={anonymisieren.bind(null, id)} datensaetze={alle.length} versteckt={anonym} />
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section className="card p-5" aria-labelledby="daten">
          <h2 id="daten" className="h2 mb-3">Daten</h2>
          {anonym ? <p className="text-sm text-muted">Diese Person wurde anonymisiert.</p> : (
            <KundeFormular action={kundeBearbeiten.bind(null, id)} prefix="kunde" werte={{ firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone ?? '', company: c.company ?? '', vatId: c.vatId ?? '', street: c.street ?? '', zip: c.zip ?? '', city: c.city ?? '', country: c.country ?? '', newsletter: c.newsletter }} />
          )}
          <p className="mt-3 text-xs text-muted">Angelegt {fmtDatumZeit(c.createdAt)} · Sprache {c.locale}</p>
        </section>
        <section className="card" aria-labelledby="bestellungen">
          <h2 id="bestellungen" className="h2 px-5 pt-4">Bestellungen</h2>
          {orders.length ? (
            <table className="table mt-3">
              <thead><tr><th scope="col">Nummer</th><th scope="col">Vorstellung</th><th scope="col">Kanal</th><th scope="col">Status</th><th scope="col" className="text-right">Summe</th></tr></thead>
              <tbody>{orders.map((o) => (
                <tr key={o.id}>
                  <td><Link href={`/bestellungen/${o.id}`} className="font-mono underline-offset-4 hover:underline">{o.number}</Link></td>
                  <td className="whitespace-nowrap">{fmtDatumZeit(o.show.startsAt)}</td><td>{KANAL_NAME[o.channel] ?? o.channel}</td><td><StatusPill status={o.status} /></td><td className="text-right"><Money cents={o.totalCents} /></td>
                </tr>
              ))}</tbody>
            </table>
          ) : <Empty>Keine Bestellungen.</Empty>}
        </section>
      </div>
      <Verlauf ziele={[{ entity: 'customer', ids: [c.id, ...alle.map((x) => x.id)] }]} />
    </>
  );
}
