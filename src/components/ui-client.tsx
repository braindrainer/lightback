'use client';
// Interaktive Bausteine: Kopieren, Menü (⋯), Seitenleiste, Rückfrage, Hinweise (Toast)
import Link from 'next/link';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons';

/* ───────── Kopieren ───────── */

export function Kopieren({ wert, label = 'Kopieren', className = '' }: { wert: string; label?: string; className?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className={`inline-grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted hover:bg-paper-deep hover:text-ink ${className}`}
      onClick={() => navigator.clipboard?.writeText(wert).then(() => { setOk(true); toast(`„${wert}“ kopiert`); setTimeout(() => setOk(false), 1500); })}
      aria-label={`${label}: ${wert}`} title={label}>
      <Icon name={ok ? 'haken' : 'kopieren'} className="h-4 w-4" />
    </button>
  );
}

/* ───────── Toast ───────── */

type ToastDaten = { id: number; text: string; art: 'ok' | 'fehler' | 'info' };
let zaehler = 0;
/** Kurze Rückmeldung unten rechts (role=status). Überall aufrufbar, braucht <ToastBereich /> im Layout. */
export function toast(text: string, art: ToastDaten['art'] = 'ok') {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('lb-toast', { detail: { id: ++zaehler, text, art } }));
}

