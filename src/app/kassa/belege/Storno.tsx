'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { stornoAction } from '../actions';

export default function Storno({ receiptId, number, sessionId }: { receiptId: string; number: number; sessionId: string }) {
  const d = useRef<HTMLDialogElement>(null);
  const [grund, setGrund] = useState('');
  const [fehler, setFehler] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function absenden(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFehler('');
    try {
      const r = await stornoAction({ receiptId, grund, sessionId });
      if (!r.ok) return setFehler(r.fehler);
      d.current?.close();
      router.push(`/kassa/beleg/${r.id}?druck=1`);
    } catch {
      setFehler('Keine Verbindung – Storno nicht möglich.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" onClick={() => d.current?.showModal()} className="btn-danger min-h-12 flex-1 text-base">Stornieren</button>
      <dialog ref={d} aria-labelledby={`st-${receiptId}`} className="m-auto w-[min(28rem,calc(100vw-1.5rem))] rounded-2xl p-0 backdrop:bg-black/60">
        <form onSubmit={absenden} className="grid gap-4 p-5">
          <h2 id={`st-${receiptId}`} className="text-xl font-semibold">Beleg Nr. {number} stornieren</h2>
          <p className="text-base">Es wird ein Stornobeleg mit negativen Beträgen erstellt. Bargeld bzw. Kartenbetrag an der Kassa zurückgeben; Tickets und Gutscheine dieses Belegs werden ungültig.</p>
          <div>
            <label htmlFor={`grund-${receiptId}`} className="label text-sm">Grund (Pflicht)</label>
            <input id={`grund-${receiptId}`} value={grund} onChange={(e) => setGrund(e.target.value)} required minLength={3} maxLength={200} className="input min-h-12 text-base" aria-invalid={!!fehler || undefined} aria-describedby={fehler ? `sf-${receiptId}` : undefined} />
          </div>
          {fehler && <p id={`sf-${receiptId}`} role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-base text-neg">{fehler}</p>}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => d.current?.close()} className="btn-secondary min-h-14 text-base">Abbrechen</button>
            <button disabled={busy} className="btn-primary min-h-14 text-base">{busy ? 'Bitte warten …' : 'Storno erstellen'}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
