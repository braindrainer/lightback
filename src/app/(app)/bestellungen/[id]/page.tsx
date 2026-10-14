import Link from 'next/link';
import { notFound } from 'next/navigation';
import { hat, requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatumZeit } from '@/lib/dates';
import { stornoMoeglich } from '@/lib/orders';
import { sitzName } from '@/lib/saal';
import { Empty, Money, PageHeader, StatusPill } from '@/components/ui';
import { Verlauf } from '@/components/Verlauf';
import RechnungModal from '@/components/finanzen/RechnungModal';
import TicketBlock from '@/components/tickets/TicketBlock';
import { AktionForm, Absenden } from '@/components/verkauf/form';
import { AktionKnopf, KundeFormular, NotizFormular, StornoDialog, UmbuchungDialog, ZahlungErhalten } from '@/components/verkauf/BestellungAktionen';
import { showOptionen } from '@/components/verkauf/showOptionen';
import { ART_NAME, GRUND_NAME, KANAL_NAME, KAT_NAME, METHODE_NAME, ZAHLART_NAME } from '@/components/verkauf/texte';
import { kundeSpeichern, notizSpeichern, rechnungErstellenAktion, rechnungSendenAktion, reservierungAufheben, stornoAktion, ticketsSenden, umbuchungAktion, zahlungErhalten } from '../actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const o = await db.order.findUnique({ where: { id: (await params).id }, select: { number: true } });
  return { title: o ? `Bestellung ${o.number}` : 'Bestellung' };
}

