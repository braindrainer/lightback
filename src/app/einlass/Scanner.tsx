'use client';
// Kamera-Scanner: BarcodeDetector (Chrome/Android, Safari 17+) oder jsQR als Ersatz. Füllt den Elternbereich.
// Startet von selbst, sobald die Kamera einmal erlaubt wurde; hält währenddessen den Bildschirm wach (Wake Lock).
import { useCallback, useEffect, useRef, useState } from 'react';
import { speicher } from '@/components/vorort/pwa';

type Detector = { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> };
type JsQr = (data: Uint8ClampedArray, w: number, h: number, o?: { inversionAttempts?: 'dontInvert' | 'onlyInvert' | 'attemptBoth' | 'invertFirst' }) => { data: string } | null;
type WakeLock = { release(): Promise<void>; addEventListener(t: 'release', f: () => void): void };

const FEHLER: Record<string, string> = {
  NotAllowedError: 'Kamerazugriff verweigert. Bitte in den Browser-Einstellungen erlauben – oder den Code eingeben.',
  NotFoundError: 'Keine Kamera gefunden. Bitte den Code eingeben.',
  NotReadableError: 'Die Kamera wird von einer anderen App verwendet.',
  OverconstrainedError: 'Keine passende Kamera gefunden.',
  unsicher: 'Die Kamera ist nur über HTTPS verfügbar. Bitte den Code eingeben.',
};

