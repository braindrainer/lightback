// Tickets am Handy: öffentlich über den Link aus der Buchungsbestätigung (manageToken), ohne Anmeldung.
import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { esc } from '@/lib/marke';
import { bestellungMitTickets, ORT, qrFuer, shopUrl, terminText, ticketCss, ticketKarte, ticketLabel, ticketsAusBestellung } from '@/lib/ticket-html';
import Wischpunkte from '@/components/tickets/Wischpunkte';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: { absolute: 'Ihre Tickets – Light of Creation' }, robots: { index: false, follow: false, nocache: true }, referrer: 'no-referrer' };
export const viewport: Viewport = { themeColor: '#070b14', colorScheme: 'dark' };

const CSS = `
html,body{background:#0c1322 !important}
.tm{min-height:100dvh;background:#0c1322;color:#f4efe6;font-family:"Inter",system-ui,sans-serif;padding:0 0 calc(28px + env(safe-area-inset-bottom))}
.tm a{color:inherit}
.tm-kopf{text-align:center;padding:calc(18px + env(safe-area-inset-top)) 20px 6px}
.tm-kopf h1{font:600 30px/1.15 "Inter",system-ui,sans-serif;margin:6px 0 6px;color:#ecd3a0}
.tm-kopf p{margin:0;color:#c4bfb3;font-size:15px}
.tm-hell{display:flex;align-items:center;justify-content:center;gap:8px;margin:14px auto 0;max-width:420px;padding:0 20px;font-size:14px;color:#ecd3a0;text-align:center}
.tm-hell svg{flex:none}
.tm-karten{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;padding:10px max(10vw,calc(50vw - 200px)) 8px;scrollbar-width:none;-webkit-overflow-scrolling:touch;outline-offset:-3px}
.tm-karten::-webkit-scrollbar{display:none}
.tm-karten:focus-visible{outline:3px solid #ecd3a0}
.tm-karte{flex:0 0 min(80vw,400px);scroll-snap-align:center;scroll-snap-stop:always;font-size:min(3.85vw,16.5px)}
.tm-karte .lt{border:1px solid #2a3654;box-shadow:0 18px 40px rgba(0,0,0,.45)}
.tm-karte .lt-qr{width:14.5em;height:14.5em}
.tm-punkte{text-align:center;margin:14px auto 0;max-width:440px;padding:0 12px}
.tm-blaettern{display:flex;align-items:center;justify-content:space-between;gap:8px}
.tm-zaehler{margin:0;display:grid;gap:2px}
.tm-zaehler strong{font-size:19px;color:#ecd3a0}
.tm-zaehler span{font-size:13.5px;color:#c4bfb3}
.tm-pfeil{flex:none;width:48px;height:48px;border-radius:50%;border:1.5px solid #d9b877;background:#121b2e;color:#ecd3a0;display:grid;place-items:center;cursor:pointer}
.tm-pfeil:disabled{opacity:.3;cursor:default}
.tm-pfeil:focus-visible{outline:3px solid #ecd3a0;outline-offset:2px}
.tm-punkte ul{margin-top:4px !important}
.tm-punkte ul{display:flex;justify-content:center;gap:2px;list-style:none;margin:0;padding:0}
.tm-punkte button{width:28px;height:28px;border:0;background:transparent;display:grid;place-items:center;cursor:pointer;border-radius:50%}
.tm-punkte button span{width:9px;height:9px;border-radius:50%;border:1.5px solid #d9b877}
.tm-punkte button[aria-current] span{background:#d9b877;width:11px;height:11px}
.tm-punkte button:focus-visible{outline:2px solid #ecd3a0}
.tm-aktionen{max-width:440px;margin:22px auto 0;padding:0 20px;display:grid;gap:10px}
.tm-knopf{display:flex;align-items:center;gap:12px;min-height:52px;padding:10px 16px;border-radius:14px;background:#121b2e;border:1px solid #2a3654;text-decoration:none;font-weight:600;font-size:16px}
.tm-knopf:hover{border-color:#d9b877}
.tm-knopf:focus-visible{outline:3px solid #ecd3a0;outline-offset:2px}
.tm-knopf small{display:block;font-weight:400;font-size:13.5px;color:#c4bfb3;margin-top:1px}
.tm-knopf svg{flex:none;color:#d9b877}
.tm-knopf.gold{background:#d9b877;color:#070b14;border-color:#d9b877}
.tm-knopf.gold svg{color:#070b14}
.tm-knopf.gold small{color:#2b2414}
.tm-fuss{max-width:440px;margin:26px auto 0;padding:0 20px;font-size:13px;line-height:1.5;color:#b9b3a6;text-align:center}
@media (min-width:900px){.tm-karten{flex-wrap:wrap;justify-content:center;overflow:visible;padding:20px}.tm-punkte{display:none}}
`;

