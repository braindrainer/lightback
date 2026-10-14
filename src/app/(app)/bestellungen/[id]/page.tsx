import Link from 'next/link';
import { notFound } from 'next/navigation';
import { hat, requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatumZeit, fmtTag, fmtZeit, wienTag } from '@/lib/dates';
import { stornoMoeglich } from '@/lib/orders';
import { sitzName } from '@/lib/saal';
import { Abschnitt, DetailKopf, Empty, Feldliste, Hinweis, Icon, Money, StatusPill } from '@/components/ui';
import { Verlauf } from '@/components/Verlauf';
import RechnungModal from '@/components/finanzen/RechnungModal';
import TicketBlock from '@/components/tickets/TicketBlock';
import { AktionForm, Absenden } from '@/components/verkauf/form';
import { AktionKnopf, KundeBearbeiten, NotizFormular, StornoDialog, UmbuchungDialog, ZahlungErhalten } from '@/components/verkauf/BestellungAktionen';
import { showOptionen } from '@/components/verkauf/showOptionen';
import { gastMeta } from '@/lib/gaeste';
import { ART_NAME, GRUND_NAME, KANAL_NAME, KAT_NAME, METHODE_NAME, ZAHLART_NAME } from '@/components/verkauf/texte';
import { kundeSpeichern, notizSpeichern, rechnungErstellenAktion, rechnungSendenAktion, reservierungAufheben, stornoAktion, ticketsSenden, umbuchungAktion, zahlungErhalten } from '../actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const o = await db.order.findUnique({ where: { id: (await params).id }, select: { number: true } });
  return { title: o ? `Bestellung ${o.number}` : 'Bestellung' };
}

