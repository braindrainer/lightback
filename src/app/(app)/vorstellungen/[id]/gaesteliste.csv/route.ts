// Gästeliste einer Vorstellung als CSV (Excel-tauglich: UTF-8 mit BOM, Semikolon)
import { assertRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtZeit, wienTag } from '@/lib/dates';
import { sitzName } from '@/lib/saal';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const feld = (v: string) => {
  // Formel-Injektion in Tabellenprogrammen verhindern
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const TSTATUS: Record<string, string> = { gueltig: 'gültig', eingelassen: 'eingelassen', storniert: 'storniert' };

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  let u;
  try { u = await assertRole('leitung'); } catch { return new Response('Keine Berechtigung', { status: 403 }); }
  const { id } = await params;
  const show = await db.show.findUnique({ where: { id } });
  if (!show) return new Response('Nicht gefunden', { status: 404 });
  const orders = await db.order.findMany({
    where: { showId: id, status: { in: ['bezahlt', 'teilstorniert'] } },
    include: { customer: true, tickets: { where: { status: { not: 'storniert' } }, orderBy: { seatId: 'asc' } } },
    orderBy: { number: 'asc' },
  });
  const zeilen = [['Name', 'E-Mail', 'Telefon', 'Bestellung', 'Anzahl', 'Plätze', 'Status'].join(';')];
  const sortiert = orders.filter((o) => o.tickets.length).sort((a, b) => (a.customer?.lastName ?? '').localeCompare(b.customer?.lastName ?? '', 'de'));
  for (const o of sortiert) {
    const c = o.customer;
    const status = o.tickets.every((t) => t.status === 'eingelassen') ? 'eingelassen' : o.tickets.some((t) => t.status === 'eingelassen') ? 'teilweise eingelassen' : TSTATUS.gueltig;
    zeilen.push([
      c ? `${c.lastName} ${c.firstName}`.trim() : '', c?.email ?? '', c?.phone ?? '', o.number, String(o.tickets.length),
      o.tickets.map((t) => `${sitzName(t.seatId)}${TSTATUS[t.status] === 'eingelassen' ? ' (eingelassen)' : ''}`).join(' | '), status,
    ].map(feld).join(';'));
  }
  await audit(u, 'gaesteliste_export', 'Show', id, { bestellungen: sortiert.length });
  const name = `gaesteliste-${wienTag(show.startsAt)}-${fmtZeit(show.startsAt).replace(':', '')}.csv`;
  return new Response('﻿' + zeilen.join('\r\n') + '\r\n', {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' },
  });
}
