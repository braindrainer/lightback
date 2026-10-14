import type { Prisma } from '@prisma/client';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtBuchDatum, heute } from '@/lib/finanzen/zeitraum';
import { BelegFelder } from '@/components/finanzen/BelegFelder';
import { Formular, Senden } from '@/components/finanzen/Formular';
import { Hochladen } from '@/components/finanzen/Hochladen';
import { Empty, Money, StatusPill } from '@/components/ui';
import { belegBezahltAktion, belegStornoAktion } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Belege – Buchhaltung' };

export default async function Belege({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole('buchhaltung');
  const sp = await searchParams;
  const status = ['offen', 'bezahlt', 'storniert'].includes(sp.status ?? '') ? sp.status! : '';
  const q = (sp.q ?? '').trim();
  const where: Prisma.ExpenseWhereInput = { ...(status ? { status } : {}), ...(q ? { OR: [{ supplier: { contains: q, mode: 'insensitive' } }, { docNumber: { contains: q, mode: 'insensitive' } }] } : {}) };
  const [konten, belege, offen] = await Promise.all([
    db.account.findMany({ where: { type: 'aufwand', active: true }, orderBy: { number: 'asc' }, select: { number: true, name: true, vatCode: true } }),
    db.expense.findMany({ where, orderBy: [{ docDate: 'desc' }, { createdAt: 'desc' }], take: 100 }),
    db.expense.aggregate({ where: { status: 'offen' }, _sum: { grossCents: true }, _count: true }),
  ]);
  const h = heute();
  return (
    <>
      <section className="card relative mb-6 p-5" aria-labelledby="h-neu">
        <h2 id="h-neu" className="h2 mb-1">Eingangsrechnung erfassen</h2>
        <p className="mb-3 text-sm text-muted">Bucht Aufwand und Vorsteuer an 3300 Lieferverbindlichkeiten. Die Datei wird unveränderbar abgelegt (Prüfsumme).</p>
        <Hochladen url="/buchhaltung/belege/upload" knopf="Beleg speichern und buchen" className="flex flex-wrap items-end gap-3">
          <BelegFelder konten={konten} heute={h} />
        </Hochladen>
      </section>
      <form className="card mb-4 flex flex-wrap items-end gap-3 p-4" role="search" aria-label="Belege filtern">
        <div><label className="label" htmlFor="b-st">Status</label><select id="b-st" name="status" defaultValue={status} className="input"><option value="">Alle</option><option value="offen">Offen</option><option value="bezahlt">Bezahlt</option><option value="storniert">Storniert</option></select></div>
        <div className="min-w-48 flex-1"><label className="label" htmlFor="b-q">Suche</label><input id="b-q" name="q" defaultValue={q} className="input" placeholder="Lieferant oder Nummer" /></div>
        <button className="btn-secondary">Filtern</button>
        <p className="text-sm text-muted">Offen: {offen._count} Belege, <Money cents={offen._sum.grossCents ?? 0} /></p>
      </form>
      <section className="card relative" aria-labelledby="h-belege">
        <h2 id="h-belege" className="h2 px-5 pt-4">Belege</h2>
        {belege.length ? (
          <table className="table mt-3">
            <thead><tr><th>Datum</th><th>Lieferant</th><th>Konto</th><th className="text-right">Netto</th><th className="text-right">USt</th><th className="text-right">Brutto</th><th>Status</th><th>Datei</th><th>Aktion</th></tr></thead>
            <tbody>{belege.map((b) => (
              <tr key={b.id}>
                <td className="whitespace-nowrap">{fmtBuchDatum(b.docDate)}{b.dueDate && b.status === 'offen' && <div className="text-xs text-muted">fällig {fmtBuchDatum(b.dueDate)}</div>}</td>
                <td>{b.supplier}<div className="text-xs text-muted">{b.docNumber}</div></td>
                <td className="num">{b.accountNumber}</td>
                <td className="text-right"><Money cents={b.netCents} /></td>
                <td className="text-right"><Money cents={b.vatCents} /><div className="text-xs text-muted">{b.vatRate} %</div></td>
                <td className="text-right"><Money cents={b.grossCents} /></td>
                <td><StatusPill status={b.status} />{b.paidAt && <div className="text-xs text-muted">{fmtBuchDatum(b.paidAt)}</div>}</td>
                <td>{b.filePath ? <><a href={`/buchhaltung/belege/${b.id}/datei`} target="_blank" rel="noopener" className="underline underline-offset-4">Ansehen<span className="sr-only"> Beleg {b.supplier} (neues Fenster)</span></a> · <a href={`/buchhaltung/belege/${b.id}/datei?download=1`} className="underline underline-offset-4">Laden<span className="sr-only"> Beleg {b.supplier}</span></a></> : <span className="text-muted">–</span>}</td>
                <td>{b.status === 'offen' && (
                  <details>
                    <summary className="cursor-pointer underline underline-offset-4">Bezahlt / Storno<span className="sr-only"> {b.supplier}</span></summary>
                    <Formular action={belegBezahltAktion.bind(null, b.id)} className="mt-2 flex flex-wrap items-end gap-2">
                      <div><label className="label" htmlFor={`bz-${b.id}`}>Bezahlt am</label><input id={`bz-${b.id}`} type="date" name="datum" defaultValue={h} required className="input" /></div>
                      <Senden className="btn-secondary btn-sm">Zahlung buchen</Senden>
                    </Formular>
                    <Formular action={belegStornoAktion.bind(null, b.id)} className="mt-2 flex flex-wrap items-end gap-2" bestaetigen="Beleg stornieren (Gegenbuchung)?">
                      <div><label className="label" htmlFor={`bs-${b.id}`}>Storno am</label><input id={`bs-${b.id}`} type="date" name="datum" defaultValue={h} required className="input" /></div>
                      <Senden className="btn-danger btn-sm">Stornieren</Senden>
                    </Formular>
                  </details>
                )}</td>
              </tr>))}
            </tbody>
          </table>
        ) : <Empty>Keine Belege.</Empty>}
      </section>
    </>
  );
}
