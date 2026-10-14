import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { Verlauf } from '@/components/Verlauf';
import { db } from '@/lib/db';
import { fmtDatum, fmtDatumZeit } from '@/lib/dates';
import { formatEur } from '@/lib/money';
import { Abschnitt, DetailKopf, Empty, Feldliste, Kennzahlen, Money, StatusPill } from '@/components/ui';
import { KundeBearbeiten } from '@/components/verkauf/BestellungAktionen';
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
  const name = `${c.firstName} ${c.lastName}`.trim() || '(ohne Namen)';
  const adresse = [c.street, [c.zip, c.city].filter(Boolean).join(' '), c.country].filter(Boolean).join(', ');
  const besuche = new Set(orders.filter((o) => o.status !== 'storniert' && o.status !== 'offen').map((o) => o.showId)).size;
  return (
    <>
      <DetailKopf krumen={[{ label: 'Verkauf' }, { label: 'Kund:innen', href: '/kunden' }, { label: name }]} titel={name}
        status={c.newsletter ? <span className="pill bg-accent-soft text-accent-deep ring-1 ring-inset ring-gold/50">Newsletter</span> : undefined}
        untertitel={<>Kund:in seit {fmtDatumZeit(c.createdAt)} · Sprache {c.locale.toUpperCase()}{alle.length > 1 ? ` · ${alle.length} Datensätze mit dieser E-Mail zusammengefasst` : ''}</>}
        aktionen={<>
          {!anonym && <KundeBearbeiten action={kundeBearbeiten.bind(null, id)} untertitel={name} knopf="Bearbeiten" werte={{ firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone ?? '', company: c.company ?? '', vatId: c.vatId ?? '', street: c.street ?? '', zip: c.zip ?? '', city: c.city ?? '', country: c.country ?? '', newsletter: c.newsletter }} />}
          <AnonymisierenDialog action={anonymisieren.bind(null, id)} datensaetze={alle.length} versteckt={anonym} />
        </>} />
      <Kennzahlen items={[
        { label: 'Bestellungen', wert: orders.length, icon: 'liste' },
        { label: 'Besuchte Vorstellungen', wert: besuche, icon: 'kalender' },
        { label: 'Umsatz (Tickets)', wert: formatEur(umsatz), ton: 'gold', icon: 'euro' },
        { label: 'Zuletzt bestellt', wert: orders[0] ? fmtDatum(orders[0].createdAt) : '–', icon: 'uhr' },
      ]} />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Abschnitt id="daten" titel="Kontaktdaten">
          {anonym ? <Empty icon="schloss">Diese Person wurde anonymisiert.</Empty> : (
            <Feldliste spalten={2} felder={[
              { label: 'Vorname', wert: c.firstName || null }, { label: 'Nachname', wert: c.lastName || null },
              { label: 'E-Mail', wert: c.email ? <a href={`mailto:${c.email}`} className="link break-all">{c.email}</a> : null, kopieren: c.email || null, breit: true },
              { label: 'Telefon', wert: c.phone ? <a href={`tel:${c.phone}`} className="link">{c.phone}</a> : null, kopieren: c.phone },
              { label: 'Firma', wert: c.company }, c.vatId && { label: 'UID', wert: c.vatId },
              { label: 'Adresse', wert: adresse || null, breit: true },
              { label: 'Newsletter', wert: c.newsletter ? 'Einwilligung liegt vor' : 'nein' },
            ]} />
          )}
        </Abschnitt>
        <Abschnitt id="bestellungen" titel="Bestellungen" flush>
          {orders.length ? (
            <table className="table rtab">
              <thead><tr><th scope="col">Nummer</th><th scope="col">Vorstellung</th><th scope="col">Kanal</th><th scope="col">Status</th><th scope="col" className="text-right">Summe</th></tr></thead>
              <tbody>{orders.map((o) => (
                <tr key={o.id}>
                  <td className="rtab-kopf"><Link href={`/bestellungen/${o.id}`} className="font-mono text-[13px] font-semibold underline-offset-4 hover:underline">{o.number}</Link><span className="block text-xs text-muted">{fmtDatum(o.createdAt)}</span></td>
                  <td data-label="Vorstellung" className="whitespace-nowrap">{fmtDatumZeit(o.show.startsAt)}</td><td data-label="Kanal">{KANAL_NAME[o.channel] ?? o.channel}</td><td data-label="Status"><StatusPill status={o.status} /></td><td data-label="Summe" className="text-right"><Money cents={o.totalCents} /></td>
                </tr>
              ))}</tbody>
            </table>
          ) : <Empty icon="ticket">Noch keine Bestellungen.</Empty>}
        </Abschnitt>
      </div>
      <Verlauf className="mt-6" ziele={[{ entity: 'customer', ids: [c.id, ...alle.map((x) => x.id)] }]} />
    </>
  );
}
