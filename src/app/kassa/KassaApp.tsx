'use client';
// Verkaufsoberfläche (Touch-Kassa): Artikel-Kacheln, Abendkasse mit Vorstellungswahl, Warenkorb rechts bzw. als Blatt am Handy,
// Zahlung bar (Ziffernblock, Rückgeld) oder Karte (Terminal bestätigen), danach Beleg drucken. Belege signiert der Server (RKSV).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sheet } from '@/components/vorort/Sheet';
import { OnlineAnzeige, useOnline } from '@/components/vorort/pwa';
import { istGutschein, KATEGORIEN, ticketArt, ticketPreis } from '@/lib/kassa-shared';
import { formatEur, parseAmountToCents } from '@/lib/money';
import type { Kat, Preise } from '@/lib/saal';
import { kasseSetzenAction, verkaufAction } from './actions';

type Produkt = { id: string; name: string; category: string; priceCents: number; vatRate: number; color: string; sku: string | null; stock: number | null };
type Show = { id: string; label: string; tag: string; zeit: string; prices: Preise; frei: Record<Kat, number>; kap: Record<Kat, number> };
type Beleg = { id: string; number: number; zeit: string; totalCents: number; payment: string; type: string };
type Ergebnis = { id: string; number: number; totalCents: number; changeCents: number | null; givenCents: number | null; zahlart: 'bar' | 'karte'; training: boolean };
type Zeile = { p: Produkt; n: number; preis: number; ust: number };

const SCHNELL = [500, 1000, 2000, 5000, 10000];
const KAT_FARBE: Record<string, string> = { ticket: '#b08530', merch: '#9b4dca', getraenk: '#2f7fc4', snack: '#c2620a', sonstiges: '#1d7a47' };
const TICKET_FARBE: Record<Kat, string> = { I: '#b08530', II: '#8676e6', R: '#2f7fc4' };
const KAT_NAME: Record<Kat, string> = { I: 'Kat. I', II: 'Kat. II', R: 'Rollstuhl' };
const ZAHLART: Record<string, string> = { bar: 'Bar', karte: 'Karte' };

const farbe = (p: Produkt) => p.color || (ticketArt(p) ? TICKET_FARBE[ticketArt(p)!.kat] : KAT_FARBE[p.category] ?? '#59617a');
const stueck = (n: number) => `${n} Artikel`;

