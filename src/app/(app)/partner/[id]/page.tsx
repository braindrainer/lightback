import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatum, fmtDatumZeit, fmtZeit } from '@/lib/dates';
import { formatEur } from '@/lib/money';
import { Formular } from '@/components/system/Formular';
import { Abschnitt, DetailKopf, Empty, Icon, Kennzahlen, StatusPill } from '@/components/ui';
import { partnerSpeichern, schluesselNeu, webhookGeheimnisNeu, webhookTesten } from '../actions';
import { PartnerFelder } from '../Felder';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Partner' };

export default async function PartnerSeite({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('leitung');
  const p = await db.partner.findUnique({ where: { id: (await params).id } });
  if (!p) notFound();
  const [monate, summe, bestellungen, webhooks] = await Promise.all([
    db.$queryRaw<{ monat: string; tickets: number; umsatz: number; storniert: number }[]>`
      SELECT to_char((o."paidAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Vienna', 'YYYY-MM') AS monat,
        COUNT(t.id) FILTER (WHERE t.status <> 'storniert')::int AS tickets,
        COALESCE(SUM(t."priceCents") FILTER (WHERE t.status <> 'storniert'), 0)::int AS umsatz,
        COUNT(t.id) FILTER (WHERE t.status = 'storniert')::int AS storniert
      FROM "Order" o JOIN "Ticket" t ON t."orderId" = o.id
      WHERE o."partnerId" = ${p.id} AND o."paidAt" >= now() - interval '12 months'
      GROUP BY 1 ORDER BY 1 DESC`,
    db.ticket.groupBy({ by: ['status'], where: { order: { partnerId: p.id } }, _count: { _all: true }, _sum: { priceCents: true } }),
    db.order.findMany({ where: { partnerId: p.id, status: { not: 'offen' } }, orderBy: { createdAt: 'desc' }, take: 20, include: { show: { select: { startsAt: true } }, _count: { select: { tickets: true } } } }),
    db.auditLog.findMany({ where: { entity: 'partner', entityId: p.id, action: { startsWith: 'webhook' } }, orderBy: { createdAt: 'desc' }, take: 5 }),
  ]);
  const aktiv = summe.filter((s) => s.status !== 'storniert');
  const tickets = aktiv.reduce((n, s) => n + s._count._all, 0);
  const umsatz = aktiv.reduce((n, s) => n + (s._sum.priceCents ?? 0), 0);
  const storniert = summe.find((s) => s.status === 'storniert')?._count._all ?? 0;
  return (
    <>
      <DetailKopf krumen={[{ label: 'Verkauf' }, { label: 'Partner & API', href: '/partner' }, { label: p.name }]} titel={p.name}
        status={p.active ? <StatusPill status="bezahlt" label="Zugang aktiv" /> : <StatusPill status="storniert" label="Deaktiviert" />}
        untertitel={<>Schlüssel <code className="font-mono">{p.apiKeyPrefix}…</code> · angelegt {fmtDatum(p.createdAt)} · zuletzt aktiv {p.lastUsedAt ? fmtDatumZeit(p.lastUsedAt) : 'nie'}</>}
        aktionen={<Link href="/api-doku" className="btn-secondary"><Icon name="buch" className="h-4 w-4" />API-Dokumentation</Link>} />

      <Kennzahlen items={[
        { label: 'Tickets (gültig)', wert: tickets, icon: 'ticket' },
        { label: 'Umsatz brutto', wert: formatEur(umsatz), ton: 'gold', icon: 'euro' },
        { label: `Provision (${p.commissionPct} %)`, wert: formatEur(Math.round((umsatz * p.commissionPct) / 100)) },
        { label: 'Storniert', wert: storniert, icon: 'storno' },
      ]} />

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Formular action={partnerSpeichern} knopf="Speichern" className="card !overflow-visible p-5">
          <h2 className="h2 mb-3">Vertrag und Zugang</h2>
          <input type="hidden" name="id" value={p.id} />
          <PartnerFelder p={p} />
          <label className="mt-3 flex min-h-10 items-center gap-2.5"><input type="checkbox" name="active" defaultChecked={p.active} className="h-4 w-4 accent-[#6e5118]" /> <span className="text-sm font-semibold">Zugang aktiv</span></label>
        </Formular>

        <div className="grid content-start gap-6">
          <Formular action={schluesselNeu} knopf="Neuen Schlüssel erzeugen" variante="btn-danger" bestaetigen={`Neuen API-Schlüssel für ${p.name} erzeugen? Der bisherige Schlüssel funktioniert dann sofort nicht mehr.`} className="card p-5">
            <h2 className="h2">API-Schlüssel</h2>
            <p className="mt-1 text-sm text-muted">Aktueller Schlüssel beginnt mit <code className="font-mono">{p.apiKeyPrefix}</code>. Wir speichern nur einen Hash; verlorene Schlüssel lassen sich nicht anzeigen, nur ersetzen.</p>
            <input type="hidden" name="id" value={p.id} />
          </Formular>

          <section aria-labelledby="wh" className="card p-5">
            <h2 id="wh" className="h2">Webhooks</h2>
            <p className="mt-1 text-sm text-muted">{p.webhookUrl ? <>An <code className="break-all font-mono text-[13px]">{p.webhookUrl}</code>, signiert mit HMAC-SHA256 im Header X-LoC-Signature.</> : 'Keine Webhook-URL eingetragen.'}</p>
            <details className="mt-2 text-sm"><summary className="cursor-pointer font-medium text-accent-deep underline underline-offset-4">Webhook-Geheimnis anzeigen</summary><code className="mt-1 block break-all rounded bg-paper px-2 py-1 font-mono text-[13px]">{p.webhookSecret || '—'}</code></details>
            <div className="mt-3 flex flex-wrap gap-3">
              <Formular action={webhookTesten} knopf="Test-Webhook senden" variante="btn-secondary"><input type="hidden" name="id" value={p.id} /></Formular>
              <Formular action={webhookGeheimnisNeu} knopf="Geheimnis erneuern" variante="btn-secondary" bestaetigen="Neues Webhook-Geheimnis erzeugen? Der Partner muss es danach übernehmen."><input type="hidden" name="id" value={p.id} /></Formular>
            </div>
            {webhooks.length > 0 && (
              <ul className="mt-3 grid gap-1 text-xs">
                {webhooks.map((w) => { const d = w.data as { event?: string; status?: number; fehler?: string } | null; return <li key={w.id}>{fmtDatumZeit(w.createdAt)} · {d?.event} · {w.action === 'webhook_ok' ? <span className="text-pos">zugestellt ({d?.status})</span> : <span className="text-neg">Fehler: {d?.fehler}</span>}</li>; })}
              </ul>
            )}
          </section>
        </div>
      </div>

      <div className="mt-6 grid items-start gap-6 xl:grid-cols-2">
      <Abschnitt id="monate" titel="Verkäufe der letzten 12 Monate" flush>
        {monate.length ? (
          <table className="table rtab">
            <thead><tr><th scope="col">Monat</th><th scope="col" className="text-right">Tickets</th><th scope="col" className="text-right">Umsatz</th><th scope="col" className="text-right">Provision</th><th scope="col" className="text-right">Storniert</th></tr></thead>
            <tbody>{monate.map((r) => <tr key={r.monat}><td className="rtab-kopf">{r.monat.slice(5)}/{r.monat.slice(0, 4)}</td><td data-label="Tickets" className="num text-right">{r.tickets}</td><td data-label="Umsatz" className="num text-right">{formatEur(r.umsatz)}</td><td data-label="Provision" className="num text-right">{formatEur(Math.round((r.umsatz * p.commissionPct) / 100))}</td><td data-label="Storniert" className="num text-right">{r.storniert}</td></tr>)}</tbody>
          </table>
        ) : <Empty icon="diagramm">Noch keine Verkäufe über diesen Partner.</Empty>}
      </Abschnitt>

      <Abschnitt id="best" titel="Letzte Bestellungen" flush>
        {bestellungen.length ? (
          <table className="table rtab">
            <thead><tr><th scope="col">Bestellung</th><th scope="col">Partner-Ref.</th><th scope="col">Vorstellung</th><th scope="col" className="text-right">Tickets</th><th scope="col" className="text-right">Betrag</th><th scope="col">Status</th></tr></thead>
            <tbody>{bestellungen.map((o) => <tr key={o.id}><td className="rtab-kopf"><Link href={`/bestellungen/${o.id}`} className="font-mono text-[13px] font-semibold underline-offset-4 hover:underline">{o.number}</Link></td><td data-label="Partner-Ref." className="font-mono text-[13px]">{o.partnerRef ?? '–'}</td><td data-label="Vorstellung" className="whitespace-nowrap">{fmtDatum(o.show.startsAt)}, {fmtZeit(o.show.startsAt)}</td><td data-label="Tickets" className="num text-right">{o._count.tickets}</td><td data-label="Betrag" className="num text-right">{formatEur(o.totalCents)}</td><td data-label="Status"><StatusPill status={o.status} /></td></tr>)}</tbody>
          </table>
        ) : <Empty icon="ticket">Noch keine Bestellungen über die API.</Empty>}
      </Abschnitt>
      </div>
    </>
  );
}
