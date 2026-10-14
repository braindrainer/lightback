import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatum, fmtDatumZeit } from '@/lib/dates';
import { Empty, Money, PageHeader, StatusPill } from '@/components/ui';
import { AktionKnopf } from '@/components/verkauf/BestellungAktionen';
import { gutscheinAktivSetzen } from '../actions';
import { ISSUER_NAME } from '@/components/verkauf/texte';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Gutschein' };

export default async function Gutschein({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('leitung', 'buchhaltung');
  const { id } = await params;
  const v = await db.voucher.findUnique({ where: { id }, include: { redemptions: { orderBy: { createdAt: 'asc' }, include: { order: { select: { id: true, number: true, status: true } } } } } });
  if (!v) notFound();
  const [herkunft, verkauft] = await Promise.all([
    db.refund.findFirst({ where: { voucherId: id }, include: { order: { select: { id: true, number: true } } } }),
    v.soldOrderId ? db.order.findUnique({ where: { id: v.soldOrderId }, select: { id: true, number: true } }) : null,
  ]);
  const abgelaufen = !!v.validUntil && v.validUntil < new Date();
  return (
    <>
      <PageHeader title={`Gutschein ${v.code}`} sub={<Link href="/gutscheine" className="underline underline-offset-4">Alle Gutscheine</Link>}>
        {v.active ? <AktionKnopf action={gutscheinAktivSetzen.bind(null, id, false)} className="btn-danger" frage="Gutschein deaktivieren? Er kann dann nicht mehr eingelöst werden.">Deaktivieren</AktionKnopf>
          : <AktionKnopf action={gutscheinAktivSetzen.bind(null, id, true)}>Wieder aktivieren</AktionKnopf>}
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5" aria-labelledby="daten">
          <h2 id="daten" className="h2 mb-3">Daten</h2>
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted">Status</dt><dd>{!v.active ? <StatusPill status="storniert" label="Deaktiviert" /> : abgelaufen ? <StatusPill status="fehler" label="Abgelaufen" /> : v.remainingCents === 0 ? <StatusPill status="erstattet" label="Aufgebraucht" /> : <StatusPill status="bezahlt" label="Einlösbar" />}</dd>
            <dt className="text-muted">Art</dt><dd>{v.kind === 'partner' ? 'Partner-Gutschein' : 'Wertgutschein'}</dd>
            <dt className="text-muted">Herausgeber</dt><dd>{ISSUER_NAME[v.issuer] ?? v.issuer}</dd>
            <dt className="text-muted">Wert</dt><dd><Money cents={v.valueCents} /></dd>
            <dt className="text-muted">Restwert</dt><dd><Money cents={v.remainingCents} className="font-semibold" /></dd>
            <dt className="text-muted">Gültig bis</dt><dd>{v.validUntil ? fmtDatum(v.validUntil) : 'unbegrenzt'}</dd>
            <dt className="text-muted">Angelegt</dt><dd>{fmtDatumZeit(v.createdAt)}</dd>
            {v.note && <><dt className="text-muted">Notiz</dt><dd>{v.note}</dd></>}
            {herkunft && <><dt className="text-muted">Aus Storno</dt><dd><Link className="font-mono underline" href={`/bestellungen/${herkunft.order.id}`}>{herkunft.order.number}</Link></dd></>}
            {verkauft && <><dt className="text-muted">Verkauft mit</dt><dd><Link className="font-mono underline" href={`/bestellungen/${verkauft.id}`}>{verkauft.number}</Link></dd></>}
          </dl>
        </section>
        <section className="card" aria-labelledby="einloesungen">
          <h2 id="einloesungen" className="h2 px-5 pt-4">Einlösungen</h2>
          {v.redemptions.length ? (
            <table className="table mt-3">
              <thead><tr><th scope="col">Datum</th><th scope="col">Bestellung</th><th scope="col">Status</th><th scope="col" className="text-right">Betrag</th></tr></thead>
              <tbody>{v.redemptions.map((r) => <tr key={r.id}><td>{fmtDatumZeit(r.createdAt)}</td><td><Link className="font-mono underline-offset-4 hover:underline" href={`/bestellungen/${r.order.id}`}>{r.order.number}</Link></td><td><StatusPill status={r.order.status} /></td><td className="text-right"><Money cents={r.amountCents} /></td></tr>)}</tbody>
            </table>
          ) : <Empty>Noch nicht eingelöst.</Empty>}
        </section>
      </div>
    </>
  );
}
