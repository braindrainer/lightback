// 80-mm-Ausdruck hinterlegter Freikarten: je Ticket ein QR-Code. Kein Kassabeleg – Freikarten sind kein Verkauf.
import { notFound } from 'next/navigation';
import { audit } from '@/lib/audit';
import { requireRole } from '@/lib/auth';
import { db, getSettings } from '@/lib/db';
import { fmtDatum, fmtZeit } from '@/lib/dates';
import { gastMeta } from '@/lib/gaeste';
import { sitzName } from '@/lib/saal';
import { qrInhalt, qrSvg } from '@/lib/tickets';
import { DruckSteuerung } from '../../../Bon';
import { BON_CSS } from '../../../bon-css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Freikarten drucken' };

export default async function FreikartenDruck({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ druck?: string }> }) {
  const u = await requireRole('kassa');
  const { id } = await params;
  const { druck } = await searchParams;
  const o = await db.order.findUnique({ where: { id }, include: { customer: true, show: true, tickets: { where: { status: { not: 'storniert' } }, orderBy: { seatId: 'asc' } } } });
  if (!o) notFound();
  const g = gastMeta(o.meta);
  const s = await getSettings();
  const qr = await Promise.all(o.tickets.map(async (t) => ({ t, svg: await qrSvg(qrInhalt(t.code, t.showId)) })));
  await audit(u, 'freikarten_druck', 'order', o.id, { tickets: o.tickets.length });
  const name = o.customer ? `${o.customer.firstName} ${o.customer.lastName}`.trim() : '';
  return (
    <div className="bg-paper py-4 print:bg-white print:py-0">
      <style dangerouslySetInnerHTML={{ __html: BON_CSS }} />
      <DruckSteuerung auto={druck === '1'} zurueck="/kassa/gaeste" />
      <article className="bon mx-auto shadow-md" aria-label={`Freikarten ${o.number}`}>
        <div className="mitte">
          <h1>Light of Creation</h1>
          <div>Votivkirche, Rooseveltplatz, 1090 Wien</div>
        </div>
        <hr />
        <div className="marke">FREIKARTE{o.tickets.length > 1 ? 'N' : ''} – KEIN VERKAUF</div>
        {name && <div className="z"><span>Gast</span><span>{name}</span></div>}
        <div className="z"><span>Vorstellung</span><span>{fmtDatum(o.show.startsAt)} {fmtZeit(o.show.startsAt)}</span></div>
        <div className="z"><span>Buchung</span><span>{o.number}</span></div>
        {g?.grund && <div className="z"><span>Grund</span><span>{g.grund}</span></div>}
        {qr.map(({ t, svg }) => (
          <div key={t.id} className="mitte" style={{ marginTop: 8 }}>
            <hr />
            <div><strong>{sitzName(t.seatId)}</strong></div>
            <div>{t.kat === 'R' ? 'inkl. Begleitperson' : `Kategorie ${t.kat}`} · Freikarte</div>
            {t.status === 'eingelassen' ? <div className="marke">BEREITS EINGELASSEN</div> : <div className="qr-klein" role="img" aria-label={`QR-Code Ticket ${t.code}`} dangerouslySetInnerHTML={{ __html: svg }} />}
            <div>{t.code}</div>
          </div>
        ))}
        <hr />
        <div className="mitte">Einlass ab 30 Min. vor Beginn. Die Show enthält Stroboskop-Effekte.</div>
        <div className="mitte" style={{ marginTop: 4 }}>{s.companyName}</div>
      </article>
    </div>
  );
}