const I = {
  pdf: '<path d="M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" />',
  kal: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  ort: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.4"/>',
  verw: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  druck: '<path d="M7 9V4h10v5M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v6H7z"/>',
  sonne: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
};
const Icon = ({ d }: { d: string }) => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: d }} />;

export default async function TicketsMobil({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-z0-9]{20,40}$/.test(token)) notFound();
  const o = await bestellungMitTickets({ manageToken: token });
  if (!o || !['bezahlt', 'teilstorniert'].includes(o.status)) notFound();
  const liste = ticketsAusBestellung(o);
  const karten = await Promise.all(liste.map(async (t) => ({ t, html: ticketKarte(t, { variante: 'digital', modus: 'web', qr: t.status === 'storniert' ? '' : await qrFuer(t), ueberschrift: 'p' }) })));
  const aktiv = liste.filter((t) => t.status !== 'storniert');
  const start = (aktiv[0] ?? liste[0])?.startsAt ?? o.show.startsAt;
  const pdf = `/api/tickets/${o.manageToken}.pdf`;
  const shop = shopUrl();
  return (
    <main id="inhalt" className="tm">
      <style dangerouslySetInnerHTML={{ __html: ticketCss('web') + CSS }} />
      <header className="tm-kopf">
        <h1>{aktiv.length === 1 ? 'Ihr Ticket' : 'Ihre Tickets'}</h1>
        <p>{terminText(start)}</p>
        <p>Bestellung {o.number}{aktiv.length > 1 ? ` · ${aktiv.length} Tickets` : ''}</p>
      </header>
      {aktiv.length > 0 && <p className="tm-hell"><Icon d={I.sonne} />Bitte stellen Sie den Bildschirm beim Einlass hell.</p>}
      <Wischpunkte ziel="tm-karten" labels={liste.map(ticketLabel)} />
      <div id="tm-karten" className="tm-karten" role="region" aria-label={liste.length > 1 ? 'Tickets – seitlich wischen für weitere' : 'Ticket'} tabIndex={0}>
        {karten.map(({ t, html }) => <div key={t.id} className="tm-karte" dangerouslySetInnerHTML={{ __html: html }} />)}
      </div>
      <nav className="tm-aktionen" aria-label="Weitere Möglichkeiten">
        {aktiv.length > 0 && <a className="tm-knopf gold" href={`${pdf}?format=a6&variante=digital&download=1`}><Icon d={I.pdf} /><span>Als PDF speichern<small>Alle Tickets in einer Datei</small></span></a>}
        {aktiv.length > 0 && <a className="tm-knopf" href={pdf} target="_blank" rel="noopener"><Icon d={I.druck} /><span>Zum Ausdrucken (A4)<small>Öffnet in neuem Fenster</small></span></a>}
        {aktiv.length > 0 && <a className="tm-knopf" href={`/api/tickets/${o.manageToken}.ics`}><Icon d={I.kal} /><span>Zum Kalender hinzufügen<small>{terminText(start)}</small></span></a>}
        <a className="tm-knopf" href={ORT.karte} target="_blank" rel="noopener noreferrer"><Icon d={I.ort} /><span>Anfahrt: {ORT.name}<small>{ORT.adresse}, {ORT.plzOrt} – Karte in neuem Fenster</small></span></a>
        {shop && <a className="tm-knopf" href={`${shop}/de/buchung/${o.manageToken}`}><Icon d={I.verw} /><span>Buchung verwalten<small>Stornieren oder umbuchen bis 24 Stunden vorher</small></span></a>}
      </nav>
      <p className="tm-fuss" dangerouslySetInnerHTML={{ __html: `Einlass ab 30 Minuten vor Beginn. Die Show enthält Stroboskop- und Blitzlichteffekte.<br>Parnassus Immersive GmbH · ${esc(ORT.name)} Wien` }} />
    </main>
  );
}
