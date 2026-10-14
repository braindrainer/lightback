import { audit } from '@/lib/audit';
import { currentUser, hat } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatumZeit } from '@/lib/dates';
import { csv, csvAntwort, dezimal } from '@/lib/finanzen/csv';
import { sitzName } from '@/lib/saal';
import { KANAL_NAME, ZAHLART_NAME } from '@/components/verkauf/texte';

export const dynamic = 'force-dynamic';

// Ausgewählte Bestellungen als CSV (Semikolon, Dezimalkomma, UTF-8 mit BOM)
export async function GET(req: Request) {
  const u = await currentUser();
  if (!hat(u, 'leitung')) return new Response('Keine Berechtigung', { status: 403 });
  const ids = (new URL(req.url).searchParams.get('ids') ?? '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 500);
  if (!ids.length) return new Response('Keine Bestellungen gewählt', { status: 400 });
  const orders = await db.order.findMany({
    where: { id: { in: ids } }, orderBy: { createdAt: 'desc' },
    include: { customer: true, show: { select: { startsAt: true } }, partner: { select: { name: true } }, tickets: { where: { status: { not: 'storniert' } }, select: { seatId: true } }, payments: { select: { provider: true } } },
  });
  await audit(u, 'export_bestellungen', 'order', null, { anzahl: orders.length });
  const zeilen = [
    ['Bestellung', 'Bestellt', 'Vorname', 'Nachname', 'Firma', 'E-Mail', 'Telefon', 'Vorstellung', 'Tickets', 'Plätze', 'Kanal', 'Partner', 'Zahlung', 'Status', 'Summe EUR', 'Gutschein EUR', 'Bezahlt EUR', 'Erstattet EUR'],
    ...orders.map((o) => [
      o.number, fmtDatumZeit(o.createdAt), o.customer?.firstName ?? '', o.customer?.lastName ?? '', o.customer?.company ?? '', o.customer?.email ?? '', o.customer?.phone ?? '',
      fmtDatumZeit(o.show.startsAt), o.tickets.length, o.tickets.map((t) => sitzName(t.seatId)).join(', '), KANAL_NAME[o.channel] ?? o.channel, o.partner?.name ?? '',
      [...new Set(o.payments.map((p) => ZAHLART_NAME[p.provider] ?? p.provider))].join(', '), o.status, dezimal(o.totalCents), dezimal(o.voucherCents), dezimal(o.paidCents), dezimal(o.refundedCents),
    ]),
  ];
  return csvAntwort(csv(zeilen), `bestellungen-${new Date().toISOString().slice(0, 10)}.csv`);
}