export default function KassaApp({ kasse, kassen, schicht, produkte, shows, ticketUst, belege, fehler: serverFehler }: {
  kasse: { id: string; name: string; kassenId: string; signer: string };
  kassen: { id: string; name: string; kassenId: string }[];
  schicht: { id: string; seit: string; seitLang: string; von: string; wechselgeld: string };
  produkte: Produkt[];
  shows: Show[];
  ticketUst: number;
  belege: Beleg[];
  fehler?: string;
}) {
  const [online, setOnline] = useOnline();
  const [kat, setKat] = useState<string>('alle');
  const [suche, setSuche] = useState('');
  const [korb, setKorb] = useState<Record<string, number>>({});
  const [showId, setShowId] = useState(shows[0]?.id ?? '');
  const [training, setTraining] = useState(false);
  const [zahlart, setZahlart] = useState<'bar' | 'karte' | null>(null);
  const [gegeben, setGegeben] = useState('');
  const [fehler, setFehler] = useState(serverFehler ?? '');
  const [busy, setBusy] = useState(false);
  const [erg, setErg] = useState<Ergebnis | null>(null);
  const [druck, setDruck] = useState<{ id: string; n: number } | null>(null);
  const [blatt, setBlatt] = useState<null | 'korb' | 'kasse' | 'belege' | 'hilfe'>(null);
  const [ansage, setAnsage] = useState('');
  const [eigene, setEigene] = useState<Beleg[]>([]); // eben erstellte Belege, bis die Seite neu geladen ist
  const zahlDialog = useRef<HTMLDialogElement>(null);
  const fertigDialog = useRef<HTMLDialogElement>(null);
  const neuKnopf = useRef<HTMLButtonElement>(null);
  const suchFeld = useRef<HTMLInputElement>(null);
  const aktion = useRef('');
  const laeuft = useRef(false); // Sperre gegen doppeltes Absenden (Enter + Klick im selben Moment)
  const langDruck = useRef<{ t: ReturnType<typeof setTimeout> | null; ausgeloest: boolean }>({ t: null, ausgeloest: false });

  const show = shows.find((s) => s.id === showId);
  const preis = useCallback((p: Produkt) => {
    const t = ticketArt(p);
    return t && show ? ticketPreis(show.prices, t.kat, t.art) : p.priceCents;
  }, [show]);
  const kategorien = KATEGORIEN.filter((k) => produkte.some((p) => p.category === k.key));
  const hatTicketArtikel = produkte.some((p) => p.category === 'ticket');
  const s = suche.trim().toLowerCase();
  const sichtbar = produkte.filter((p) => (s ? `${p.name} ${p.sku ?? ''}`.toLowerCase().includes(s) : kat === 'alle' || p.category === kat));

  const zeilen: Zeile[] = useMemo(() => Object.entries(korb).filter(([, n]) => n > 0)
    .map(([id, n]) => ({ p: produkte.find((x) => x.id === id), n }))
    .filter((z): z is { p: Produkt; n: number } => !!z.p)
    .map(({ p, n }) => ({ p, n, preis: preis(p), ust: ticketArt(p) ? ticketUst : p.vatRate })), [korb, produkte, preis, ticketUst]);
  const summe = zeilen.reduce((a, z) => a + z.n * z.preis, 0);
  const anzahl = zeilen.reduce((a, z) => a + z.n, 0);
  const hatTickets = zeilen.some((z) => ticketArt(z.p));
  const steuern = useMemo(() => {
    const m = new Map<number, number>();
    for (const z of zeilen) m.set(z.ust, (m.get(z.ust) ?? 0) + z.n * z.preis);
    return [...m.entries()].sort((a, b) => b[0] - a[0]).map(([satz, brutto]) => ({ satz, ust: satz ? brutto - Math.round(brutto / (1 + satz / 100)) : 0 }));
  }, [zeilen]);
  const imKorbKat = (k: Kat) => zeilen.reduce((a, z) => a + (ticketArt(z.p)?.kat === k ? z.n : 0), 0);
  const gegebenCents = gegeben.trim() ? parseAmountToCents(gegeben) : summe;
  const rueckgeld = gegebenCents - summe;

  // Ansage für Screenreader nach jeder Änderung am Warenkorb
  useEffect(() => {
    if (!aktion.current) return;
    setAnsage(`${aktion.current} Warenkorb: ${stueck(anzahl)}, Summe ${formatEur(summe)}.`);
    aktion.current = '';
  }, [anzahl, summe]);

  function sperrgrund(p: Produkt): string | null {
    const t = ticketArt(p);
    if (!online) return 'offline';
    if (training && (t || istGutschein(p))) return 'nicht im Training';
    if (t && !show) return 'keine Vorstellung';
    if (t && show && show.frei[t.kat] - imKorbKat(t.kat) <= 0) return 'ausverkauft';
    return null;
  }

  function dazu(p: Produkt, d = 1) {
    setFehler('');
    if (d > 0) {
      const g = sperrgrund(p);
      if (g === 'nicht im Training') return setFehler('Im Trainingsmodus nur Waren – keine Tickets oder Gutscheine.');
      if (g === 'keine Vorstellung') return setFehler('Heute gibt es keine Vorstellung mehr im Verkauf.');
      if (g === 'ausverkauft') return setFehler('Für diese Kategorie sind keine Plätze mehr frei.');
      if (g) return;
    }
    const alt = korb[p.id] ?? 0;
    const neu = Math.max(0, Math.min(99, alt + d));
    if (neu === alt) return;
    aktion.current = d > 0 ? `${p.name} hinzugefügt.` : neu ? `${p.name}: eins weniger.` : `${p.name} entfernt.`;
    setKorb((k) => ({ ...k, [p.id]: neu }));
  }
  function leeren() {
    if (!anzahl) return;
    aktion.current = 'Warenkorb geleert.';
    setKorb({});
  }

  function oeffnen(z: 'bar' | 'karte') {
    if (!anzahl || !online || busy) return;
    setFehler('');
    setBlatt(null);
    setZahlart(z);
    setGegeben('');
    zahlDialog.current?.showModal();
  }
  function schliessen() {
    zahlDialog.current?.close();
    setZahlart(null);
  }

  async function bezahlen() {
    if (!zahlart || laeuft.current) return;
    if (!navigator.onLine) { setOnline(false); return setFehler('Keine Verbindung – Verkauf nicht möglich.'); }
    if (zahlart === 'bar' && rueckgeld < 0) return setFehler('Der gegebene Betrag reicht nicht.');
    laeuft.current = true;
    setBusy(true);
    setFehler('');
    try {
      const r = await verkaufAction({
        registerId: kasse.id, sessionId: schicht.id, payment: zahlart, training, showId: hatTickets ? showId : null,
        givenCents: zahlart === 'bar' ? gegebenCents : null,
        items: zeilen.map((z) => ({ productId: z.p.id, quantity: z.n })),
      });
      if (!r.ok) return setFehler(r.fehler);
      schliessen();
      setErg({ id: r.id, number: r.number, totalCents: r.totalCents, changeCents: r.changeCents, givenCents: zahlart === 'bar' ? gegebenCents : null, zahlart, training });
      const uhr = new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit' }).format(new Date());
      setEigene((e) => [{ id: r.id, number: r.number, zeit: uhr, totalCents: r.totalCents, payment: zahlart, type: training ? 'training' : 'standard' }, ...e].slice(0, 5));
      aktion.current = '';
      setKorb({});
      setSuche('');
      setDruck({ id: r.id, n: Date.now() }); // Beleg sofort drucken (Belegerteilungspflicht)
    } catch {
      setOnline(false);
      setFehler('Verbindung unterbrochen. Bitte unter „Belege“ prüfen, ob der Beleg erstellt wurde, bevor Sie erneut kassieren.');
    } finally {
      laeuft.current = false;
      setBusy(false);
    }
  }

  function neuerVerkauf() {
    fertigDialog.current?.close();
    setErg(null);
  }

  useEffect(() => {
    if (!erg) return;
    if (!fertigDialog.current?.open) fertigDialog.current?.showModal();
    neuKnopf.current?.focus();
  }, [erg]);

  // Druck-Frame nach dem Drucken wieder entfernen
  useEffect(() => { if (druck) { const t = setTimeout(() => setDruck(null), 60000); return () => clearTimeout(t); } }, [druck]);

  // Tastenkürzel: F1 bar, F2 Karte, / Suche
  useEffect(() => {
    const taste = (e: KeyboardEvent) => {
      if (zahlart || erg || blatt) return;
      if (e.key === 'F1' || e.key === 'F2') { e.preventDefault(); oeffnen(e.key === 'F1' ? 'bar' : 'karte'); return; }
      const t = e.target as HTMLElement;
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(t.tagName)) { e.preventDefault(); suchFeld.current?.focus(); }
    };
    window.addEventListener('keydown', taste);
    return () => window.removeEventListener('keydown', taste);
  });

  // Ziffernblock: Eingabe in Euro mit Komma
  function tippen(t: string) {
    setFehler('');
    setGegeben((g) => {
      if (t === 'C') return '';
      if (t === '⌫') return g.slice(0, -1);
      if (t === ',') return g.includes(',') ? g : `${g || '0'},`;
      const [e, c] = g.split(',');
      if (c !== undefined) return c.length >= 2 ? g : g + t;
      if (e.length >= 5) return g;
      return e === '0' ? t : g + t;
    });
  }
  // Physische Tasten im Zahlungsfenster; Enter bestätigt immer (außer auf „Abbrechen“/„Nein“)
  function zahlTaste(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      if ((e.target as HTMLElement).dataset.abbruch) return;
      e.preventDefault();
      void bezahlen();
      return;
    }
    if (zahlart !== 'bar') return;
    if (/^\d$/.test(e.key)) { e.preventDefault(); tippen(e.key); }
    else if (e.key === ',' || e.key === '.') { e.preventDefault(); tippen(','); }
    else if (e.key === 'Backspace') { e.preventDefault(); tippen('⌫'); }
    else if (e.key === 'Delete') { e.preventDefault(); tippen('C'); }
  }

  function langStart(p: Produkt) {
    langDruck.current.ausgeloest = false;
    if (!korb[p.id]) return;
    langDruck.current.t = setTimeout(() => { langDruck.current.ausgeloest = true; dazu(p, -1); try { navigator.vibrate?.(30); } catch { /* egal */ } }, 550);
  }
  function langEnde() { if (langDruck.current.t) clearTimeout(langDruck.current.t); langDruck.current.t = null; }

  const neuDrucken = (id: string) => setDruck({ id, n: Date.now() });
  const letzte = useMemo(() => [...new Map([...eigene, ...belege].map((b) => [b.id, b])).values()].sort((a, b) => b.number - a.number).slice(0, 5), [eigene, belege]);
  const zeigeTickets = hatTicketArtikel && !s && (kat === 'alle' || kat === 'ticket');

  // ─────────── Teile ───────────

  const korbListe = (blattModus: boolean) => (zeilen.length === 0 ? (
    <div className="grid flex-1 place-items-center px-4 py-10 text-center text-muted">
      <p className="text-base">Noch leer.<br />Artikel antippen, um sie hinzuzufügen.</p>
    </div>
  ) : (
    <ul className={`divide-y divide-line ${blattModus ? '' : 'min-h-0 flex-1 overflow-y-auto px-4'}`} aria-label="Positionen">
      {zeilen.map(({ p, n, preis: pr }) => (
        <li key={p.id} className="flex items-center gap-2 py-2.5">
          <span aria-hidden="true" className="h-10 w-1.5 shrink-0 rounded-full" style={{ background: farbe(p) }} />
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 block text-base font-semibold leading-snug">{p.name}</span>
            <span className="num block text-sm text-muted">{formatEur(pr)}{ticketArt(p) && show ? ` · ${show.zeit}` : ''}</span>
          </span>
          <span className="flex shrink-0 items-center rounded-xl border border-line bg-paper">
            <button type="button" onClick={() => dazu(p, -1)} aria-label={`${p.name}: eins weniger`} className="inline-flex size-12 items-center justify-center rounded-l-xl text-2xl font-semibold hover:bg-white">−</button>
            <span className="num w-8 text-center text-lg font-semibold">{n}<span className="sr-only"> Stück</span></span>
            <button type="button" onClick={() => dazu(p, 1)} aria-label={`${p.name}: eins mehr`} className="inline-flex size-12 items-center justify-center rounded-r-xl text-2xl font-semibold hover:bg-white">+</button>
          </span>
          <span className="num w-[5.25rem] shrink-0 text-right text-base font-semibold">{formatEur(n * pr)}</span>
        </li>
      ))}
    </ul>
  ));

  const korbFuss = (
    <div className={`shrink-0 border-t border-line px-4 pb-4 pt-3 ${training ? 'bg-amber-50' : 'bg-white'}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-base font-semibold">Summe{anzahl ? <span className="font-normal text-muted"> · {stueck(anzahl)}</span> : null}</span>
        <span className="num text-5xl font-bold tracking-tight">{formatEur(summe)}</span>
      </div>
      <p className="num mt-0.5 min-h-5 text-right text-xs text-muted">
        {steuern.length ? `inkl. ${steuern.map((t) => `${t.satz} % USt ${formatEur(t.ust)}`).join(' · ')}` : ''}
      </p>
      {fehler && !zahlart && <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-base text-neg">{fehler}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => oeffnen('bar')} disabled={!anzahl || !online} className="btn-primary min-h-20 flex-col !gap-0 rounded-xl text-2xl font-semibold">
          Bar <span className="hidden text-xs font-normal text-white/75 lg:block">F1</span>
        </button>
        <button type="button" onClick={() => oeffnen('karte')} disabled={!anzahl || !online} className="btn-gold min-h-20 flex-col !gap-0 rounded-xl text-2xl font-semibold">
          Karte <span className="hidden text-xs font-normal text-nacht/80 lg:block">F2</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-1 flex-col lg:h-[calc(100dvh-3rem)] lg:flex-row lg:overflow-hidden">
      <p role="status" aria-live="polite" className="sr-only">{ansage}</p>

      <section aria-labelledby="kasse-titel" className="flex min-w-0 flex-1 flex-col lg:overflow-hidden">
        {/* Kopfzeile: Kasse (Wechsel per Menü), Schicht, Status, Training */}
        <div className="flex items-center gap-2 border-b border-line bg-white px-3 py-1.5 sm:gap-3 sm:px-4">
          <div className="min-w-0 flex-1">
            <h1 id="kasse-titel" className="min-w-0 text-lg font-semibold leading-tight">
              {kassen.length > 1 ? (
                <button type="button" onClick={() => setBlatt('kasse')} aria-label={`${kasse.name} – Kasse wechseln`} className="-ml-1 inline-flex min-h-8 max-w-full items-center gap-1 rounded-lg px-1 hover:bg-paper">
                  <span className="truncate">{kasse.name}</span>
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 shrink-0 text-muted" fill="currentColor"><path d="M5 7l5 5 5-5z" /></svg>
                </button>
              ) : <span className="block truncate">{kasse.name}</span>}
            </h1>
            <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted">
              <OnlineAnzeige online={online} />
              {kasse.signer === 'demo' && <span className="pill shrink-0 bg-violet-50 text-violet-900">Demo<span className="max-sm:hidden">-Signatur</span></span>}
              <span className="truncate">seit {schicht.seit}<span className="max-xl:hidden"> · {schicht.von}</span></span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" role="switch" aria-checked={training} onClick={() => { setTraining(!training); setKorb({}); setFehler(''); setAnsage(training ? 'Trainingsmodus aus.' : 'Trainingsmodus an. Belege zählen nicht zum Umsatz.'); }}
              className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-2.5 text-sm font-semibold sm:px-3 ${training ? 'border-amber-700 bg-amber-100 text-amber-950' : 'border-line bg-white text-ink hover:bg-paper'}`}>
              <span aria-hidden="true" className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${training ? 'bg-amber-700' : 'bg-[#767d8f]'}`}>
                <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${training ? 'left-[1.125rem]' : 'left-0.5'}`} />
              </span>
              Training
            </button>
            <button type="button" onClick={() => setBlatt('belege')} className="btn-secondary min-h-11 rounded-full text-sm">Belege</button>
            <button type="button" onClick={() => setBlatt('hilfe')} aria-label="Hilfe und Tastenkürzel" className="btn-secondary size-11 shrink-0 rounded-full !px-0 text-base font-bold max-md:hidden">?</button>
          </div>
        </div>
        {training && (
          <p role="status" className="sticky top-12 z-20 flex flex-wrap items-center gap-x-3 border-b-2 border-amber-700 px-4 py-2 text-black lg:static"
            style={{ background: 'repeating-linear-gradient(-45deg,#fcd34d 0 16px,#fbbf24 16px 32px)' }}>
            <strong className="text-lg tracking-wide">TRAINING – zählt nicht</strong>
            <span className="text-sm font-medium">Belege tragen „Trainingsbuchung“. Keine Tickets oder Gutscheine.</span>
          </p>
        )}
        {!online && <p role="alert" className="bg-amber-400 px-4 py-2 text-base font-semibold text-black">Offline – Verkauf gesperrt. Belege werden am Server signiert (RKSV); bitte Verbindung herstellen.</p>}

        {/* Kategorien + Suche */}
        <div className="flex flex-wrap items-center gap-2 px-3 pt-3 sm:px-4 xl:flex-nowrap">
          <div role="group" aria-label="Kategorie" className="flex min-w-0 max-w-full gap-1 overflow-x-auto rounded-2xl border border-line bg-white p-1 [scrollbar-width:none]">
            {[{ key: 'alle', label: 'Alle' }, ...kategorien].map((k) => {
              const an = !s && kat === k.key;
              return (
                <button key={k.key} type="button" aria-pressed={an} onClick={() => { setKat(k.key); setSuche(''); }}
                  className={`min-h-12 shrink-0 rounded-xl px-4 text-base font-semibold transition-colors ${an ? 'bg-nacht text-white shadow' : 'text-ink hover:bg-paper'}`}>
                  {k.key !== 'alle' && <span aria-hidden="true" className="mr-2 inline-block size-2.5 rounded-full align-middle" style={{ background: KAT_FARBE[k.key] }} />}
                  {k.label}
                </button>
              );
            })}
          </div>
          <div className="relative !min-w-[12rem] flex-1 xl:max-w-xs">
            <label htmlFor="artikelsuche" className="sr-only">Artikel suchen</label>
            <svg aria-hidden="true" viewBox="0 0 20 20" className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted"><path fill="currentColor" d="M8.5 3a5.5 5.5 0 0 1 4.38 8.82l3.65 3.65-1.06 1.06-3.65-3.65A5.5 5.5 0 1 1 8.5 3Zm0 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" /></svg>
            <input id="artikelsuche" ref={suchFeld} type="search" value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Artikel suchen" autoComplete="off"
              onKeyDown={(e) => { if (e.key === 'Escape' && suche) { e.stopPropagation(); setSuche(''); } if (e.key === 'Enter' && sichtbar.length === 1) dazu(sichtbar[0]); }}
              className="input min-h-14 rounded-2xl !pl-10 !text-base" />
          </div>
        </div>

        <div className="flex-1 px-3 pb-28 pt-3 sm:px-4 lg:overflow-y-auto lg:pb-4">
          {/* Abendkasse: Vorstellung wählen */}
          {zeigeTickets && (
            <section aria-labelledby="vorst-titel" className="mb-4">
              <h2 id="vorst-titel" className="mb-2 text-sm font-semibold text-muted">Vorstellung für Abendkasse-Tickets <span className="font-normal">· beste freie Plätze werden automatisch vergeben</span></h2>
              {shows.length ? (
                <div role="group" aria-labelledby="vorst-titel" className="flex gap-2 overflow-x-auto pb-1">
                  {shows.map((v) => {
                    const an = v.id === showId;
                    return (
                      <button key={v.id} type="button" aria-pressed={an} onClick={() => setShowId(v.id)}
                        className={`!min-w-[13.5rem] shrink-0 rounded-2xl border-2 p-3 text-left transition-colors ${an ? 'border-nacht bg-nacht text-white' : 'border-line bg-white text-ink hover:border-accent'}`}>
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="num text-2xl font-bold">{v.zeit}<span className="sr-only"> Uhr</span></span>
                          <span className={`text-sm ${an ? 'text-white/85' : 'text-muted'}`}>{v.tag}</span>
                        </span>
                        <span className="mt-2 grid gap-1">
                          {(['I', 'II', 'R'] as Kat[]).map((k) => (
                            <span key={k} className="grid grid-cols-[4.5rem_1fr_2.5rem] items-center gap-2 text-xs">
                              <span className={an ? 'text-white/85' : 'text-muted'}>{KAT_NAME[k]}</span>
                              <span aria-hidden="true" className={`h-1.5 overflow-hidden rounded-full ${an ? 'bg-white/20' : 'bg-paper'}`}>
                                <span className="block h-full rounded-full" style={{ width: `${v.kap[k] ? Math.round((v.frei[k] / v.kap[k]) * 100) : 0}%`, background: TICKET_FARBE[k] }} />
                              </span>
                              <span className="num text-right font-semibold">{v.frei[k]}<span className="sr-only"> frei</span></span>
                            </span>
                          ))}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : <p className="rounded-2xl border border-line bg-white p-3 text-base text-muted">Heute keine Vorstellung mehr im Verkauf.</p>}
            </section>
          )}

          <h2 className="sr-only">Artikel</h2>
          {sichtbar.length === 0 && <p className="rounded-2xl border border-line bg-white p-5 text-base text-muted">Keine Artikel zu „{suche}“ gefunden.</p>}
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] sm:gap-3">
            {sichtbar.map((p) => {
              const t = ticketArt(p);
              const grund = sperrgrund(p);
              const n = korb[p.id] ?? 0;
              const frei = t && show ? show.frei[t.kat] - imKorbKat(t.kat) : null;
              const info = grund === 'nicht im Training' ? 'Nicht im Training' : grund === 'keine Vorstellung' ? 'Keine Vorstellung' : grund === 'ausverkauft' ? 'Ausverkauft'
                : t ? `${frei} frei` : p.stock != null ? `Bestand ${p.stock}` : KATEGORIEN.find((k) => k.key === p.category)?.label ?? '';
              return (
                <li key={p.id} className="relative">
                  <button type="button" disabled={!!grund}
                    onClick={() => { if (langDruck.current.ausgeloest) { langDruck.current.ausgeloest = false; return; } dazu(p); }}
                    onPointerDown={() => langStart(p)} onPointerUp={langEnde} onPointerLeave={langEnde} onPointerCancel={langEnde}
                    onContextMenu={(e) => e.preventDefault()}
                    className={`relative flex h-full min-h-[7.5rem] w-full select-none flex-col overflow-hidden rounded-2xl border bg-white p-3 pt-4 text-left shadow-sm transition active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-55 disabled:shadow-none ${n ? 'border-nacht ring-2 ring-nacht' : 'border-line hover:border-accent'}`}>
                    <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1.5" style={{ background: farbe(p) }} />
                    <span className="break-words text-[1.0625rem] font-semibold leading-snug">{p.name}</span>
                    <span className="mt-0.5 text-sm text-muted">{info}</span>
                    <span className="num mt-auto pt-2 text-2xl font-bold tracking-tight">{formatEur(preis(p))}</span>
                    {n > 0 && <span className="sr-only">, {n} im Warenkorb</span>}
                  </button>
                  {n > 0 && <span aria-hidden="true" className="num pointer-events-none absolute -right-1.5 -top-2 z-10 inline-flex h-8 !min-w-8 items-center justify-center rounded-full bg-nacht px-2 text-base font-bold text-white shadow ring-2 ring-paper">{n}</span>}
                  {n > 0 && (
                    <button type="button" onClick={() => dazu(p, -1)} aria-label={`${p.name}: eins weniger`}
                      className="absolute bottom-2.5 right-2.5 inline-flex size-11 items-center justify-center rounded-full border border-line bg-paper text-2xl font-semibold text-ink shadow-sm hover:bg-white">−</button>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-muted max-lg:hidden">Tipp: Kachel lange drücken nimmt einen Artikel wieder heraus.</p>
        </div>
      </section>

      {/* Warenkorb: rechts ab 1024 px */}
      <aside aria-labelledby="korb-titel" className={`hidden w-[25rem] shrink-0 flex-col border-l bg-white lg:flex ${training ? 'border-amber-700' : 'border-line'}`}>
        <div className="flex items-center gap-2 px-4 pb-1 pt-3">
          <h2 id="korb-titel" className="flex-1 text-lg font-semibold">Warenkorb{training ? ' – Training' : ''}</h2>
          {anzahl > 0 && <button type="button" onClick={leeren} className="btn-danger min-h-10 text-sm">Leeren</button>}
        </div>
        {korbListe(false)}
        {korbFuss}
      </aside>

      {/* Handy/Tablet hochkant: Leiste unten, Warenkorb als Blatt */}
      {!erg && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-nacht px-3 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-3 lg:hidden">
          <button type="button" onClick={() => setBlatt('korb')} disabled={!anzahl}
            className="flex min-h-14 w-full items-center gap-3 rounded-xl bg-gold px-4 text-left text-nacht disabled:cursor-default disabled:bg-[#232c45] disabled:text-white">
            <span className="min-w-0 flex-1 text-base font-semibold">{anzahl ? <>{stueck(anzahl)} · <span className="num text-xl">{formatEur(summe)}</span></> : 'Warenkorb leer'}</span>
            {anzahl > 0 && <span className="text-lg font-bold">Bezahlen <span aria-hidden="true">›</span></span>}
          </button>
        </div>
      )}
      <Sheet offen={blatt === 'korb'} onClose={() => setBlatt(null)} titel={`Warenkorb${training ? ' – Training' : ''}`}
        aktionen={anzahl > 0 ? <button type="button" onClick={leeren} className="btn-danger min-h-10 text-sm">Leeren</button> : null}>
        <div className="-mx-4 -mb-4 flex flex-col">
          <div className="px-4">{korbListe(true)}</div>
          {korbFuss}
        </div>
      </Sheet>

      {/* Zahlung */}
      <dialog ref={zahlDialog} aria-labelledby="zahlung-titel" onClose={() => setZahlart(null)} onKeyDown={zahlTaste}
        className="m-auto max-h-[96dvh] w-[min(46rem,calc(100vw-1rem))] overflow-y-auto rounded-3xl bg-white p-0 text-ink backdrop:bg-black/70">
        {zahlart && (
          <form onSubmit={(e) => { e.preventDefault(); void bezahlen(); }} className="grid gap-4 p-4 sm:p-6">
            <div className="flex items-center gap-3">
              <h2 id="zahlung-titel" className="flex-1 text-2xl font-semibold">{zahlart === 'bar' ? 'Barzahlung' : 'Kartenzahlung'}</h2>
              {training && <span className="pill bg-amber-300 !text-sm text-black">Training</span>}
            </div>
            {zahlart === 'bar' ? (
              <div className="grid gap-4 md:grid-cols-[1fr_17rem]">
                <div className="grid content-start gap-3">
                  <p className="flex items-baseline justify-between gap-3 text-lg">Zu zahlen <span className="num text-4xl font-bold">{formatEur(summe)}</span></p>
                  <div className="rounded-2xl border-2 border-nacht px-4 py-2">
                    <span id="gegeben-titel" className="block text-sm font-semibold text-muted">Gegeben</span>
                    <output aria-labelledby="gegeben-titel" className="num block text-right text-4xl font-bold">
                      {gegeben ? `€ ${gegeben}` : <>{formatEur(summe)} <span className="text-base font-semibold text-muted">passend</span></>}
                    </output>
                  </div>
                  <div role="group" aria-label="Schnellauswahl Betrag" className="grid grid-cols-3 gap-2">
                    <button type="button" onClick={() => setGegeben('')} aria-pressed={!gegeben} className={`min-h-12 rounded-xl border text-base font-semibold ${!gegeben ? 'border-nacht bg-nacht text-white' : 'border-line bg-white hover:bg-paper'}`}>Passend</button>
                    {SCHNELL.map((c) => {
                      const an = !!gegeben && gegebenCents === c;
                      return (
                        <button key={c} type="button" disabled={c < summe} onClick={() => setGegeben(String(c / 100))} aria-pressed={an}
                          className={`num min-h-12 rounded-xl border text-base font-semibold disabled:opacity-40 ${an ? 'border-nacht bg-nacht text-white' : 'border-line bg-white hover:bg-paper'}`}>{c / 100} €</button>
                      );
                    })}
                  </div>
                  <p aria-live="polite" className={`flex items-baseline justify-between gap-3 rounded-2xl px-4 py-3 ${rueckgeld < 0 ? 'bg-red-50 text-neg' : 'bg-emerald-50 text-emerald-950'}`}>
                    <span className="text-lg font-semibold">{rueckgeld < 0 ? 'Fehlt' : 'Rückgeld'}</span>
                    <span className="num text-5xl font-bold tracking-tight sm:text-6xl">{formatEur(Math.abs(rueckgeld))}</span>
                  </p>
                </div>
                <div role="group" aria-label="Ziffernblock" className="grid grid-cols-3 gap-2 self-start">
                  {['7', '8', '9', '4', '5', '6', '1', '2', '3', ',', '0', '⌫'].map((t) => (
                    <button key={t} type="button" onClick={() => tippen(t)} aria-label={t === '⌫' ? 'Letzte Ziffer löschen' : t === ',' ? 'Komma' : undefined}
                      className="num min-h-14 rounded-xl border border-line bg-paper text-2xl font-semibold hover:bg-white active:bg-accent-soft md:min-h-16">{t}</button>
                  ))}
                  <button type="button" onClick={() => tippen('C')} className="col-span-3 min-h-11 rounded-xl border border-line bg-white text-base font-semibold hover:bg-paper">Eingabe löschen</button>
                </div>
              </div>
            ) : (
              <div className="grid gap-2 rounded-2xl bg-paper px-4 py-6 text-center">
                <p className="text-lg">Betrag am Terminal</p>
                <p className="num text-6xl font-bold tracking-tight">{formatEur(summe)}</p>
                <p className="mt-2 text-xl font-semibold">Zahlung erfolgreich?</p>
                <p className="text-sm text-muted">Erst bestätigen, wenn das Terminal „Zahlung erfolgreich“ zeigt.</p>
              </div>
            )}
            {fehler && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-base text-neg">{fehler}</p>}
            <div className="grid grid-cols-[1fr_1.6fr] gap-2">
              <button type="button" data-abbruch="1" onClick={() => { schliessen(); if (zahlart === 'karte') setFehler('Kartenzahlung nicht erfolgt – es wurde kein Beleg erstellt.'); }} className="btn-secondary min-h-16 rounded-xl text-lg">
                {zahlart === 'karte' ? 'Nein' : 'Abbrechen'}
              </button>
              <button type="submit" disabled={busy || (zahlart === 'bar' && rueckgeld < 0)} className={`min-h-16 rounded-xl text-xl font-semibold ${zahlart === 'karte' ? 'btn bg-pos text-white hover:bg-[#16613a]' : 'btn-primary'}`}>
                {busy ? 'Bitte warten …' : zahlart === 'bar' ? <>Bezahlt<span className="max-sm:hidden"> – Beleg</span></> : 'Ja, bezahlt'}
              </button>
            </div>
          </form>
        )}
      </dialog>

      {/* Nach dem Verkauf */}
      <dialog ref={fertigDialog} aria-labelledby="fertig-titel" onClose={() => setErg(null)}
        className="m-auto max-h-[96dvh] w-[min(34rem,calc(100vw-1rem))] overflow-y-auto rounded-3xl bg-white p-0 text-ink backdrop:bg-black/70">
        {erg && (
          <div className="grid gap-4 p-5 text-center sm:p-6">
            <span aria-hidden="true" className="mx-auto grid size-16 place-items-center rounded-full bg-pos text-4xl font-bold text-white">✓</span>
            <h2 id="fertig-titel" className="text-2xl font-semibold">{erg.training ? 'Trainingsbeleg' : 'Beleg'} Nr. {erg.number} erstellt</h2>
            {erg.zahlart === 'bar' && erg.changeCents != null ? (
              <p className="rounded-2xl bg-emerald-50 py-4 text-emerald-950">
                <span className="block text-lg font-semibold">Rückgeld</span>
                <span className="num block text-7xl font-bold tracking-tight">{formatEur(erg.changeCents)}</span>
                <span className="num mt-1 block text-sm">gegeben {formatEur(erg.givenCents ?? erg.totalCents)} · Summe {formatEur(erg.totalCents)}</span>
              </p>
            ) : <p className="rounded-2xl bg-paper py-4"><span className="block text-lg">Karte bezahlt</span><span className="num block text-5xl font-bold">{formatEur(erg.totalCents)}</span></p>}
            <p className="text-sm text-muted">Der Beleg wird gedruckt. Kein Drucker? „Beleg anzeigen“ und der Kundin bzw. dem Kunden zeigen.</p>
            <div className="grid grid-cols-2 gap-2">
              <a href={`/kassa/beleg/${erg.id}?druck=1`} target="_blank" rel="noopener" className="btn-secondary min-h-14 rounded-xl text-base">Beleg anzeigen</a>
              <button type="button" onClick={() => neuDrucken(erg.id)} className="btn-secondary min-h-14 rounded-xl text-base">Nochmal drucken</button>
            </div>
            <button ref={neuKnopf} type="button" onClick={neuerVerkauf} className="btn-primary min-h-16 rounded-xl text-xl font-semibold">Neuer Verkauf</button>
            <BelegListe belege={letzte} drucken={neuDrucken} />
          </div>
        )}
      </dialog>

      <Sheet offen={blatt === 'belege'} onClose={() => setBlatt(null)} titel="Letzte Belege">
        <BelegListe belege={letzte} drucken={neuDrucken} ohneTitel />
        <a href="/kassa/belege" className="btn-secondary mt-3 min-h-12 w-full text-base">Alle Belege von heute</a>
      </Sheet>

      <Sheet offen={blatt === 'kasse'} onClose={() => setBlatt(null)} titel="Kasse wechseln">
        <ul className="grid gap-2">
          {kassen.map((k) => (
            <li key={k.id}>
              <form action={kasseSetzenAction}>
                <input type="hidden" name="registerId" value={k.id} />
                <button disabled={k.id === kasse.id} aria-current={k.id === kasse.id ? 'true' : undefined}
                  className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-line bg-white px-4 text-left hover:bg-paper disabled:border-nacht disabled:bg-paper">
                  <span className="flex-1"><span className="block font-semibold">{k.name}</span><span className="block text-sm text-muted">{k.kassenId}</span></span>
                  {k.id === kasse.id && <span className="pill bg-nacht text-white">aktiv</span>}
                </button>
              </form>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-muted">Kasse {kasse.kassenId} · Schicht seit {schicht.seitLang} · Wechselgeld {schicht.wechselgeld}</p>
      </Sheet>

      <Sheet offen={blatt === 'hilfe'} onClose={() => setBlatt(null)} titel="Tastenkürzel und Hilfe">
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-base">
          {[['F1', 'Barzahlung'], ['F2', 'Kartenzahlung'], ['Esc', 'Zahlung abbrechen, Fenster schließen'], ['Enter', 'Zahlung bestätigen'], ['0–9 ,', 'Betrag im Bar-Fenster'], ['⌫ / Entf', 'Ziffer bzw. Eingabe löschen'], ['/', 'Artikelsuche']].map(([k, t]) => (
            <div key={k} className="contents"><dt><kbd className="inline-block min-w-12 rounded-md border border-line bg-paper px-2 py-1 text-center font-mono text-sm font-semibold">{k}</kbd></dt><dd>{t}</dd></div>
          ))}
        </dl>
        <p className="mt-4 text-sm text-muted">Kachel antippen fügt einen Artikel hinzu, lange drücken oder „−“ nimmt einen heraus. Abendkasse-Tickets bekommen automatisch die besten freien Plätze der gewählten Vorstellung.</p>
        <p className="mt-2 text-sm text-muted">Kasse {kasse.kassenId} · Schicht seit {schicht.seitLang} · Wechselgeld {schicht.wechselgeld}</p>
      </Sheet>

      {druck && <iframe key={`${druck.id}-${druck.n}`} src={`/kassa/beleg/${druck.id}?druck=1&eingebettet=1`} title="Beleg zum Drucken" className="pointer-events-none fixed -left-[9999px] top-0 h-[600px] w-[320px]" aria-hidden="true" tabIndex={-1} />}
    </div>
  );
}

function BelegListe({ belege, drucken, ohneTitel = false }: { belege: Beleg[]; drucken: (id: string) => void; ohneTitel?: boolean }) {
  if (!belege.length) return <p className="text-base text-muted">Noch keine Belege in dieser Kasse.</p>;
  return (
    <section aria-label={ohneTitel ? undefined : 'Letzte Belege'} className="text-left">
      {!ohneTitel && <h3 className="mb-1 mt-2 text-sm font-semibold text-muted">Letzte Belege</h3>}
      <ul className="divide-y divide-line rounded-xl border border-line">
        {belege.map((b) => (
          <li key={b.id} className="flex items-center gap-3 px-3 py-1.5">
            <span className="min-w-0 flex-1 text-sm">
              <span className="font-semibold">Nr. {b.number}</span> · {b.zeit} Uhr · {ZAHLART[b.payment] ?? b.payment}
              {b.type !== 'standard' && <span className="pill ml-1.5 bg-gray-100 text-ink">{b.type === 'training' ? 'Training' : b.type === 'storno' ? 'Storno' : b.type}</span>}
            </span>
            <span className="num text-sm font-semibold">{formatEur(b.totalCents)}</span>
            <button type="button" onClick={() => drucken(b.id)} aria-label={`Beleg Nr. ${b.number} drucken`} className="btn-secondary min-h-11 text-sm">Drucken</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
