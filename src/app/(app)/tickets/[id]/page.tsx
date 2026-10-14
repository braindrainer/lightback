import Link from 'next/link';
import { notFound } from 'next/navigation';
import { hat, requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatum, fmtDatumZeit, fmtZeit } from '@/lib/dates';
import { stornoMoeglich } from '@/lib/orders';
import { sitzName, TICKET_UST, type Preise } from '@/lib/saal';
import { platzStatus } from '@/lib/seats';
import Umsetzen from '@/components/vorort/Umsetzen';
import { qrInhalt, qrSvg } from '@/lib/tickets';
import MiniSaalplan from '@/components/MiniSaalplan';
import { Money, PageHeader, StatusPill } from '@/components/ui';
import { Verlauf } from '@/components/Verlauf';
import { AktionKnopf, StornoDialog } from '@/components/verkauf/BestellungAktionen';
import { AktionForm, Absenden } from '@/components/verkauf/form';
import { ART_NAME, KANAL_NAME, KAT_NAME } from '@/components/verkauf/texte';
import { stornoAktion } from '../../bestellungen/actions';
import { einlassZuruecknehmenAktion, ticketSenden, umsetzenAktion } from '../actions';

export const dynamic = 'force-dynamic';

const ERGEBNIS: Record<string, string> = {
  ok: 'Eingelassen', doppelt: 'Abgelehnt: schon eingelassen', falsche_vorstellung: 'Abgelehnt: falsche Vorstellung', storniert: 'Abgelehnt: storniert',
  unbekannt: 'Abgelehnt: unbekannt', ungueltig: 'Abgelehnt: ungültig', zurueckgenommen: 'Zurückgenommen', verweigert: 'Einlass verweigert',
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const t = await db.ticket.findUnique({ where: { id: (await params).id }, select: { code: true } });
  return { title: t ? `Ticket ${t.code}` : 'Ticket' };
}

