import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatum, fmtDatumZeit, wienTag, wienZuUtc } from '@/lib/dates';
import { ZAHLART_NAME } from '@/lib/kassa';
import { formatEur } from '@/lib/money';
import { BELEGART_NAME, BELEGARTEN, demoPruefen, verkettung, type Belegart } from '@/lib/rksv';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Kassenbuch' };

export default async function Kassenbuch({ searchParams }: { searchParams: Promise<{ kasse?: string; von?: string; bis?: string; typ?: string }> }) {
  await requireRole('admin');
  const q = await searchParams;
  const kassen = await db.register.findMany({ orderBy: { createdAt: 'asc' } });
  const reg = kassen.find((k) => k.id === q.kasse) ?? kassen[0];
  const heute = wienTag(new Date());
  const von = /^\d{4}-\d{2}-\d{2}$/.test(q.von ?? '') ? q.von! : heute.slice(0, 8) + '01';
  const bis = /^\d{4}-\d{2}-\d{2}$/.test(q.bis ?? '') ? q.bis! : heute;
  const typ = BELEGARTEN.includes(q.typ as Belegart) ? (q.typ as Belegart) : undefined;
  if (!reg) return <div className="px-4 py-5"><h1 className="h1">Kassenbuch</h1><p className="mt-3">Keine Kasse eingerichtet.</p></div>;

  // Verkettung und Signaturen der ganzen Kasse prüfen (Belegnummern lückenlos, Kette geschlossen)
  const alle = await db.receipt.findMany({ where: { registerId: reg.id }, orderBy: { number: 'asc' }, select: { id: true, number: true, prevSigHash: true, signature: true, signerFailed: true } });
  const pub = (reg.signerConfig as { publicKey?: string }).publicKey;
  const fehlerKette = new Set<string>();
  let sigOk = 0;
  alle.forEach((r, i) => {
    const vor = i ? alle[i - 1] : null;
    if (r.number !== i + 1 || r.prevSigHash !== verkettung(vor?.signature ?? null, reg.kassenId)) fehlerKette.add(r.id);
    if (reg.signer === 'demo' && pub && !r.signerFailed && demoPruefen(r.signature, pub)) sigOk++;
  });

  const belege = await db.receipt.findMany({
    where: { registerId: reg.id, createdAt: { gte: wienZuUtc(von, '00:00'), lt: new Date(wienZuUtc(bis, '00:00').getTime() + 864e5) }, ...(typ ? { type: typ } : {}) },
    orderBy: { number: 'asc' },
  });
  const tage = new Map<string, { anzahl: number; summe: number; bar: number; karte: number; training: number }>();
  for (const b of belege) {
    const t = wienTag(b.createdAt);
    const x = tage.get(t) ?? { anzahl: 0, summe: 0, bar: 0, karte: 0, training: 0 };
    if (b.type === 'standard' || b.type === 'storno') {
      x.anzahl++;
      x.summe += b.totalCents;
      if (b.payment === 'bar') x.bar += b.totalCents; else x.karte += b.totalCents;
    }
    if (b.type === 'training') x.training += b.totalCents;
    tage.set(t, x);
  }
  const ges = [...tage.values()].reduce((a, t) => ({ summe: a.summe + t.summe, bar: a.bar + t.bar, karte: a.karte + t.karte }), { summe: 0, bar: 0, karte: 0 });

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-5 px-3 py-5 sm:px-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="h1">Kassenbuch</h1>
        <a href={`/api/kassa/dep?registerId=${reg.id}`} className="btn-secondary min-h-12">DEP-Export</a>
      </div>
      <form className="card grid gap-3 p-4 sm:grid-cols-[1.5fr_1fr_1fr_1fr_auto] sm:items-end">
        <div><label htmlFor="kasse" className="label">Kasse</label><select id="kasse" name="kasse" defaultValue={reg.id} className="input min-h-12">{kassen.map((k) => <option key={k.id} value={k.id}>{k.name} ({k.kassenId})</option>)}</select></div>
        <div><label htmlFor="von" className="label">Von</label><input id="von" name="von" type="date" defaultValue={von} className="input min-h-12" /></div>
        <div><label htmlFor="bis" className="label">Bis</label><input id="bis" name="bis" type="date" defaultValue={bis} className="input min-h-12" /></div>
        <div><label htmlFor="typ" className="label">Belegart</label><select id="typ" name="typ" defaultValue={typ ?? ''} className="input min-h-12"><option value="">alle</option>{BELEGARTEN.map((t) => <option key={t} value={t}>{BELEGART_NAME[t]}</option>)}</select></div>
        <button className="btn-primary min-h-12">Anzeigen</button>
      </form>

      <p role="status" className={`rounded-lg px-3 py-2 text-base ${fehlerKette.size ? 'bg-red-50 text-neg' : 'bg-emerald-50 text-emerald-950'}`}>
        {alle.length} Belege gesamt · {fehlerKette.size ? `${fehlerKette.size} Belege mit Fehler in Nummerierung oder Verkettung!` : 'Belegnummern lückenlos, Signaturkette geschlossen.'}
        {reg.signer === 'demo' && ` Demo-Signaturen gültig: ${sigOk} von ${alle.filter((a) => !a.signerFailed).length}.`}
      </p>

      <section className="card" aria-labelledby="tage" tabIndex={0}>
        <h2 id="tage" className="h2 px-4 pt-4">Summen je Tag</h2>
        <table className="table mt-2">
          <thead><tr><th>Tag</th><th className="text-right">Belege</th><th className="text-right">Bar</th><th className="text-right">Karte</th><th className="text-right">Umsatz</th><th className="text-right">Training</th></tr></thead>
          <tbody>
            {[...tage.entries()].map(([t, x]) => (
              <tr key={t}><td>{fmtDatum(`${t}T12:00:00Z`)}</td><td className="num text-right">{x.anzahl}</td><td className="num text-right">{formatEur(x.bar)}</td><td className="num text-right">{formatEur(x.karte)}</td><td className="num text-right font-semibold">{formatEur(x.summe)}</td><td className="num text-right text-muted">{formatEur(x.training)}</td></tr>
            ))}
            <tr><td className="font-semibold">Gesamt</td><td /><td className="num text-right font-semibold">{formatEur(ges.bar)}</td><td className="num text-right font-semibold">{formatEur(ges.karte)}</td><td className="num text-right font-semibold">{formatEur(ges.summe)}</td><td /></tr>
          </tbody>
        </table>
      </section>

      <section className="card" aria-labelledby="liste">
        <h2 id="liste" className="h2 px-4 pt-4">Belege</h2>
        <table className="table mt-2">
          <thead><tr><th>Nr.</th><th>Zeit</th><th>Art</th><th>Kassier:in</th><th>Zahlung</th><th className="text-right">Betrag</th><th>Signatur</th></tr></thead>
          <tbody>
            {belege.map((b) => (
              <tr key={b.id}>
                <td><Link href={`/kassa/beleg/${b.id}`} prefetch={false} className="underline">{b.number}</Link></td>
                <td className="whitespace-nowrap">{fmtDatumZeit(b.createdAt)}</td>
                <td>{BELEGART_NAME[b.type as Belegart] ?? b.type}</td>
                <td>{b.cashierName ?? '–'}</td>
                <td>{b.totalCents || b.type === 'standard' ? (ZAHLART_NAME[b.payment] ?? b.payment) : '–'}</td>
                <td className="num text-right">{formatEur(b.totalCents)}</td>
                <td>{fehlerKette.has(b.id) ? <span className="pill bg-red-50 text-neg">Kette fehlerhaft</span> : b.signerFailed ? <span className="pill bg-amber-50 text-warn">ausgefallen</span> : <span className="pill bg-emerald-50 text-emerald-900">signiert</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!belege.length && <p className="px-4 py-6 text-sm text-muted">Keine Belege im Zeitraum.</p>}
      </section>
    </div>
  );
}
