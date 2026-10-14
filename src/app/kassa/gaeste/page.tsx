// Kassa: hinterlegte Freikarten ausgeben, Tickets suchen (Name, Bestellnummer, Ticketcode) und umsetzen bzw. aufzahlen
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtTag, fmtZeit } from '@/lib/dates';
import { gaesteListe } from '@/lib/gaeste';
import { suchen } from '@/lib/einlass';
import { ausgebenAction } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Gäste & Tickets' };

const ART: Record<string, string> = { normal: 'Vollpreis', ermaessigt: 'ermäßigt', frei: 'Freikarte', rollstuhl: 'Rollstuhl' };
const STATUS: Record<string, string> = { gueltig: 'gültig', eingelassen: 'eingelassen', storniert: 'storniert' };

export default async function KassaGaeste({ searchParams }: { searchParams: Promise<{ q?: string; show?: string; fehler?: string }> }) {
  await requireRole('kassa');
  const sp = await searchParams;
  const jetzt = Date.now();
  const shows = await db.show.findMany({ where: { status: { not: 'abgesagt' }, startsAt: { gte: new Date(jetzt - 3 * 3600e3), lte: new Date(jetzt + 20 * 3600e3) } }, orderBy: { startsAt: 'asc' }, take: 6 });
  const show = shows.find((s) => s.id === sp.show) ?? shows.find((s) => s.startsAt.getTime() + (s.durationMin + 15) * 60e3 > jetzt) ?? shows[0];
  const q = (sp.q ?? '').trim().slice(0, 80);
  const [treffer, gaeste] = show ? await Promise.all([q.length >= 2 ? suchen(show.id, q) : Promise.resolve([]), gaesteListe(show.id)]) : [[], []];
  const hinterlegt = gaeste.filter((g) => g.gast.hinterlegt);
  const zurueck = `/kassa/gaeste?show=${show?.id ?? ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`;

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-5 px-4 py-5">
      <h1 className="h1">Gäste &amp; Tickets</h1>
      {sp.fehler && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-base text-neg">{sp.fehler}</p>}
      {!show ? <p className="card p-5 text-base">Heute gibt es keine Vorstellung.</p> : (
        <>
          <form className="card grid gap-3 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-end" role="search" aria-label="Gäste und Tickets suchen">
            <div>
              <label htmlFor="show" className="label text-sm">Vorstellung</label>
              <select id="show" name="show" defaultValue={show.id} className="input min-h-12">
                {shows.map((s) => <option key={s.id} value={s.id}>{fmtTag(s.startsAt)}, {fmtZeit(s.startsAt)} Uhr</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="q" className="label text-sm">Name, Firma, Bestellnummer oder Ticketcode</label>
              <input id="q" name="q" type="search" defaultValue={q} minLength={2} className="input min-h-12 text-lg" autoComplete="off" />
            </div>
            <button className="btn-primary min-h-12 text-base">Suchen</button>
          </form>

          {q.length >= 2 && (
            <section aria-labelledby="h-treffer" className="grid gap-3">
              <h2 id="h-treffer" className="h2">Treffer für „{q}“ ({treffer.length})</h2>
              {!treffer.length && <p className="card p-4 text-base">Nichts gefunden. Prüfen Sie die Schreibweise oder die Vorstellung.</p>}
              {treffer.map((o) => (
                <article key={o.id} className="card grid gap-3 p-4" aria-labelledby={`o-${o.id}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 id={`o-${o.id}`} className="text-lg font-semibold">{o.name || 'ohne Namen'}{o.firma ? ` · ${o.firma}` : ''}</h3>
                    <span className="font-mono text-sm">{o.number}</span>
                  </div>
                  {o.gast && <p className="text-sm">Gästeliste: {o.gast.grund}{o.gast.hinterlegt ? (o.gast.abgeholt ? ' · bereits abgeholt' : ' · an der Kassa hinterlegt') : ' · per E-Mail'}</p>}
                  <ul className="grid gap-2">
                    {o.tickets.map((t) => (
                      <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-paper px-3 py-2">
                        <span><strong>{t.sitz}</strong> · {t.kat === 'R' ? 'Rollstuhl' : `Kat. ${t.kat}`} · {ART[t.art] ?? t.art} · <span className={t.status === 'storniert' ? 'line-through' : ''}>{STATUS[t.status] ?? t.status}</span> <span className="font-mono text-xs">{t.code}</span></span>
                        {t.status !== 'storniert' && <Link href={`/kassa/gaeste/ticket/${t.id}`} className="btn-secondary min-h-11">Umsetzen / Aufzahlen<span className="sr-only"> {t.sitz}</span></Link>}
                      </li>
                    ))}
                  </ul>
                  {o.gast && o.tickets.some((t) => t.status !== 'storniert') && (
                    <form action={ausgebenAction}>
                      <input type="hidden" name="orderId" value={o.id} />
                      <input type="hidden" name="zurueck" value={zurueck} />
                      <button className="btn-gold min-h-12 text-base">{o.gast.abgeholt ? 'Erneut drucken' : 'Ausgeben und drucken'}<span className="sr-only"> für {o.name}</span></button>
                    </form>
                  )}
                </article>
              ))}
            </section>
          )}

          <section aria-labelledby="h-hinterlegt" className="card">
            <h2 id="h-hinterlegt" className="h2 px-4 pt-4">An der Kassa hinterlegt ({hinterlegt.filter((g) => !g.gast.abgeholtAm).length} offen von {hinterlegt.length})</h2>
            {hinterlegt.length ? (
              <table className="table mt-3">
                <thead><tr><th scope="col">Name</th><th scope="col" className="text-right">Karten</th><th scope="col">Grund</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Aktion</span></th></tr></thead>
                <tbody>
                  {hinterlegt.map((g) => (
                    <tr key={g.id}>
                      <td>{g.customer ? `${g.customer.lastName} ${g.customer.firstName}`.trim() : '–'}{g.customer?.company ? <span className="block text-xs text-muted">{g.customer.company}</span> : null}</td>
                      <td className="num text-right">{g.aktiv.length}</td>
                      <td>{g.gast.grund}</td>
                      <td>{g.gast.abgeholtAm ? `abgeholt ${fmtZeit(new Date(g.gast.abgeholtAm))}` : 'offen'}</td>
                      <td>
                        <form action={ausgebenAction}>
                          <input type="hidden" name="orderId" value={g.id} />
                          <input type="hidden" name="zurueck" value={zurueck} />
                          <button className={g.gast.abgeholtAm ? 'btn-secondary btn-sm' : 'btn-gold btn-sm'}>{g.gast.abgeholtAm ? 'Nachdruck' : 'Ausgeben'}<span className="sr-only"> für {g.customer?.lastName}</span></button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="px-4 pb-4 pt-2 text-base text-muted">Für diese Vorstellung sind keine Freikarten hinterlegt.</p>}
          </section>
        </>
      )}
    </div>
  );
}