export default async function Ticket({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireRole('leitung', 'kassa', 'einlass');
  const { id } = await params;
  const t = await db.ticket.findUnique({ where: { id }, include: { show: true, order: { include: { customer: true } } } });
  if (!t) notFound();
  const scans = await db.checkIn.findMany({ where: { OR: [{ ticketId: t.id }, { code: t.code }] }, orderBy: { createdAt: 'asc' } });
  const benutzer = new Map((await db.user.findMany({ where: { id: { in: [...new Set(scans.map((s) => s.userId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));
  const svg = await qrSvg(qrInhalt(t.code, t.showId));
  const o = t.order;
  const c = o.customer;
  const netto = Math.round(t.priceCents / (1 + t.vatRate / 100));
  const leitung = hat(u, 'leitung');
  const ticketZeile = { id: t.id, label: `${sitzName(t.seatId)} (${KAT_NAME[t.kat]}, ${ART_NAME[t.art] ?? t.art})`, cents: t.priceCents };
  const fristAbgelaufen = !stornoMoeglich(t.show.startsAt);
  const umsetzbar = t.status !== 'storniert' && ['bezahlt', 'teilstorniert'].includes(o.status) && t.show.status !== 'abgesagt' && Date.now() < t.show.startsAt.getTime() + t.show.durationMin * 60e3;
  const saal = umsetzbar ? await platzStatus(t.showId) : null;

  return (
    <>
      <PageHeader title={`Ticket ${t.code}`} sub={<>{sitzName(t.seatId)} · {fmtDatum(t.show.startsAt)}, {fmtZeit(t.show.startsAt)} Uhr · Bestellung {leitung ? <Link href={`/bestellungen/${o.id}`} className="font-mono underline underline-offset-4">{o.number}</Link> : <span className="font-mono">{o.number}</span>}</>}>
        <StatusPill status={t.status} />
        <a href={`/tickets/${t.id}/druck`} target="_blank" rel="noopener" className="btn-secondary">Druckansicht<span className="sr-only"> (neues Fenster)</span></a>
        {hat(u, 'leitung', 'kassa') && t.status !== 'storniert' && c?.email && <AktionKnopf action={ticketSenden.bind(null, t.id)}>Ticket erneut senden</AktionKnopf>}
        {leitung && t.status === 'gueltig' && ['bezahlt', 'teilstorniert'].includes(o.status) && (
          <StornoDialog einzeln action={stornoAktion.bind(null, o.id)} tickets={[ticketZeile]} fristAbgelaufen={fristAbgelaufen} darfFrist={leitung} />
        )}
      </PageHeader>

      <div className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,320px)_1fr]">
        <section className="card grid content-start justify-items-center gap-3 p-5" aria-labelledby="h-qr">
          <h2 id="h-qr" className="h2 justify-self-start">QR-Code</h2>
          <div role="img" aria-label={`QR-Code für Ticket ${t.code}`} className={`w-full max-w-[280px] ${t.status === 'storniert' ? 'opacity-30' : ''}`} dangerouslySetInnerHTML={{ __html: svg.replace('<svg ', '<svg aria-hidden="true" focusable="false" width="100%" ') }} />
          <p className="font-mono text-2xl font-semibold tracking-[0.15em]">{t.code}</p>
          {t.status === 'storniert' && <p className="rounded-lg bg-red-50 px-3 py-1.5 text-sm font-semibold text-neg">Storniert – berechtigt nicht zum Einlass</p>}
          {t.status === 'eingelassen' && <p className="rounded-lg bg-sky-50 px-3 py-1.5 text-sm font-semibold text-sky-900">Bereits eingelassen{t.checkedInAt ? ` am ${fmtDatumZeit(t.checkedInAt)}` : ''}</p>}
        </section>

        <div className="grid content-start gap-6">
          <section className="card p-5" aria-labelledby="h-daten">
            <h2 id="h-daten" className="h2 mb-3">Ticket</h2>
            <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="text-muted">Platz</dt><dd className="font-semibold">{sitzName(t.seatId)}</dd>
              <dt className="text-muted">Kategorie</dt><dd>{KAT_NAME[t.kat] ?? t.kat}</dd>
              <dt className="text-muted">Ticketart</dt><dd>{ART_NAME[t.art] ?? t.art}</dd>
              <dt className="text-muted">Preis</dt><dd><Money cents={t.priceCents} /> inkl. {t.vatRate} % USt (netto <Money cents={netto} />, USt <Money cents={t.priceCents - netto} />){t.vatRate !== TICKET_UST && ' – abweichender Satz'}</dd>
              <dt className="text-muted">Vorstellung</dt><dd>{leitung ? <Link href={`/vorstellungen/${t.showId}`} className="underline underline-offset-4">{fmtDatumZeit(t.show.startsAt)} Uhr</Link> : `${fmtDatumZeit(t.show.startsAt)} Uhr`} · {t.show.title} <StatusPill status={t.show.status} /></dd>
              <dt className="text-muted">Status</dt><dd><StatusPill status={t.status} />{t.checkedInAt && <span className="ml-2">am {fmtDatumZeit(t.checkedInAt)}{t.checkedInBy ? ` von ${t.checkedInBy}` : ''}</span>}</dd>
              <dt className="text-muted">Bestellung</dt><dd>{leitung ? <Link href={`/bestellungen/${o.id}`} className="font-mono underline underline-offset-4">{o.number}</Link> : <span className="font-mono">{o.number}</span>} · {KANAL_NAME[o.channel] ?? o.channel} · <StatusPill status={o.status} /></dd>
              <dt className="text-muted">Kund:in</dt><dd>{c ? <>{leitung ? <Link href={`/kunden/${c.id}`} className="underline underline-offset-4">{`${c.firstName} ${c.lastName}`.trim() || '–'}</Link> : `${c.firstName} ${c.lastName}`.trim() || '–'}{c.email && <span className="text-muted"> · {c.email}</span>}</> : <span className="text-muted">anonym</span>}</dd>
              <dt className="text-muted">Ausgestellt</dt><dd>{fmtDatumZeit(t.createdAt)}</dd>
            </dl>
          </section>
          <section className="card p-5" aria-labelledby="h-plan">
            <h2 id="h-plan" className="h2 mb-2">Lage im Saal</h2>
            <MiniSaalplan seatId={t.seatId} className="mx-auto h-auto w-full max-w-[360px]" />
            <p className="mt-2 text-center text-sm">Markiert (roter Ring): <strong>{sitzName(t.seatId)}</strong></p>
          </section>
        </div>
      </div>

      <section className="card mb-6" aria-labelledby="h-einlass">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4"><h2 id="h-einlass" className="h2">Einlass</h2></div>
        {scans.length ? (
          <table className="table mt-3">
            <caption className="sr-only">Scans dieses Tickets, älteste zuerst</caption>
            <thead><tr><th scope="col">Zeit</th><th scope="col">Ergebnis</th><th scope="col">Person</th><th scope="col">Gerät</th><th scope="col">Erfassung</th></tr></thead>
            <tbody>{scans.map((s) => (
              <tr key={s.id}>
                <td className="whitespace-nowrap">{fmtDatumZeit(s.createdAt)}</td>
                <td>{ERGEBNIS[s.result] ?? s.result}{s.method === 'manuell' && <span className="block text-xs text-muted">ohne Scan (Namenssuche)</span>}{s.method === 'umbuchung' && <span className="block text-xs text-muted">nach Umbuchung am Einlass</span>}{s.reason && <span className="block text-xs">Grund: {s.reason}</span>}{s.showId && s.showId !== t.showId && <span className="block text-xs text-muted">bei anderer Vorstellung</span>}</td>
                <td>{s.userId ? benutzer.get(s.userId) ?? s.userId : '–'}</td>
                <td className="font-mono text-xs">{s.deviceId ?? '–'}</td>
                <td>{s.offline ? 'offline, nachgereicht' : 'online'}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <p className="px-5 pb-5 pt-3 text-sm text-muted">Noch nicht gescannt.</p>}
        {leitung && t.status === 'eingelassen' && (
          <div className="border-t border-line p-5">
            <AktionForm action={einlassZuruecknehmenAktion.bind(null, t.id)} className="grid max-w-xl gap-3">
              <div><label htmlFor="grund" className="label">Grund für die Rücknahme</label><input id="grund" name="grund" required minLength={3} maxLength={300} className="input" aria-describedby="grund-h" /><p id="grund-h" className="mt-1 text-xs text-muted">Wird im Protokoll festgehalten. Der ursprüngliche Scan bleibt sichtbar.</p></div>
              <div><Absenden className="btn-danger">Einlass zurücknehmen</Absenden></div>
            </AktionForm>
          </div>
        )}
      </section>

      {saal && (
        <section className="card mb-6 p-5" aria-labelledby="h-umsetzen">
          <h2 id="h-umsetzen" className="h2 mb-1">Umsetzen oder Tarif ändern</h2>
          <p className="mb-3 text-sm text-muted">Für Gäste vor Ort, z. B. Sichtbehinderung, Gruppe zusammensetzen oder ermäßigt ohne Nachweis. Ein Aufpreis wird an der Kassa kassiert (Kassa → Gäste &amp; Tickets).</p>
          <Umsetzen ticket={{ id: t.id, seatId: t.seatId, kat: t.kat, art: t.art, code: t.code }} status={saal} preise={t.show.prices as Preise} modus="backend" darfKulanz={leitung} action={umsetzenAktion.bind(null, t.id)} />
        </section>
      )}

      <Verlauf ziele={[{ entity: 'ticket', ids: [t.id] }, { entity: 'order', ids: [o.id] }]} titel="Verlauf (Ticket und Bestellung)" />
    </>
  );
}
