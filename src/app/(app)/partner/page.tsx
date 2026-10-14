import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatumZeit } from '@/lib/dates';
import { formatEur } from '@/lib/money';
import { Empty, PageHeader } from '@/components/ui';

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
      <PageHeader title="Partner & API" sub="Vertriebspartner mit eigenem API-Zugang">
        <Link href="/api-doku" className="btn-secondary">API-Dokumentation</Link>
        <Link href="/partner/neu" className="btn-primary">Partner anlegen</Link>
      </PageHeader>
      <div className="card">
        {partner.length ? (
          <table className="table">
            <thead><tr><th scope="col">Partner</th><th scope="col">Schlüssel</th><th scope="col" className="text-right">Provision</th><th scope="col">Kategorien</th><th scope="col" className="text-right">Kontingent</th><th scope="col" className="text-right">Tickets 30 Tage</th><th scope="col" className="text-right">Umsatz gesamt</th><th scope="col">Zuletzt aktiv</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {partner.map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/partner/${p.id}`} className="font-medium underline underline-offset-4">{p.name}</Link>{p.contactEmail && <p className="text-xs text-muted">{p.contactEmail}</p>}</td>
                  <td className="font-mono text-[13px]">{p.apiKeyPrefix}…</td>
                  <td className="num text-right">{p.commissionPct} %</td>
                  <td>{p.categories.map((k) => (k === 'R' ? 'Rollstuhl' : k)).join(', ')}</td>
                  <td className="num text-right">{p.quotaPerShow ?? '∞'}</td>
                  <td className="num text-right">{m.get(p.id) ?? 0}</td>
                  <td className="num text-right">{formatEur(g.get(p.id)?.umsatz ?? 0)}</td>
                  <td className="whitespace-nowrap">{p.lastUsedAt ? fmtDatumZeit(p.lastUsedAt) : <span className="text-muted">nie</span>}</td>
                  <td>{p.active ? <span className="pill bg-emerald-50 text-emerald-800">Aktiv</span> : <span className="pill bg-gray-100 text-gray-700">Deaktiviert</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>Noch keine Partner. Legen Sie den ersten an, um einen API-Schlüssel zu erzeugen.</Empty>}
      </div>
    </>
  );
}
