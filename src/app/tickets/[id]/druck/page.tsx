// Druckticket (A6 hoch): QR, Platz, Termin, Hinweise. Ohne Backend-Navigation.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { audit } from '@/lib/audit';
import { requireRole } from '@/lib/auth';
import { db, getSettings } from '@/lib/db';
import { fmtDatum, fmtZeit } from '@/lib/dates';
import { formatEur } from '@/lib/money';
import { sitzName } from '@/lib/saal';
import { qrInhalt, qrSvg } from '@/lib/tickets';
import DruckKnopf from '@/components/DruckKnopf';
import MiniSaalplan from '@/components/MiniSaalplan';
import { ART_NAME, KAT_NAME } from '@/components/verkauf/texte';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ticket drucken' };

const WOCHENTAG = (d: Date) => new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', weekday: 'long' }).format(d);

export default async function Druck({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireRole('leitung', 'kassa', 'einlass');
  const { id } = await params;
  const t = await db.ticket.findUnique({ where: { id }, include: { show: true, order: { select: { number: true, customer: { select: { firstName: true, lastName: true } } } } } });
  if (!t) notFound();
  const [svg, s] = await Promise.all([qrSvg(qrInhalt(t.code, t.showId)), getSettings()]);
  await audit(u, 'ticket_druck', 'ticket', t.id, { code: t.code, status: t.status });
  const name = t.order.customer ? `${t.order.customer.firstName} ${t.order.customer.lastName}`.trim() : '';
  return (
    <main id="inhalt" className="druck-seite min-h-dvh bg-paper p-4 print:bg-white print:p-0">
      <style>{`@page { size: A6 portrait; margin: 6mm; } @media print { .nicht-drucken { display: none !important; } html, body { background: #fff !important; } .ticket { box-shadow: none !important; border: none !important; width: auto !important; } }`}</style>
      <div className="nicht-drucken mx-auto mb-4 flex max-w-[105mm] flex-wrap items-center justify-between gap-2">
        <Link href={`/tickets/${t.id}`} className="btn-secondary">Zurück zum Ticket</Link>
        <DruckKnopf>Ticket drucken</DruckKnopf>
      </div>
      <article className="ticket mx-auto grid w-[105mm] max-w-full gap-2 rounded-xl border border-line bg-white p-[6mm] text-ink shadow" aria-label={`Ticket ${t.code}`}>
        <header className="flex items-baseline justify-between gap-2 border-b border-ink pb-1.5">
          <h1 className="text-lg font-semibold tracking-tight">{t.show.title}</h1>
          <span className="text-[10px] uppercase tracking-[0.2em] text-muted">Votivkirche Wien</span>
        </header>
        {t.status !== 'gueltig' && <p className="rounded bg-red-50 px-2 py-1 text-center text-sm font-bold text-neg">{t.status === 'storniert' ? 'STORNIERT – UNGÜLTIG' : 'BEREITS EINGELASSEN'}</p>}
        <p className="text-base"><strong>{WOCHENTAG(t.show.startsAt)}, {fmtDatum(t.show.startsAt)}</strong><br />Beginn {fmtZeit(t.show.startsAt)} Uhr</p>
        <div className="grid grid-cols-[1fr_auto] items-center gap-3">
          <div>
            <p className="text-xl font-bold leading-tight">{sitzName(t.seatId)}</p>
            <p className="text-sm">{KAT_NAME[t.kat] ?? t.kat} · {ART_NAME[t.art] ?? t.art}</p>
            <p className="text-sm">{formatEur(t.priceCents)} inkl. {t.vatRate} % USt</p>
            {name && <p className="mt-1 text-xs text-muted">{name}</p>}
          </div>
          <div role="img" aria-label={`QR-Code Ticket ${t.code}`} className="w-[34mm]" dangerouslySetInnerHTML={{ __html: svg.replace('<svg ', '<svg aria-hidden="true" focusable="false" width="100%" ') }} />
        </div>
        <p className="text-center font-mono text-lg font-semibold tracking-[0.2em]">{t.code}</p>
        <MiniSaalplan seatId={t.seatId} className="mx-auto h-[36mm] w-auto" />
        <p className="rounded border border-ink px-2 py-1 text-[11px] leading-snug"><strong>Hinweis:</strong> Die Show enthält Stroboskop- und Lichteffekte. Für Menschen mit Photosensibilität oder Epilepsie nicht geeignet.</p>
        <footer className="border-t border-line pt-1 text-[9px] leading-snug text-muted">Bestellung {t.order.number} · {s.companyName}, {s.street}, {s.zip} {s.city} · {s.uid}</footer>
      </article>
    </main>
  );
}
