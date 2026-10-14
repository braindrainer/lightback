'use client';
// Einlass-App: Kamera bildschirmfüllend, laufend scannen, Ergebnis als Vollbild in Farbe. Bedienung unten (einhändig).
// Offline: Prüfung gegen die zuletzt geladene Codeliste, Scans in einer Warteschlange, Abgleich bei Verbindung.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Sheet } from '@/components/vorort/Sheet';
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
type Eintrag = Antwort & { id: string; am: string };
type ListenTicket = { code: string; seatId: string; kat: string; art: string; status: string; checkedInAt?: string | null };
type Warteschlange = { id: string; qr?: string; code?: string; showId: string; scannedAt: string }[];
type Konflikt = { id: string; result: string; code?: string; ticket?: { sitz: string }; vorher?: { am: string; von: string | null } };
type Show = { id: string; label: string; tag: string; zeit: string };
type Einst = { ton: boolean; vibration: boolean };

const TITEL: Record<Ergebnis, string> = {
  ok: 'Einlass OK', doppelt: 'Bereits eingelassen', falsche_vorstellung: 'Falsche Vorstellung', storniert: 'Ticket storniert',
  unbekannt: 'Ticket unbekannt', ungueltig: 'Ungültiges Ticket', fehler: 'Fehler',
};
const RUECKNAHME_MS = 2 * 60e3;
const SPERRE_MS = 3000;
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
const artName = (art: string) => (art === 'ermaessigt' ? 'ermäßigt' : art === 'frei' ? 'Freikarte' : art === 'rollstuhl' ? 'Rollstuhl' : 'Vollpreis');
/** Darstellung: grün ✓, gelb ! (eingelassen, aber prüfen), rot ✕ */
const stufe = (a: Antwort): 'ok' | 'pruefen' | 'nein' => (a.result !== 'ok' ? 'nein' : a.ticket?.art === 'ermaessigt' ? 'pruefen' : 'ok');
const STUFE = {
  ok: { bg: 'bg-[#11612f] text-white', icon: '✓' },
  pruefen: { bg: 'bg-[#f5b400] text-black', icon: '!' },
  nein: { bg: 'bg-[#a01b1b] text-white', icon: '✕' },
} as const;

function hinweise(a: Antwort): string[] {
  const h: string[] = [];
  if (a.result === 'ok' && a.ticket?.art === 'ermaessigt') h.push('Ausweis für die Ermäßigung prüfen');
  if (a.result === 'ok' && a.ticket?.art === 'rollstuhl') h.push('Rollstuhlplatz mit Begleitperson');
  if (a.result === 'doppelt' && a.vorher) h.push(`Eingelassen um ${zeit(a.vorher.am)} Uhr${a.vorher.von ? ` von ${a.vorher.von}` : ''}`);
  if (a.result === 'falsche_vorstellung') h.push(a.vorstellung ? `Gültig für ${a.vorstellung} Uhr` : 'Ticket gilt für eine andere Vorstellung');
  if (a.result === 'ungueltig') h.push('QR-Code nicht von Light of Creation oder verändert');
  if (a.result === 'unbekannt') h.push(`Code ${a.code ?? ''} nicht gefunden${a.offline ? ' (Offline-Liste)' : ''}`);
  if (a.fehler) h.push(a.fehler);
  return h;
}

