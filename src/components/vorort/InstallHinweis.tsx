'use client';
// Hinweis „Zum Startbildschirm hinzufügen“ (App-Domain): Android/Chrome über beforeinstallprompt, iOS mit Anleitung.
import { useEffect, useState } from 'react';
import { speicher } from './pwa';

type InstallEreignis = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export function InstallHinweis() {
  const [ereignis, setEreignis] = useState<InstallEreignis | null>(null);
  const [ios, setIos] = useState(false);
  const [zu, setZu] = useState(true);

  useEffect(() => {
    const installiert = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (installiert || speicher.lesen('app.installHinweis', 0) > Date.now()) return;
    const ua = navigator.userAgent;
    const istIos = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (istIos) { setIos(true); setZu(false); }
    const vor = (e: Event) => { e.preventDefault(); setEreignis(e as InstallEreignis); setZu(false); };
    const fertig = () => setZu(true);
    window.addEventListener('beforeinstallprompt', vor);
    window.addEventListener('appinstalled', fertig);
    return () => { window.removeEventListener('beforeinstallprompt', vor); window.removeEventListener('appinstalled', fertig); };
  }, []);

  if (zu || (!ereignis && !ios)) return null;
  const weg = () => { setZu(true); speicher.schreiben('app.installHinweis', Date.now() + 14 * 864e5); };
  return (
    <aside aria-label="App installieren" className="flex items-center gap-3 border-b border-white/15 bg-[#16213a] px-3 py-2 text-sm text-white">
      <img src="/icons/vorort-192.png" alt="" className="size-9 shrink-0 rounded-lg" />
      <p className="min-w-0 flex-1">
        <strong className="block">Zum Startbildschirm hinzufügen</strong>
        {ereignis ? 'Dann startet der Scanner wie eine App – auch ohne Netz.' : 'In Safari auf „Teilen“ (Quadrat mit Pfeil) tippen, dann „Zum Home-Bildschirm“.'}
      </p>
      {ereignis && (
        <button type="button" onClick={async () => { await ereignis.prompt(); await ereignis.userChoice.catch(() => null); setEreignis(null); setZu(true); }}
          className="min-h-11 shrink-0 rounded-lg bg-gold px-3 font-semibold text-nacht">Installieren</button>
      )}
      <button type="button" onClick={weg} aria-label="Hinweis ausblenden" className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-xl hover:bg-white/10">×</button>
    </aside>
  );
}
