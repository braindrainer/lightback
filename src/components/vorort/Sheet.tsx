'use client';
// Modales Blatt (natives <dialog>: Fokusfalle, Esc schließt). Am Handy von unten, sonst als Fenster in der Mitte.
import { useEffect, useId, useRef } from 'react';

export function Sheet({ offen, onClose, titel, children, dunkel = false, unten = true, breit = false, aktionen }: {
  offen: boolean;
  onClose: () => void;
  titel: React.ReactNode;
  children: React.ReactNode;
  dunkel?: boolean;
  /** true: auf schmalen Bildschirmen am unteren Rand */
  unten?: boolean;
  breit?: boolean;
  aktionen?: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (offen && !d.open) d.showModal();
    if (!offen && d.open) d.close();
  }, [offen]);
  return (
    <dialog ref={ref} aria-labelledby={id} onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className={`max-h-[88dvh] w-full overflow-hidden p-0 backdrop:bg-black/60 ${breit ? 'max-w-2xl' : 'max-w-lg'} ${unten ? 'max-sm:mb-0 max-sm:mt-auto max-sm:max-w-none max-sm:rounded-b-none' : ''} m-auto rounded-2xl shadow-2xl ${dunkel ? 'bg-[#0f1729] text-white' : 'bg-white text-ink'}`}>
      {offen && (
        <div className="flex max-h-[88dvh] flex-col">
          <div className={`flex shrink-0 items-center gap-2 border-b px-4 py-2 ${dunkel ? 'border-white/15' : 'border-line'}`}>
            <h2 id={id} className="min-w-0 flex-1 text-lg font-semibold">{titel}</h2>
            {aktionen}
            <button type="button" onClick={onClose} className={`inline-flex size-11 shrink-0 items-center justify-center rounded-full text-2xl leading-none ${dunkel ? 'hover:bg-white/10' : 'hover:bg-paper'}`} aria-label="Schließen">×</button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">{children}</div>
        </div>
      )}
    </dialog>
  );
}
