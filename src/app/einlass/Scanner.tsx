'use client';
// Kamera-Scanner: BarcodeDetector (Chrome/Android, Safari 17+) oder jsQR als Ersatz.
// Ohne Kamera oder ohne Erlaubnis bleibt die Handeingabe darunter nutzbar.
import { useCallback, useEffect, useRef, useState } from 'react';
import { speicher } from '@/components/vorort/pwa';

type Detector = { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> };
type JsQr = (data: Uint8ClampedArray, w: number, h: number, o?: { inversionAttempts?: 'dontInvert' | 'onlyInvert' | 'attemptBoth' | 'invertFirst' }) => { data: string } | null;

const FEHLER: Record<string, string> = {
  NotAllowedError: 'Kamerazugriff verweigert. Bitte in den Browser-Einstellungen erlauben – oder den Code unten eingeben.',
  NotFoundError: 'Keine Kamera gefunden. Bitte den Code unten eingeben.',
  NotReadableError: 'Die Kamera wird von einer anderen App verwendet.',
  OverconstrainedError: 'Keine passende Kamera gefunden.',
  unsicher: 'Die Kamera ist nur über HTTPS verfügbar. Bitte den Code unten eingeben.',
};

export default function Scanner({ aktiv, onTreffer, onStart }: { aktiv: boolean; onTreffer: (text: string) => void; onStart?: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const aktivRef = useRef(aktiv);
  const trefferRef = useRef(onTreffer);
  const [status, setStatus] = useState<'aus' | 'startet' | 'laeuft' | 'fehler'>('aus');
  const [fehler, setFehler] = useState('');
  const [licht, setLicht] = useState<boolean | null>(null); // null = nicht verfügbar
  const [verfahren, setVerfahren] = useState('');
  aktivRef.current = aktiv;
  trefferRef.current = onTreffer;

  const stoppen = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setStatus('aus');
    setLicht(null);
  }, []);

  const starten = useCallback(async () => {
    onStart?.();
    setFehler('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('fehler');
      setFehler(FEHLER.unsicher);
      return;
    }
    setStatus('startet');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      stream.current = s;
      const v = video.current!;
      v.srcObject = s;
      await v.play();
      setStatus('laeuft');
      speicher.schreiben('einlass.kamera', true);
      const track = s.getVideoTracks()[0];
      const caps = (track.getCapabilities?.() ?? {}) as { torch?: boolean };
      setLicht(caps.torch ? false : null);
    } catch (e) {
      stoppen();
      setStatus('fehler');
      const n = (e as DOMException).name;
      setFehler(FEHLER[n] ?? `Kamera konnte nicht gestartet werden (${n || 'unbekannt'}).`);
      if (n === 'NotAllowedError') speicher.schreiben('einlass.kamera', false);
    }
  }, [onStart, stoppen]);

  // Erkennungsschleife (~8 Bilder/s)
  useEffect(() => {
    if (status !== 'laeuft') return;
    let ende = false;
    let detector: Detector | null = null;
    let jsqr: JsQr | null = null;
    const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    if (BD) { detector = new BD({ formats: ['qr_code'] }); setVerfahren('BarcodeDetector'); }
    else { void import('jsqr').then((m) => { jsqr = m.default as unknown as JsQr; setVerfahren('jsQR'); }); }
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

  // Beim Verlassen und wenn die App in den Hintergrund geht: Kamera aus
  useEffect(() => {
    const sicht = () => { if (document.hidden) stoppen(); };
    document.addEventListener('visibilitychange', sicht);
    if (speicher.lesen('einlass.kamera', false)) void starten();
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

  return (
    <section aria-labelledby="kamera-titel" className="flex flex-col gap-2">
      <h2 id="kamera-titel" className="sr-only">Kamera</h2>
      <div className="relative mx-auto aspect-square w-full max-w-md overflow-hidden rounded-2xl bg-black" style={{ maxHeight: '52dvh' }}>
        <video ref={video} playsInline muted className={`size-full object-cover ${status === 'laeuft' ? '' : 'hidden'}`} aria-label="Kamerabild" />
        <canvas ref={canvas} className="hidden" aria-hidden="true" />
        {status === 'laeuft' && <div aria-hidden="true" className="pointer-events-none absolute inset-[15%] rounded-2xl border-4 border-gold/90 shadow-[0_0_0_9999px_rgba(0,0,0,.35)]" />}
        {status !== 'laeuft' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
            {status === 'fehler' && <p role="alert" className="text-base text-amber-300">{fehler}</p>}
            <button type="button" onClick={starten} disabled={status === 'startet'} className="min-h-14 rounded-xl bg-gold px-6 text-lg font-semibold text-nacht disabled:opacity-60">
              {status === 'startet' ? 'Kamera startet …' : status === 'fehler' ? 'Erneut versuchen' : 'Kamera starten'}
            </button>
          </div>
        )}
      </div>
      {status === 'laeuft' && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button type="button" onClick={stoppen} className="min-h-12 rounded-xl border border-white/30 px-4 text-base">Kamera aus</button>
          {licht !== null && (
            <button type="button" onClick={lichtUmschalten} aria-pressed={licht} className={`min-h-12 rounded-xl px-4 text-base font-semibold ${licht ? 'bg-gold text-nacht' : 'border border-white/30'}`}>
              Licht {licht ? 'an' : 'aus'}
            </button>
          )}
          {verfahren && <span className="text-xs text-white/70">Erkennung: {verfahren}</span>}
        </div>
      )}
    </section>
  );
}
