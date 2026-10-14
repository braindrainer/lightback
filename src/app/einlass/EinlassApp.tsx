'use client';
// Einlass-App: Vorstellung wählen, scannen oder Code eingeben, Ergebnis bildschirmfüllend.
// Offline: Prüfung gegen die zuletzt geladene Codeliste, Scans in einer Warteschlange, Abgleich bei Verbindung.
import { useCallback, useEffect, useRef, useState } from 'react';
import { OnlineAnzeige, speicher, useOnline } from '@/components/vorort/pwa';
import Scanner from './Scanner';
import { rueckmeldung, tonFreischalten } from './ton';

type Ergebnis = 'ok' | 'doppelt' | 'falsche_vorstellung' | 'storniert' | 'unbekannt' | 'ungueltig' | 'fehler';
type Antwort = {
  result: Ergebnis;
  checkInId?: string;
  code?: string;
  ticket?: { code: string; seatId: string; sitz: string; kat: string; art: string };
  vorher?: { am: string; von: string | null };
  vorstellung?: string;
  fehler?: string;
  offline?: boolean;
};
type ListenTicket = { code: string; seatId: string; kat: string; art: string; status: string; checkedInAt?: string | null };
type Warteschlange = { id: string; qr?: string; code?: string; showId: string; scannedAt: string }[];
type Konflikt = { id: string; result: string; code?: string; ticket?: { sitz: string }; vorher?: { am: string; von: string | null } };

const TITEL: Record<Ergebnis, string> = {
  ok: 'Einlass OK', doppelt: 'Bereits eingelassen', falsche_vorstellung: 'Falsche Vorstellung', storniert: 'Ticket storniert',
  unbekannt: 'Ticket unbekannt', ungueltig: 'Ungültiges Ticket', fehler: 'Fehler',
};
const RUECKNAHME_MS = 2 * 60e3;
const zeit = (iso: string) => new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(iso));

/** Sitzname wie am Server (für den Offline-Fall ohne Server-Antwort) */
function sitzName(seatId: string) {
  const [r, p] = seatId.split('-');
  return r === 'R' ? `Rollstuhlplatz ${p} mit Begleitsitz` : `Reihe ${r}, Platz ${p}`;
}
function codeAus(text: string): { code: string; showId?: string } | null {
  const s = text.trim();
  const m = s.match(/^LOC1\.([A-Z0-9]{6,16})\.([a-z0-9]+)\.[A-Za-z0-9_-]{16}$/);
  if (m) return { code: m[1], showId: m[2] };
  const c = s.toUpperCase().replace(/[\s-]/g, '');
  return /^[A-Z0-9]{6,16}$/.test(c) ? { code: c } : null;
}