export default function Scanner({ aktiv, onTreffer, onStart }: { aktiv: boolean; onTreffer: (text: string) => void; onStart?: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const wach = useRef<WakeLock | null>(null);
  const aktivRef = useRef(aktiv);
  const trefferRef = useRef(onTreffer);
  const [status, setStatus] = useState<'aus' | 'startet' | 'laeuft' | 'fehler'>('aus');
  const [fehler, setFehler] = useState('');
  const [licht, setLicht] = useState<boolean | null>(null); // null = nicht verfügbar
  const [kameras, setKameras] = useState<{ id: string; name: string }[]>([]);
  const [kameraId, setKameraId] = useState<string>('');
  const [erstmals, setErstmals] = useState(true);
  aktivRef.current = aktiv;
  trefferRef.current = onTreffer;

  const wachHalten = useCallback(async () => {
    try {
      const wl = (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<WakeLock> } }).wakeLock;
      if (!wl || wach.current || document.hidden) return;
      const l = await wl.request('screen');
      wach.current = l;
      l.addEventListener('release', () => { if (wach.current === l) wach.current = null; });
    } catch { /* nicht unterstützt oder Akku-Sparmodus */ }
  }, []);

  const stoppen = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setStatus('aus');
    setLicht(null);
    void wach.current?.release().catch(() => {});
    wach.current = null;
  }, []);

  const starten = useCallback(async (geraet?: string) => {
    onStart?.();
    setFehler('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('fehler');
      setFehler(FEHLER.unsicher);
      return;
    }
    stream.current?.getTracks().forEach((t) => t.stop());
    setStatus('startet');
    const id = geraet ?? speicher.lesen('einlass.kameraId', '');
    try {
      const bild = { width: { ideal: 1280 }, height: { ideal: 720 } };
      let s: MediaStream;
      try {
        s = await navigator.mediaDevices.getUserMedia({ video: id ? { deviceId: { exact: id }, ...bild } : { facingMode: { ideal: 'environment' }, ...bild }, audio: false });
      } catch (e) {
        if (!id || (e as DOMException).name === 'NotAllowedError') throw e;
        speicher.schreiben('einlass.kameraId', '');
        s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, ...bild }, audio: false });
      }
      stream.current = s;
      const v = video.current!;
      v.srcObject = s;
      await v.play();
      setStatus('laeuft');
      speicher.schreiben('einlass.kamera', true);
      const track = s.getVideoTracks()[0];
      setKameraId(track.getSettings?.().deviceId ?? '');
      const caps = (track.getCapabilities?.() ?? {}) as { torch?: boolean };
      setLicht(caps.torch ? false : null);
      const geraete = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      setKameras(geraete.filter((d) => d.kind === 'videoinput').map((d, i) => ({ id: d.deviceId, name: d.label || `Kamera ${i + 1}` })));
      void wachHalten();
    } catch (e) {
      stoppen();
      setStatus('fehler');
      const n = (e as DOMException).name;
      setFehler(FEHLER[n] ?? `Kamera konnte nicht gestartet werden (${n || 'unbekannt'}).`);
      if (n === 'NotAllowedError') speicher.schreiben('einlass.kamera', false);
    }
  }, [onStart, stoppen, wachHalten]);

  // Erkennungsschleife (~8 Bilder/s)
  useEffect(() => {
    if (status !== 'laeuft') return;
    let ende = false;
    let detector: Detector | null = null;
    let jsqr: JsQr | null = null;
    const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    if (BD) detector = new BD({ formats: ['qr_code'] });
    else void import('jsqr').then((m) => { jsqr = m.default as unknown as JsQr; });
    const schleife = async () => {
      if (ende) return;
      const v = video.current;
      if (aktivRef.current && v && v.readyState >= 2) {
        try {
          let text: string | undefined;
          if (detector) text = (await detector.detect(v))[0]?.rawValue;
          else if (jsqr && canvas.current) {
            const max = 640;
            const f = Math.min(1, max / Math.max(v.videoWidth, v.videoHeight));
            const w = Math.round(v.videoWidth * f);
            const h = Math.round(v.videoHeight * f);
            const c = canvas.current;
            c.width = w; c.height = h;
            const g = c.getContext('2d', { willReadFrequently: true })!;
            g.drawImage(v, 0, 0, w, h);
            text = jsqr(g.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' })?.data;
          }
          if (text && aktivRef.current) trefferRef.current(text);
        } catch { /* Einzelbild fehlerhaft – weiter */ }
      }
      setTimeout(schleife, 120);
    };
    void schleife();
    return () => { ende = true; };
  }, [status]);

  // Hintergrund: Kamera aus; zurück im Vordergrund: wieder an (wenn schon einmal erlaubt)
  useEffect(() => {
    const auto = speicher.lesen('einlass.kamera', false);
    setErstmals(!auto);
    const sicht = () => {
      if (document.hidden) stoppen();
      else if (speicher.lesen('einlass.kamera', false) && !stream.current) void starten();
    };
    document.addEventListener('visibilitychange', sicht);
    if (auto) void starten();
    return () => { document.removeEventListener('visibilitychange', sicht); stoppen(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function lichtUmschalten() {
    const t = stream.current?.getVideoTracks()[0];
    if (!t || licht === null) return;
    try {
      await t.applyConstraints({ advanced: [{ torch: !licht } as MediaTrackConstraintSet] });
      setLicht(!licht);
    } catch { setLicht(null); }
  }

  function kameraWechseln() {
    if (kameras.length < 2) return;
    const i = kameras.findIndex((k) => k.id === kameraId);
    const naechste = kameras[(i + 1) % kameras.length];
    speicher.schreiben('einlass.kameraId', naechste.id);
    void starten(naechste.id);
  }

  const rund = 'inline-flex size-12 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm hover:bg-black/70';
  return (
    <section aria-label="Kamera" className="absolute inset-0 overflow-hidden bg-black">
      <video ref={video} playsInline muted className={`size-full object-cover ${status === 'laeuft' ? '' : 'invisible'}`} aria-hidden="true" />
      <canvas ref={canvas} className="hidden" aria-hidden="true" />
      {status === 'laeuft' && (
        <>
          {/* Suchrahmen mit abgedunkeltem Rand */}
          <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-[44%] aspect-square w-[min(68vw,46dvh,22rem)] -translate-x-1/2 -translate-y-1/2 rounded-3xl shadow-[0_0_0_9999px_rgba(0,0,0,.45)]">
            {['left-0 top-0 border-l-4 border-t-4 rounded-tl-3xl', 'right-0 top-0 border-r-4 border-t-4 rounded-tr-3xl', 'left-0 bottom-0 border-l-4 border-b-4 rounded-bl-3xl', 'right-0 bottom-0 border-r-4 border-b-4 rounded-br-3xl'].map((c) => (
              <span key={c} className={`absolute size-12 border-gold ${c}`} />
            ))}
            {aktiv && <span className="absolute inset-x-6 top-1/2 h-0.5 animate-pulse rounded bg-gold/80 motion-reduce:animate-none" />}
          </div>
          <p className="pointer-events-none absolute inset-x-0 top-[calc(44%+min(34vw,23dvh,11rem)+0.75rem)] text-center text-base font-semibold text-white [text-shadow:0_1px_3px_rgba(0,0,0,.8)]">QR-Code in den Rahmen halten</p>
          <div className="absolute right-3 top-3 flex flex-col gap-2">
            {licht !== null && (
              <button type="button" onClick={lichtUmschalten} aria-pressed={licht} aria-label="Taschenlampe" className={`${rund} ${licht ? '!bg-gold !text-nacht' : ''}`}>
                <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="currentColor"><path d="M7 2h10v3l-2 4v13H9V9L7 5V2Zm4 9v4h2v-4h-2Z" /></svg>
              </button>
            )}
            {kameras.length > 1 && (
              <button type="button" onClick={kameraWechseln} aria-label="Kamera wechseln" className={rund}>
                <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h3l2-3h6l2 3h3v12H4z" /><path d="M9.5 12.5a3 3 0 0 1 5-1.5l.5.5M14.5 14a3 3 0 0 1-5 .5L9 14" /><path d="M15 9.5V11h-1.5M9 15.5V14h1.5" /></svg>
              </button>
            )}
            <button type="button" onClick={() => { stoppen(); setErstmals(false); }} aria-label="Kamera ausschalten" className={rund}>
              <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 3l18 18M10 6h5l2 3h3v9M17 20H4V9h3" /></svg>
            </button>
          </div>
        </>
      )}
      {status !== 'laeuft' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-[radial-gradient(ellipse_at_center,#16213a_0%,#070b14_70%)] p-6 text-center">
          <svg aria-hidden="true" viewBox="0 0 48 48" className="size-20 text-gold" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 16V8a2 2 0 0 1 2-2h8M32 6h8a2 2 0 0 1 2 2v8M42 32v8a2 2 0 0 1-2 2h-8M16 42H8a2 2 0 0 1-2-2v-8" /><rect x="15" y="15" width="7" height="7" rx="1" /><rect x="26" y="15" width="7" height="7" rx="1" /><rect x="15" y="26" width="7" height="7" rx="1" /><path d="M27 27h6v6" /></svg>
          {status === 'fehler' ? <p role="alert" className="max-w-xs text-base text-amber-300">{fehler}</p>
            : <p className="max-w-xs text-base text-white/85">{erstmals ? 'Tickets mit der Kamera scannen. Beim ersten Start fragt der Browser nach der Erlaubnis.' : 'Kamera ist aus.'}</p>}
          <button type="button" onClick={() => void starten()} disabled={status === 'startet'} className="min-h-16 w-full max-w-xs rounded-2xl bg-gold px-6 text-xl font-semibold text-nacht shadow-lg disabled:opacity-60">
            {status === 'startet' ? 'Kamera startet …' : status === 'fehler' ? 'Erneut versuchen' : 'Kamera starten'}
          </button>
        </div>
      )}
    </section>
  );
}