function Abschnitt({ id, titel, children, aktion }: { id: string; titel: string; children: React.ReactNode; aktion?: React.ReactNode }) {
  return (
    <section className="card mb-6" aria-labelledby={id}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4"><h2 id={id} className="h2">{titel}</h2>{aktion}</div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default async function Bestellung({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireRole('leitung');
  const { id } = await params;
  const o = await db.order.findUnique({
    where: { id },
    include: {
      show: true, customer: true, partner: { select: { name: true } },
      tickets: { orderBy: { seatId: 'asc' } }, payments: { orderBy: { createdAt: 'asc' } }, refunds: { orderBy: { createdAt: 'asc' } },
      invoices: { orderBy: { issueDate: 'asc' } }, emails: { orderBy: { createdAt: 'desc' }, select: { id: true, to: true, subject: true, status: true, createdAt: true, error: true } },
      redemptions: { include: { voucher: { select: { id: true, code: true } } } },
    },
  });
  if (!o) notFound();
  const [ersteller, umgebuchtAuf, umgebuchtVon, gutscheine, hold] = await Promise.all([
    o.createdById ? db.user.findUnique({ where: { id: o.createdById }, select: { name: true } }) : null,
    db.order.findMany({ where: { rebookedFromId: o.id }, select: { id: true, number: true } }),
    o.rebookedFromId ? db.order.findUnique({ where: { id: o.rebookedFromId }, select: { id: true, number: true } }) : null,
    db.voucher.findMany({ where: { id: { in: o.refunds.map((r) => r.voucherId).filter((x): x is string => !!x) } }, select: { id: true, code: true, remainingCents: true } }),
    o.holdId ? db.hold.findUnique({ where: { id: o.holdId } }) : null,
  ]);
  const gueltig = o.tickets.filter((t) => t.status === 'gueltig');
  const zeilen = gueltig.map((t) => ({ id: t.id, label: `${sitzName(t.seatId)} (${KAT_NAME[t.kat]}, ${ART_NAME[t.art] ?? t.art})`, cents: t.priceCents }));
  const stornierbar = ['bezahlt', 'teilstorniert'].includes(o.status) && gueltig.length > 0;
  const fristAbgelaufen = !stornoMoeglich(o.show.startsAt);
  const darfFrist = hat(u, 'leitung');
  const shows = stornierbar ? await showOptionen() : [];
  const c = o.customer;
  const gv = new Map(gutscheine.map((g) => [g.id, g]));
  const offen = o.totalCents - o.voucherCents;
  const darfRechnung = hat(u, 'leitung', 'buchhaltung');
  const buchhaltung = hat(u, 'buchhaltung');
  const rechnungFehlt = ['bezahlt', 'teilstorniert'].includes(o.status) && !o.invoices.some((i) => i.kind === 'rechnung');

  return (
    <>
      <PageHeader title={`Bestellung ${o.number}`} sub={<><Link href="/bestellungen" className="underline underline-offset-4">Alle Bestellungen</Link> · {KANAL_NAME[o.channel] ?? o.channel}{o.partner ? ` (${o.partner.name}${o.partnerRef ? `, ${o.partnerRef}` : ''})` : ''} · bestellt {fmtDatumZeit(o.createdAt)}{ersteller ? ` von ${ersteller.name}` : ''}</>}>
        <StatusPill status={o.status} />
        {['bezahlt', 'teilstorniert'].includes(o.status) && c?.email && <AktionKnopf action={ticketsSenden.bind(null, o.id)}>Tickets erneut senden</AktionKnopf>}
        {o.status !== 'offen' && <UmbuchungDialog action={umbuchungAktion.bind(null, o.id)} tickets={zeilen} shows={shows} aktuelleShow={o.showId} fristAbgelaufen={fristAbgelaufen} darfFrist={darfFrist} darfFrei={hat(u, 'leitung')} versteckt={!stornierbar} />}
        {o.status !== 'offen' && <StornoDialog action={stornoAktion.bind(null, o.id)} tickets={zeilen} fristAbgelaufen={fristAbgelaufen} darfFrist={darfFrist} versteckt={!stornierbar} />}
      </PageHeader>

      {(umgebuchtVon || umgebuchtAuf.length > 0) && (
        <p className="mb-4 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">
          {umgebuchtVon && <>Umgebucht von <Link className="font-mono underline" href={`/bestellungen/${umgebuchtVon.id}`}>{umgebuchtVon.number}</Link>. </>}
          {umgebuchtAuf.map((x) => <span key={x.id}>Umgebucht auf <Link className="font-mono underline" href={`/bestellungen/${x.id}`}>{x.number}</Link>. </span>)}
        </p>
      )}

      {o.status === 'offen' && (
        <section className="card mb-6 grid gap-3 border-amber-300 bg-amber-50/50 p-5" aria-labelledby="offen">
          <h2 id="offen" className="h2">Noch nicht bezahlt</h2>
          <p className="text-sm">Offener Betrag: <Money cents={offen} className="font-semibold" />. {hold ? `Plätze reserviert bis ${fmtDatumZeit(hold.expiresAt)}.` : 'Die Reservierung ist abgelaufen – die Plätze sind nicht mehr gesichert.'}</p>
          {hold && hold.expiresAt > new Date() && <ZahlungErhalten action={zahlungErhalten.bind(null, o.id)} betrag={offen} />}
          <div><AktionKnopf action={reservierungAufheben.bind(null, o.id)} className="btn-danger" frage="Bestellung verwerfen und Plätze freigeben?">Bestellung verwerfen</AktionKnopf></div>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Abschnitt id="vorstellung" titel="Vorstellung">
          <dl className="grid gap-x-6 gap-y-1 px-5 pb-5 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted">Termin</dt><dd><Link href={`/vorstellungen/${o.showId}`} className="underline underline-offset-4">{fmtDatumZeit(o.show.startsAt)}</Link> <StatusPill status={o.show.status} /></dd>
            <dt className="text-muted">Summe</dt><dd><Money cents={o.totalCents} /></dd>
            {o.voucherCents > 0 && <><dt className="text-muted">Gutschein</dt><dd><Money cents={o.voucherCents} /> ({o.voucherCode})</dd></>}
            <dt className="text-muted">Bezahlt</dt><dd><Money cents={o.paidCents} />{o.paidAt ? ` am ${fmtDatumZeit(o.paidAt)}` : ''}</dd>
            {o.refundedCents > 0 && <><dt className="text-muted">Erstattet</dt><dd><Money cents={o.refundedCents} /></dd></>}
            <dt className="text-muted">Sprache</dt><dd>{o.locale}</dd>
          </dl>
        </Abschnitt>
        <Abschnitt id="kunde" titel="Kund:in" aktion={c ? <Link href={`/kunden/${c.id}`} className="text-sm underline underline-offset-4">Kundenkonto</Link> : undefined}>
          <div className="px-5 pb-5">
            <KundeFormular action={kundeSpeichern.bind(null, o.id)} werte={{ firstName: c?.firstName ?? '', lastName: c?.lastName ?? '', email: c?.email ?? '', phone: c?.phone ?? '', company: c?.company ?? '', vatId: c?.vatId ?? '', street: c?.street ?? '', zip: c?.zip ?? '', city: c?.city ?? '', country: c?.country ?? '', newsletter: c?.newsletter ?? false }} />
          </div>
        </Abschnitt>
      </div>

      <Abschnitt id="rechnungen" titel={o.invoices.length > 1 ? `Rechnungen (${o.invoices.length})` : 'Rechnung'}>
        {o.invoices.length ? (
          <ul className="grid gap-4 px-5 pb-5">
            {[...o.invoices].reverse().map((i) => (
              <li key={i.id} className="rounded-lg border border-line p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-base font-semibold">
                    {i.kind === 'storno' ? 'Stornorechnung' : 'Rechnung'}{' '}
                    {buchhaltung ? <Link href={`/rechnungen/${i.id}`} className="font-mono underline underline-offset-4">{i.number}</Link> : <span className="font-mono">{i.number}</span>}
                  </h3>
                  <span className="flex flex-wrap items-center gap-2 text-sm">
                    {i.kind === 'storno' ? <StatusPill status="storniert" label="Storno" /> : <StatusPill status={i.status} />}
                    {i.sentAt ? <span className="text-muted">gesendet {fmtDatumZeit(i.sentAt)}</span> : <span className="text-muted">noch nicht per E-Mail gesendet</span>}
                  </span>
                </div>
                <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[repeat(4,auto)] sm:justify-start">
                  <div><dt className="text-muted">Datum</dt><dd>{fmtDatumZeit(i.issueDate)}</dd></div>
                  <div><dt className="text-muted">Netto</dt><dd><Money cents={i.netCents} /></dd></div>
                  <div><dt className="text-muted">USt</dt><dd><Money cents={i.vatCents} /></dd></div>
                  <div><dt className="text-muted">Brutto</dt><dd><Money cents={i.grossCents} className="font-semibold" /></dd></div>
                </dl>
                {darfRechnung && (
                  <>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <RechnungModal id={i.id} nummer={i.number} storno={i.kind === 'storno'} />
                      <a href={`/rechnungen/${i.id}/pdf?download=1`} className="btn-secondary btn-sm">PDF herunterladen<span className="sr-only"> – {i.number}</span></a>
                    </div>
                    <AktionForm action={rechnungSendenAktion.bind(null, o.id, i.id)} className="mt-3 grid max-w-xl gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                      <div><label htmlFor={`re-an-${i.id}`} className="label">Per E-Mail senden an</label><input id={`re-an-${i.id}`} name="an" type="email" required autoComplete="off" defaultValue={c?.email ?? ''} className="input" /></div>
                      <Absenden className="btn-secondary">Per E-Mail senden</Absenden>
                    </AktionForm>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-5 pb-5">
            <Empty>{rechnungFehlt ? 'Zu dieser bezahlten Bestellung gibt es noch keine Rechnung.' : 'Die Rechnung entsteht mit dem Zahlungseingang.'}</Empty>
            {rechnungFehlt && darfRechnung && <AktionKnopf action={rechnungErstellenAktion.bind(null, o.id)} className="btn-primary">Rechnung erstellen</AktionKnopf>}
          </div>
        )}
      </Abschnitt>

      <Abschnitt id="tickets" titel={`Tickets (${o.tickets.length})`}>
        {o.tickets.length ? (
          <table className="table">
            <thead><tr><th scope="col">Platz</th><th scope="col">Kategorie</th><th scope="col">Art</th><th scope="col" className="text-right">Preis</th><th scope="col">Status</th><th scope="col">Code</th><th scope="col">Eingelassen</th></tr></thead>
            <tbody>{o.tickets.map((t) => (
              <tr key={t.id}>
                <td>{sitzName(t.seatId)}</td><td>{KAT_NAME[t.kat]}</td><td>{ART_NAME[t.art] ?? t.art}</td><td className="text-right"><Money cents={t.priceCents} /></td>
                <td><StatusPill status={t.status} /></td><td><Link href={`/tickets/${t.id}`} className="relative font-mono underline underline-offset-4">{t.code}<span className="sr-only"> – Ticket öffnen</span></Link></td><td className="whitespace-nowrap">{t.checkedInAt ? fmtDatumZeit(t.checkedInAt) : '–'}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <Empty>{o.status === 'offen' ? 'Tickets entstehen mit dem Zahlungseingang.' : 'Keine Tickets.'}</Empty>}
      </Abschnitt>

      <TicketBlock orderId={o.id} />

      <div>
        <Abschnitt id="zahlungen" titel="Zahlungen">
          {o.payments.length || o.redemptions.length ? (
            <table className="table">
              <thead><tr><th scope="col">Art</th><th scope="col" className="text-right">Betrag</th><th scope="col">Status</th><th scope="col">Datum</th></tr></thead>
              <tbody>
                {o.payments.map((p) => <tr key={p.id}><td>{ZAHLART_NAME[p.provider] ?? p.provider}<span className="block font-mono text-xs text-muted">{p.providerRef}</span></td><td className="text-right"><Money cents={p.amountCents} />{p.refundedCents > 0 && <span className="block text-xs text-muted">erstattet <Money cents={p.refundedCents} /></span>}</td><td><StatusPill status={p.status} /></td><td className="whitespace-nowrap">{p.paidAt ? fmtDatumZeit(p.paidAt) : fmtDatumZeit(p.createdAt)}</td></tr>)}
                {o.redemptions.map((r) => <tr key={r.id}><td>Gutschein <Link className="font-mono underline" href={`/gutscheine/${r.voucher.id}`}>{r.voucher.code}</Link></td><td className="text-right"><Money cents={r.amountCents} /></td><td><StatusPill status="bezahlt" label="Eingelöst" /></td><td className="whitespace-nowrap">{fmtDatumZeit(r.createdAt)}</td></tr>)}
              </tbody>
            </table>
          ) : <Empty>Keine Zahlungen.</Empty>}
        </Abschnitt>
      </div>

      {o.refunds.length > 0 && (
        <Abschnitt id="stornos" titel="Stornos und Erstattungen">
          <table className="table">
            <thead><tr><th scope="col">Datum</th><th scope="col" className="text-right">Tickets</th><th scope="col" className="text-right">Betrag</th><th scope="col" className="text-right">Gebühr</th><th scope="col">Erstattung</th><th scope="col">Grund</th><th scope="col">Notiz</th></tr></thead>
            <tbody>{o.refunds.map((r) => {
              const v = r.voucherId ? gv.get(r.voucherId) : undefined;
              return (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">{fmtDatumZeit(r.createdAt)}</td><td className="num text-right">{r.ticketIds.length}</td><td className="text-right"><Money cents={r.amountCents} /></td><td className="text-right"><Money cents={r.feeCents} /></td>
                  <td>{METHODE_NAME[r.method] ?? r.method}{v && <> · <Link href={`/gutscheine/${v.id}`} className="font-mono underline">{v.code}</Link> (Rest <Money cents={v.remainingCents} />)</>}</td>
                  <td>{GRUND_NAME[r.reason] ?? r.reason}</td><td>{r.note}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </Abschnitt>
      )}

      <Abschnitt id="mails" titel="Gesendete E-Mails">
        {o.emails.length ? (
          <table className="table">
            <thead><tr><th scope="col">Datum</th><th scope="col">An</th><th scope="col">Betreff</th><th scope="col">Status</th></tr></thead>
            <tbody>{o.emails.map((m) => <tr key={m.id}><td className="whitespace-nowrap">{fmtDatumZeit(m.createdAt)}</td><td>{m.to}</td><td>{m.subject}{m.error && <span className="block text-xs text-neg">{m.error}</span>}</td><td><StatusPill status={m.status} /></td></tr>)}</tbody>
          </table>
        ) : <Empty>Keine E-Mails.</Empty>}
      </Abschnitt>

      <section className="card mb-6 p-5" aria-label="Notiz"><NotizFormular action={notizSpeichern.bind(null, o.id)} note={o.note} /></section>

      <Verlauf ziele={[
        { entity: 'order', ids: [o.id] },
        { entity: 'ticket', ids: o.tickets.map((t) => t.id) },
        { entity: 'invoice', ids: o.invoices.map((i) => i.id) },
        { entity: 'refund', ids: o.refunds.map((r) => r.id) },
        { entity: 'voucher', ids: o.refunds.map((r) => r.voucherId) },
        ...(o.customerId ? [{ entity: 'customer', ids: [o.customerId] }] : []),
      ]} titel="Verlauf" />
    </>
  );
}
