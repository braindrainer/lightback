import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { fmtDatumZeit } from '@/lib/dates';
import { kassenbericht } from '@/lib/kassa';
import { formatEur } from '@/lib/money';
import { db } from '@/lib/db';
import { schichtSchliessenAction } from '../actions';
import { kasseWaehlen } from '../daten';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Schicht' };

export default async function Schicht({ searchParams }: { searchParams: Promise<{ fehler?: string }> }) {
  await requireRole('kassa');
  const { fehler } = await searchParams;
  const { reg, schicht } = await kasseWaehlen();
  const b = schicht ? await kassenbericht(schicht.id) : null;
  const fruehere = reg ? await db.cashSession.findMany({ where: { registerId: reg.id, closedAt: { not: null } }, orderBy: { openedAt: 'desc' }, take: 10 }) : [];
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-5 px-4 py-5">
      <h1 className="h1">Schicht{reg ? ` – ${reg.name}` : ''}</h1>
      {fehler && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-base text-neg">{fehler}</p>}
      {!schicht || !b ? (
        <p className="card p-5 text-base">Keine offene Schicht. <Link href="/kassa" className="font-semibold underline">Schicht öffnen</Link></p>
      ) : (
        <>
          <section className="card grid gap-2 p-5 text-base" aria-labelledby="stand">
            <h2 id="stand" className="h2 text-lg">Aktueller Stand</h2>
            <p>Geöffnet {fmtDatumZeit(schicht.openedAt)} von {schicht.openedByName}</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
              <dt>Verkäufe</dt><dd className="num text-right">{b.anzahl}</dd>
              <dt>Umsatz</dt><dd className="num text-right">{formatEur(b.umsatz)}</dd>
              <dt>Bar</dt><dd className="num text-right">{formatEur(b.jeZahlart.bar)}</dd>
              <dt>Karte</dt><dd className="num text-right">{formatEur(b.jeZahlart.karte)}</dd>
              <dt>Wechselgeld</dt><dd className="num text-right">{formatEur(schicht.floatCents)}</dd>
              <dt className="font-semibold">Soll in der Lade</dt><dd className="num text-right font-semibold">{formatEur(b.erwartet)}</dd>
            </dl>
            <Link href={`/kassa/bericht/${schicht.id}?druck=1`} prefetch={false} className="btn-secondary mt-2 min-h-12 text-base">X-Bericht drucken</Link>
          </section>
          <form action={schichtSchliessenAction} className="card grid gap-4 p-5">
            <h2 className="h2 text-lg">Schicht schließen</h2>
            <input type="hidden" name="sessionId" value={schicht.id} />
            <div>
              <label htmlFor="gezaehlt" className="label text-sm">Gezählter Bargeldbestand (€)</label>
              <input id="gezaehlt" name="gezaehlt" inputMode="decimal" required autoComplete="off" className="input min-h-14 text-2xl" aria-describedby="gz-hinweis" />
              <p id="gz-hinweis" className="mt-1 text-sm text-muted">Inklusive Wechselgeld. Die Differenz zum Soll steht im Z-Bericht.</p>
            </div>
            <div>
              <label htmlFor="notiz" className="label text-sm">Notiz (optional)</label>
              <input id="notiz" name="notiz" className="input min-h-12" />
            </div>
            <button className="btn-primary min-h-14 text-lg">Schicht schließen und Z-Bericht drucken</button>
          </form>
        </>
      )}
      {fruehere.length > 0 && (
        <section className="card" aria-labelledby="frueher">
          <h2 id="frueher" className="h2 px-5 pt-4">Frühere Schichten</h2>
          <table className="table mt-2">
            <thead><tr><th>Geöffnet</th><th>Geschlossen</th><th className="text-right">Differenz</th><th><span className="sr-only">Bericht</span></th></tr></thead>
            <tbody>
              {fruehere.map((f) => {
                const d = (f.countedCents ?? 0) - (f.expectedCents ?? 0);
                return (
                  <tr key={f.id}>
                    <td>{fmtDatumZeit(f.openedAt)}<br /><span className="text-muted">{f.openedByName}</span></td>
                    <td>{fmtDatumZeit(f.closedAt!)}</td>
                    <td className={`num text-right ${d < 0 ? 'text-neg' : d > 0 ? 'text-pos' : ''}`}>{formatEur(d, { sign: true })}</td>
                    <td><Link href={`/kassa/bericht/${f.id}`} prefetch={false} className="underline">Z-Bericht</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