export default function EinlassApp({ shows, standard }: { shows: { id: string; label: string }[]; standard: string }) {
  const [showId, setShowId] = useState(standard);
  const [online, setOnline] = useOnline();
  const [zaehler, setZaehler] = useState<{ eingelassen: number; verkauft: number } | null>(null);
  const [liste, setListe] = useState<Record<string, ListenTicket>>({});
  const [listeStand, setListeStand] = useState<string | null>(null);
  const [queue, setQueue] = useState<Warteschlange>([]);
  const [konflikte, setKonflikte] = useState<Konflikt[]>([]);
  const [antwort, setAntwort] = useState<Antwort | null>(null);
  const [letzterOk, setLetzterOk] = useState<{ checkInId: string; sitz: string; am: number } | null>(null);
  const [eingabe, setEingabe] = useState('');
  const [meldung, setMeldung] = useState('');
  const [jetzt, setJetzt] = useState(Date.now());
  const busy = useRef(false);
  const zuletzt = useRef<{ text: string; am: number }>({ text: '', am: 0 });
  const geraet = useRef('');
  const eingabeFeld = useRef<HTMLInputElement>(null);

  // Gerät, gespeicherte Vorstellung und Warteschlange
  useEffect(() => {
    let id = speicher.lesen('einlass.geraet', '');
    if (!id) { id = `g-${Math.random().toString(36).slice(2, 10)}`; speicher.schreiben('einlass.geraet', id); }
    geraet.current = id;
    const s = speicher.lesen('einlass.show', '');
    if (s && shows.some((x) => x.id === s)) setShowId(s);
    setQueue(speicher.lesen<Warteschlange>('einlass.queue', []));
  }, [shows]);
  useEffect(() => { speicher.schreiben('einlass.queue', queue); }, [queue]);

  // Codeliste je Vorstellung (für offline)
  const listeLaden = useCallback(async (id: string) => {
    const lokal = speicher.lesen<{ stand: string; tickets: ListenTicket[] } | null>(`einlass.liste.${id}`, null);
    if (lokal) { setListe(Object.fromEntries(lokal.tickets.map((t) => [t.code, t]))); setListeStand(lokal.stand); }
    try {
      const r = await fetch(`/api/einlass/liste?showId=${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (!r.ok) return;
      const j = (await r.json()) as { stand: string; tickets: ListenTicket[] };
      speicher.schreiben(`einlass.liste.${id}`, j);
      setListe(Object.fromEntries(j.tickets.map((t) => [t.code, t])));
      setListeStand(j.stand);
    } catch { /* offline – lokale Liste bleibt */ }
  }, []);

  const standLaden = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/einlass/stand?showId=${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (r.ok) { setZaehler(await r.json()); setOnline(true); }
    } catch { setOnline(false); }
  }, [setOnline]);

  useEffect(() => {
    if (!showId) return;
    speicher.schreiben('einlass.show', showId);
    setZaehler(null);
    void listeLaden(showId);
    void standLaden(showId);
    const t1 = setInterval(() => { if (navigator.onLine) void standLaden(showId); }, 5000);
    const t2 = setInterval(() => { if (navigator.onLine) void listeLaden(showId); }, 60000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [showId, listeLaden, standLaden]);

  useEffect(() => { const t = setInterval(() => setJetzt(Date.now()), 1000); return () => clearInterval(t); }, []);

  // Abgleich der Offline-Scans, sobald wieder online
  const abgleichen = useCallback(async () => {
    const offen = speicher.lesen<Warteschlange>('einlass.queue', []);
    if (!offen.length) return;
    try {
      const r = await fetch('/api/einlass/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: geraet.current, scans: offen }) });
      if (!r.ok) return;
      const j = (await r.json()) as { konflikte: Konflikt[] };
      setQueue((q) => q.filter((x) => !offen.some((o) => o.id === x.id)));
      setKonflikte((k) => [...j.konflikte, ...k].slice(0, 50));
      setMeldung(`${offen.length} Offline-Scans abgeglichen${j.konflikte.length ? `, ${j.konflikte.length} Konflikte` : ''}.`);
      if (showId) { void standLaden(showId); void listeLaden(showId); }
    } catch { setOnline(false); }
  }, [showId, standLaden, listeLaden, setOnline]);
  useEffect(() => { if (online && queue.length) void abgleichen(); }, [online, queue.length, abgleichen]);

  // Ergebnis anzeigen, Ton, automatisch zurück
  const zeigen = useCallback((a: Antwort) => {
    setAntwort(a);
    const hinweis = a.result === 'ok' && (a.ticket?.art === 'ermaessigt' || a.ticket?.art === 'rollstuhl');
    rueckmeldung(a.result === 'ok', hinweis);
    if (a.result === 'ok') {
      setZaehler((z) => (z ? { ...z, eingelassen: z.eingelassen + 1 } : z));
      if (a.checkInId && a.ticket) setLetzterOk({ checkInId: a.checkInId, sitz: a.ticket.sitz, am: Date.now() });
    }
  }, []);
  useEffect(() => {
    if (!antwort) return;
    const t = setTimeout(() => setAntwort(null), antwort.result === 'ok' ? 2500 : 4000);
    return () => clearTimeout(t);
  }, [antwort]);

  function offlinePruefen(text: string) {
    const c = codeAus(text);
    if (!c) return zeigen({ result: 'ungueltig', offline: true });
    if (c.showId && c.showId !== showId) return zeigen({ result: 'falsche_vorstellung', code: c.code, offline: true });
    const t = liste[c.code];
    if (!t) return zeigen({ result: 'unbekannt', code: c.code, offline: true });
    const ticket = { code: t.code, seatId: t.seatId, sitz: sitzName(t.seatId), kat: t.kat, art: t.art };
    if (t.status === 'storniert') return zeigen({ result: 'storniert', code: t.code, ticket, offline: true });
    if (t.status === 'eingelassen') return zeigen({ result: 'doppelt', code: t.code, ticket, vorher: t.checkedInAt ? { am: t.checkedInAt, von: 'dieses Gerät oder Server' } : undefined, offline: true });
    const am = new Date().toISOString();
    const neu = { ...liste, [t.code]: { ...t, status: 'eingelassen', checkedInAt: am } };
    setListe(neu);
    speicher.schreiben(`einlass.liste.${showId}`, { stand: listeStand ?? am, tickets: Object.values(neu) });
    setQueue((q) => [...q, { id: `${geraet.current}-${Date.now()}`, ...(text.trim().startsWith('LOC1.') ? { qr: text.trim() } : { code: c.code }), showId, scannedAt: am }]);
    zeigen({ result: 'ok', code: t.code, ticket, offline: true });
  }

  async function pruefen(text: string) {
    if (busy.current || !showId) return;
    // Gleicher Code direkt nochmal vor der Kamera: ignorieren
    if (text === zuletzt.current.text && Date.now() - zuletzt.current.am < 3500) return;
    zuletzt.current = { text, am: Date.now() };
    busy.current = true;
    try {
      if (!online) return offlinePruefen(text);
      const istQr = text.trim().startsWith('LOC1.');
      const r = await fetch('/api/einlass/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(istQr ? { qr: text.trim() } : { code: text.trim() }), showId, deviceId: geraet.current }) });
      const j = await r.json();
      if (!r.ok) return zeigen({ result: 'fehler', fehler: j.fehler ?? 'Fehler beim Prüfen' });
      zeigen(j);
      if (j.ticket?.code && liste[j.ticket.code] && j.result === 'ok') setListe((l) => ({ ...l, [j.ticket.code]: { ...l[j.ticket.code], status: 'eingelassen', checkedInAt: new Date().toISOString() } }));
    } catch {
      setOnline(false);
      offlinePruefen(text);
    } finally {
      busy.current = false;
    }
  }

  async function zuruecknehmen() {
    if (!letzterOk) return;
    try {
      const r = await fetch('/api/einlass/zuruecknehmen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ checkInId: letzterOk.checkInId }) });
      const j = await r.json();
      setMeldung(r.ok ? `Einlass zurückgenommen: ${letzterOk.sitz}` : (j.fehler ?? 'Rücknahme fehlgeschlagen'));
      if (r.ok) { setLetzterOk(null); void standLaden(showId); void listeLaden(showId); }
    } catch { setMeldung('Rücknahme nur online möglich.'); }
  }

  const ok = antwort?.result === 'ok';
  const rueckOffen = letzterOk && jetzt - letzterOk.am < RUECKNAHME_MS;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-3 py-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor="vorstellung" className="mb-1 block text-sm font-semibold text-white/80">Vorstellung</label>
          <select id="vorstellung" value={showId} onChange={(e) => setShowId(e.target.value)} className="min-h-12 w-full rounded-xl border border-white/30 bg-[#111a2e] px-3 text-lg text-white">
            {!shows.length && <option value="">Keine Vorstellung in den nächsten Tagen</option>}
            {shows.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <OnlineAnzeige online={online} dunkel />
      </div>

      <dl className="grid grid-cols-2 gap-3" aria-live="polite">
        <div className="rounded-xl bg-white/10 p-3"><dt className="text-sm text-white/80">Eingelassen</dt><dd className="num text-3xl font-bold">{zaehler?.eingelassen ?? '–'}</dd></div>
        <div className="rounded-xl bg-white/10 p-3"><dt className="text-sm text-white/80">Verkauft</dt><dd className="num text-3xl font-bold">{zaehler?.verkauft ?? (Object.keys(liste).length || '–')}</dd></div>
      </dl>

      {!online && (
        <p role="status" className="rounded-xl bg-amber-400 px-3 py-2 text-base font-medium text-black">
          Offline: Prüfung gegen die Codeliste{listeStand ? ` vom ${zeit(listeStand)}` : ' (keine Liste geladen!)'}. Scans werden später abgeglichen.
        </p>
      )}

      <Scanner aktiv={!antwort} onTreffer={pruefen} onStart={tonFreischalten} />

      <form onSubmit={(e) => { e.preventDefault(); tonFreischalten(); if (eingabe.trim()) { void pruefen(eingabe); setEingabe(''); } }} className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor="code" className="mb-1 block text-sm font-semibold text-white/80">Ticketcode eingeben</label>
          <input id="code" ref={eingabeFeld} value={eingabe} onChange={(e) => setEingabe(e.target.value.toUpperCase())} autoComplete="off" autoCapitalize="characters" spellCheck={false} inputMode="text" placeholder="z. B. K7QH2M9XPA"
            className="min-h-14 w-full rounded-xl border-2 border-white/40 bg-white px-3 font-mono text-xl tracking-wider text-nacht placeholder:text-[#59617a]" />
        </div>
        <button className="min-h-14 rounded-xl bg-gold px-5 text-lg font-semibold text-nacht">Prüfen</button>
      </form>

      {rueckOffen && (
        <button type="button" onClick={zuruecknehmen} className="min-h-12 rounded-xl border-2 border-gold px-4 text-base font-semibold text-gold">
          Einlass zurücknehmen ({letzterOk.sitz}, noch {Math.ceil((RUECKNAHME_MS - (jetzt - letzterOk.am)) / 1000)} s)
        </button>
      )}

      {meldung && <p role="status" className="rounded-xl bg-white/10 px-3 py-2 text-base">{meldung}</p>}

      {queue.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-400/60 p-3">
          <p className="flex-1 text-base">{queue.length} Offline-Scan{queue.length === 1 ? '' : 's'} warten auf Abgleich.</p>
          <button type="button" onClick={abgleichen} disabled={!online} className="min-h-12 rounded-xl bg-white px-4 font-semibold text-nacht disabled:opacity-50">Jetzt abgleichen</button>
        </div>
      )}

      {konflikte.length > 0 && (
        <section aria-labelledby="konflikte" className="rounded-xl border border-red-400/70 p-3">
          <h2 id="konflikte" className="text-base font-semibold">Konflikte beim Abgleich</h2>
          <ul className="mt-1 space-y-1 text-sm">
            {konflikte.map((k) => (
              <li key={k.id}>{k.ticket?.sitz ?? k.code}: {TITEL[k.result as Ergebnis] ?? k.result}{k.vorher ? ` (bereits ${zeit(k.vorher.am)}${k.vorher.von ? `, ${k.vorher.von}` : ''})` : ''}</li>
            ))}
          </ul>
          <button type="button" onClick={() => setKonflikte([])} className="mt-2 min-h-12 rounded-xl border border-white/30 px-4">Ausblenden</button>
        </section>
      )}

      {antwort && (
        <button type="button" onClick={() => { setAntwort(null); eingabeFeld.current?.blur(); }} aria-label={`${TITEL[antwort.result]} – tippen zum Fortfahren`}
          className={`fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 p-6 text-center text-white ${ok ? 'bg-[#11612f]' : 'bg-[#a01b1b]'}`}>
          <span aria-hidden="true" className="text-[96px] leading-none font-bold">{ok ? '✓' : '✕'}</span>
          <span role="alert" className="text-4xl font-bold">{TITEL[antwort.result]}</span>
          {antwort.ticket && <span className="text-3xl font-semibold">{antwort.ticket.sitz}</span>}
          {antwort.ticket && antwort.ticket.kat !== 'R' && <span className="text-xl">Kategorie {antwort.ticket.kat} · {antwort.ticket.art === 'ermaessigt' ? 'ermäßigt' : antwort.ticket.art === 'frei' ? 'Freikarte' : 'Vollpreis'}</span>}
          {ok && antwort.ticket?.art === 'ermaessigt' && <span className="rounded-xl bg-yellow-300 px-5 py-3 text-2xl font-bold text-black">Ausweis prüfen</span>}
          {ok && antwort.ticket?.art === 'rollstuhl' && <span className="rounded-xl bg-white px-5 py-3 text-2xl font-bold text-[#11612f]">Rollstuhlplatz mit Begleitperson</span>}
          {antwort.result === 'doppelt' && antwort.vorher && <span className="text-xl">Eingelassen um {zeit(antwort.vorher.am)} Uhr{antwort.vorher.von ? ` von ${antwort.vorher.von}` : ''}</span>}
          {antwort.result === 'falsche_vorstellung' && <span className="text-xl">{antwort.vorstellung ? `Gültig für ${antwort.vorstellung} Uhr` : 'Ticket gilt für eine andere Vorstellung'}</span>}
          {antwort.result === 'ungueltig' && <span className="text-xl">QR-Code nicht von Light of Creation oder verändert</span>}
          {antwort.result === 'unbekannt' && <span className="text-xl">Code {antwort.code} nicht gefunden{antwort.offline ? ' (Offline-Liste)' : ''}</span>}
          {antwort.fehler && <span className="text-xl">{antwort.fehler}</span>}
          {antwort.offline && <span className="text-base opacity-90">Offline geprüft</span>}
          <span className="mt-6 text-base opacity-90">Tippen zum Fortfahren</span>
        </button>
      )}
    </div>
  );
}
