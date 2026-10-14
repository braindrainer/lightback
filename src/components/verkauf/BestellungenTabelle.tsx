'use client';
// Bestellliste mit Schnellaktionen je Zeile (⋯), Mehrfachauswahl und Karten am Handy
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { bestellungKurz, kundeSpeichern, notizSpeichern, reservierungAufheben, stornoAktion, ticketsSenden, type BestellungKurz } from '@/app/(app)/bestellungen/actions';
import { formatEur } from '@/lib/money';
import RechnungModal from '@/components/finanzen/RechnungModal';
import { Icon } from '@/components/icons';
import { Bestaetigen, Drawer, Menue, Modal, toast, type MenueEintrag } from '@/components/ui-client';
import { KundeFormular, NotizFormular, StornoFormular } from './BestellungAktionen';
import type { Ergebnis } from './ergebnis';

export type Zeile = {
  id: string; number: string; erstellt: string;
  kunde: { name: string; email: string; firma: string } | null;
  show: { id: string; label: string; kurz: string };
  tickets: number; plaetze: string[]; kanal: string; kanalName: string; partner: string | null; zahlung: string;
  status: string; totalCents: number; rechnung: { id: string; number: string } | null; manageToken: string;
  hatEmail: boolean; stornierbar: boolean; fristAbgelaufen: boolean;
};

const STATUS: Record<string, [string, string]> = {
  offen: ['Offen', 'bg-amber-50 text-amber-800 ring-amber-200'], bezahlt: ['Bezahlt', 'bg-emerald-50 text-emerald-800 ring-emerald-200'],
  storniert: ['Storniert', 'bg-gray-100 text-gray-700 ring-gray-200'], teilstorniert: ['Teilstorniert', 'bg-orange-50 text-orange-800 ring-orange-200'],
};
function Pill({ status }: { status: string }) {
  const [l, c] = STATUS[status] ?? [status, 'bg-gray-100 text-gray-700 ring-gray-200'];
  return <span className={`pill ring-1 ring-inset ${c}`}><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />{l}</span>;
}

const KANAL_ICON: Record<string, string> = { web: 'web', telefon: 'telefon', partner: 'partner', gast: 'stern', abendkasse: 'zahlung' };

type Dialog = { art: 'storno' | 'bearbeiten' | 'rechnung' | 'verwerfen'; zeile: Zeile } | null;

