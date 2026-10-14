import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatum, fmtDatumZeit, wienZuUtc } from '@/lib/dates';
import { ANBIETER, anbieterVonKonto, TRANSIT_KONTEN } from '@/lib/finanzen/buchhaltung';
import { centZuEingabe, heute, tag } from '@/lib/finanzen/zeitraum';
import { TRANSIT } from '@/lib/ledger';
import { Formular, Senden } from '@/components/finanzen/Formular';
import { Seiten } from '@/components/finanzen/Seiten';
import { Empty, Money, PageHeader, StatusPill } from '@/components/ui';
import { auszahlungAktion } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Zahlungen' };

const PROVIDER = ['hobex', 'applepay', 'stripe', 'paypal', 'terminal', 'bar', 'gutschein', 'rechnung', 'partner'];
const STATUS = ['offen', 'autorisiert', 'bezahlt', 'fehlgeschlagen', 'erstattet', 'teilerstattet'];
const METHODE: Record<string, string> = { zahlungsmittel: 'Zahlungsmittel', gutschein: 'Gutschein', keine: 'keine Erstattung' };

export default async function Zahlungen({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole('buchhaltung');
  const sp = await searchParams;
  const provider = PROVIDER.includes(sp.anbieter ?? '') ? sp.anbieter! : '';
  const status = STATUS.includes(sp.status ?? '') ? sp.status! : '';
  const abgerechnet = sp.abgerechnet === 'ja' || sp.abgerechnet === 'nein' ? sp.abgerechnet : '';
  const von = tag(sp.von) ? sp.von! : '';
  const bis = tag(sp.bis) ? sp.bis! : '';
  const seite = Math.max(1, Number(sp.seite) || 1);
  const where: Prisma.PaymentWhereInput = {
    ...(provider ? { provider } : {}), ...(status ? { status } : {}),
    ...(abgerechnet === 'ja' ? { settledAt: { not: null } } : abgerechnet === 'nein' ? { settledAt: null } : {}),
    ...(von || bis ? { createdAt: { ...(von ? { gte: wienZuUtc(von, '00:00') } : {}), ...(bis ? { lt: new Date(wienZuUtc(bis, '00:00').getTime() + 864e5) } : {}) } } : {}),
  };
  // Auszahlung: offene Zahlungen eines Anbieters im gewählten Zeitraum
  const aAnbieter = ANBIETER[sp.a_anbieter ?? ''] ? sp.a_anbieter! : '';
  const aVon = tag(sp.a_von) ? sp.a_von! : '';
  const aBis = tag(sp.a_bis) ? sp.a_bis! : '';
  const [konten, salden, zahlungen, summe, refunds, offeneAuszahlung] = await Promise.all([
    db.account.findMany({ where: { number: { in: TRANSIT_KONTEN } }, orderBy: { number: 'asc' } }),
    db.journalLine.groupBy({ by: ['accountId'], where: { account: { number: { in: TRANSIT_KONTEN } } }, _sum: { debitCents: true, creditCents: true } }),
    db.payment.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100, skip: (seite - 1) * 100, include: { order: { select: { id: true, number: true } } } }),
    db.payment.aggregate({ where, _sum: { amountCents: true, feeCents: true, refundedCents: true }, _count: true }),
    db.refund.findMany({ orderBy: { createdAt: 'desc' }, take: 30, include: { order: { select: { id: true, number: true } } } }),
    aAnbieter ? db.payment.findMany({
      where: { provider: { in: anbieterVonKonto(TRANSIT[aAnbieter]) }, settledAt: null, status: { in: ['bezahlt', 'teilerstattet', 'erstattet'] }, ...(aVon || aBis ? { paidAt: { ...(aVon ? { gte: wienZuUtc(aVon, '00:00') } : {}), ...(aBis ? { lt: new Date(wienZuUtc(aBis, '00:00').getTime() + 864e5) } : {}) } } : {}) },
      orderBy: { paidAt: 'asc' }, take: 500, include: { order: { select: { number: true } } },
    }) : Promise.resolve([]),
  ]);
  const saldo = new Map(salden.map((s) => [s.accountId, (s._sum.debitCents ?? 0) - (s._sum.creditCents ?? 0)]));
  const vorschlagBrutto = offeneAuszahlung.reduce((s, p) => s + p.amountCents - p.refundedCents, 0);
  const vorschlagGebuehr = offeneAuszahlung.reduce((s, p) => s + p.feeCents, 0);
  return (
    <>
      <PageHeader title="Zahlungen" sub="Zahlungseingänge über die Anbieter, Auszahlungen auf das Bankkonto und Erstattungen" />
      <section aria-labelledby="h-transit" className="mb-6">
        <h2 id="h-transit" className="h2 mb-2">Geldtransit (noch nicht ausgezahlt)</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {konten.map((k) => (
            <div key={k.id} className="card p-4">
              <p className="text-xs text-muted">{k.number} {k.name}</p>
              <p className="mt-1 text-2xl font-semibold"><Money cents={saldo.get(k.id) ?? 0} /></p>
              <Link href={`/buchhaltung/konten/${k.number}`} className="text-xs underline underline-offset-4">Kontenblatt<span className="sr-only"> {k.number}</span></Link>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">Saldo laut Buchhaltung: Zahlungseingänge minus erfasste Auszahlungen und Erstattungen.</p>
      </section>

      <section className="card relative mb-6 p-5" aria-labelledby="h-ausz">
        <h2 id="h-ausz" className="h2">Auszahlung erfassen</h2>
        <p className="mt-1 text-sm text-muted">1. Anbieter und Zeitraum der enthaltenen Zahlungen wählen. 2. Zahlungen prüfen, Beträge laut Abrechnung des Anbieters eintragen und buchen (Bank und Gebühren an Geldtransit).</p>
        <form className="mt-3 flex flex-wrap items-end gap-3" aria-label="Zahlungen für die Auszahlung suchen">
          <div><label className="label" htmlFor="a-anb">Anbieter</label><select id="a-anb" name="a_anbieter" defaultValue={aAnbieter} className="input" required><option value="">Bitte wählen</option>{Object.entries(ANBIETER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div><label className="label" htmlFor="a-von">Zahlungen von</label><input id="a-von" name="a_von" type="date" defaultValue={aVon} className="input" /></div>
          <div><label className="label" htmlFor="a-bis">bis</label><input id="a-bis" name="a_bis" type="date" defaultValue={aBis} className="input" /></div>
          <button className="btn-secondary">Offene Zahlungen anzeigen</button>
        </form>
        {aAnbieter && (
          <Formular action={auszahlungAktion} className="mt-4 grid gap-4">
            <input type="hidden" name="provider" value={aAnbieter} />
            {offeneAuszahlung.length ? (
              <fieldset className="max-h-80 overflow-auto rounded-lg border border-line">
                <legend className="sr-only">Enthaltene Zahlungen</legend>
                <table className="table">
                  <thead><tr><th>Enthalten</th><th>Bezahlt</th><th>Bestellung</th><th className="text-right">Betrag</th><th className="text-right">Erstattet</th><th className="text-right">Gebühr</th></tr></thead>
                  <tbody>{offeneAuszahlung.map((p) => (
                    <tr key={p.id}>
                      <td><input type="checkbox" name="zahlung" value={p.id} defaultChecked className="h-5 w-5" aria-label={`Zahlung ${p.order?.number ?? p.id} enthalten`} /></td>
                      <td>{p.paidAt ? fmtDatumZeit(p.paidAt) : '–'}</td><td>{p.order?.number ?? '–'}</td>
                      <td className="text-right"><Money cents={p.amountCents} /></td><td className="text-right"><Money cents={p.refundedCents} /></td><td className="text-right"><Money cents={p.feeCents} /></td>
                    </tr>))}
                  </tbody>
                </table>
              </fieldset>
            ) : <p className="text-sm text-muted">Keine offenen Zahlungen für {ANBIETER[aAnbieter]} im Zeitraum. Die Auszahlung kann trotzdem gebucht werden.</p>}
            <div className="grid gap-3 sm:grid-cols-4">
              <div><label className="label" htmlFor="a-datum">Auszahlung am</label><input id="a-datum" name="datum" type="date" required defaultValue={heute()} className="input" /></div>
              <div><label className="label" htmlFor="a-brutto">Bruttobetrag €</label><input id="a-brutto" name="brutto" inputMode="decimal" required defaultValue={vorschlagBrutto ? centZuEingabe(vorschlagBrutto) : ''} className="input num" aria-describedby="a-brutto-h" /><p id="a-brutto-h" className="mt-1 text-xs text-muted">Summe der Zahlungen vor Gebühren</p></div>
              <div><label className="label" htmlFor="a-geb">Gebühren €</label><input id="a-geb" name="gebuehr" inputMode="decimal" defaultValue={vorschlagGebuehr ? centZuEingabe(vorschlagGebuehr) : ''} className="input num" /></div>
              <div><label className="label" htmlFor="a-ref">Referenz der Auszahlung</label><input id="a-ref" name="ref" className="input" /></div>
            </div>
            <div><Senden>Auszahlung buchen</Senden></div>
          </Formular>
        )}
      </section>

      <form className="card mb-4 flex flex-wrap items-end gap-3 p-4" role="search" aria-label="Zahlungen filtern">
        <div><label className="label" htmlFor="f-anb">Anbieter</label><select id="f-anb" name="anbieter" defaultValue={provider} className="input"><option value="">Alle</option>{PROVIDER.map((p) => <option key={p} value={p}>{ANBIETER[p] ?? p}</option>)}</select></div>
        <div><label className="label" htmlFor="f-st">Status</label><select id="f-st" name="status" defaultValue={status} className="input"><option value="">Alle</option>{STATUS.map((p) => <option key={p}>{p}</option>)}</select></div>
        <div><label className="label" htmlFor="f-ab">Ausgezahlt</label><select id="f-ab" name="abgerechnet" defaultValue={abgerechnet} className="input"><option value="">Alle</option><option value="ja">Ja</option><option value="nein">Nein</option></select></div>
        <div><label className="label" htmlFor="f-von">Von</label><input id="f-von" type="date" name="von" defaultValue={von} className="input" /></div>
        <div><label className="label" htmlFor="f-bis">Bis</label><input id="f-bis" type="date" name="bis" defaultValue={bis} className="input" /></div>
        <button className="btn-secondary">Filtern</button>
      </form>
      <section className="card relative mb-6" aria-labelledby="h-zahl">
        <h2 id="h-zahl" className="h2 px-5 pt-4">Zahlungen <span className="text-sm font-normal text-muted">({summe._count})</span></h2>
        {zahlungen.length ? (
          <table className="table mt-3">
            <thead><tr><th>Datum</th><th>Bestellung</th><th>Anbieter</th><th>Status</th><th className="text-right">Betrag</th><th className="text-right">Gebühr</th><th className="text-right">Erstattet</th><th>Ausgezahlt</th></tr></thead>
            <tbody>{zahlungen.map((p) => (
              <tr key={p.id}>
                <td className="whitespace-nowrap">{fmtDatumZeit(p.paidAt ?? p.createdAt)}</td>
                <td>{p.order ? <Link href={`/bestellungen/${p.order.id}`} className="underline underline-offset-4">{p.order.number}</Link> : '–'}<div className="max-w-40 truncate text-xs text-muted" title={p.providerRef ?? ''}>{p.providerRef}</div></td>
                <td>{ANBIETER[p.provider] ?? p.provider}</td>
                <td><StatusPill status={p.status} /></td>
                <td className="text-right"><Money cents={p.amountCents} /></td>
                <td className="text-right"><Money cents={p.feeCents} /></td>
                <td className="text-right"><Money cents={p.refundedCents} /></td>
                <td>{p.settledAt ? <>{fmtDatum(p.settledAt)}<div className="text-xs text-muted">{p.settlementRef}</div></> : <span className="text-muted">nein</span>}</td>
              </tr>))}
            </tbody>
            <tfoot><tr className="font-semibold"><td colSpan={4} className="px-4 py-2.5">Summe</td><td className="px-4 text-right"><Money cents={summe._sum.amountCents ?? 0} /></td><td className="px-4 text-right"><Money cents={summe._sum.feeCents ?? 0} /></td><td className="px-4 text-right"><Money cents={summe._sum.refundedCents ?? 0} /></td><td /></tr></tfoot>
          </table>
        ) : <Empty>Keine Zahlungen gefunden.</Empty>}
        <Seiten seite={seite} gesamt={summe._count} je={100} params={{ anbieter: provider, status, abgerechnet, von, bis }} />
      </section>
      <section className="card relative" aria-labelledby="h-ref">
        <h2 id="h-ref" className="h2 px-5 pt-4">Stornos und Erstattungen <span className="text-sm font-normal text-muted">(letzte 30)</span></h2>
        {refunds.length ? (
          <table className="table mt-3">
            <thead><tr><th>Datum</th><th>Bestellung</th><th>Art</th><th>Grund</th><th className="text-right">Erstattet</th><th className="text-right">Stornogebühr</th><th>Status</th></tr></thead>
            <tbody>{refunds.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">{fmtDatumZeit(r.createdAt)}</td>
                <td><Link href={`/bestellungen/${r.order.id}`} className="underline underline-offset-4">{r.order.number}</Link></td>
                <td>{METHODE[r.method] ?? r.method}</td><td>{r.reason}</td>
                <td className="text-right"><Money cents={r.amountCents} /></td><td className="text-right"><Money cents={r.feeCents} /></td>
                <td>{r.status}</td>
              </tr>))}
            </tbody>
          </table>
        ) : <Empty>Noch keine Erstattungen.</Empty>}
      </section>
    </>
  );
}
