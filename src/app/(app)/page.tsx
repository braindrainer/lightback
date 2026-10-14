import Link from 'next/link';
import { hat, requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatumZeit, fmtTag, fmtZeit, TZ, wienTag, wienZuUtc } from '@/lib/dates';
import { formatEur } from '@/lib/money';
import { KAPAZITAET } from '@/lib/saal';
import { KANAL_NAME, tagPlus, tagesreihe, zeitraumAus } from '@/lib/statistik';
import { Balken } from '@/components/system/Balken';
import { Auslastung, type ShowBalken } from '@/components/uebersicht/Auslastung';
import { Ring } from '@/components/uebersicht/Ring';
import { Icon, StatusPill } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Übersicht' };

const KANAL_FARBE: Record<string, string> = { web: '#8a6a1f', telefon: '#2a6fae', abendkasse: '#6a58d8', partner: '#1d7a47' };

function Kennzahl({ label, wert, hinweis, vergleich }: { label: string; wert: string; hinweis?: string; vergleich?: { jetzt: number; vorher: number; text: string } }) {
  const d = vergleich ? vergleich.jetzt - vergleich.vorher : 0;
  const pct = vergleich && vergleich.vorher ? Math.round((d / vergleich.vorher) * 100) : null;
  return (
    <div className="card p-4 md:p-5">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="num mt-1.5 text-2xl font-semibold tracking-tight">{wert}</p>
      {vergleich && (
        <p className="mt-1 flex items-center gap-1.5 text-xs">
          <span className={`pill ${d > 0 ? 'bg-emerald-50 text-pos' : d < 0 ? 'bg-red-50 text-neg' : 'bg-gray-100 text-gray-700'}`}>{d > 0 ? '▲' : d < 0 ? '▼' : '='} {pct == null ? '–' : `${Math.abs(pct)} %`}</span>
          <span className="text-muted">{vergleich.text}</span>
        </p>
      )}
      {hinweis && <p className="mt-1 text-xs text-muted">{hinweis}</p>}
    </div>
  );
}