export default function EinlassApp({ shows, standard, benutzer, appHost }: { shows: Show[]; standard: string; benutzer: string; appHost: boolean }) {
  const [showId, setShowId] = useState(standard);
  const [online, setOnline] = useOnline();
  const [zaehler, setZaehler] = useState<{ eingelassen: number; verkauft: number } | null>(null);
  const [liste, setListe] = useState<Record<string, ListenTicket>>({});
  const [listeStand, setListeStand] = useState<string | null>(null);
  const [queue, setQueue] = useState<Warteschlange>([]);
  const [konflikte, setKonflikte] = useState<Konflikt[]>([]);
  const [antwort, setAntwort] = useState<Antwort | null>(null);
  const [verlauf, setVerlauf] = useState<Eintrag[]>([]);
  const [detail, setDetail] = useState<Eintrag | null>(null);
  const [letzterOk, setLetzterOk] = useState<{ checkInId: string; sitz: string; am: number } | null>(null);
  const [eingabe, setEingabe] = useState('');
  const [meldung, setMeldung] = useState('');
  const [jetzt, setJetzt] = useState(Date.now());
  const [blatt, setBlatt] = useState<null | 'show' | 'code' | 'verlauf' | 'einst'>(null);
  const [einst, setEinst] = useState<Einst>({ ton: true, vibration: true });
  const busy = useRef(false);
  const zuletzt = useRef<{ code: string; am: number }>({ code: '', am: 0 });
  const geraet = useRef('');
  const einstRef = useRef(einst);
  einstRef.current = einst;

  // Gerät, gespeicherte Vorstellung, Warteschlange, Verlauf, Einstellungen
  useEffect(() => {
    let id = speicher.lesen('einlass.geraet', '');
    if (!id) { id = `g-${Math.random().toString(36).slice(2, 10)}`; speicher.schreiben('einlass.geraet', id); }
    geraet.current = id;
    const s = speicher.lesen('einlass.show', '');
    if (s && shows.some((x) => x.id === s)) setShowId(s);
    setQueue(speicher.lesen<Warteschlange>('einlass.queue', []));
    setVerlauf(speicher.lesen<Eintrag[]>('einlass.verlauf', []));
    setEinst({ ton: true, vibration: true, ...speicher.lesen<Partial<Einst>>('einlass.einst', {}) });
  }, [shows]);
  useEffect(() => { speicher.schreiben('einlass.queue', queue); }, [queue]);
  useEffect(() => { speicher.schreiben('einlass.verlauf', verlauf); }, [verlauf]);
  const einstSetzen = (e: Partial<Einst>) => setEinst((x) => { const n = { ...x, ...e }; speicher.schreiben('einlass.einst', n); return n; });

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
  useEffect(() => { if (!meldung) return; const t = setTimeout(() => setMeldung(''), 6000); return () => clearTimeout(t); }, [meldung]);

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

  // Ergebnis anzeigen, Ton/Vibration, Verlauf, automatisch zurück
  const zeigen = useCallback((a: Antwort) => {
    setAntwort(a);
    const hinweis = a.result === 'ok' && (a.ticket?.art === 'ermaessigt' || a.ticket?.art === 'rollstuhl');
    rueckmeldung(a.result === 'ok', hinweis, einstRef.current);
    setVerlauf((v) => [{ ...a, id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, am: new Date().toISOString() }, ...v].slice(0, 10));
    if (a.result === 'ok') {
      setZaehler((z) => (z ? { ...z, eingelassen: z.eingelassen + 1 } : z));
      if (a.checkInId && a.ticket) setLetzterOk({ checkInId: a.checkInId, sitz: a.ticket.sitz, am: Date.now() });
    }
  }, []);
  useEffect(() => {
    if (!antwort) return;
    const t = setTimeout(() => setAntwort(null), antwort.result === 'ok' && antwort.ticket?.art !== 'ermaessigt' ? 2500 : 4000);
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

  async function pruefen(text: string, hand = false) {
    if (busy.current || !showId) return;
    // Gleicher Code vor der Kamera: 3 s lang ignorieren (solange er im Bild bleibt, verlängert sich die Sperre)
    const schluessel = codeAus(text)?.code ?? text.trim();
    if (!hand && schluessel === zuletzt.current.code && Date.now() - zuletzt.current.am < SPERRE_MS) { zuletzt.current.am = Date.now(); return; }
    zuletzt.current = { code: schluessel, am: Date.now() };
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

  const show = shows.find((s) => s.id === showId);
  const rueckOffen = letzterOk && jetzt - letzterOk.am < RUECKNAHME_MS;
  const verkauft = zaehler?.verkauft ?? Object.keys(liste).length;
  const eingelassen = zaehler?.eingelassen ?? Object.values(liste).filter((t) => t.status === 'eingelassen').length;
  const prozent = verkauft ? Math.min(100, Math.round((eingelassen / verkauft) * 100)) : 0;
  const knopf = 'flex min-h-14 items-center justify-center gap-2 rounded-2xl text-base font-semibold';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Kopf: Vorstellung, Status, Einstellungen */}
      <div className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-[max(.5rem,env(safe-area-inset-top))]">
        <button type="button" onClick={() => setBlatt('show')} aria-label={`Vorstellung: ${show?.label ?? 'keine gewählt'} – ändern`}
          className="flex min-h-12 min-w-0 items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 text-left hover:bg-white/15">
          <span className="num text-lg font-bold">{show?.zeit ?? '–'}</span>
          <span className="truncate text-sm text-white/85">{show?.tag ?? 'Vorstellung wählen'}</span>
          <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 shrink-0" fill="currentColor"><path d="M5 7l5 5 5-5z" /></svg>
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <OnlineAnzeige online={online} dunkel />
          {queue.length > 0 && <span className="rounded-full bg-amber-400 px-2.5 py-1 text-xs font-bold text-black">{queue.length} offen</span>}
          <button type="button" onClick={() => setBlatt('einst')} aria-label="Einstellungen und Abmelden" className="inline-flex size-12 items-center justify-center rounded-full hover:bg-white/10">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
        </div>
      </div>

      {/* Fortschritt */}
      <div className="shrink-0 px-3 pb-2">
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span><span className="num text-2xl font-bold">{eingelassen}</span><span className="text-white/80"> von </span><span className="num font-semibold">{verkauft || '–'}</span><span className="text-white/80"> eingelassen</span></span>
          <span className="num text-lg font-semibold">{verkauft ? `${prozent} %` : ''}</span>
        </div>
        <div role="progressbar" aria-label="Eingelassen von verkauft" aria-valuemin={0} aria-valuemax={verkauft || 0} aria-valuenow={eingelassen} aria-valuetext={`${eingelassen} von ${verkauft} eingelassen`}
          className="mt-1 h-2 overflow-hidden rounded-full bg-white/15">
          <div className="h-full rounded-full bg-gold transition-[width] duration-500" style={{ width: `${prozent}%` }} />
        </div>
      </div>

      {!online && (
        <p role="status" className="shrink-0 bg-amber-400 px-3 py-2 text-sm font-semibold text-black">
          Offline: Prüfung gegen die Codeliste{listeStand ? ` vom ${zeit(listeStand)}` : ' (keine Liste geladen!)'}.{queue.length ? ` ${queue.length} Scan${queue.length === 1 ? '' : 's'} warten auf Abgleich.` : ''}
        </p>
      )}

      {/* Kamera */}
      <div className="relative min-h-[16rem] flex-1">
        <Scanner aktiv={!antwort && !blatt} onTreffer={pruefen} onStart={tonFreischalten} />
        {meldung && <p role="status" className="absolute inset-x-3 bottom-3 rounded-xl bg-white px-3 py-2 text-base font-medium text-nacht shadow-lg">{meldung}</p>}
      </div>

      {/* Bedienung unten (Daumenbereich) */}
      <div className="grid shrink-0 gap-2 px-3 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-3">
        {rueckOffen && (
          <button type="button" onClick={zuruecknehmen} className="min-h-12 rounded-2xl border-2 border-gold px-4 text-base font-semibold text-gold">
            Letzten Einlass zurücknehmen ({letzterOk.sitz}, noch {Math.ceil((RUECKNAHME_MS - (jetzt - letzterOk.am)) / 1000)} s)
          </button>
        )}
        {queue.length > 0 && online && (
          <button type="button" onClick={abgleichen} className="min-h-12 rounded-2xl bg-amber-400 px-4 text-base font-semibold text-black">{queue.length} Offline-Scans jetzt abgleichen</button>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => { tonFreischalten(); setBlatt('code'); }} className={`${knopf} bg-gold text-nacht`}>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></svg>
            Code eingeben
          </button>
          <button type="button" onClick={() => setBlatt('verlauf')} className={`${knopf} border border-white/25 bg-white/10 hover:bg-white/15`}>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" /></svg>
            Verlauf{konflikte.length ? <span className="rounded-full bg-red-500 px-2 text-sm text-white">{konflikte.length}</span> : verlauf.length ? <span className="num text-white/80">({verlauf.length})</span> : null}
          </button>
        </div>
      </div>

      {/* Ergebnis bildschirmfüllend */}
      {antwort && (() => {
        const st = STUFE[stufe(antwort)];
        const titel = antwort.result === 'ok' && antwort.ticket?.art === 'ermaessigt' ? 'Einlass OK – Ausweis prüfen' : TITEL[antwort.result];
        return (
          <button type="button" onClick={() => setAntwort(null)} aria-label={`${titel} – tippen zum Fortfahren`}
            className={`fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 p-6 text-center ${st.bg}`}>
            <span aria-hidden="true" className="grid size-40 place-items-center rounded-full border-[6px] border-current text-[110px] font-bold leading-none">{st.icon}</span>
            <span role="alert" className="text-4xl font-bold leading-tight">{titel}</span>
            {antwort.ticket && <span className="text-3xl font-semibold">{antwort.ticket.sitz}</span>}
            {antwort.ticket && antwort.ticket.kat !== 'R' && <span className="text-xl">Kategorie {antwort.ticket.kat} · {artName(antwort.ticket.art)}</span>}
            {hinweise(antwort).map((h) => <span key={h} className={`rounded-xl px-5 py-2 text-xl font-semibold ${stufe(antwort) === 'pruefen' ? 'bg-black text-[#f5b400]' : 'bg-black/25'}`}>{h}</span>)}
            {antwort.offline && <span className="text-base">Offline geprüft</span>}
            <span className="mt-6 text-base">Tippen zum Fortfahren</span>
          </button>
        );
      })()}

      {/* Vorstellung wählen */}
      <Sheet dunkel offen={blatt === 'show'} onClose={() => setBlatt(null)} titel="Vorstellung wählen">
        {!shows.length && <p className="text-base text-white/85">Keine Vorstellung in den nächsten Tagen.</p>}
        <ul className="grid gap-2">
          {shows.map((s) => (
            <li key={s.id}>
              <button type="button" aria-pressed={s.id === showId} onClick={() => { setShowId(s.id); setBlatt(null); }}
                className={`flex min-h-14 w-full items-center gap-3 rounded-2xl border px-4 text-left ${s.id === showId ? 'border-gold bg-gold text-nacht' : 'border-white/20 bg-white/5 hover:bg-white/10'}`}>
                <span className="num text-2xl font-bold">{s.zeit}</span>
                <span className="flex-1 text-base">{s.tag}</span>
                {s.id === showId && <span className="text-sm font-semibold">gewählt</span>}
              </button>
            </li>
          ))}
        </ul>
      </Sheet>

      {/* Handeingabe */}
      <Sheet dunkel offen={blatt === 'code'} onClose={() => setBlatt(null)} titel="Ticketcode eingeben">
        <form onSubmit={(e) => { e.preventDefault(); const c = eingabe.trim(); if (!c) return; setBlatt(null); setEingabe(''); void pruefen(c, true); }} className="grid gap-3">
          <label htmlFor="code" className="text-sm font-semibold text-white/85">Code vom Ticket (Groß-/Kleinschreibung egal)</label>
          <input id="code" autoFocus value={eingabe} onChange={(e) => setEingabe(e.target.value.toUpperCase())} autoComplete="off" autoCapitalize="characters" spellCheck={false} enterKeyHint="go" placeholder="z. B. K7QH2M9XPA"
            className="min-h-16 w-full rounded-2xl border-2 border-white/40 bg-white px-4 font-mono text-2xl tracking-wider text-nacht placeholder:text-[#59617a]" />
          <button disabled={!eingabe.trim()} className="min-h-14 rounded-2xl bg-gold text-lg font-semibold text-nacht disabled:opacity-60">Prüfen</button>
        </form>
      </Sheet>

      {/* Verlauf */}
      <Sheet dunkel offen={blatt === 'verlauf'} onClose={() => { setBlatt(null); setDetail(null); }} titel={detail ? 'Scan-Details' : 'Letzte Scans'}
        aktionen={detail ? <button type="button" onClick={() => setDetail(null)} className="min-h-11 rounded-full px-3 text-sm font-semibold text-gold hover:bg-white/10">Zurück</button> : null}>
        {detail ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-base">
            <dt className="text-white/80">Ergebnis</dt><dd className="font-semibold">{STUFE[stufe(detail)].icon} {TITEL[detail.result]}</dd>
            <dt className="text-white/80">Zeit</dt><dd>{zeit(detail.am)} Uhr{detail.offline ? ' (offline)' : ''}</dd>
            {detail.code && <><dt className="text-white/80">Code</dt><dd className="font-mono">{detail.code}</dd></>}
            {detail.ticket && <><dt className="text-white/80">Platz</dt><dd>{detail.ticket.sitz}</dd><dt className="text-white/80">Kategorie</dt><dd>{detail.ticket.kat === 'R' ? 'Rollstuhl' : detail.ticket.kat} · {artName(detail.ticket.art)}</dd></>}
            {hinweise(detail).map((h) => <div key={h} className="contents"><dt className="text-white/80">Hinweis</dt><dd>{h}</dd></div>)}
          </dl>
        ) : (
          <>
            {konflikte.length > 0 && (
              <section aria-labelledby="konflikte" className="mb-4 rounded-2xl border border-red-400/70 p-3">
                <h3 id="konflikte" className="text-base font-semibold">Konflikte beim Abgleich</h3>
                <ul className="mt-1 space-y-1 text-sm">
                  {konflikte.map((k) => (
                    <li key={k.id}>{k.ticket?.sitz ?? k.code}: {TITEL[k.result as Ergebnis] ?? k.result}{k.vorher ? ` (bereits ${zeit(k.vorher.am)}${k.vorher.von ? `, ${k.vorher.von}` : ''})` : ''}</li>
                  ))}
                </ul>
                <button type="button" onClick={() => setKonflikte([])} className="mt-2 min-h-11 rounded-xl border border-white/30 px-4">Ausblenden</button>
              </section>
            )}
            {!verlauf.length && <p className="text-base text-white/85">Noch keine Scans auf diesem Gerät.</p>}
            <ul className="grid gap-1.5">
              {verlauf.map((e) => {
                const st = stufe(e);
                return (
                  <li key={e.id}>
                    <button type="button" onClick={() => setDetail(e)} className="flex min-h-14 w-full items-center gap-3 rounded-xl bg-white/5 px-3 text-left hover:bg-white/10">
                      <span aria-hidden="true" className={`grid size-9 shrink-0 place-items-center rounded-full text-lg font-bold ${STUFE[st].bg}`}>{STUFE[st].icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{TITEL[e.result]}{e.ticket ? ` · ${e.ticket.sitz}` : ''}</span>
                        <span className="block truncate text-sm text-white/80">{zeit(e.am)} Uhr{e.code ? ` · ${e.code}` : ''}{e.offline ? ' · offline' : ''}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Sheet>

      {/* Einstellungen */}
      <Sheet dunkel offen={blatt === 'einst'} onClose={() => setBlatt(null)} titel="Einstellungen">
        <div className="grid gap-2">
          {([['ton', 'Ton bei jedem Scan'], ['vibration', 'Vibration bei jedem Scan']] as const).map(([k, t]) => (
            <button key={k} type="button" role="switch" aria-checked={einst[k]} onClick={() => { tonFreischalten(); einstSetzen({ [k]: !einst[k] }); }}
              className="flex min-h-14 items-center gap-3 rounded-2xl bg-white/5 px-4 text-left text-base hover:bg-white/10">
              <span className="flex-1">{t}</span>
              <span aria-hidden="true" className={`relative h-7 w-12 rounded-full transition-colors ${einst[k] ? 'bg-gold' : 'bg-white/30'}`}>
                <span className={`absolute top-0.5 size-6 rounded-full bg-white shadow transition-all ${einst[k] ? 'left-[1.375rem]' : 'left-0.5'}`} />
              </span>
            </button>
          ))}
          <button type="button" onClick={() => { tonFreischalten(); rueckmeldung(true, false, einst); }} className="min-h-12 rounded-2xl border border-white/25 text-base font-semibold hover:bg-white/10">Ton testen</button>
          <p className="mt-2 text-sm text-white/80">Angemeldet als <strong className="text-white">{benutzer}</strong>{listeStand ? ` · Codeliste vom ${zeit(listeStand)}` : ''}</p>
          <div className="grid grid-cols-2 gap-2">
            {!appHost && <a href="/" className="flex min-h-12 items-center justify-center rounded-2xl border border-white/25 text-base font-semibold hover:bg-white/10">Zur Übersicht</a>}
            <form action="/api/auth/logout" method="post" className={appHost ? 'col-span-2' : ''}>
              <button className="min-h-12 w-full rounded-2xl bg-white text-base font-semibold text-nacht">Abmelden</button>
            </form>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