export function ToastBereich() {
  const [liste, setListe] = useState<ToastDaten[]>([]);
  useEffect(() => {
    const neu = (e: Event) => {
      const t = (e as CustomEvent<ToastDaten>).detail;
      setListe((l) => [...l.slice(-3), t]);
      setTimeout(() => setListe((l) => l.filter((x) => x.id !== t.id)), t.art === 'fehler' ? 9000 : 5000);
    };
    window.addEventListener('lb-toast', neu);
    return () => window.removeEventListener('lb-toast', neu);
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-3 z-[60] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-5 sm:bottom-5">
      <div role="status" aria-live="polite" className="contents">
        {liste.filter((t) => t.art !== 'fehler').map((t) => <ToastKarte key={t.id} t={t} weg={() => setListe((l) => l.filter((x) => x.id !== t.id))} />)}
      </div>
      <div role="alert" className="contents">
        {liste.filter((t) => t.art === 'fehler').map((t) => <ToastKarte key={t.id} t={t} weg={() => setListe((l) => l.filter((x) => x.id !== t.id))} />)}
      </div>
    </div>
  );
}

function ToastKarte({ t, weg }: { t: ToastDaten; weg: () => void }) {
  return (
    <div className="lb-rein pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl bg-nacht px-4 py-3 text-sm text-white shadow-schwebend">
      <Icon name={t.art === 'fehler' ? 'warnung' : t.art === 'info' ? 'info' : 'haken'} className={`mt-0.5 h-4 w-4 shrink-0 ${t.art === 'fehler' ? 'text-[#ff9b93]' : 'text-gold'}`} />
      <p className="flex-1">{t.text}</p>
      <button type="button" onClick={weg} className="-m-1 grid h-7 w-7 place-items-center rounded text-white/70 hover:text-white" aria-label="Hinweis schließen"><Icon name="x" className="h-4 w-4" /></button>
    </div>
  );
}

/* ───────── Menü ───────── */

export type MenueEintrag =
  | { label: string; href: string; extern?: boolean; icon?: string; gefahr?: boolean }
  | { label: string; onSelect: () => void; icon?: string; gefahr?: boolean; disabled?: boolean }
  | { trenner: true };

/** Menüknopf (⋯) mit Popover: Pfeiltasten, Pos1/Ende, Esc, Klick daneben schließt; Fokus kehrt zurück. */
export function Menue({ label, eintraege, knopf, knopfKlasse, ausrichtung = 'rechts' }: { label: string; eintraege: MenueEintrag[]; knopf?: React.ReactNode; knopfKlasse?: string; ausrichtung?: 'rechts' | 'links' }) {
  const [offen, setOffen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not([aria-disabled=true])') ?? [])];

  const zu = useCallback((fokus = true) => { setOffen(false); setPos(null); if (fokus) btn.current?.focus(); }, []);

  useLayoutEffect(() => {
    if (!offen || !btn.current || !menu.current) return;
    const r = btn.current.getBoundingClientRect();
    const m = menu.current.getBoundingClientRect();
    const unten = window.innerHeight - r.bottom;
    const top = unten < m.height + 12 && r.top > m.height + 12 ? r.top - m.height - 6 : r.bottom + 6;
    let left = ausrichtung === 'rechts' ? r.right - m.width : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - m.width - 8));
    setPos({ top, left });
  }, [offen, ausrichtung]);

  useEffect(() => {
    if (!offen) return;
    const erst = items()[0];
    erst?.focus();
    const klick = (e: MouseEvent) => { if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) zu(false); };
    const weg = () => zu(false);
    document.addEventListener('mousedown', klick);
    window.addEventListener('scroll', weg, true);
    window.addEventListener('resize', weg);
    return () => { document.removeEventListener('mousedown', klick); window.removeEventListener('scroll', weg, true); window.removeEventListener('resize', weg); };
  }, [offen, zu]);

  const taste = (e: React.KeyboardEvent) => {
    const l = items();
    const i = l.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); l[(i + 1) % l.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); l[(i - 1 + l.length) % l.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); l[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); l.at(-1)?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); zu(); }
    else if (e.key === 'Tab') zu(false);
    else if (e.key.length === 1) {
      const t = l.find((x, j) => j > i && x.textContent?.trim().toLowerCase().startsWith(e.key.toLowerCase())) ?? l.find((x) => x.textContent?.trim().toLowerCase().startsWith(e.key.toLowerCase()));
      t?.focus();
    }
  };

  const eintragKlasse = (gefahr?: boolean) => `flex min-h-10 w-full items-center gap-2.5 rounded-md px-3 text-left text-sm outline-none focus:bg-paper-deep hover:bg-paper-deep aria-disabled:opacity-50 ${gefahr ? 'text-neg' : 'text-ink'}`;

  return (
    <>
      <button ref={btn} type="button" aria-haspopup="menu" aria-expanded={offen} aria-controls={offen ? id : undefined}
        onClick={() => (offen ? zu(false) : setOffen(true))}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOffen(true); } }}
        className={knopfKlasse ?? 'inline-grid h-9 w-9 place-items-center rounded-lg border border-transparent text-muted hover:border-line hover:bg-white hover:text-ink aria-expanded:border-line aria-expanded:bg-white aria-expanded:text-ink'}
        aria-label={knopf ? undefined : label}>
        {knopf ?? <Icon name="mehr" className="h-5 w-5" />}
      </button>
      {offen && createPortal(
        <div ref={menu} id={id} role="menu" aria-label={label} onKeyDown={taste}
          style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
          className="lb-rein z-[70] min-w-56 max-w-[calc(100vw-16px)] rounded-xl border border-line bg-white p-1.5 shadow-schwebend">
          {eintraege.map((e, i) => {
            if ('trenner' in e) return <div key={i} role="separator" className="my-1 h-px bg-line-soft" />;
            const inhalt = <>{e.icon && <Icon name={e.icon} className="h-4 w-4 shrink-0 opacity-80" />}<span className="flex-1">{e.label}</span>{'extern' in e && e.extern && <Icon name="extern" className="h-3.5 w-3.5 opacity-60" />}</>;
            if ('href' in e) {
              return e.extern
                ? <a key={i} role="menuitem" tabIndex={-1} href={e.href} target="_blank" rel="noopener" className={eintragKlasse(e.gefahr)} onClick={() => zu(false)}>{inhalt}<span className="sr-only"> (neues Fenster)</span></a>
                : <Link key={i} role="menuitem" tabIndex={-1} href={e.href} className={eintragKlasse(e.gefahr)} onClick={() => zu(false)}>{inhalt}</Link>;
            }
            return <button key={i} type="button" role="menuitem" tabIndex={-1} aria-disabled={e.disabled || undefined} className={eintragKlasse(e.gefahr)}
              onClick={() => { if (e.disabled) return; zu(); e.onSelect(); }}>{inhalt}</button>;
          })}
        </div>, document.body)}
    </>
  );
}

