import Link from 'next/link';
import { notFound } from 'next/navigation';
import { hat, requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatum, fmtDatumZeit, fmtZeit } from '@/lib/dates';
import { stornoMoeglich } from '@/lib/orders';
import { sitzName, TICKET_UST, type Preise } from '@/lib/saal';
import { platzStatus } from '@/lib/seats';
import Umsetzen from '@/components/vorort/Umsetzen';
import MiniSaalplan from '@/components/MiniSaalplan';
import TicketKarte from '@/components/tickets/TicketKarte';
import { Abschnitt, DetailKopf, Empty, Feldliste, Icon, Money, StatusPill } from '@/components/ui';
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
      <DetailKopf
        krumen={leitung ? [{ label: 'Verkauf' }, { label: 'Bestellungen', href: '/bestellungen' }, { label: o.number, href: `/bestellungen/${o.id}` }, { label: `Ticket ${t.code}` }] : [{ label: 'Ticket' }, { label: t.code }]}
        titel={t.code} mono status={<StatusPill status={t.status} />}
        untertitel={<>{sitzName(t.seatId)} · {fmtDatum(t.show.startsAt)}, {fmtZeit(t.show.startsAt)} Uhr · {t.show.title}</>}
        aktionen={<>
          <a href={`/tickets/${t.id}/druck`} target="_blank" rel="noopener" className="btn-secondary"><Icon name="druck" className="h-4 w-4" />Druckansicht<span className="sr-only"> (neues Fenster)</span></a>
          {hat(u, 'leitung', 'kassa') && t.status !== 'storniert' && c?.email && <AktionKnopf leise action={ticketSenden.bind(null, t.id)}><Icon name="mail" className="h-4 w-4" />Ticket erneut senden</AktionKnopf>}
          {leitung && t.status === 'gueltig' && ['bezahlt', 'teilstorniert'].includes(o.status) && (
            <StornoDialog einzeln action={stornoAktion.bind(null, o.id)} tickets={[ticketZeile]} fristAbgelaufen={fristAbgelaufen} darfFrist={leitung} />
          )}
        </>}
        fakten={[
          { label: 'Platz', wert: sitzName(t.seatId) },
          { label: 'Kategorie · Art', wert: `${KAT_NAME[t.kat] ?? t.kat} · ${ART_NAME[t.art] ?? t.art}` },
          { label: 'Preis', wert: <Money cents={t.priceCents} /> },
          { label: 'Einlass', wert: t.checkedInAt ? fmtDatumZeit(t.checkedInAt) : <span className="font-normal text-muted">noch nicht</span> },
        ]}
      />

      <div className="mb-6 grid items-start gap-6 lg:grid-cols-[minmax(0,320px)_1fr]">
        <TicketKarte ticketId={t.id} orderId={t.orderId} />

        <div className="grid content-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
          <Abschnitt id="h-daten" titel="Ticket">
            <Feldliste spalten={2} felder={[
              { label: 'Code', wert: t.code, mono: true, kopieren: t.code },
              { label: 'Status', wert: <><StatusPill status={t.status} />{t.checkedInAt && <span className="block text-sm text-muted">am {fmtDatumZeit(t.checkedInAt)}{t.checkedInBy ? ` von ${t.checkedInBy}` : ''}</span>}</> },
              { label: 'Preis', wert: <><Money cents={t.priceCents} /> <span className="text-sm text-muted">inkl. {t.vatRate} % USt (netto <Money cents={netto} />){t.vatRate !== TICKET_UST && ' – abweichender Satz'}</span></>, breit: true },
              { label: 'Vorstellung', wert: <>{leitung ? <Link href={`/vorstellungen/${t.showId}`} className="link">{fmtDatumZeit(t.show.startsAt)} Uhr</Link> : `${fmtDatumZeit(t.show.startsAt)} Uhr`} <StatusPill status={t.show.status} /></>, breit: true },
              { label: 'Bestellung', wert: <>{leitung ? <Link href={`/bestellungen/${o.id}`} className="link font-mono">{o.number}</Link> : <span className="font-mono">{o.number}</span>} <span className="text-sm text-muted">· {KANAL_NAME[o.channel] ?? o.channel}</span></> },
              { label: 'Kund:in', wert: c ? (leitung ? <Link href={`/kunden/${c.id}`} className="link">{`${c.firstName} ${c.lastName}`.trim() || '–'}</Link> : `${c.firstName} ${c.lastName}`.trim() || '–') : <span className="text-muted">anonym</span> },
              c?.email && { label: 'E-Mail', wert: c.email, kopieren: c.email, breit: true },
              { label: 'Ausgestellt', wert: fmtDatumZeit(t.createdAt) },
            ]} />
          </Abschnitt>
          <Abschnitt id="h-plan" titel="Lage im Saal">
            <MiniSaalplan seatId={t.seatId} className="mx-auto h-auto w-full max-w-[360px]" />
            <p className="mt-2 text-center text-sm">Markiert (roter Ring): <strong>{sitzName(t.seatId)}</strong></p>
          </Abschnitt>
        </div>
      </div>

      <section className="card mb-6" aria-labelledby="h-einlass">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-3 pt-4"><h2 id="h-einlass" className="h2">Einlass</h2></div>
        {scans.length ? (
          <table className="table rtab">
            <caption className="sr-only">Scans dieses Tickets, älteste zuerst</caption>
            <thead><tr><th scope="col">Zeit</th><th scope="col">Ergebnis</th><th scope="col">Person</th><th scope="col">Gerät</th><th scope="col">Erfassung</th></tr></thead>
            <tbody>{scans.map((s) => (
              <tr key={s.id}>
                <td className="rtab-kopf whitespace-nowrap">{fmtDatumZeit(s.createdAt)}</td>
                <td data-label="Ergebnis">{ERGEBNIS[s.result] ?? s.result}{s.method === 'manuell' && <span className="block text-xs text-muted">ohne Scan (Namenssuche)</span>}{s.method === 'umbuchung' && <span className="block text-xs text-muted">nach Umbuchung am Einlass</span>}{s.reason && <span className="block text-xs">Grund: {s.reason}</span>}{s.showId && s.showId !== t.showId && <span className="block text-xs text-muted">bei anderer Vorstellung</span>}</td>
                <td data-label="Person">{s.userId ? benutzer.get(s.userId) ?? s.userId : '–'}</td>
                <td data-label="Gerät" className="font-mono text-xs">{s.deviceId ?? '–'}</td>
                <td data-label="Erfassung">{s.offline ? 'offline, nachgereicht' : 'online'}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <Empty icon="scan">Noch nicht gescannt.</Empty>}
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
