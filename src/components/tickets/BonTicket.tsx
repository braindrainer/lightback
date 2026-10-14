// Ticket auf dem 80-mm-Kassabon: Termin, Platz groß, QR (≥ 38 mm) und Code.
import type { Show, Ticket } from '@prisma/client';
import { fmtDatum, fmtZeit, TZ } from '@/lib/dates';
import { formatEur } from '@/lib/money';
import { SITZ } from '@/lib/saal';
import { ART_TEXT, EINLASS_MIN } from '@/lib/ticket-html';

export const BON_TICKET_CSS = `
.bon .bt{border:1.5px solid #000;border-radius:3mm;padding:2.5mm 2.5mm 3mm;margin:3mm 0;text-align:center;page-break-inside:avoid;break-inside:avoid}
.bon .bt-kopf{display:flex;justify-content:space-between;font-size:10px;letter-spacing:.08em;text-transform:uppercase;border-bottom:1px solid #000;padding-bottom:1.2mm;margin-bottom:1.6mm}
.bon .bt-titel{font-family:Georgia,"Times New Roman",serif;font-size:17px;font-weight:700;letter-spacing:.02em}
.bon .bt-termin{font-size:13px;font-weight:700;margin-top:.8mm}
.bon .bt-platz{display:flex;justify-content:center;gap:2mm;margin:2mm 0 1mm}
.bon .bt-platz>div{border:1px solid #000;border-radius:1.5mm;padding:.6mm 2.4mm;min-width:16mm}
.bon .bt-platz small{display:block;font-size:9px;letter-spacing:.1em;text-transform:uppercase}
.bon .bt-platz b{display:block;font-size:22px;line-height:1.1}
.bon .bt-qr svg{width:40mm;height:40mm;display:block;margin:2mm auto 1mm}
.bon .bt-code{font-size:16px;font-weight:700;letter-spacing:.18em}
.bon .bt-klein{font-size:10.5px;line-height:1.35;margin-top:1mm}
`;

const tag = (d: Date) => new Intl.DateTimeFormat('de-AT', { timeZone: TZ, weekday: 'short' }).format(d).replace('.', '');

export default function BonTicket({ t, svg, nr, von }: { t: Ticket & { show: Show }; svg: string; nr: number; von: number }) {
  const s = SITZ[t.seatId];
  const einlass = new Date(t.show.startsAt.getTime() - EINLASS_MIN * 60e3);
  const art = t.kat === 'R' ? 'inkl. Begleitperson' : `Kat. ${t.kat} · ${ART_TEXT[t.art] ?? t.art}`;
  return (
    <div className="bt" aria-label={`Ticket ${nr} von ${von}`}>
      <div className="bt-kopf"><span>Ticket {nr}/{von}</span><span>Votivkirche Wien</span></div>
      <div className="bt-titel">{t.show.title}</div>
      <div className="bt-termin">{tag(t.show.startsAt)} {fmtDatum(t.show.startsAt)} · {fmtZeit(t.show.startsAt)} Uhr</div>
      <div className="bt-platz">
        {s?.rollstuhl
          ? <div><small>Rollstuhlplatz</small><b>{s.stellplatz}</b></div>
          : <><div><small>Reihe</small><b>{s?.reihe ?? '–'}</b></div><div><small>Platz</small><b>{s?.platz ?? t.seatId}</b></div></>}
      </div>
      <div>{art} · {t.art === 'frei' || t.priceCents === 0 ? 'Freikarte' : formatEur(t.priceCents)}</div>
      {t.status === 'storniert'
        ? <div className="marke">STORNIERT – ungültig</div>
        : <div className="bt-qr" role="img" aria-label={`QR-Code Ticket ${t.code}`} dangerouslySetInnerHTML={{ __html: svg }} />}
      <div className="bt-code">{t.code}</div>
      <div className="bt-klein">Einlass ab {fmtZeit(einlass)} Uhr · Rooseveltplatz, 1090 Wien<br />Stroboskop- und Blitzlichteffekte</div>
    </div>
  );
}
