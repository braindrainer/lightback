import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { Verlauf } from '@/components/Verlauf';
import { db } from '@/lib/db';
import { fmtDatum, fmtDatumZeit } from '@/lib/dates';
import { formatEur } from '@/lib/money';
import { Abschnitt, DetailKopf, Empty, Feldliste, Icon, Money, StatusPill } from '@/components/ui';
import GutscheinKarte, { gutscheinZustand } from '@/components/gutschein/GutscheinKarte';
import { AktionKnopf } from '@/components/verkauf/BestellungAktionen';
import { GutscheinSenden } from '@/components/verkauf/GutscheinFormulare';
import { ISSUER_NAME } from '@/components/verkauf/texte';
import { gutscheinAktivSetzen, gutscheinSendenAktion } from '../actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const v = await db.voucher.findUnique({ where: { id: (await params).id }, select: { code: true } });
  return { title: v ? `Gutschein ${v.code}` : 'Gutschein' };
}

const PILL: Record<string, [string, string]> = { aktiv: ['bezahlt', 'Einlösbar'], inaktiv: ['storniert', 'Deaktiviert'], abgelaufen: ['fehler', 'Abgelaufen'], aufgebraucht: ['erstattet', 'Aufgebraucht'] };

export default async function Gutschein({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('leitung', 'buchhaltung');
  const { id } = await params;
  const v = await db.voucher.findUnique({ where: { id }, include: { redemptions: { orderBy: { createdAt: 'desc' }, include: { order: { select: { id: true, number: true, status: true, totalCents: true, customer: { select: { firstName: true, lastName: true } }, show: { select: { startsAt: true } } } } } } } });
  if (!v) notFound();
  const [herkunft, verkauft, mails] = await Promise.all([
    db.refund.findFirst({ where: { voucherId: id }, include: { order: { select: { id: true, number: true } } } }),
    v.soldOrderId ? db.order.findUnique({ where: { id: v.soldOrderId }, select: { id: true, number: true } }) : null,
    db.auditLog.count({ where: { entity: 'voucher', entityId: id, action: 'gutschein_gesendet' } }),
  ]);
  const z = gutscheinZustand(v);
  const eingeloest = v.valueCents - v.remainingCents;
  const [pk, pl] = PILL[z.key];
  return (
    <>
      <DetailKopf
        krumen={[{ label: 'Verkauf' }, { label: 'Gutscheine', href: '/gutscheine' }, { label: v.code }]}
        titel={v.code} mono
        status={<><StatusPill status={pk} label={pl} /><span className="pill bg-paper-deep text-ink ring-1 ring-inset ring-line">{v.kind === 'partner' ? `Partner · ${v.issuer}` : `Wertgutschein · ${ISSUER_NAME[v.issuer] ?? v.issuer}`}</span></>}
        untertitel={<>Angelegt {fmtDatumZeit(v.createdAt)}{v.note ? <> · {v.note}</> : ''}</>}
        aktionen={<>
          <a href={`/gutscheine/${v.id}/druck`} target="_blank" rel="noopener" className="btn-secondary"><Icon name="druck" className="h-4 w-4" />Drucken<span className="sr-only"> (A6, neues Fenster)</span></a>
          <GutscheinSenden action={gutscheinSendenAktion.bind(null, v.id)} code={v.code} deaktiviert={!v.active} />
          {v.active
            ? <AktionKnopf leise action={gutscheinAktivSetzen.bind(null, id, false)} className="btn-danger" frage="Gutschein deaktivieren? Er kann dann nicht mehr eingelöst werden.">Deaktivieren</AktionKnopf>
            : <AktionKnopf leise action={gutscheinAktivSetzen.bind(null, id, true)}>Wieder aktivieren</AktionKnopf>}
        </>}
      />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <GutscheinKarte v={v} />
        <Abschnitt id="daten" titel="Details">
          <Feldliste spalten={2} felder={[
            { label: 'Wert', wert: <Money cents={v.valueCents} className="font-semibold" /> },
            { label: 'Restwert', wert: <Money cents={v.remainingCents} className="font-semibold" /> },
            { label: 'Eingelöst', wert: <>{formatEur(eingeloest)} <span className="text-muted">in {v.redemptions.length} {v.redemptions.length === 1 ? 'Einlösung' : 'Einlösungen'}</span></> },
            { label: 'Gültig bis', wert: v.validUntil ? <>{fmtDatum(v.validUntil)}{z.key === 'abgelaufen' && <span className="text-neg"> (abgelaufen)</span>}</> : 'unbefristet' },
            { label: 'Code', wert: v.code, mono: true, kopieren: v.code },
            { label: 'Herausgeber', wert: v.kind === 'partner' ? `${v.issuer} (Partner)` : ISSUER_NAME[v.issuer] ?? v.issuer },
            herkunft && { label: 'Entstanden aus Storno', wert: <Link className="link font-mono" href={`/bestellungen/${herkunft.order.id}`}>{herkunft.order.number}</Link> },
            verkauft && { label: 'Verkauft mit', wert: <Link className="link font-mono" href={`/bestellungen/${verkauft.id}`}>{verkauft.number}</Link> },
            { label: 'Per E-Mail gesendet', wert: mails ? `${mails}×` : 'noch nie' },
            !!v.note && { label: 'Notiz', wert: v.note, breit: true },
          ]} />
        </Abschnitt>
      </div>

      <Abschnitt id="einloesungen" className="mt-6" flush titel={`Einlösungen${v.redemptions.length ? ` (${v.redemptions.length})` : ''}`}
        beschreibung={v.redemptions.length ? <>Insgesamt <Money cents={eingeloest} /> eingelöst</> : undefined}>
        {v.redemptions.length ? (
          <table className="table rtab">
            <caption className="sr-only">Einlösungen, neueste zuerst</caption>
            <thead><tr><th scope="col">Bestellung</th><th scope="col">Eingelöst am</th><th scope="col">Kund:in</th><th scope="col">Vorstellung</th><th scope="col">Status</th><th scope="col" className="text-right">Bestellwert</th><th scope="col" className="text-right">Eingelöst</th></tr></thead>
            <tbody>{v.redemptions.map((r) => (
              <tr key={r.id}>
                <td className="rtab-kopf"><Link className="font-mono text-[13px] font-semibold underline-offset-4 hover:underline" href={`/bestellungen/${r.order.id}`}>{r.order.number}</Link></td>
                <td data-label="Eingelöst am" className="whitespace-nowrap">{fmtDatumZeit(r.createdAt)}</td>
                <td data-label="Kund:in">{r.order.customer ? `${r.order.customer.firstName} ${r.order.customer.lastName}`.trim() || '–' : <span className="text-muted">anonym</span>}</td>
                <td data-label="Vorstellung" className="whitespace-nowrap">{fmtDatumZeit(r.order.show.startsAt)}</td>
                <td data-label="Status"><StatusPill status={r.order.status} /></td>
                <td data-label="Bestellwert" className="text-right"><Money cents={r.order.totalCents} /></td>
                <td data-label="Eingelöst" className="text-right font-semibold"><Money cents={r.amountCents} /></td>
              </tr>
            ))}</tbody>
          </table>
        ) : (
          <Empty icon="gutschein" titel="Noch nicht eingelöst" aktion={v.active && z.key === 'aktiv' ? <Link href="/bestellungen/neu" className="btn-secondary btn-sm">Im Telefonverkauf einlösen</Link> : undefined}>
            {z.key === 'aktiv' ? <>Der Code <span className="font-mono text-ink">{v.code}</span> gilt im Webshop, im Telefonverkauf und an der Abendkasse – auch in mehreren Teilen.</> : `Der Gutschein ist ${z.text.toLowerCase()} und kann nicht eingelöst werden.`}
          </Empty>
        )}
      </Abschnitt>

      <Verlauf className="mt-6" ziele={[{ entity: 'voucher', ids: [v.id] }]} />
    </>
  );
}
