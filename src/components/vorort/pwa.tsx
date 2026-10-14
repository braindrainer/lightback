'use client';
// Gemeinsames für die Vor-Ort-Apps (Einlass, Kassa): Service Worker, Online-Status
import { useEffect, useState } from 'react';

/** Service Worker nur im Produktivbetrieb – im Dev-Server würde der Cache alte Bundles ausliefern */
export function PwaRegistrieren({ pfad, scope }: { pfad: string; scope: string }) {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return;
    navigator.serviceWorker.register(pfad, { scope }).catch(() => {});
  }, [pfad, scope]);
  return null;
}

/** navigator.onLine plus Ereignisse; setzbar, wenn ein Abruf scheitert */
export function useOnline(): [boolean, (v: boolean) => void] {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const an = () => setOnline(true);
    const aus = () => setOnline(false);
    window.addEventListener('online', an);
    window.addEventListener('offline', aus);
    return () => { window.removeEventListener('online', an); window.removeEventListener('offline', aus); };
  }, []);
  return [online, setOnline];
}

export function OnlineAnzeige({ online, dunkel = false }: { online: boolean; dunkel?: boolean }) {
  return (
    <span role="status" className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${online ? (dunkel ? 'bg-emerald-900 text-emerald-100' : 'bg-emerald-50 text-emerald-900') : 'bg-amber-400 text-black'}`}>
      <span aria-hidden="true" className={`size-2 rounded-full ${online ? 'bg-emerald-400' : 'bg-black'}`} />
      {online ? 'Online' : 'Offline'}
    </span>
  );
}

/** Kleiner Speicher-Helfer: localStorage kann gesperrt sein (privater Modus) */
export const speicher = {
  lesen<T>(k: string, ersatz: T): T {
    try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : ersatz; } catch { return ersatz; }
  },
  schreiben(k: string, v: unknown) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* voll oder gesperrt */ }
  },
};