export default async function Bestellung({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireRole('leitung');
  const { id } = await params;
  const aktion = (await searchParams).aktion;
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
  // Freikarten (0 €) bekommen keine Rechnung
  const rechnungFehlt = ['bezahlt', 'teilstorniert'].includes(o.status) && o.totalCents > 0 && !o.invoices.some((i) => i.kind === 'rechnung');
  const gast = gastMeta(o.meta);

  const name = c ? `${c.firstName} ${c.lastName}`.trim() : '';
  const kundeWerte = { firstName: c?.firstName ?? '', lastName: c?.lastName ?? '', email: c?.email ?? '', phone: c?.phone ?? '', company: c?.company ?? '', vatId: c?.vatId ?? '', street: c?.street ?? '', zip: c?.zip ?? '', city: c?.city ?? '', country: c?.country ?? '', newsletter: c?.newsletter ?? false };
  const tickets = ['bezahlt', 'teilstorniert'].includes(o.status) && o.tickets.some((t) => t.status !== 'storniert');
  const showTitel = `${fmtTag(o.show.startsAt)} ${wienTag(o.show.startsAt).slice(0, 4)}, ${fmtZeit(o.show.startsAt)}`;
  const adresse = c ? [c.street, [c.zip, c.city].filter(Boolean).join(' '), c.country].filter(Boolean).join(', ') : '';

  return (
    <>
      <DetailKopf
        krumen={[{ label: 'Verkauf' }, { label: 'Bestellungen', href: '/bestellungen' }, { label: o.number }]}
        titel={o.number} mono
        status={<><StatusPill status={o.status} /><span className="pill bg-paper-deep text-ink ring-1 ring-inset ring-line">{KANAL_NAME[o.channel] ?? o.channel}{o.partner ? ` · ${o.partner.name}` : ''}</span></>}
        untertitel={<>Bestellt {fmtDatumZeit(o.createdAt)}{ersteller ? ` von ${ersteller.name}` : ''}{o.partnerRef ? <> · Partner-Referenz <span className="font-mono">{o.partnerRef}</span></> : ''}</>}
        aktionen={<>
          {tickets && c?.email && <AktionKnopf leise action={ticketsSenden.bind(null, o.id)}><Icon name="mail" className="h-4 w-4" />Tickets erneut senden</AktionKnopf>}
          {o.status !== 'offen' && <UmbuchungDialog action={umbuchungAktion.bind(null, o.id)} tickets={zeilen} shows={shows} aktuelleShow={o.showId} fristAbgelaufen={fristAbgelaufen} darfFrist={darfFrist} darfFrei={hat(u, 'leitung')} versteckt={!stornierbar} anfangsOffen={aktion === 'umbuchen' && stornierbar} />}
          {o.status !== 'offen' && <StornoDialog action={stornoAktion.bind(null, o.id)} tickets={zeilen} fristAbgelaufen={fristAbgelaufen} darfFrist={darfFrist} versteckt={!stornierbar} anfangsOffen={aktion === 'stornieren' && stornierbar} />}
        </>}
        menue={[
          ...(tickets ? [{ label: 'Tickets als PDF', href: `/bestellungen/${o.id}/tickets`, extern: true, icon: 'download' }, { label: 'Mobile Ansicht', href: `/t/${o.manageToken}`, extern: true, icon: 'ticket' }] : []),
          { label: 'Zur Vorstellung', href: `/vorstellungen/${o.showId}`, icon: 'kalender' },
          ...(c ? [{ label: 'Kundenkonto öffnen', href: `/kunden/${c.id}`, icon: 'kunde' }] : []),
          { label: 'Weitere Bestellungen dieser Vorstellung', href: `/bestellungen?show=${o.showId}`, icon: 'liste' },
        ]}
        fakten={[
          { label: 'Vorstellung', wert: <Link href={`/vorstellungen/${o.showId}`} className="underline-offset-4 hover:underline">{showTitel}</Link> },
          { label: 'Kund:in', wert: name || <span className="font-normal text-muted">anonym</span> },
          { label: 'Tickets', wert: <span className="num">{gueltig.length}{o.tickets.length > gueltig.length ? <span className="font-normal text-muted"> von {o.tickets.length}</span> : ''}</span> },
          { label: 'Summe', wert: <Money cents={o.totalCents} /> },
          o.status === 'offen' ? { label: 'Offen', wert: <Money cents={offen} className="text-warn" /> } : { label: o.refundedCents > 0 ? 'Bezahlt / erstattet' : 'Bezahlt', wert: <><Money cents={o.paidCents} />{o.refundedCents > 0 && <span className="font-normal text-muted"> / <Money cents={o.refundedCents} /></span>}</> },
        ]}
      />

      {(umgebuchtVon || umgebuchtAuf.length > 0) && (
        <Hinweis art="info">
          {umgebuchtVon && <>Umgebucht von <Link className="font-mono underline" href={`/bestellungen/${umgebuchtVon.id}`}>{umgebuchtVon.number}</Link>. </>}
          {umgebuchtAuf.map((x) => <span key={x.id}>Umgebucht auf <Link className="font-mono underline" href={`/bestellungen/${x.id}`}>{x.number}</Link>. </span>)}
        </Hinweis>
      )}

      {o.status === 'offen' && (
        <section className="mb-6 grid gap-4 rounded-xl border border-amber-300 bg-amber-50/70 p-5" aria-labelledby="offen">
          <div>
            <h2 id="offen" className="h2 flex items-center gap-2"><Icon name="uhr" className="h-5 w-5 text-warn" />Noch nicht bezahlt</h2>
            <p className="mt-1 text-sm">Offener Betrag: <Money cents={offen} className="font-semibold" />. {hold ? `Plätze reserviert bis ${fmtDatumZeit(hold.expiresAt)}.` : 'Die Reservierung ist abgelaufen – die Plätze sind nicht mehr gesichert.'}</p>
          </div>
          {hold && hold.expiresAt > new Date() && <ZahlungErhalten action={zahlungErhalten.bind(null, o.id)} betrag={offen} />}
          <div className="border-t border-amber-200 pt-3"><AktionKnopf action={reservierungAufheben.bind(null, o.id)} className="btn-danger btn-sm" frage="Bestellung verwerfen und Plätze freigeben?">Bestellung verwerfen</AktionKnopf></div>
        </section>
      )}

      <div className="mb-6 grid items-start gap-6 lg:grid-cols-2 xl:grid-cols-3">
          <Abschnitt id="kunde" titel="Kund:in" aktionen={<KundeBearbeiten action={kundeSpeichern.bind(null, o.id)} werte={kundeWerte} knopf={c ? 'Bearbeiten' : 'Anlegen'} untertitel={<span className="font-mono">{o.number}</span>} />}>
            {c ? (
              <Feldliste spalten={2} felder={[
                { label: 'Name', wert: <span className="font-medium">{name || '–'}</span> },
                c.company ? { label: 'Firma', wert: <>{c.company}{c.vatId ? <span className="text-muted"> · UID {c.vatId}</span> : ''}</>, breit: true } : null,
                { label: 'E-Mail', wert: c.email ? <a href={`mailto:${c.email}`} className="link break-all">{c.email}</a> : null, kopieren: c.email || null, breit: true },
                { label: 'Telefon', wert: c.phone ? <a href={`tel:${c.phone}`} className="link">{c.phone}</a> : null, kopieren: c.phone || null },
                adresse ? { label: 'Adresse', wert: adresse, breit: true } : null,
                { label: 'Sprache · Newsletter', wert: `${o.locale.toUpperCase()} · ${c.newsletter ? 'Einwilligung liegt vor' : 'nein'}` },
              ]} />
            ) : <Empty icon="kunde">Ohne Kundendaten (anonym).</Empty>}
            {c && <Link href={`/kunden/${c.id}`} className="link mt-4 inline-flex items-center gap-1 text-sm">Kundenkonto öffnen<Icon name="pfeil" className="h-3.5 w-3.5" /></Link>}
          </Abschnitt>

          <Abschnitt id="betrag" titel="Betrag">
            <dl className="grid gap-2 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted">Summe</dt><dd><Money cents={o.totalCents} /></dd></div>
              {o.voucherCents > 0 && <div className="flex justify-between gap-3"><dt className="text-muted">Gutschein <span className="font-mono text-xs">{o.voucherCode}</span></dt><dd><Money cents={-o.voucherCents} /></dd></div>}
              <div className="flex justify-between gap-3"><dt className="text-muted">Bezahlt{o.paidAt ? ` am ${fmtDatumZeit(o.paidAt)}` : ''}</dt><dd><Money cents={o.paidCents} /></dd></div>
              {o.refundedCents > 0 && <div className="flex justify-between gap-3"><dt className="text-muted">Erstattet</dt><dd><Money cents={-o.refundedCents} /></dd></div>}
              <div className="mt-1 flex justify-between gap-3 border-t border-line pt-2 font-semibold"><dt>{o.status === 'offen' ? 'Offen' : 'Saldo'}</dt><dd><Money cents={o.status === 'offen' ? offen : o.paidCents - o.refundedCents} /></dd></div>
            </dl>
          </Abschnitt>

          {gast && (
            <Abschnitt id="h-gast" titel="Gästeliste" aktionen={<Link href={`/vorstellungen/${o.showId}/gaeste`} className="link text-sm">Zur Gästeliste</Link>}>
              <Feldliste spalten={1} felder={[
                { label: 'Grund', wert: `${gast.grund}${gast.notiz ? ` – ${gast.notiz}` : ''}` },
                { label: 'Zustellung', wert: [gast.mail ? 'per E-Mail' : '', gast.hinterlegt ? 'an der Kassa hinterlegt' : ''].filter(Boolean).join(' und ') || '–' },
                { label: 'Abgeholt', wert: gast.abgeholtAm ? `${fmtDatumZeit(new Date(gast.abgeholtAm))}${gast.abgeholtVon ? ` von ${gast.abgeholtVon}` : ''}` : gast.hinterlegt ? 'noch nicht' : '–' },
                { label: 'Begleitung', wert: gast.begleitung ? 'erlaubt (+1 Karte)' : 'nein' },
              ]} />
            </Abschnitt>
          )}

          <Abschnitt id="h-notiz" titel="Interne Notiz"><NotizFormular action={notizSpeichern.bind(null, o.id)} note={o.note} ohneLabel /></Abschnitt>
        </div>
      <div className="grid gap-6">
        <div className="grid min-w-0 gap-6">
          <Abschnitt id="tickets" titel={`Tickets (${o.tickets.length})`} flush
            beschreibung={o.tickets.length ? `${gueltig.length} gültig${o.tickets.filter((t) => t.status === 'eingelassen').length ? `, ${o.tickets.filter((t) => t.status === 'eingelassen').length} eingelassen` : ''}` : undefined}>
            {o.tickets.length ? (
              <table className="table rtab">
                <thead><tr><th scope="col">Platz</th><th scope="col">Kategorie</th><th scope="col">Art</th><th scope="col" className="text-right">Preis</th><th scope="col">Status</th><th scope="col">Code</th><th scope="col">Eingelassen</th></tr></thead>
                <tbody>{o.tickets.map((t) => (
                  <tr key={t.id}>
                    <td className="rtab-kopf font-medium">{sitzName(t.seatId)}</td><td data-label="Kategorie">{KAT_NAME[t.kat]}</td><td data-label="Art">{ART_NAME[t.art] ?? t.art}</td><td data-label="Preis" className="text-right"><Money cents={t.priceCents} /></td>
                    <td data-label="Status"><StatusPill status={t.status} /></td><td data-label="Code"><Link href={`/tickets/${t.id}`} className="relative font-mono text-[13px] underline underline-offset-4">{t.code}<span className="sr-only"> – Ticket öffnen</span></Link></td><td data-label="Eingelassen" className="whitespace-nowrap">{t.checkedInAt ? fmtDatumZeit(t.checkedInAt) : <span className="text-muted">–</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            ) : <Empty icon="ticket">{o.status === 'offen' ? 'Tickets entstehen mit dem Zahlungseingang.' : 'Keine Tickets.'}</Empty>}
          </Abschnitt>

          <TicketBlock orderId={o.id} />

          <Abschnitt id="zahlungen" titel="Zahlungen" flush>
            {o.payments.length || o.redemptions.length ? (
              <table className="table rtab">
                <thead><tr><th scope="col">Art</th><th scope="col" className="text-right">Betrag</th><th scope="col">Status</th><th scope="col">Datum</th></tr></thead>
                <tbody>
                  {o.payments.map((p) => <tr key={p.id}><td className="rtab-kopf">{ZAHLART_NAME[p.provider] ?? p.provider}<span className="block font-mono text-xs text-muted">{p.providerRef}</span></td><td data-label="Betrag" className="text-right"><Money cents={p.amountCents} />{p.refundedCents > 0 && <span className="block text-xs text-muted">erstattet <Money cents={p.refundedCents} /></span>}</td><td data-label="Status"><StatusPill status={p.status} /></td><td data-label="Datum" className="whitespace-nowrap">{p.paidAt ? fmtDatumZeit(p.paidAt) : fmtDatumZeit(p.createdAt)}</td></tr>)}
                  {o.redemptions.map((r) => <tr key={r.id}><td className="rtab-kopf">Gutschein <Link className="font-mono underline" href={`/gutscheine/${r.voucher.id}`}>{r.voucher.code}</Link></td><td data-label="Betrag" className="text-right"><Money cents={r.amountCents} /></td><td data-label="Status"><StatusPill status="bezahlt" label="Eingelöst" /></td><td data-label="Datum" className="whitespace-nowrap">{fmtDatumZeit(r.createdAt)}</td></tr>)}
                </tbody>
              </table>
            ) : <Empty icon="zahlung">{o.totalCents === 0 ? 'Freikarten – keine Zahlung nötig.' : 'Noch keine Zahlung eingegangen.'}</Empty>}
          </Abschnitt>

          {o.refunds.length > 0 && (
            <Abschnitt id="stornos" titel="Stornos und Erstattungen" flush>
              <table className="table rtab">
                <thead><tr><th scope="col">Datum</th><th scope="col" className="text-right">Tickets</th><th scope="col" className="text-right">Betrag</th><th scope="col" className="text-right">Gebühr</th><th scope="col">Erstattung</th><th scope="col">Grund</th><th scope="col">Notiz</th></tr></thead>
                <tbody>{o.refunds.map((r) => {
                  const v = r.voucherId ? gv.get(r.voucherId) : undefined;
                  return (
                    <tr key={r.id}>
                      <td className="rtab-kopf whitespace-nowrap">{fmtDatumZeit(r.createdAt)}</td><td data-label="Tickets" className="num text-right">{r.ticketIds.length}</td><td data-label="Betrag" className="text-right"><Money cents={r.amountCents} /></td><td data-label="Gebühr" className="text-right"><Money cents={r.feeCents} /></td>
                      <td data-label="Erstattung">{METHODE_NAME[r.method] ?? r.method}{v && <> · <Link href={`/gutscheine/${v.id}`} className="font-mono underline">{v.code}</Link> (Rest <Money cents={v.remainingCents} />)</>}</td>
                      <td data-label="Grund">{GRUND_NAME[r.reason] ?? r.reason}</td><td data-label="Notiz" className={r.note ? '' : 'rtab-leer'}>{r.note}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </Abschnitt>
          )}

          <Abschnitt id="rechnungen" titel={o.invoices.length > 1 ? `Rechnungen (${o.invoices.length})` : 'Rechnung'} flush={!o.invoices.length}>
            {o.invoices.length ? (
              <ul className="grid gap-3">
                {[...o.invoices].reverse().map((i) => (
                  <li key={i.id} className="rounded-lg border border-line p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                        <Icon name="rechnung" className="h-4 w-4 text-muted" />
                        {i.kind === 'storno' ? 'Stornorechnung' : 'Rechnung'}{' '}
                        {buchhaltung ? <Link href={`/rechnungen/${i.id}`} className="font-mono underline underline-offset-4">{i.number}</Link> : <span className="font-mono">{i.number}</span>}
                        {i.kind === 'storno' ? <StatusPill status="storniert" label="Storno" /> : <StatusPill status={i.status} />}
                      </h3>
                      <span className="text-xs text-muted">{i.sentAt ? `gesendet ${fmtDatumZeit(i.sentAt)}` : 'noch nicht per E-Mail gesendet'}</span>
                    </div>
                    <Feldliste spalten={4} className="mt-3" felder={[
                      { label: 'Datum', wert: fmtDatumZeit(i.issueDate) }, { label: 'Netto', wert: <Money cents={i.netCents} /> }, { label: 'USt', wert: <Money cents={i.vatCents} /> }, { label: 'Brutto', wert: <Money cents={i.grossCents} className="font-semibold" /> },
                    ]} />
                    {darfRechnung && (
                      <div className="mt-4 flex flex-wrap items-end gap-x-4 gap-y-3 border-t border-line-soft pt-4">
                        <div className="flex flex-wrap gap-2">
                          <RechnungModal id={i.id} nummer={i.number} storno={i.kind === 'storno'} />
                          <a href={`/rechnungen/${i.id}/pdf?download=1`} className="btn-secondary btn-sm"><Icon name="download" className="h-3.5 w-3.5" />PDF<span className="sr-only"> herunterladen – {i.number}</span></a>
                        </div>
                        <AktionForm action={rechnungSendenAktion.bind(null, o.id, i.id)} className="grid flex-1 gap-2 sm:min-w-80 sm:grid-cols-[1fr_auto] sm:items-end">
                          <div><label htmlFor={`re-an-${i.id}`} className="label">Per E-Mail senden an</label><input id={`re-an-${i.id}`} name="an" type="email" required autoComplete="off" defaultValue={c?.email ?? ''} className="input" /></div>
                          <Absenden className="btn-secondary">Senden</Absenden>
                        </AktionForm>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty icon="rechnung" aktion={rechnungFehlt && darfRechnung ? <AktionKnopf action={rechnungErstellenAktion.bind(null, o.id)} className="btn-primary">Rechnung erstellen</AktionKnopf> : undefined}>
                {o.totalCents === 0 ? 'Freikarten (0 €): keine Rechnung, keine Buchung.' : rechnungFehlt ? 'Zu dieser bezahlten Bestellung gibt es noch keine Rechnung.' : 'Die Rechnung entsteht mit dem Zahlungseingang.'}
              </Empty>
            )}
          </Abschnitt>

          <Abschnitt id="mails" titel="Gesendete E-Mails" flush>
            {o.emails.length ? (
              <table className="table rtab">
                <thead><tr><th scope="col">Datum</th><th scope="col">An</th><th scope="col">Betreff</th><th scope="col">Status</th></tr></thead>
                <tbody>{o.emails.map((m) => <tr key={m.id}><td className="rtab-kopf whitespace-nowrap"><Link href={`/emails/${m.id}`} className="underline-offset-4 hover:underline">{fmtDatumZeit(m.createdAt)}</Link></td><td data-label="An" className="break-all">{m.to}</td><td data-label="Betreff">{m.subject}{m.error && <span className="block text-xs text-neg">{m.error}</span>}</td><td data-label="Status"><StatusPill status={m.status} /></td></tr>)}</tbody>
              </table>
            ) : <Empty icon="mail">Noch keine E-Mails zu dieser Bestellung.</Empty>}
          </Abschnitt>
        </div>

      </div>

      <Verlauf className="mt-6" ziele={[
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
