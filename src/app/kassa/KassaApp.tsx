'use client';
// Verkaufsoberfläche: Artikel nach Kategorie, Warenkorb, Zahlung bar/Karte, Beleg drucken.
import { useEffect, useMemo, useRef, useState } from 'react';
import { OnlineAnzeige, useOnline } from '@/components/vorort/pwa';
import { istGutschein, KATEGORIEN, SCHNELLGELD, ticketArt, ticketPreis } from '@/lib/kassa-shared';
import { formatEur, parseAmountToCents } from '@/lib/money';
import type { Preise } from '@/lib/saal';
import { verkaufAction } from './actions';

type Produkt = { id: string; name: string; category: string; priceCents: number; vatRate: number; color: string; sku: string | null; stock: number | null };
type Show = { id: string; label: string; prices: Preise; frei: { I: number; II: number; R: number } };
type Ergebnis = { id: string; number: number; totalCents: number; changeCents: number | null; zahlart: 'bar' | 'karte'; training: boolean };

export default function KassaApp({ kasse, schicht, produkte, shows, kopf }: {
  kasse: { id: string; name: string; kassenId: string; signer: string };
  schicht: { id: string; seit: string; von: string; wechselgeld: string };
  produkte: Produkt[];
  shows: Show[];
  kopf: React.ReactNode;
}) {
  const [online, setOnline] = useOnline();
  const [kat, setKat] = useState<string>('alle');
  const [korb, setKorb] = useState<Record<string, number>>({});
  const [showId, setShowId] = useState(shows[0]?.id ?? '');
  const [training, setTraining] = useState(false);
  const [zahlart, setZahlart] = useState<'bar' | 'karte' | null>(null);
  const [gegeben, setGegeben] = useState('');
  const [fehler, setFehler] = useState('');
  const [busy, setBusy] = useState(false);
  const [erg, setErg] = useState<Ergebnis | null>(null);
  const [druck, setDruck] = useState<string | null>(null);
  const [korbOffen, setKorbOffen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const gegebenFeld = useRef<HTMLInputElement>(null);

  const show = shows.find((s) => s.id === showId);
  const preis = (p: Produkt) => {
    const t = ticketArt(p);
    return t && show ? ticketPreis(show.prices, t.kat, t.art) : p.priceCents;
  };
  const kategorien = KATEGORIEN.filter((k) => produkte.some((p) => p.category === k.key));
  const sichtbar = produkte.filter((p) => kat === 'alle' || p.category === kat);
  const zeilen = useMemo(() => Object.entries(korb).filter(([, n]) => n > 0).map(([id, n]) => ({ p: produkte.find((x) => x.id === id)!, n })).filter((z) => z.p), [korb, produkte]);
  const summe = zeilen.reduce((s, z) => s + z.n * preis(z.p), 0);
  const hatTickets = zeilen.some((z) => ticketArt(z.p));
  const gegebenCents = gegeben.trim() ? parseAmountToCents(gegeben) : summe;
  const rueckgeld = gegebenCents - summe;

  function dazu(p: Produkt, d = 1) {
    setFehler('');
    if (training && (ticketArt(p) || istGutschein(p))) return setFehler('Im Trainingsmodus nur Waren – keine Tickets oder Gutscheine.');
    if (ticketArt(p) && !show) return setFehler('Heute gibt es keine Vorstellung mehr im Verkauf.');
    setKorb((k) => ({ ...k, [p.id]: Math.max(0, Math.min(99, (k[p.id] ?? 0) + d)) }));
  }

  function oeffnen(z: 'bar' | 'karte') {
    setFehler('');
    setZahlart(z);
    setGegeben('');
    dialog.current?.showModal();
    setTimeout(() => gegebenFeld.current?.focus(), 30);
  }
  function schliessen() {
    dialog.current?.close();
    setZahlart(null);
  }

  async function bezahlen() {
    if (!zahlart || busy) return;
    if (!navigator.onLine) { setOnline(false); return setFehler('Keine Verbindung – Verkauf nicht möglich.'); }
    if (zahlart === 'bar' && rueckgeld < 0) return setFehler('Der gegebene Betrag reicht nicht.');
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
      setErg({ id: r.id, number: r.number, totalCents: r.totalCents, changeCents: r.changeCents, zahlart, training });
      setKorb({});
      setKorbOffen(false);
      setDruck(r.id); // Beleg sofort drucken (Belegerteilungspflicht)
    } catch {
      setOnline(false);
      setFehler('Verbindung unterbrochen. Bitte unter „Belege“ prüfen, ob der Beleg erstellt wurde, bevor Sie erneut kassieren.');
    } finally {
      setBusy(false);
    }
  }

  // Druck-Frame nach dem Drucken wieder entfernen
  useEffect(() => { if (druck) { const t = setTimeout(() => setDruck(null), 60000); return () => clearTimeout(t); } }, [druck]);

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      <section aria-labelledby="artikel-titel" className="flex-1 px-3 py-4 sm:px-5">
        {kopf}
        <p className="mt-1 text-sm text-muted">Kasse {kasse.kassenId} · Schicht seit {schicht.seit} ({schicht.von}) · Wechselgeld {schicht.wechselgeld}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <OnlineAnzeige online={online} />
          {kasse.signer === 'demo' && <span className="pill bg-violet-50 text-violet-900">Demo-Signatur – nicht rechtsgültig</span>}
          <label className="ml-auto inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 text-base">
            <input type="checkbox" checked={training} onChange={(e) => { setTraining(e.target.checked); setKorb({}); }} className="size-5 accent-[#8a6a1f]" />
            Trainingsmodus
          </label>
        </div>
        {!online && <p role="alert" className="mt-3 rounded-lg bg-amber-400 px-3 py-2 text-base font-semibold text-black">Offline – Verkauf gesperrt. Belege werden am Server signiert (RKSV); bitte Verbindung herstellen.</p>}
        {training && <p role="status" className="mt-3 rounded-lg bg-sky-100 px-3 py-2 text-base text-sky-950">Trainingsmodus: Belege tragen „Trainingsbuchung“ und zählen nicht zum Umsatz.</p>}

        <h2 id="artikel-titel" className="sr-only">Artikel</h2>
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Kategorie">
          {[{ key: 'alle', label: 'Alle' }, ...kategorien].map((k) => (
            <button key={k.key} type="button" aria-pressed={kat === k.key} onClick={() => setKat(k.key)}
              className={`min-h-12 shrink-0 rounded-full px-4 text-base font-medium ${kat === k.key ? 'bg-nacht text-white' : 'border border-line bg-white text-ink'}`}>{k.label}</button>
          ))}
        </div>

        {(kat === 'alle' || kat === 'ticket') && produkte.some((p) => p.category === 'ticket') && (
          <div className="mt-4 rounded-xl border border-line bg-white p-3">
            <label htmlFor="show" className="label text-sm">Vorstellung für Abendkasse-Tickets</label>
            {shows.length ? (
              <select id="show" value={showId} onChange={(e) => setShowId(e.target.value)} className="input min-h-12 text-base">
                {shows.map((s) => <option key={s.id} value={s.id}>{s.label} – frei: Kat. I {s.frei.I}, Kat. II {s.frei.II}, Rollstuhl {s.frei.R}</option>)}
              </select>
            ) : <p id="show" className="text-base text-muted">Heute keine Vorstellung mehr im Verkauf.</p>}
            <p className="mt-1 text-sm text-muted">Die besten freien Plätze werden automatisch vergeben.</p>
          </div>
        )}

        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {sichtbar.map((p) => {
            const t = ticketArt(p);
            const gesperrt = !online || (training && (!!t || istGutschein(p))) || (!!t && !show);
            return (
              <li key={p.id}>
                <button type="button" onClick={() => dazu(p)} disabled={gesperrt}
                  className="flex min-h-24 w-full flex-col justify-between rounded-xl border border-line bg-white p-3 text-left shadow-sm hover:border-accent disabled:opacity-50"
                  style={p.color ? { borderLeft: `8px solid ${p.color}` } : undefined}>
                  <span className="text-base font-semibold leading-tight">{p.name}</span>
                  <span className="mt-2 flex items-end justify-between gap-2">
                    <span className="num text-lg">{formatEur(preis(p))}</span>
                    {korb[p.id] ? <span className="pill bg-nacht text-white text-sm">{korb[p.id]}×</span> : null}
                  </span>
                  {p.stock != null && <span className="text-xs text-muted">Bestand {p.stock}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <aside aria-labelledby="korb-titel" className="sticky bottom-0 z-20 border-t border-line bg-white px-3 py-3 shadow-[0_-4px_12px_rgba(0,0,0,.06)] lg:static lg:w-[380px] lg:border-l lg:border-t-0 lg:shadow-none">
        <div className="flex items-center justify-between gap-2">
          <h2 id="korb-titel" className="h2 text-lg">Warenkorb{training ? ' (Training)' : ''}</h2>
          {zeilen.length > 0 && (
            <button type="button" onClick={() => setKorbOffen(!korbOffen)} aria-expanded={korbOffen} aria-controls="korb-liste" className="btn-secondary min-h-12 text-base lg:hidden">
              {korbOffen ? 'Zuklappen' : `${zeilen.reduce((a, z) => a + z.n, 0)} Artikel anzeigen`}
            </button>
          )}
        </div>
        {zeilen.length === 0 ? <p className="py-2 text-base text-muted max-lg:sr-only">Noch leer – Artikel antippen.</p> : (
          <ul id="korb-liste" className={`max-h-[40dvh] divide-y divide-line overflow-y-auto lg:block lg:max-h-none ${korbOffen ? '' : 'hidden'}`}>
            {zeilen.map(({ p, n }) => (
              <li key={p.id} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1"><span className="block truncate text-base font-medium">{p.name}</span><span className="num text-sm text-muted">{n} × {formatEur(preis(p))}</span></span>
                <button type="button" onClick={() => dazu(p, -1)} aria-label={`${p.name}: eins weniger`} className="btn-secondary min-h-12 min-w-12 text-xl">−</button>
                <span className="num w-7 text-center text-lg" aria-label={`Menge ${n}`}>{n}</span>
                <button type="button" onClick={() => dazu(p, 1)} aria-label={`${p.name}: eins mehr`} className="btn-secondary min-h-12 min-w-12 text-xl">+</button>
                <span className="num w-20 text-right text-base">{formatEur(n * preis(p))}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2">
          <span className="text-lg font-semibold">Summe</span>
          <span className="num text-3xl font-bold" aria-live="polite">{formatEur(summe)}</span>
        </div>
        {fehler && !zahlart && <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-base text-neg">{fehler}</p>}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => oeffnen('bar')} disabled={!zeilen.length || !online} className="btn-primary min-h-16 text-xl">Bar</button>
          <button type="button" onClick={() => oeffnen('karte')} disabled={!zeilen.length || !online} className="btn-gold min-h-16 text-xl">Karte</button>
        </div>
        {zeilen.length > 0 && <button type="button" onClick={() => { setKorb({}); setKorbOffen(false); }} className={`btn-danger mt-2 min-h-12 w-full text-base lg:inline-flex ${korbOffen ? '' : 'max-lg:hidden'}`}>Warenkorb leeren</button>}
      </aside>

      <dialog ref={dialog} aria-labelledby="zahlung-titel" onClose={() => setZahlart(null)} className="m-auto w-[min(32rem,calc(100vw-1.5rem))] rounded-2xl p-0 backdrop:bg-black/60">
        <form method="dialog" onSubmit={(e) => { e.preventDefault(); void bezahlen(); }} className="grid gap-4 p-5">
          <h2 id="zahlung-titel" className="text-xl font-semibold">{zahlart === 'bar' ? 'Barzahlung' : 'Kartenzahlung'}{training ? ' (Training)' : ''}</h2>
          <p className="flex items-baseline justify-between text-lg">Zu zahlen <span className="num text-3xl font-bold">{formatEur(summe)}</span></p>
          {zahlart === 'bar' ? (
            <>
              <div>
                <label htmlFor="gegeben" className="label text-sm">Gegeben (€)</label>
                <input id="gegeben" ref={gegebenFeld} value={gegeben} onChange={(e) => setGegeben(e.target.value)} inputMode="decimal" autoComplete="off" placeholder={formatEur(summe)} className="input min-h-14 text-2xl" aria-describedby="rueckgeld" />
              </div>
              <div className="grid grid-cols-5 gap-2" role="group" aria-label="Schnellauswahl Betrag">
                <button type="button" onClick={() => setGegeben('')} className="btn-secondary min-h-12 whitespace-nowrap px-1 text-sm sm:text-base">Passend</button>
                {SCHNELLGELD.map((c) => <button key={c} type="button" onClick={() => setGegeben(String(c / 100))} className="btn-secondary min-h-12 whitespace-nowrap px-1 text-base">{c / 100}&nbsp;€</button>)}
              </div>
              <p id="rueckgeld" className={`flex items-baseline justify-between rounded-xl px-3 py-2 text-lg ${rueckgeld < 0 ? 'bg-red-50 text-neg' : 'bg-emerald-50 text-emerald-950'}`}>
                {rueckgeld < 0 ? 'Fehlt' : 'Rückgeld'} <span className="num text-3xl font-bold">{formatEur(Math.abs(rueckgeld))}</span>
              </p>
            </>
          ) : (
            <p className="rounded-xl bg-paper px-3 py-3 text-base">Betrag am Kartenterminal eingeben und Zahlung abwarten. Erst bestätigen, wenn das Terminal „Zahlung erfolgreich“ zeigt.</p>
          )}
          {fehler && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-base text-neg">{fehler}</p>}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={schliessen} className="btn-secondary min-h-14 text-lg">Abbrechen</button>
            <button type="submit" disabled={busy || (zahlart === 'bar' && rueckgeld < 0)} className="btn-primary min-h-14 text-lg">
              {busy ? 'Bitte warten …' : zahlart === 'bar' ? 'Bezahlt – Beleg' : 'Zahlung am Terminal erfolgreich'}
            </button>
          </div>
        </form>
      </dialog>

      {erg && (
        <div role="dialog" aria-modal="true" aria-labelledby="fertig-titel" className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-3">
          <div className="grid w-full max-w-md gap-4 rounded-2xl bg-white p-6 text-center">
            <h2 id="fertig-titel" className="text-2xl font-semibold">{erg.training ? 'Trainingsbeleg' : 'Beleg'} Nr. {erg.number} erstellt</h2>
            {erg.zahlart === 'bar' && erg.changeCents != null ? (
              <p className="rounded-xl bg-emerald-50 py-4 text-emerald-950"><span className="block text-lg">Rückgeld</span><span className="num block text-5xl font-bold">{formatEur(erg.changeCents)}</span></p>
            ) : <p className="text-lg">Kartenzahlung {formatEur(erg.totalCents)}</p>}
            <p className="text-sm text-muted">Der Beleg wird gedruckt. Kein Drucker? Beleg anzeigen und der Kundin bzw. dem Kunden zeigen.</p>
            <div className="grid grid-cols-2 gap-2">
              <a href={`/kassa/beleg/${erg.id}?druck=1`} target="_blank" rel="noopener" className="btn-secondary min-h-14 text-base">Beleg anzeigen</a>
              <button type="button" autoFocus onClick={() => setErg(null)} className="btn-primary min-h-14 text-lg">Neuer Verkauf</button>
            </div>
          </div>
        </div>
      )}
      {druck && <iframe key={druck} src={`/kassa/beleg/${druck}?druck=1&eingebettet=1`} title="Beleg zum Drucken" className="pointer-events-none fixed -left-[9999px] top-0 h-[600px] w-[320px]" aria-hidden="true" tabIndex={-1} />}
    </div>
  );
}
