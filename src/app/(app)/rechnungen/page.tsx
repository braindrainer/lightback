import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatum, wienZuUtc } from '@/lib/dates';
import { heute, letzterTag, MONATE } from '@/lib/finanzen/zeitraum';
import { Seiten } from '@/components/finanzen/Seiten';
import { Empty, Money, PageHeader, StatusPill } from '@/components/ui';
import RechnungModal from '@/components/finanzen/RechnungModal';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Rechnungen' };

type Sp = Promise<Record<string, string | undefined>>;

export default async function Rechnungen({ searchParams }: { searchParams: Sp }) {
  await requireRole('buchhaltung');
  const sp = await searchParams;
  const jahr = /^\d{4}$/.test(sp.jahr ?? '') ? Number(sp.jahr) : Number(heute().slice(0, 4));
  const monat = /^\d{1,2}$/.test(sp.monat ?? '') ? Number(sp.monat) : 0;
  const art = sp.art === 'rechnung' || sp.art === 'storno' ? sp.art : '';
  const status = ['offen', 'bezahlt', 'storniert'].includes(sp.status ?? '') ? sp.status! : '';
  const herkunft = sp.herkunft === 'manuell' || sp.herkunft === 'bestellung' ? sp.herkunft : '';
  const q = (sp.q ?? '').trim();
  const p = (m: number, t: number) => `${jahr}-${String(m).padStart(2, '0')}-${String(t).padStart(2, '0')}`;
  const von = wienZuUtc(p(monat || 1, 1), '00:00');
  const bis = new Date(wienZuUtc(p(monat || 12, letzterTag(jahr, monat || 12)), '00:00').getTime() + 864e5);
  const seite = Math.max(1, Number(sp.seite) || 1);
  const where: Prisma.InvoiceWhereInput = {
    issueDate: { gte: von, lt: bis },
    ...(art ? { kind: art } : {}),
    ...(status ? { status, kind: 'rechnung' } : {}),
    ...(herkunft === 'manuell' ? { orderId: null } : herkunft === 'bestellung' ? { orderId: { not: null } } : {}),
    ...(q ? { OR: [
      { number: { contains: q, mode: 'insensitive' } },
      { order: { number: { contains: q, mode: 'insensitive' } } },
      { recipient: { path: ['name'], string_contains: q } },
      { recipient: { path: ['company'], string_contains: q } },
      { recipient: { path: ['email'], string_contains: q.toLowerCase() } },
    ] } : {}),
  };
  const [liste, summe, anzahl] = await Promise.all([
    db.invoice.findMany({ where, orderBy: [{ issueDate: 'desc' }, { number: 'desc' }], take: 100, skip: (seite - 1) * 100, include: { order: { select: { number: true } } } }),
    db.invoice.aggregate({ where, _sum: { netCents: true, vatCents: true, grossCents: true } }),
    db.invoice.count({ where }),
  ]);
  const jahre = Array.from({ length: 4 }, (_, i) => Number(heute().slice(0, 4)) + 1 - i);
  return (
    <>
      <PageHeader title="Rechnungen" sub="Rechnungen aus Bestellungen und manuelle Rechnungen an Firmen">
        <Link href="/rechnungen/neu" className="btn-primary">Neue Rechnung</Link>
      </PageHeader>
      <form className="card mb-4 flex flex-wrap items-end gap-3 p-4" role="search" aria-label="Rechnungen filtern">
        <div><label className="label" htmlFor="f-jahr">Jahr</label><select id="f-jahr" name="jahr" defaultValue={jahr} className="input">{jahre.map((j) => <option key={j}>{j}</option>)}</select></div>
        <div><label className="label" htmlFor="f-monat">Monat</label><select id="f-monat" name="monat" defaultValue={monat || ''} className="input"><option value="">Alle</option>{MONATE.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></div>
        <div><label className="label" htmlFor="f-art">Art</label><select id="f-art" name="art" defaultValue={art} className="input"><option value="">Alle</option><option value="rechnung">Rechnung</option><option value="storno">Storno</option></select></div>
        <div><label className="label" htmlFor="f-status">Status</label><select id="f-status" name="status" defaultValue={status} className="input"><option value="">Alle</option><option value="offen">Offen</option><option value="bezahlt">Bezahlt</option><option value="storniert">Storniert</option></select></div>
        <div><label className="label" htmlFor="f-herkunft">Herkunft</label><select id="f-herkunft" name="herkunft" defaultValue={herkunft} className="input"><option value="">Alle</option><option value="manuell">Manuell</option><option value="bestellung">Bestellung</option></select></div>
        <div className="min-w-48 flex-1"><label className="label" htmlFor="f-q">Suche</label><input id="f-q" name="q" defaultValue={q} className="input" placeholder="Nummer, Name, Firma, E-Mail" /></div>
        <button className="btn-secondary">Filtern</button>
      </form>
      <section className="card relative" aria-labelledby="re-liste">
        <h2 id="re-liste" className="sr-only">Liste</h2>
        {liste.length ? (
          <table className="table">
            <caption className="sr-only">Rechnungen {monat ? `${MONATE[monat - 1]} ` : ''}{jahr}</caption>
            <thead><tr><th>Nummer</th><th>Datum</th><th>Empfänger:in</th><th>Art</th><th>Status</th><th className="text-right">Netto</th><th className="text-right">Brutto</th><th><span className="sr-only">PDF</span></th></tr></thead>
            <tbody>
              {liste.map((r) => {
                const e = r.recipient as { name?: string; company?: string };
                return (
                  <tr key={r.id}>
                    <td><Link href={`/rechnungen/${r.id}`} className="font-medium underline underline-offset-4">{r.number}</Link>{r.order && <div className="text-xs text-muted">Bestellung {r.order.number}</div>}</td>
                    <td className="whitespace-nowrap">{fmtDatum(r.issueDate)}</td>
                    <td>{e.company || e.name || '–'}{e.company && e.name ? <div className="text-xs text-muted">{e.name}</div> : null}</td>
                    <td>{r.kind === 'storno' ? <span className="pill bg-gray-100 text-gray-700">Storno</span> : 'Rechnung'}</td>
                    <td>{r.kind === 'storno' ? '–' : <StatusPill status={r.status} />}</td>
                    <td className="text-right"><Money cents={r.netCents} /></td>
                    <td className="text-right"><Money cents={r.grossCents} /></td>
                    <td className="whitespace-nowrap"><RechnungModal id={r.id} nummer={r.number} storno={r.kind === 'storno'} knopf="Ansehen" className="btn-secondary btn-sm mr-2" /><a href={`/rechnungen/${r.id}/pdf?download=1`} className="text-sm underline underline-offset-4">PDF<span className="sr-only"> {r.number} herunterladen</span></a></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr className="font-semibold"><td colSpan={5} className="px-4 py-2.5">Summe ({anzahl} Rechnungen{anzahl > liste.length ? `, Seite ${seite}` : ''})</td><td className="px-4 text-right"><Money cents={summe._sum.netCents ?? 0} /></td><td className="px-4 text-right"><Money cents={summe._sum.grossCents ?? 0} /></td><td /></tr></tfoot>
          </table>
        ) : <Empty>Keine Rechnungen im gewählten Zeitraum.</Empty>}
        <Seiten seite={seite} gesamt={anzahl} je={100} params={{ jahr: String(jahr), monat: monat ? String(monat) : '', art, status, herkunft, q }} />
      </section>
    </>
  );
}
