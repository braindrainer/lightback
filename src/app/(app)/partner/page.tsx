import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatumZeit } from '@/lib/dates';
import { formatEur } from '@/lib/money';
import { Empty, Icon, PageHeader, StatusPill } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Partner & API' };

export default async function PartnerListe() {
  await requireRole('leitung');
  const seit = new Date(Date.now() - 30 * 864e5);
  const [partner, gesamt, monat] = await Promise.all([
    db.partner.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] }),
    db.$queryRaw<{ id: string; tickets: number; umsatz: number }[]>`SELECT o."partnerId" AS id, COUNT(t.id)::int AS tickets, COALESCE(SUM(t."priceCents"), 0)::int AS umsatz FROM "Order" o JOIN "Ticket" t ON t."orderId" = o.id WHERE o."partnerId" IS NOT NULL AND t.status <> 'storniert' GROUP BY 1`,
    db.$queryRaw<{ id: string; tickets: number }[]>`SELECT o."partnerId" AS id, COUNT(t.id)::int AS tickets FROM "Order" o JOIN "Ticket" t ON t."orderId" = o.id WHERE o."partnerId" IS NOT NULL AND t.status <> 'storniert' AND o."paidAt" >= ${seit} GROUP BY 1`,
  ]);
  const g = new Map(gesamt.map((r) => [r.id, r]));
  const m = new Map(monat.map((r) => [r.id, r.tickets]));
  return (
    <>
      <PageHeader title="Partner & API" krumen={[{ label: 'Verkauf' }, { label: 'Partner & API' }]} sub="Vertriebspartner mit eigenem API-Zugang, Provision und Kontingent.">
        <Link href="/api-doku" className="btn-secondary">API-Dokumentation</Link>
        <Link href="/partner/neu" className="btn-primary"><Icon name="plus" className="h-4 w-4" />Partner anlegen</Link>
      </PageHeader>
      <div className="card tabelle-frei">
        {partner.length ? (
          <table className="table rtab">
            <thead><tr><th scope="col">Partner</th><th scope="col">Schlüssel</th><th scope="col" className="text-right">Provision</th><th scope="col">Kategorien</th><th scope="col" className="text-right">Kontingent</th><th scope="col" className="text-right">Tickets 30 Tage</th><th scope="col" className="text-right">Umsatz gesamt</th><th scope="col">Zuletzt aktiv</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {partner.map((p) => (
                <tr key={p.id}>
                  <td className="rtab-kopf"><Link href={`/partner/${p.id}`} className="font-semibold underline-offset-4 hover:underline">{p.name}</Link>{p.contactEmail && <span className="block text-xs text-muted">{p.contactEmail}</span>}</td>
                  <td data-label="Schlüssel" className="font-mono text-[13px]">{p.apiKeyPrefix}…</td>
                  <td data-label="Provision" className="num text-right">{p.commissionPct} %</td>
                  <td data-label="Kategorien">{p.categories.map((k) => (k === 'R' ? 'Rollstuhl' : k)).join(', ')}</td>
                  <td data-label="Kontingent" className="num text-right">{p.quotaPerShow ?? '∞'}</td>
                  <td data-label="Tickets 30 Tage" className="num text-right">{m.get(p.id) ?? 0}</td>
                  <td data-label="Umsatz gesamt" className="num text-right font-medium">{formatEur(g.get(p.id)?.umsatz ?? 0)}</td>
                  <td data-label="Zuletzt aktiv" className="whitespace-nowrap">{p.lastUsedAt ? fmtDatumZeit(p.lastUsedAt) : <span className="text-muted">nie</span>}</td>
                  <td data-label="Status">{p.active ? <StatusPill status="bezahlt" label="Aktiv" /> : <StatusPill status="storniert" label="Deaktiviert" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty icon="partner" titel="Noch keine Partner" aktion={<Link href="/partner/neu" className="btn-primary btn-sm">Partner anlegen</Link>}>Legen Sie den ersten Partner an, um einen API-Schlüssel zu erzeugen.</Empty>}
      </div>
    </>
  );
}
