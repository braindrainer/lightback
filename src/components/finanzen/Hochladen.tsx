'use client';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import type { Ergebnis } from '@/lib/finanzen/aktion';
import { Meldung } from './Formular';

/** Formular mit Datei: geht an eine Route (keine Größenbeschränkung wie bei Server Actions) */
export function Hochladen({ url, children, knopf, className }: { url: string; children: React.ReactNode; knopf: string; className?: string }) {
  const [st, setSt] = useState<Ergebnis>(null);
  const [laeuft, setLaeuft] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  return (
    <form ref={ref} className={className} encType="multipart/form-data" onSubmit={async (e) => {
      e.preventDefault();
      setLaeuft(true);
      try {
        const r = await fetch(url, { method: 'POST', body: new FormData(e.currentTarget) });
        const j = (await r.json().catch(() => ({ fehler: `Fehler ${r.status}` }))) as Ergebnis;
        setSt(j);
        if (j?.ok) { ref.current?.reset(); router.refresh(); }
      } catch {
        setSt({ fehler: 'Verbindung fehlgeschlagen.' });
      } finally { setLaeuft(false); }
    }}>
      {children}
      <div className="basis-full"><button type="submit" className="btn-primary" disabled={laeuft}>{laeuft ? 'Bitte warten …' : knopf}</button></div>
      <Meldung st={st} />
    </form>
  );
}
