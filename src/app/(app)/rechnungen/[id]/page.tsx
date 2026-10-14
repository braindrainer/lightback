import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { Verlauf } from '@/components/Verlauf';
import { db, getSettings } from '@/lib/db';
import { fmtDatum, fmtDatumZeit } from '@/lib/dates';
import { rechnungDoc } from '@/lib/finanzen/rechnungen';
import { fmtBuchDatum, heute } from '@/lib/finanzen/zeitraum';
import { pflichtHinweise, steuerAufstellung, type Empfaenger } from '@/lib/invoice-html';
import { Formular, Senden } from '@/components/finanzen/Formular';
import { Money, PageHeader, StatusPill } from '@/components/ui';
import { sendenAktion, stornoAktion, zahlungErhaltenAktion } from '../actions';

export const dynamic = 'force-dynamic';

export default async function Rechnung({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole('buchhaltung');
  const { id } = await params;
  const sp = await searchParams;
  const inv = await db.invoice.findUnique({ where: { id }, include: { order: { select: { id: true, number: true } } } });
  if (!inv) notFound();
  const [doc, s, stornos, buchungen, mails] = await Promise.all([
    rechnungDoc(inv), getSettings(),
    db.invoice.findMany({ where: { cancelsId: inv.id }, select: { id: true, number: true } }),
    db.journalEntry.findMany({ where: { OR: [{ sourceId: inv.id }, { docRef: inv.number }, ...(inv.orderId ? [{ source: 'order', sourceId: inv.orderId }] : [])] }, orderBy: { number: 'asc' }, select: { id: true, number: true, date: true, text: true } }),
    db.emailLog.findMany({ where: { template: 'rechnung', subject: { contains: inv.number } }, orderBy: { createdAt: 'desc' }, take: 5 }),
  ]);
  const r = inv.recipient as Empfaenger;
  const st = steuerAufstellung(doc);
  const hinweise = pflichtHinweise(doc, s);
  const manuell = !inv.orderId;
  const offen = inv.kind === 'rechnung' && inv.status === 'offen';
  return (
    <>
      <PageHeader title={`${inv.kind === 'storno' ? 'Stornorechnung' : 'Rechnung'} ${inv.number}`} sub={<>{manuell ? 'Manuelle Rechnung' : <>Aus Bestellung <Link className="underline underline-offset-4" href={`/bestellungen/${inv.order!.id}`}>{inv.order!.number}</Link></>} · ausgestellt {fmtDatum(inv.issueDate)}</>}>
        <a href={`/rechnungen/${inv.id}/pdf?download=1`} className="btn-primary">PDF herunterladen</a>
        <a href={`/rechnungen/${inv.id}/pdf`} target="_blank" rel="noopener" className="btn-secondary">PDF öffnen<span className="sr-only"> (neues Fenster)</span></a>
        <Link href="/rechnungen" className="btn-secondary">Zur Liste</Link>
      </PageHeader>
      {sp.bezahlt && <p role="status" className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-pos">Zahlungseingang gebucht (Bank bzw. Kassa an 2000 Forderungen).</p>}
      {sp.neu && <p role="status" className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-pos">Rechnung angelegt und gebucht (Forderung an Erlöse und Umsatzsteuer).</p>}
      {hinweise.length > 0 && (
        <div className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-warn"><p className="font-semibold">Pflichtangaben prüfen</p><ul className="ml-4 list-disc">{hinweise.map((h) => <li key={h}>{h}</li>)}</ul></div>
      )}
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="grid gap-5">
          <section className="card relative p-5" aria-labelledby="h-daten">
            <h2 id="h-daten" className="h2 mb-3">Daten</h2>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div className="sm:row-span-4"><dt className="text-muted">Empfänger:in</dt><dd>{[r.company, r.name, r.street, [r.zip, r.city].filter(Boolean).join(' '), r.country].filter(Boolean).map((x) => <span key={x} className="block">{x}</span>)}</dd></div>
              <div><dt className="text-muted">Status</dt><dd>{inv.kind === 'storno' ? 'Storno' : <StatusPill status={inv.status} />}</dd></div>
              {r.vatId && <div><dt className="text-muted">UID Empfänger:in</dt><dd>{r.vatId}</dd></div>}
              <div><dt className="text-muted">Leistungsdatum</dt><dd>{inv.serviceDate ? fmtDatum(inv.serviceDate) : 'wie Rechnungsdatum'}</dd></div>
              {inv.dueDate && <div><dt className="text-muted">Fällig</dt><dd>{fmtDatum(inv.dueDate)}</dd></div>}
              {inv.sentAt && <div><dt className="text-muted">Zuletzt verschickt</dt><dd>{fmtDatumZeit(inv.sentAt)}</dd></div>}
            </dl>
          </section>
          <section className="card relative" aria-labelledby="h-pos">
            <h2 id="h-pos" className="h2 px-5 pt-4">Positionen</h2>
            <table className="table mt-3">
              <thead><tr><th>Bezeichnung</th><th className="text-right">Menge</th><th className="text-right">Einzelpreis {doc.bruttoPreise ? 'brutto' : 'netto'}</th><th className="text-right">USt</th><th className="text-right">Gesamt</th></tr></thead>
              <tbody>
                {doc.items.map((it, i) => (
                  <tr key={i}><td>{it.title}</td><td className="num text-right">{it.quantity}</td><td className="text-right"><Money cents={it.unitCents} /></td><td className="num text-right">{it.vatRate} %</td><td className="text-right"><Money cents={Math.round(it.quantity * it.unitCents)} /></td></tr>
                ))}
              </tbody>
              <tfoot className="text-sm">
                {st.gruppen.map((g) => <tr key={g.rate}><td colSpan={4} className="px-4 py-1.5 text-right text-muted">USt {g.rate} % auf <Money cents={g.net} /></td><td className="px-4 text-right"><Money cents={g.vat} /></td></tr>)}
                <tr><td colSpan={4} className="px-4 py-1.5 text-right">Netto</td><td className="px-4 text-right"><Money cents={inv.netCents} /></td></tr>
                <tr className="font-semibold"><td colSpan={4} className="px-4 py-2 text-right">Brutto</td><td className="px-4 text-right"><Money cents={inv.grossCents} /></td></tr>
              </tfoot>
            </table>
            {inv.note && <p className="px-5 py-3 text-sm text-muted">{inv.note}</p>}
          </section>
          <Verlauf ziele={[{ entity: 'invoice', ids: [inv.id] }, { entity: 'invoice', ids: [...stornos.map((x) => x.id), inv.cancelsId] }]} />
          <section className="card relative overflow-hidden" aria-labelledby="h-vorschau">
            <h2 id="h-vorschau" className="h2 px-5 pt-4">Vorschau</h2>
            <iframe title={`Vorschau ${inv.number}`} src={`/rechnungen/${inv.id}/pdf?html=1`} className="mt-3 h-[640px] w-full border-t border-line bg-white" />
          </section>
        </div>
        <aside className="grid content-start gap-5" aria-label="Aktionen">
          {manuell && offen && (
            <section className="card relative p-5" aria-labelledby="h-zahlung">
              <h2 id="h-zahlung" className="h2 mb-3">Zahlung erhalten</h2>
              <Formular action={zahlungErhaltenAktion.bind(null, inv.id)} className="grid gap-3">
                <div><label className="label" htmlFor="z-datum">Zahlungsdatum</label><input id="z-datum" name="datum" type="date" required defaultValue={heute()} className="input" /></div>
                <div><label className="label" htmlFor="z-konto">Eingang auf</label><select id="z-konto" name="konto" className="input"><option value="2800">2800 Bank</option><option value="2700">2700 Kassa</option></select></div>
                <p className="text-xs text-muted">Bucht {inv.grossCents ? <Money cents={inv.grossCents} /> : null} von 2000 Forderungen auf das gewählte Konto. Bankumsätze lassen sich alternativ unter Buchhaltung → Bank zuordnen.</p>
                <Senden>Zahlung buchen</Senden>
              </Formular>
            </section>
          )}
          <section className="card relative p-5" aria-labelledby="h-senden">
            <h2 id="h-senden" className="h2 mb-3">Per E-Mail senden</h2>
            <Formular action={sendenAktion.bind(null, inv.id)} className="grid gap-3">
              <div><label className="label" htmlFor="s-an">E-Mail-Adresse</label><input id="s-an" name="an" type="email" required autoComplete="off" defaultValue={r.email ?? ''} className="input" /></div>
              <Senden className="btn-secondary">Rechnung als PDF senden</Senden>
            </Formular>
            {mails.length > 0 && <ul className="mt-3 grid gap-1 text-xs text-muted">{mails.map((m) => <li key={m.id}>{fmtDatumZeit(m.createdAt)} an {m.to} · <StatusPill status={m.status} /></li>)}</ul>}
          </section>
          {manuell && inv.kind === 'rechnung' && inv.status !== 'storniert' && (
            <section className="card relative p-5" aria-labelledby="h-storno">
              <h2 id="h-storno" className="h2 mb-2">Stornieren</h2>
              <p className="mb-3 text-sm text-muted">Erstellt eine Stornorechnung mit negativen Beträgen und bucht Erlös und Umsatzsteuer zurück. Die Rechnung selbst bleibt unverändert erhalten.{inv.status === 'bezahlt' && ' Die Rechnung ist schon bezahlt: Das Guthaben der Kund:in bleibt auf 2000 stehen, bis es zurücküberwiesen ist.'}</p>
              <Formular action={stornoAktion.bind(null, inv.id)} bestaetigen={`Rechnung ${inv.number} wirklich stornieren?`}><Senden className="btn-danger">Stornorechnung erstellen</Senden></Formular>
            </section>
          )}
          {stornos.length > 0 && <p className="card p-4 text-sm">Storniert durch {stornos.map((x) => <Link key={x.id} href={`/rechnungen/${x.id}`} className="underline underline-offset-4">{x.number}</Link>)}</p>}
          {inv.cancelsId && <p className="card p-4 text-sm"><Link href={`/rechnungen/${inv.cancelsId}`} className="underline underline-offset-4">Zur stornierten Rechnung</Link></p>}
          <section className="card relative p-5" aria-labelledby="h-buch">
            <h2 id="h-buch" className="h2 mb-2">Buchungen</h2>
            {buchungen.length ? <ul className="grid gap-1 text-sm">{buchungen.map((b) => <li key={b.id}><Link href={`/buchhaltung?nr=${b.number}`} className="underline underline-offset-4">Nr. {b.number}</Link> · {fmtBuchDatum(b.date)} · {b.text}</li>)}</ul> : <p className="text-sm text-muted">Keine Buchungen gefunden.</p>}
          </section>
        </aside>
      </div>
    </>
  );
}