export default async function Uebersicht() {
  const u = await requireRole();
  const jetzt = new Date();
  const heute = wienTag(jetzt);
  const tagStart = wienZuUtc(heute, '00:00');
  const morgenStart = wienZuUtc(tagPlus(heute, 1), '00:00');
  const z30 = zeitraumAus({ von: tagPlus(heute, -29), bis: heute });
  const in14 = wienZuUtc(tagPlus(heute, 14), '00:00');
  const verkauf = hat(u, 'leitung', 'buchhaltung');
  const finanzen = hat(u, 'buchhaltung');

  const [reihe, shows, kanaele, letzte, offen, mailFehler, belegeFaellig, kassaHeute, schichten] = await Promise.all([
    tagesreihe(z30),
    db.show.findMany({ where: { startsAt: { gte: new Date(jetzt.getTime() - 45 * 60e3), lt: in14 }, status: { not: 'abgesagt' } }, orderBy: { startsAt: 'asc' }, take: 28, select: { id: true, startsAt: true } }),
    db.order.groupBy({ by: ['channel'], where: { paidAt: { gte: z30.fromUtc } }, _sum: { totalCents: true } }),
    db.order.findMany({ where: { status: { not: 'offen' } }, orderBy: { createdAt: 'desc' }, take: 8, include: { customer: true, show: { select: { startsAt: true } }, _count: { select: { tickets: true } } } }),
    db.order.count({ where: { status: 'offen', createdAt: { lt: new Date(jetzt.getTime() - 30 * 60e3) } } }),
    db.emailLog.count({ where: { status: 'fehler', createdAt: { gte: new Date(jetzt.getTime() - 7 * 864e5) } } }),
    db.expense.count({ where: { status: 'offen', dueDate: { lte: new Date(tagPlus(heute, 7)) } } }),
    db.receipt.aggregate({ where: { createdAt: { gte: tagStart, lt: morgenStart }, type: { in: ['standard', 'storno'] } }, _sum: { totalCents: true }, _count: true }),
    db.cashSession.count({ where: { closedAt: null } }),
  ]);

  // Auslastung: verkaufte Tickets und Sperren je Vorstellung in zwei gruppierten Abfragen
  const ids = shows.map((s) => s.id);
  const [tickets, locks] = await Promise.all([
    db.ticket.groupBy({ by: ['showId', 'status'], where: { showId: { in: ids }, status: { not: 'storniert' } }, _count: true }),
    db.seatLock.groupBy({ by: ['showId', 'kind'], where: { showId: { in: ids }, kind: { in: ['hold', 'block'] }, OR: [{ expiresAt: null }, { expiresAt: { gt: jetzt } }] }, _count: true }),
  ]);
  const startVon = new Map(shows.map((s) => [s.id, s.startsAt]));
  const balken: ShowBalken[] = shows.map((s) => {
    const t = tickets.filter((x) => x.showId === s.id);
    const l = locks.filter((x) => x.showId === s.id);
    const tag = new Intl.DateTimeFormat('de-AT', { timeZone: TZ, day: 'numeric', month: 'numeric' }).format(s.startsAt);
    return {
      id: s.id, label: `${fmtTag(s.startsAt)}, ${fmtZeit(s.startsAt)}`, kurz: `${tag} ${fmtZeit(s.startsAt)}`,
      verkauft: t.reduce((n, x) => n + x._count, 0), eingelassen: t.find((x) => x.status === 'eingelassen')?._count ?? 0,
      reserviert: l.find((x) => x.kind === 'hold')?._count ?? 0, gesperrt: l.find((x) => x.kind === 'block')?._count ?? 0, kapazitaet: KAPAZITAET,
    };
  });
  const heuteShows = balken.filter((b) => wienTag(startVon.get(b.id)!) === heute);

  const umsatzHeute = reihe.at(-1)?.umsatz ?? 0;
  const umsatzGestern = reihe.at(-2)?.umsatz ?? 0;
  const sieben = reihe.slice(-7).reduce((n, r) => n + r.umsatz, 0);
  const siebenVorher = reihe.slice(-14, -7).reduce((n, r) => n + r.umsatz, 0);
  const grenze7 = wienZuUtc(tagPlus(heute, 7), '00:00');
  const naechste7 = balken.filter((b) => startVon.get(b.id)! < grenze7);
  const auslastung7 = naechste7.length ? Math.round((naechste7.reduce((n, b) => n + b.verkauft, 0) / (naechste7.length * KAPAZITAET)) * 100) : 0;

  const [jj, mm] = heute.split('-').map(Number);
  const vormonat = new Date(Date.UTC(jj, mm - 2, 1)).toISOString().slice(0, 7);
  const uvaGebucht = finanzen ? !!(await db.journalEntry.findFirst({ where: { source: 'uva', sourceId: vormonat }, select: { id: true } })) : true;

  const hinweise = [
    offen > 0 && { text: `${offen} unbezahlte Bestellung${offen === 1 ? '' : 'en'} älter als 30 Minuten`, href: '/bestellungen?status=offen' },
    mailFehler > 0 && { text: `${mailFehler} E-Mail${mailFehler === 1 ? ' konnte' : 's konnten'} nicht verschickt werden`, href: '/emails?status=fehler' },
    finanzen && belegeFaellig > 0 && { text: `${belegeFaellig} Eingangsrechnung${belegeFaellig === 1 ? '' : 'en'} in den nächsten 7 Tagen fällig`, href: '/buchhaltung/belege' },
    finanzen && !uvaGebucht && { text: `UVA ${vormonat.slice(5)}/${vormonat.slice(0, 4)} noch nicht gebucht`, href: `/buchhaltung/uva?monat=${vormonat}` },
    schichten > 0 && hat(u, 'kassa') && { text: `${schichten} Kassaschicht${schichten === 1 ? '' : 'en'} offen`, href: '/kassa/schicht' },
  ].filter(Boolean) as { text: string; href: string }[];

  const schnell = [
    hat(u, 'leitung', 'kassa') && { href: '/bestellungen/neu', label: 'Telefonverkauf' },
    hat(u, 'kassa') && { href: '/kassa', label: 'Kassa öffnen' },
    hat(u, 'einlass') && { href: '/einlass', label: 'Einlass-Scanner' },
    hat(u, 'leitung') && { href: '/vorstellungen/neu', label: 'Vorstellungen anlegen' },
    finanzen && { href: '/buchhaltung/belege', label: 'Beleg erfassen' },
  ].filter(Boolean) as { href: string; label: string }[];

  const datum = new Intl.DateTimeFormat('de-AT', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(jetzt);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{datum}</p>
          <h1 className="titel">Guten Tag, {u.name.split(' ')[0]}</h1>
        </div>
        {schnell.length > 0 && (
          <nav aria-label="Schnellzugriff" className="flex flex-wrap gap-2">
            {schnell.map((s, i) => <Link key={s.href} href={s.href} className={i === 0 ? 'btn-primary' : 'btn-secondary'}>{s.label}</Link>)}
          </nav>
        )}
      </div>

      {hinweise.length > 0 && (
        <section aria-labelledby="h-hinweise" className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
          <h2 id="h-hinweise" className="flex items-center gap-2 text-sm font-semibold text-warn"><Icon name="warnung" className="h-4 w-4" />Bitte ansehen</h2>
          <ul className="mt-1.5 grid gap-1 text-sm">
            {hinweise.map((h) => <li key={h.href}><Link href={h.href} className="text-ink underline underline-offset-4 hover:text-accent-deep">{h.text}</Link></li>)}
          </ul>
        </section>
      )}

      {verkauf && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kennzahl label="Ticketumsatz heute" wert={formatEur(umsatzHeute)} vergleich={{ jetzt: umsatzHeute, vorher: umsatzGestern, text: `gestern ${formatEur(umsatzGestern)}` }} />
          <Kennzahl label="Ticketumsatz 7 Tage" wert={formatEur(sieben)} vergleich={{ jetzt: sieben, vorher: siebenVorher, text: 'vs. Vorwoche' }} />
          <Kennzahl label="Auslastung nächste 7 Tage" wert={`${auslastung7} %`} hinweis={`${naechste7.length} Vorstellungen à ${KAPAZITAET} Plätze`} />
          <Kennzahl label="Kassa heute" wert={formatEur(kassaHeute._sum.totalCents ?? 0)} hinweis={`${kassaHeute._count} Belege`} />
        </div>
      )}

      {heuteShows.length > 0 && (
        <section aria-labelledby="h-heute" className="card mt-6 p-5">
          <h2 id="h-heute" className="h2">Heute</h2>
          <ul className="mt-3 grid gap-4 md:grid-cols-2">
            {heuteShows.map((s) => {
              const quote = s.verkauft ? Math.round((s.eingelassen / s.verkauft) * 100) : 0;
              return (
                <li key={s.id} className="rounded-lg border border-line p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <Link href={`/vorstellungen/${s.id}`} className="text-lg font-semibold underline-offset-4 hover:underline">{fmtZeit(startVon.get(s.id)!)} Uhr</Link>
                    <span className="num text-sm text-muted">{s.verkauft} / {s.kapazitaet} verkauft</span>
                  </div>
                  <p className="mt-3 text-xs font-medium text-muted">Einlass {s.eingelassen} von {s.verkauft} ({quote} %)</p>
                  <div className="mt-1 h-2.5 rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={s.verkauft || 1} aria-valuenow={s.eingelassen} aria-label={`Einlass ${fmtZeit(startVon.get(s.id)!)} Uhr`}>
                    <div className="h-2.5 rounded-full bg-pos" style={{ width: `${quote}%` }} />
                  </div>
                  <p className="mt-3 text-xs font-medium text-muted">Auslastung {Math.round((s.verkauft / s.kapazitaet) * 100)} %</p>
                  <div className="mt-1 h-2.5 rounded-full bg-line" aria-hidden="true"><div className="h-2.5 rounded-full bg-kat1" style={{ width: `${(s.verkauft / s.kapazitaet) * 100}%` }} /></div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {verkauf && (
        <div className="mt-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
          <section aria-labelledby="h-umsatz" className="card p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="h-umsatz" className="h2">Ticketumsatz der letzten 30 Tage</h2>
              <Link href="/statistik" className="text-sm text-accent-deep underline underline-offset-4">Zur Statistik</Link>
            </div>
            <div className="mt-3">
              <Balken id="u30" titel="Ticketumsatz der letzten 30 Tage" punkte={reihe.map((r) => ({ label: r.tag.split('-').reverse().join('.'), kurz: `${Number(r.tag.slice(8))}.${Number(r.tag.slice(5, 7))}.`, wert: r.umsatz, tickets: r.tickets }))} />
            </div>
          </section>
          <section aria-labelledby="h-kanal" className="card p-5">
            <h2 id="h-kanal" className="h2">Verkaufskanäle (30 Tage)</h2>
            <div className="mt-4">
              <Ring titel="Umsatz je Verkaufskanal" teile={['web', 'telefon', 'abendkasse', 'partner'].map((k) => ({ name: KANAL_NAME[k], wert: kanaele.find((x) => x.channel === k)?._sum.totalCents ?? 0, farbe: KANAL_FARBE[k] }))} />
            </div>
          </section>
        </div>
      )}

      {verkauf && (
        <section aria-labelledby="h-ausl" className="card mt-6 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="h-ausl" className="h2">Auslastung der nächsten 14 Tage</h2>
            <Link href="/vorstellungen" className="text-sm text-accent-deep underline underline-offset-4">Alle Vorstellungen</Link>
          </div>
          <div className="mt-3">{balken.length ? <Auslastung shows={balken} /> : <p className="text-sm text-muted">Keine Vorstellungen in den nächsten 14 Tagen.</p>}</div>
        </section>
      )}

      {hat(u, 'leitung') && (
        <section aria-labelledby="h-letzte" className="card mt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4">
            <h2 id="h-letzte" className="h2">Letzte Bestellungen</h2>
            <Link href="/bestellungen" className="text-sm text-accent-deep underline underline-offset-4">Alle Bestellungen</Link>
          </div>
          <table className="table rtab mt-3">
            <thead><tr><th scope="col">Bestellung</th><th scope="col">Kund:in</th><th scope="col">Vorstellung</th><th scope="col">Kanal</th><th scope="col">Status</th><th scope="col" className="text-right">Betrag</th></tr></thead>
            <tbody>
              {letzte.map((o) => (
                <tr key={o.id}>
                  <td className="rtab-kopf"><Link href={`/bestellungen/${o.id}`} className="font-mono text-[13px] font-semibold underline-offset-4 hover:underline">{o.number}</Link><div className="text-xs text-muted">{fmtDatumZeit(o.createdAt)}</div></td>
                  <td data-label="Kund:in">{o.customer ? `${o.customer.firstName} ${o.customer.lastName}` : <span className="text-muted">–</span>}</td>
                  <td data-label="Vorstellung" className="whitespace-nowrap"><span>{fmtTag(o.show.startsAt)}, {fmtZeit(o.show.startsAt)}<span className="block text-xs text-muted">{o._count.tickets} Tickets</span></span></td>
                  <td data-label="Kanal">{KANAL_NAME[o.channel] ?? o.channel}</td>
                  <td data-label="Status"><StatusPill status={o.status} /></td>
                  <td data-label="Betrag" className="num text-right">{formatEur(o.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