export default function BestellungenTabelle({ zeilen, sort, dir, sortHref, darfFrist, filterAktiv, children }: {
  zeilen: Zeile[]; sort: string; dir: 'asc' | 'desc'; sortHref: Record<string, string>; darfFrist: boolean; filterAktiv: boolean; children?: React.ReactNode;
}) {
  const router = useRouter();
  const [auswahl, setAuswahl] = useState<string[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [daten, setDaten] = useState<BestellungKurz | null>(null);
  const [laeuft, start] = useTransition();
  const [sammel, setSammel] = useState<'storno' | null>(null);
  const alleRef = useRef<HTMLInputElement>(null);

  // Auswahl auf sichtbare Zeilen beschränken (nach Filterwechsel)
  useEffect(() => { setAuswahl((a) => a.filter((id) => zeilen.some((z) => z.id === id))); }, [zeilen]);
  useEffect(() => { if (alleRef.current) alleRef.current.indeterminate = auswahl.length > 0 && auswahl.length < zeilen.length; }, [auswahl, zeilen]);

  const fertig = (meldung: string, art: 'ok' | 'fehler' = 'ok') => { toast(meldung, art); router.refresh(); };

  async function oeffnen(art: 'storno' | 'bearbeiten', zeile: Zeile) {
    setDaten(null);
    setDialog({ art, zeile });
    try { setDaten(await bestellungKurz(zeile.id)); } catch { toast('Bestellung konnte nicht geladen werden', 'fehler'); setDialog(null); }
  }

  const senden = (z: Zeile) => start(async () => {
    const r = await ticketsSenden(z.id, {});
    fertig(r.fehler ? `${z.number}: ${r.fehler}` : `${z.number}: ${r.meldung}`, r.fehler ? 'fehler' : 'ok');
  });

  const menue = (z: Zeile): MenueEintrag[] => [
    { label: 'Öffnen', href: `/bestellungen/${z.id}`, icon: 'pfeil' },
    { trenner: true },
    ...(z.stornierbar && z.hatEmail ? [{ label: 'Tickets erneut senden', onSelect: () => senden(z), icon: 'mail' }] : []),
    ...(z.stornierbar ? [
      { label: 'Tickets als PDF', href: `/bestellungen/${z.id}/tickets`, extern: true, icon: 'download' },
      { label: 'Mobile Ansicht', href: `/t/${z.manageToken}`, extern: true, icon: 'ticket' },
    ] : []),
    ...(z.rechnung ? [{ label: 'Rechnung ansehen', onSelect: () => setDialog({ art: 'rechnung', zeile: z }), icon: 'rechnung' }] : []),
    { label: 'Bearbeiten', onSelect: () => oeffnen('bearbeiten', z), icon: 'bearbeiten' },
    ...(z.stornierbar ? [{ label: 'Umbuchen', href: `/bestellungen/${z.id}?aktion=umbuchen`, icon: 'umbuchen' }] : []),
    ...(z.stornierbar ? [{ trenner: true as const }, { label: 'Stornieren …', onSelect: () => oeffnen('storno', z), icon: 'storno', gefahr: true }] : []),
    ...(z.status === 'offen' ? [{ trenner: true as const }, { label: 'Verwerfen …', onSelect: () => setDialog({ art: 'verwerfen', zeile: z }), icon: 'storno', gefahr: true }] : []),
  ];

  const gewaehlt = zeilen.filter((z) => auswahl.includes(z.id));
  const toggle = (id: string, an: boolean) => setAuswahl((a) => (an ? [...new Set([...a, id])] : a.filter((x) => x !== id)));

  const SortKopf = ({ k, children, rechts }: { k: string; children: React.ReactNode; rechts?: boolean }) => (
    <th scope="col" aria-sort={sort === k ? (dir === 'asc' ? 'ascending' : 'descending') : undefined} className={rechts ? 'text-right' : ''}>
      <Link href={sortHref[k]} scroll={false} className={`group inline-flex items-center gap-1 hover:text-ink ${sort === k ? 'text-ink' : ''}`}>
        {children}
        <Icon name="runter" className={`h-3.5 w-3.5 transition-transform ${sort === k ? (dir === 'asc' ? 'rotate-180' : '') : 'opacity-0 group-hover:opacity-50'}`} />
        <span className="sr-only">{sort === k ? (dir === 'asc' ? ', aufsteigend sortiert' : ', absteigend sortiert') : ', sortieren'}</span>
      </Link>
    </th>
  );

  return (
    <>
      <section aria-label="Ergebnisse" className="card tabelle-frei">
        {zeilen.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <span aria-hidden="true" className="grid h-12 w-12 place-items-center rounded-full bg-accent-soft text-accent-deep"><Icon name={filterAktiv ? 'suche' : 'ticket'} className="h-6 w-6" /></span>
            <p className="mt-3 text-[15px] font-semibold">{filterAktiv ? 'Keine Bestellungen für diesen Filter' : 'Noch keine Bestellungen'}</p>
            <p className="mt-1 max-w-md text-sm text-muted">{filterAktiv ? 'Suchbegriff oder Filter ändern – oder alle Filter zurücksetzen.' : 'Bestellungen aus Webshop, Telefon, Kassa und Partnern erscheinen hier.'}</p>
            <div className="mt-4 flex gap-2">{filterAktiv ? <Link href="/bestellungen" className="btn-secondary">Filter zurücksetzen</Link> : <Link href="/bestellungen/neu" className="btn-primary">Telefonverkauf starten</Link>}</div>
          </div>
        ) : (
          <>
            {/* Tabelle ab 768 px */}
            <div className="hidden max-xl:overflow-x-auto md:block">
            <table className="table [&_td]:!px-3 [&_th]:!px-3">
              <caption className="sr-only">Bestellungen, sortiert nach {sort}</caption>
              <thead>
                <tr>
                  <th scope="col" className="w-10 !pr-0"><input ref={alleRef} type="checkbox" aria-label="Alle Bestellungen dieser Seite auswählen" className="h-4 w-4 accent-accent align-middle"
                    checked={auswahl.length > 0 && auswahl.length === zeilen.length} onChange={(e) => setAuswahl(e.target.checked ? zeilen.map((z) => z.id) : [])} /></th>
                  <SortKopf k="datum">Bestellung</SortKopf>
                  <SortKopf k="kunde">Kund:in</SortKopf>
                  <SortKopf k="vorstellung">Vorstellung</SortKopf>
                  <SortKopf k="tickets" rechts>Tickets</SortKopf>
                  <SortKopf k="kanal">Kanal</SortKopf>
                  <th scope="col" className="max-xl:hidden">Zahlung</th>
                  <SortKopf k="status">Status</SortKopf>
                  <SortKopf k="betrag" rechts>Betrag</SortKopf>
                  <th scope="col" className="w-12"><span className="sr-only">Aktionen</span></th>
                </tr>
              </thead>
              <tbody>
                {zeilen.map((z) => {
                  const an = auswahl.includes(z.id);
                  return (
                    <tr key={z.id} className={an ? '[&>td]:!bg-accent-soft/50' : ''}>
                      <td className="!pr-0"><input type="checkbox" checked={an} onChange={(e) => toggle(z.id, e.target.checked)} aria-label={`${z.number} auswählen`} className="mt-0.5 h-4 w-4 accent-accent" /></td>
                      <td className="whitespace-nowrap">
                        <Link href={`/bestellungen/${z.id}`} className="font-mono text-[13px] font-semibold underline-offset-4 hover:underline">{z.number}</Link>
                        <span className="block text-xs text-muted">{z.erstellt}</span>
                      </td>
                      <td className="max-w-52">
                        {z.kunde ? <><span className="block truncate font-medium">{z.kunde.name || '–'}</span><span className="block truncate text-xs text-muted">{z.kunde.firma || z.kunde.email}</span></> : <span className="text-muted">anonym</span>}
                      </td>
                      <td className="whitespace-nowrap"><Link href={`/vorstellungen/${z.show.id}`} className="underline-offset-4 hover:underline">{z.show.kurz}</Link></td>
                      <td className="text-right">
                        <span className="num font-medium">{z.tickets}</span>
                        {z.plaetze.length > 0 && <span className="block whitespace-nowrap text-xs text-muted" title={z.plaetze.join(' · ')}>{z.plaetze[0]}{z.plaetze.length > 1 ? ` +${z.plaetze.length - 1}` : ''}</span>}
                      </td>
                      <td className="whitespace-nowrap"><span className="inline-flex items-center gap-1.5"><Icon name={KANAL_ICON[z.kanal] ?? 'ticket'} className="h-4 w-4 text-muted" />{z.kanalName}</span>{z.partner && <span className="block text-xs text-muted">{z.partner}</span>}</td>
                      <td className="max-w-36 text-[13px] max-xl:hidden"><span className="line-clamp-2">{z.zahlung}</span></td>
                      <td><Pill status={z.status} /></td>
                      <td className="num whitespace-nowrap text-right font-semibold">{formatEur(z.totalCents)}</td>
                      <td className="!py-1.5 text-right"><Menue label={`Aktionen für ${z.number}`} eintraege={menue(z)} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>

            {/* Karten unter 768 px */}
            <div className="md:hidden">
              <div className="flex items-center gap-2 border-b border-line-soft px-4 py-2.5 text-sm">
                <input id="alle-mobil" type="checkbox" className="h-5 w-5 accent-accent" checked={auswahl.length > 0 && auswahl.length === zeilen.length} onChange={(e) => setAuswahl(e.target.checked ? zeilen.map((z) => z.id) : [])} />
                <label htmlFor="alle-mobil" className="text-muted">Alle auf dieser Seite auswählen</label>
              </div>
              <ul>
                {zeilen.map((z) => (
                  <li key={z.id} className={`flex gap-3 border-b border-line-soft px-4 py-3.5 last:border-0 ${auswahl.includes(z.id) ? 'bg-accent-soft/50' : ''}`}>
                    <input type="checkbox" checked={auswahl.includes(z.id)} onChange={(e) => toggle(z.id, e.target.checked)} aria-label={`${z.number} auswählen`} className="mt-1 h-5 w-5 shrink-0 accent-accent" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link href={`/bestellungen/${z.id}`} className="block truncate text-[15px] font-semibold underline-offset-4 hover:underline">{z.kunde?.name || (z.kunde ? '–' : 'anonym')}</Link>
                          <span className="font-mono text-xs text-muted">{z.number}</span>
                        </div>
                        <div className="-mr-2 -mt-1 shrink-0"><Menue label={`Aktionen für ${z.number}`} eintraege={menue(z)} /></div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                        <Pill status={z.status} />
                        <span className="inline-flex items-center gap-1"><Icon name="kalender" className="h-3.5 w-3.5 text-muted" />{z.show.kurz}</span>
                        <span className="inline-flex items-center gap-1"><Icon name="ticket" className="h-3.5 w-3.5 text-muted" /><span className="num">{z.tickets}</span><span className="sr-only">Tickets</span></span>
                        <span className="text-muted">{z.kanalName}</span>
                        <span className="num ml-auto font-semibold">{formatEur(z.totalCents)}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
        {children}
      </section>

      {/* Leiste für die Mehrfachauswahl */}
      {gewaehlt.length > 0 && (
        <div role="region" aria-label="Auswahl" className="lb-rein sticky bottom-3 z-30 mt-4 flex flex-wrap items-center gap-2 rounded-xl bg-nacht px-4 py-3 text-sm text-white shadow-schwebend">
          <span className="mr-2 font-semibold"><span className="num">{gewaehlt.length}</span> ausgewählt</span>
          <button type="button" className="btn btn-sm border border-white/25 text-white hover:bg-white/10" disabled={laeuft} onClick={() => sammelSenden(gewaehlt)}><Icon name="mail" className="h-4 w-4" />Tickets erneut senden</button>
          <a className="btn btn-sm border border-white/25 text-white hover:bg-white/10" href={`/bestellungen/export?ids=${gewaehlt.map((z) => z.id).join(',')}`}><Icon name="download" className="h-4 w-4" />CSV exportieren</a>
          {darfFrist && <button type="button" className="btn btn-sm border border-[#ff9b93]/50 text-[#ffc4be] hover:bg-white/10" disabled={laeuft} onClick={() => setSammel('storno')}><Icon name="storno" className="h-4 w-4" />Stornieren …</button>}
          <button type="button" className="btn btn-sm ml-auto text-white/80 hover:text-white" onClick={() => setAuswahl([])}>Auswahl aufheben</button>
        </div>
      )}

      {/* Einzelaktionen */}
      <Drawer offen={dialog?.art === 'bearbeiten'} onClose={() => setDialog(null)} titel="Bestellung bearbeiten" breit
        untertitel={dialog && <span className="font-mono">{dialog.zeile.number}</span>}>
        {!daten ? <Laden /> : (
          <div className="grid gap-8">
            <section aria-labelledby="dr-h-kunde">
              <h3 id="dr-h-kunde" className="eyebrow mb-3">Kund:in</h3>
              <KundeFormular key={daten.id} prefix="dr" werte={daten.kunde} action={kundeSpeichern.bind(null, daten.id)} onErfolg={(e) => fertig(`${daten.number}: ${e.meldung ?? 'gespeichert'}`)} />
            </section>
            <section aria-labelledby="dr-h-notiz" className="border-t border-line pt-6">
              <h3 id="dr-h-notiz" className="eyebrow mb-3">Interne Notiz</h3>
              <NotizFormular key={daten.id} prefix="dr-notiz" ohneLabel note={daten.note} action={notizSpeichern.bind(null, daten.id)} onErfolg={() => fertig(`${daten.number}: Notiz gespeichert`)} />
            </section>
            <p className="text-xs text-muted">Jede Änderung steht mit vorher/nachher im Verlauf der Bestellung. Bereits ausgestellte Rechnungen bleiben unverändert.</p>
          </div>
        )}
      </Drawer>

      <Modal offen={dialog?.art === 'storno'} onClose={() => setDialog(null)} titel={dialog ? `Stornieren · ${dialog.zeile.number}` : 'Stornieren'} breit>
        {!daten ? <Laden /> : daten.tickets.length === 0 ? <p className="text-sm">Keine gültigen Tickets mehr.</p> : (
          <StornoFormular key={daten.id} prefix="ls" action={stornoAktion.bind(null, daten.id)} tickets={daten.tickets} fristAbgelaufen={daten.fristAbgelaufen} darfFrist={daten.darfFrist}
            onErfolg={(e: Ergebnis) => { fertig(`${daten.number}: ${e.meldung}`); if (!e.daten?.gutschein) setDialog(null); }} />
        )}
      </Modal>

      <Bestaetigen offen={dialog?.art === 'verwerfen'} onClose={() => setDialog(null)} titel="Bestellung verwerfen?" ja="Verwerfen" gefahr laeuft={laeuft}
        text={dialog && <>Die offene Bestellung <strong className="font-mono">{dialog.zeile.number}</strong> wird storniert, die reservierten Plätze werden wieder frei.</>}
        onJa={() => dialog && start(async () => { const z = dialog.zeile; const r = await reservierungAufheben(z.id, {}); setDialog(null); fertig(r.fehler ? `${z.number}: ${r.fehler}` : `${z.number}: ${r.meldung}`, r.fehler ? 'fehler' : 'ok'); })} />

      {dialog?.art === 'rechnung' && dialog.zeile.rechnung && <RechnungModal ohneKnopf offen id={dialog.zeile.rechnung.id} nummer={dialog.zeile.rechnung.number} onClose={() => setDialog(null)} />}

      <SammelStorno offen={sammel === 'storno'} onClose={() => setSammel(null)} zeilen={gewaehlt} darfFrist={darfFrist}
        fertig={(text, fehler) => { setSammel(null); setAuswahl([]); fertig(text, fehler ? 'fehler' : 'ok'); }} />
    </>
  );

  function sammelSenden(liste: Zeile[]) {
    const ok = liste.filter((z) => z.stornierbar && z.hatEmail);
    if (!ok.length) { toast('Keine der ausgewählten Bestellungen hat gültige Tickets und eine E-Mail-Adresse.', 'fehler'); return; }
    start(async () => {
      let gut = 0;
      const fehler: string[] = [];
      for (const z of ok) {
        const r = await ticketsSenden(z.id, {});
        if (r.fehler) fehler.push(`${z.number}: ${r.fehler}`); else gut++;
      }
      const ueber = liste.length - ok.length;
      fertig(`Tickets für ${gut} ${gut === 1 ? 'Bestellung' : 'Bestellungen'} gesendet${ueber ? `, ${ueber} übersprungen (ohne E-Mail oder Tickets)` : ''}${fehler.length ? `. Fehler: ${fehler.join('; ')}` : '.'}`, fehler.length ? 'fehler' : 'ok');
    });
  }
}

function Laden() {
  return <p role="status" className="flex items-center gap-2 py-6 text-sm text-muted"><span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent" />Wird geladen …</p>;
}

/** Mehrere Bestellungen nacheinander stornieren (ganze Bestellung), mit Ergebnisübersicht */
function SammelStorno({ offen, onClose, zeilen, darfFrist, fertig }: { offen: boolean; onClose: () => void; zeilen: Zeile[]; darfFrist: boolean; fertig: (text: string, fehler: boolean) => void }) {
  const [methode, setMethode] = useState('zahlungsmittel');
  const [grund, setGrund] = useState('kunde');
  const [notiz, setNotiz] = useState('');
  const [frist, setFrist] = useState(false);
  const [ergebnisse, setErgebnisse] = useState<{ number: string; ok: boolean; text: string }[]>([]);
  const [laeuft, setLaeuft] = useState(false);
  // Liste beim Start festhalten – nach jedem Storno kommen neue Zeilen vom Server
  const [fest, setFest] = useState<Zeile[] | null>(null);
  const basis = fest ?? zeilen;
  const moeglich = basis.filter((z) => z.stornierbar);
  const nichtMoeglich = basis.filter((z) => !z.stornierbar);
  const knapp = moeglich.filter((z) => z.fristAbgelaufen);
  useEffect(() => { if (offen) { setErgebnisse([]); setFrist(false); setFest(null); } }, [offen]);

  async function los() {
    setFest(zeilen);
    setLaeuft(true);
    const res: typeof ergebnisse = [];
    for (const z of moeglich) {
      const fd = new FormData();
      fd.set('umfang', 'alle'); fd.set('methode', methode); fd.set('grund', grund); fd.set('notiz', notiz);
      if (frist) fd.set('frist', 'ja');
      const r = await stornoAktion(z.id, {}, fd);
      res.push({ number: z.number, ok: !r.fehler, text: r.fehler ?? r.meldung ?? '' });
      setErgebnisse([...res]);
    }
    setLaeuft(false);
  }
  const gut = ergebnisse.filter((e) => e.ok).length;
  const fertigGelaufen = ergebnisse.length === moeglich.length && ergebnisse.length > 0 && !laeuft;

  return (
    <Modal offen={offen} onClose={() => { if (laeuft) return; if (fertigGelaufen) fertig(`${gut} von ${moeglich.length} Bestellungen storniert.`, gut < moeglich.length); else onClose(); }} titel={`${basis.length} Bestellungen stornieren`} breit>
      {ergebnisse.length === 0 ? (
        <div className="grid gap-4">
          <div>
            <p className="text-sm">Storniert wird jeweils die <strong>ganze Bestellung</strong>. Die Kund:innen erhalten eine Storno-E-Mail.</p>
            <ul className="mt-3 max-h-48 divide-y divide-line-soft overflow-y-auto rounded-lg border border-line text-sm" aria-label="Betroffene Bestellungen">
              {moeglich.map((z) => <li key={z.id} className="flex justify-between gap-3 px-3 py-2"><span><span className="font-mono">{z.number}</span> · {z.kunde?.name || 'anonym'}{z.fristAbgelaufen && <span className="ml-2 text-xs font-semibold text-warn">unter 24 h</span>}</span><span className="num">{formatEur(z.totalCents)}</span></li>)}
            </ul>
            {nichtMoeglich.length > 0 && <p className="mt-2 text-xs text-muted">Übersprungen (offen oder schon storniert): {nichtMoeglich.map((z) => z.number).join(', ')}</p>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label htmlFor="ss-methode" className="label">Erstattung</label><select id="ss-methode" className="input" value={methode} onChange={(e) => setMethode(e.target.value)}><option value="zahlungsmittel">Aufs Zahlungsmittel</option><option value="gutschein">Als Gutschein</option><option value="keine">Keine Erstattung</option></select></div>
            <div><label htmlFor="ss-grund" className="label">Grund</label><select id="ss-grund" className="input" value={grund} onChange={(e) => setGrund(e.target.value)}><option value="kunde">Wunsch der Kund:in</option><option value="kulanz">Kulanz</option><option value="sonstiges">Sonstiges</option></select></div>
          </div>
          <div><label htmlFor="ss-notiz" className="label">Notiz (intern)</label><input id="ss-notiz" className="input" value={notiz} onChange={(e) => setNotiz(e.target.value)} /></div>
          {knapp.length > 0 && (darfFrist
            ? <label className="flex min-h-8 items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-900"><input type="checkbox" checked={frist} onChange={(e) => setFrist(e.target.checked)} className="h-4 w-4 accent-accent" />{knapp.length} Bestellung(en) unter 24 Stunden vor Beginn – Frist übergehen (Ausnahme durch Leitung)</label>
            : <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{knapp.length} Bestellung(en) liegen innerhalb der 24-Stunden-Frist und werden abgelehnt.</p>)}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
            <button type="button" className="btn bg-neg text-white hover:bg-[#8f1e18]" disabled={!moeglich.length} onClick={los}>{moeglich.length} {moeglich.length === 1 ? 'Bestellung' : 'Bestellungen'} stornieren</button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          <p role="status" className="text-sm font-semibold">{laeuft ? `Storniere … ${ergebnisse.length} von ${moeglich.length}` : `Fertig: ${gut} von ${moeglich.length} storniert.`}</p>
          <ul className="max-h-72 divide-y divide-line-soft overflow-y-auto rounded-lg border border-line text-sm">
            {ergebnisse.map((e) => <li key={e.number} className="flex items-start gap-2 px-3 py-2"><Icon name={e.ok ? 'haken' : 'warnung'} className={`mt-0.5 h-4 w-4 shrink-0 ${e.ok ? 'text-pos' : 'text-neg'}`} /><span><span className="font-mono">{e.number}</span> – {e.text}</span></li>)}
          </ul>
          {fertigGelaufen && <div className="flex justify-end"><button type="button" className="btn-primary" onClick={() => fertig(`${gut} von ${moeglich.length} Bestellungen storniert.`, gut < moeglich.length)}>Schließen</button></div>}
        </div>
      )}
    </Modal>
  );
}
