import { notFound } from 'next/navigation';
import { audit } from '@/lib/audit';
import { requireRole } from '@/lib/auth';
import { db, getSettings } from '@/lib/db';
import { fmtDatum } from '@/lib/dates';
import { belegRef, ZAHLART_NAME } from '@/lib/kassa';
import { formatEur } from '@/lib/money';
import { BELEGART_NAME, rksvZeit, type Belegart, type Position } from '@/lib/rksv';
import { sitzName } from '@/lib/saal';
import { zerlegen } from '@/lib/ledger';
import { qrInhalt, qrSvg } from '@/lib/tickets';
import BonTicket, { BON_TICKET_CSS } from '@/components/tickets/BonTicket';
import { DruckSteuerung } from '../../Bon';
import { BON_CSS } from '../../bon-css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Beleg' };

export default async function BelegSeite({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ druck?: string }> }) {
  const u = await requireRole('kassa');
  const { id } = await params;
  const { druck } = await searchParams;
  const b = await db.receipt.findUnique({ where: { id }, include: { register: true } });
  if (!b) notFound();
  const s = await getSettings();
  // Erstdruck oder Kopie: jeder weitere Aufruf ist eine Kopie
  const kopie = (await db.auditLog.count({ where: { action: 'beleg_druck', entity: 'receipt', entityId: b.id } })) > 0;
  await audit(u, 'beleg_druck', 'receipt', b.id, { kopie });
  const items = b.items as Position[];
  const ticketIds = items.flatMap((i) => i.ticketIds ?? []);
  const tickets = ticketIds.length ? await db.ticket.findMany({ where: { id: { in: ticketIds } }, include: { show: true } }) : [];
  const ticketQr = await Promise.all(tickets.map(async (t) => ({ t, svg: await qrSvg(qrInhalt(t.code, t.showId)) })));
  const rksvQr = await qrSvg(b.qr);
  const orig = b.cancelsId ? await db.receipt.findUnique({ where: { id: b.cancelsId }, select: { number: true } }) : null;
  const storniertDurch = await db.receipt.findFirst({ where: { cancelsId: b.id }, select: { number: true } });
  const satz = new Map<number, number>();
  for (const i of items) satz.set(i.vatRate, (satz.get(i.vatRate) ?? 0) + i.quantity * i.unitCents);
  const steuern = zerlegen(new Map([...satz.entries()].sort((x, y) => y[0] - x[0])));
  const typ = b.type as Belegart;
  const [datum, uhrzeit] = rksvZeit(b.createdAt).split('T');

  return (
    <div className="bg-paper py-4 print:bg-white print:py-0">
      <style dangerouslySetInnerHTML={{ __html: BON_CSS }} />
      <DruckSteuerung auto={druck === '1'} zurueck={b.type === 'standard' || b.type === 'storno' || b.type === 'training' ? '/kassa' : '/kassa/einrichtung'} />
      <article className="bon mx-auto shadow-md" aria-label={`${BELEGART_NAME[typ]} Nr. ${b.number}`}>
        <div className="mitte">
          <h1>{s.companyName}</h1>
          <div>Light of Creation · Votivkirche</div>
          <div>{s.street}, {s.zip} {s.city}</div>
          <div>UID {s.uid}</div>
        </div>
        <hr />
        {kopie && <div className="marke">KOPIE</div>}
        {typ === 'training' && <div className="marke">TRAININGSBUCHUNG – KEIN UMSATZ</div>}
        {typ !== 'standard' && typ !== 'training' && <div className="marke">{BELEGART_NAME[typ].toUpperCase()}</div>}
        <div className="z"><span>Beleg-Nr.</span><span>{belegRef(b.register.kassenId, b.number)}</span></div>
        <div className="z"><span>Datum</span><span>{fmtDatum(b.createdAt)} {uhrzeit}</span></div>
        <div className="z"><span>Kasse</span><span>{b.register.name}</span></div>
        {b.cashierName && <div className="z"><span>Kassier:in</span><span>{b.cashierName}</span></div>}
        {orig && <div>Storno zu Beleg Nr. {orig.number}</div>}
        {storniertDurch && <div>Storniert durch Beleg Nr. {storniertDurch.number}</div>}
        {items.length > 0 && <hr />}
        {items.map((i, n) => (
          <div key={n}>
            <div>{i.name}</div>
            <div className="z"><span>{i.quantity} × {formatEur(i.unitCents)} ({i.vatRate} %)</span><span>{formatEur(i.quantity * i.unitCents)}</span></div>
            {(i.voucherCodes ?? []).map((c) => <div key={c} className="marke">Gutschein-Code {c}</div>)}
          </div>
        ))}
        {items.length > 0 && (
          <>
            <hr />
            <div className="z gross"><span>SUMME EUR</span><span>{formatEur(b.totalCents)}</span></div>
            <hr />
            <div className="z"><span>Satz</span><span>Netto · USt · Brutto</span></div>
            {steuern.map((t) => <div key={t.satz} className="z"><span>{t.satz} %</span><span>{formatEur(t.netto)} · {formatEur(t.ust)} · {formatEur(t.brutto)}</span></div>)}
            {satz.has(0) && items.some((i) => i.category === 'gutschein') && <div>Wertgutschein: USt bei Einlösung.</div>}
            <hr />
            <div className="z"><span>Zahlung</span><span>{ZAHLART_NAME[b.payment] ?? b.payment}</span></div>
            {b.givenCents != null && <div className="z"><span>Gegeben</span><span>{formatEur(b.givenCents)}</span></div>}
            {b.changeCents != null && <div className="z"><span>Rückgeld</span><span>{formatEur(b.changeCents)}</span></div>}
          </>
        )}
        {ticketQr.length > 0 && (
          <>
            <hr />
            <h2 className="mitte">Ihre Tickets</h2>
            <style dangerouslySetInnerHTML={{ __html: BON_TICKET_CSS }} />
            {ticketQr.map(({ t, svg }, n) => <BonTicket key={t.id} t={t} svg={svg} nr={n + 1} von={ticketQr.length} />)}
          </>
        )}
        <hr />
        {b.signerFailed && <div className="marke">Sicherheitseinrichtung ausgefallen</div>}
        <div className="qr" role="img" aria-label="RKSV-Code des Belegs" dangerouslySetInnerHTML={{ __html: rksvQr }} />
        {b.register.signer === 'demo' && <div className="mitte">DEMO-Signatur – nicht rechtsgültig</div>}
        <div className="mitte" style={{ marginTop: 4 }}>{datum} · Vielen Dank für Ihren Besuch!</div>
      </article>
    </div>
  );
}