/* ───────── Dialoge ───────── */

function useDialog(offen: boolean, onClose: () => void) {
  const d = useRef<HTMLDialogElement>(null);
  const offenRef = useRef(offen);
  offenRef.current = offen;
  useEffect(() => {
    const el = d.current;
    if (!el) return;
    if (offen && !el.open) el.showModal();
    if (!offen && el.open) el.close();
  }, [offen]);
  const props = {
    ref: d,
    // close-Ereignis kommt auch, wenn der Dialog von außen geschlossen wurde – dann nicht noch einmal melden
    onClose: () => { if (offenRef.current) onClose(); },
    onCancel: (e: React.SyntheticEvent) => { e.preventDefault(); onClose(); },
    onMouseDown: (e: React.MouseEvent<HTMLDialogElement>) => { if (e.target === d.current) onClose(); },
  };
  return props;
}

/** Seitenleiste für schnelle Bearbeitung (rechts; am Handy ganzer Bildschirm). Natives <dialog>: Fokusfalle, Esc. */
export function Drawer({ offen, onClose, titel, untertitel, children, fuss, breit }: { offen: boolean; onClose: () => void; titel: string; untertitel?: React.ReactNode; children: React.ReactNode; fuss?: React.ReactNode; breit?: boolean }) {
  const id = useId();
  const p = useDialog(offen, onClose);
  return (
    <dialog {...p} aria-labelledby={id}
      className={`lb-drawer m-0 ml-auto h-dvh max-h-none w-full ${breit ? 'sm:max-w-2xl' : 'sm:max-w-lg'} border-0 bg-card p-0 text-ink shadow-schwebend backdrop:bg-nacht/50 sm:border-l sm:border-line`}>
      {offen && (
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <h2 id={id} className="text-lg font-semibold">{titel}</h2>
              {untertitel && <div className="mt-0.5 text-sm text-muted">{untertitel}</div>}
            </div>
            <button type="button" onClick={onClose} className="-mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-paper-deep hover:text-ink" aria-label="Schließen"><Icon name="x" className="h-5 w-5" /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
          {fuss && <div className="border-t border-line bg-[#fbf9f5] px-5 py-3">{fuss}</div>}
        </div>
      )}
    </dialog>
  );
}

/** Kompakter modaler Dialog (Rückfragen, kurze Formulare) */
export function Modal({ offen, onClose, titel, children, breit }: { offen: boolean; onClose: () => void; titel: string; children: React.ReactNode; breit?: boolean }) {
  const id = useId();
  const p = useDialog(offen, onClose);
  return (
    <dialog {...p} aria-labelledby={id}
      className={`m-auto w-[calc(100vw-1.5rem)] ${breit ? 'max-w-2xl' : 'max-w-md'} max-h-[90dvh] rounded-2xl border border-line bg-card p-0 text-ink shadow-schwebend backdrop:bg-nacht/60`}>
      {offen && (
        <div className="grid gap-4 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <h2 id={id} className="text-lg font-semibold">{titel}</h2>
            <button type="button" onClick={onClose} className="-mr-2 -mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-paper-deep hover:text-ink" aria-label="Dialog schließen"><Icon name="x" className="h-5 w-5" /></button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

/** Rückfrage vor einer Aktion */
export function Bestaetigen({ offen, onClose, onJa, titel, text, ja = 'Bestätigen', gefahr, laeuft, children }: { offen: boolean; onClose: () => void; onJa: () => void; titel: string; text?: React.ReactNode; ja?: string; gefahr?: boolean; laeuft?: boolean; children?: React.ReactNode }) {
  return (
    <Modal offen={offen} onClose={onClose} titel={titel}>
      {text && <div className="text-sm text-ink/90">{text}</div>}
      {children}
      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
        <button type="button" className={gefahr ? 'btn bg-neg text-white hover:bg-[#8f1e18]' : 'btn-primary'} onClick={onJa} disabled={laeuft}>{laeuft ? 'Bitte warten …' : ja}</button>
      </div>
    </Modal>
  );
}
