import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { QUELLEN, quelle } from '@/lib/finanzen/texte';
import { fmtBuchDatum, heute, tag, zeitraum } from '@/lib/finanzen/zeitraum';
import { Formular, Senden } from '@/components/finanzen/Formular';
import { Seiten } from '@/components/finanzen/Seiten';
import { Empty, Money } from '@/components/ui';
import { stornoBuchungAktion } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Journal – Buchhaltung' };

export default async function Journal({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole('buchhaltung');
  const sp = await searchParams;
  const nr = /^\d+$/.test(sp.nr ?? '') ? Number(sp.nr) : null;
  const { von, bis } = zeitraum(sp, 'monat');
  const src = sp.quelle && QUELLEN[sp.quelle] ? sp.quelle : '';
  const konto = (sp.konto ?? '').trim().match(/^\d+/)?.[0] ?? '';
  const q = (sp.q ?? '').trim();
  const seite = Math.max(1, Number(sp.seite) || 1);
  const where: Prisma.JournalEntryWhereInput = nr ? { number: nr } : {
    date: { gte: tag(von)!, lte: tag(bis)! },
    ...(src ? { source: src } : {}),
    ...(konto ? { lines: { some: { account: { number: konto } } } } : {}),
    ...(q ? { OR: [{ text: { contains: q, mode: 'insensitive' } }, { docRef: { contains: q, mode: 'insensitive' } }] } : {}),
  };
  const [eintraege, anzahl] = await Promise.all([
    db.journalEntry.findMany({ where, orderBy: [{ date: 'asc' }, { number: 'asc' }], take: 50, skip: (seite - 1) * 50, include: { lines: { include: { account: { select: { number: true, name: true } } }, orderBy: [{ creditCents: 'asc' }] } } }),
    db.journalEntry.count({ where }),
  ]);
  const ids = eintraege.map((e) => e.id);
  const stornos = await db.journalEntry.findMany({ where: { reversesId: { in: ids } }, select: { reversesId: true, number: true } });
  const stornoVon = new Map(stornos.map((s) => [s.reversesId, s.number]));
  const reversed = await db.journalEntry.findMany({ where: { id: { in: eintraege.map((e) => e.reversesId).filter((x): x is string => !!x) } }, select: { id: true, number: true } });
  const nrVon = new Map(reversed.map((r) => [r.id, r.number]));
  const summeSoll = eintraege.reduce((s, e) => s + e.lines.reduce((a, l) => a + l.debitCents, 0), 0);
  return (
    <>
      <form className="card mb-4 flex flex-wrap items-end gap-3 p-4" role="search" aria-label="Journal filtern">
        <div><label className="label" htmlFor="j-von">Von</label><input id="j-von" type="date" name="von" defaultValue={von} className="input" /></div>
        <div><label className="label" htmlFor="j-bis">Bis</label><input id="j-bis" type="date" name="bis" defaultValue={bis} className="input" /></div>
        <div><label className="label" htmlFor="j-q">Quelle</label><select id="j-q" name="quelle" defaultValue={src} className="input"><option value="">Alle</option>{Object.entries(QUELLEN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label className="label" htmlFor="j-k">Konto</label><input id="j-k" name="konto" defaultValue={konto} inputMode="numeric" className="input w-28" /></div>
        <div className="min-w-44 flex-1"><label className="label" htmlFor="j-t">Text oder Beleg</label><input id="j-t" name="q" defaultValue={q} className="input" /></div>
        <button className="btn-secondary">Filtern</button>
        <Link href="/buchhaltung/buchen" className="btn-primary">Neue Buchung</Link>
      </form>
      <section aria-labelledby="h-journal">
        <h2 id="h-journal" className="h2 mb-2">Journal {nr ? `– Buchung Nr. ${nr}` : `${fmtBuchDatum(tag(von)!)} bis ${fmtBuchDatum(tag(bis)!)}`} <span className="text-sm font-normal text-muted">({anzahl} Buchungen{anzahl > eintraege.length ? `, Seite ${seite}` : ''}, Summe Soll auf dieser Seite <Money cents={summeSoll} />)</span></h2>
        {eintraege.length ? (
          <ol className="grid gap-3">
            {eintraege.map((e) => (
              <li key={e.id} className="card">
                <div className="flex flex-wrap items-start justify-between gap-2 px-4 pt-3">
                  <div>
                    <p className="font-semibold"><span className="num text-muted">Nr. {e.number}</span> · {fmtBuchDatum(e.date)} · {e.text}</p>
                    <p className="text-xs text-muted">{quelle(e.source)}{e.docRef ? ` · Beleg ${e.docRef}` : ''}{e.reversesId ? ` · Storno zu Nr. ${nrVon.get(e.reversesId) ?? '?'}` : ''}</p>
                  </div>
                  {stornoVon.has(e.id) ? <span className="pill bg-gray-100 text-gray-700">storniert durch Nr. {stornoVon.get(e.id)}</span> : !e.reversesId && (
                    <details className="text-sm">
                      <summary className="cursor-pointer rounded px-2 py-1 text-neg underline underline-offset-4">Stornieren<span className="sr-only"> Buchung Nr. {e.number}</span></summary>
                      <Formular action={stornoBuchungAktion.bind(null, e.id)} className="mt-2 flex flex-wrap items-end gap-2" bestaetigen={`Buchung Nr. ${e.number} durch Gegenbuchung stornieren?`}>
                        <div><label className="label" htmlFor={`st-${e.id}`}>Storno-Datum</label><input id={`st-${e.id}`} type="date" name="datum" defaultValue={heute()} className="input" required /></div>
                        <Senden className="btn-danger">Gegenbuchung erstellen</Senden>
                      </Formular>
                    </details>
                  )}
                </div>
                <table className="table mt-2 lg:table-fixed">
                  <caption className="sr-only">Zeilen der Buchung Nr. {e.number}</caption>
                  <colgroup><col className="w-24" /><col /><col className="w-36" /><col className="w-36" /><col className="w-48" /></colgroup>
                  <thead><tr><th>Konto</th><th>Bezeichnung</th><th className="text-right">Soll</th><th className="text-right">Haben</th><th>Steuer</th></tr></thead>
                  <tbody>
                    {e.lines.map((l) => (
                      <tr key={l.id}>
                        <td className="num"><Link href={`/buchhaltung/konten/${l.account.number}`} className="underline underline-offset-4">{l.account.number}</Link></td>
                        <td>{l.account.name}{l.text ? <span className="text-muted"> – {l.text}</span> : null}</td>
                        <td className="text-right">{l.debitCents ? <Money cents={l.debitCents} /> : ''}</td>
                        <td className="text-right">{l.creditCents ? <Money cents={l.creditCents} /> : ''}</td>
                        <td className="text-xs">{l.vatCode ? <>{l.vatCode}{l.baseCents != null && <span className="text-muted"> (BMG <Money cents={l.baseCents} />)</span>}</> : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </li>
            ))}
          </ol>
        ) : <div className="card relative"><Empty>Keine Buchungen im Zeitraum.</Empty></div>}
        <Seiten seite={seite} gesamt={anzahl} je={50} params={{ von, bis, quelle: src, konto, q }} />
      </section>
    </>
  );
}
