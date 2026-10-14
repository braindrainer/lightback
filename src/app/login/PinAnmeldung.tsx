'use client';
// PIN-Anmeldung am Gerät: Benutzername (wird gemerkt) und PIN über Ziffernblock oder Tastatur.
import { useEffect, useRef, useState } from 'react';

const TASTEN = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

export default function PinAnmeldung({ ziel, nutzer, fehler }: { ziel: string; nutzer: string; fehler?: React.ReactNode }) {
  const [login, setLogin] = useState(nutzer);
  const [pin, setPin] = useState('');
  const [sendet, setSendet] = useState(false);
  const pinFeld = useRef<HTMLInputElement>(null);
  const loginFeld = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let gemerkt = '';
    try { gemerkt = localStorage.getItem('pin.login') ?? ''; } catch { /* gesperrt */ }
    if (!nutzer && gemerkt) setLogin(gemerkt);
    ((nutzer || gemerkt) ? pinFeld : loginFeld).current?.focus();
  }, [nutzer]);

  const tippen = (z: string) => { setPin((p) => (p.length < 6 ? p + z : p)); pinFeld.current?.focus({ preventScroll: true }); };

  return (
    <form action="/api/auth/pin" method="post" className="space-y-5" aria-describedby={fehler ? 'fehler' : undefined}
      onSubmit={() => { setSendet(true); try { localStorage.setItem('pin.login', login.trim().toLowerCase()); } catch { /* gesperrt */ } }}>
      <input type="hidden" name="ziel" value={ziel} />
      <div>
        <label htmlFor="pin-login" className="label">Benutzername</label>
        <input id="pin-login" ref={loginFeld} name="login" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required className="input min-h-12 !text-base" />
      </div>
      <div>
        <label htmlFor="pin" className="label">PIN (4–6 Ziffern)</label>
        <input id="pin" ref={pinFeld} name="pin" type="password" inputMode="numeric" pattern="\d{4,6}" minLength={4} maxLength={6} required autoComplete="off"
          value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          className="input min-h-14 text-center font-mono !text-3xl tracking-[.6em]" />
      </div>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Ziffernblock">
        {TASTEN.map((z) => <button key={z} type="button" onClick={() => tippen(z)} className="btn-secondary min-h-14 text-2xl font-semibold">{z}</button>)}
        <button type="button" onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Letzte Ziffer löschen" className="btn-secondary min-h-14 text-xl">⌫</button>
        <button type="button" onClick={() => tippen('0')} className="btn-secondary min-h-14 text-2xl font-semibold">0</button>
        <button type="button" onClick={() => setPin('')} className="btn-secondary min-h-14 text-base">Leeren</button>
      </div>
      {fehler}
      <button disabled={sendet || pin.length < 4 || !login.trim()} className="btn-primary min-h-14 w-full text-lg">{sendet ? 'Anmelden …' : 'Anmelden'}</button>
    </form>
  );
}
