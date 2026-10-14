'use client';
// „Rechnung ansehen“: Rechnung im modalen Dialog (natives <dialog>: Fokusfalle, Esc schließt, Fokus zurück zum Knopf).
// Am Desktop das PDF, am Handy (oder ohne PDF-Anzeige im Browser) die HTML-Fassung, auf Bildschirmbreite skaliert.
import { useEffect, useId, useRef, useState } from 'react';

export default function RechnungModal({ id, nummer, storno, className = 'btn-primary btn-sm', knopf = 'Rechnung ansehen' }: { id: string; nummer: string; storno?: boolean; className?: string; knopf?: string }) {
  const [offen, setOffen] = useState(false);
  const [html, setHtml] = useState(false);
  const d = useRef<HTMLDialogElement>(null);
  const ausloeser = useRef<HTMLButtonElement>(null);
  const titelId = useId();
  const art = storno ? 'Stornorechnung' : 'Rechnung';
  const pdf = `/rechnungen/${id}/pdf`;

  useEffect(() => {
    const el = d.current;
    if (!el) return;
    if (offen && !el.open) {
      const klein = window.matchMedia('(max-width: 640px)').matches;
      const pdfAnzeige = (navigator as Navigator & { pdfViewerEnabled?: boolean }).pdfViewerEnabled;
      setHtml(klein || pdfAnzeige === false);
      el.showModal();
    }
    if (!offen && el.open) el.close();
  }, [offen]);

  return (
    <>
      <button ref={ausloeser} type="button" className={className} onClick={() => setOffen(true)} aria-haspopup="dialog">
        {knopf}<span className="sr-only"> – {art} {nummer}</span>
      </button>
      <dialog ref={d} aria-labelledby={titelId} onClose={() => { setOffen(false); ausloeser.current?.focus(); }}
        className="m-auto h-[min(92dvh,1100px)] w-[min(calc(100vw-1.5rem),980px)] max-h-none max-w-none overflow-hidden rounded-xl border border-line bg-card p-0 text-ink shadow-2xl backdrop:bg-nacht/70 max-sm:h-dvh max-sm:w-screen max-sm:rounded-none max-sm:border-0">
        {offen && (
          <div className="flex h-full flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <h2 id={titelId} className="h2 text-lg">{art} <span className="font-mono">{nummer}</span></h2>
              <div className="flex flex-wrap items-center gap-2">
                <a href={`${pdf}?download=1`} className="btn-secondary btn-sm">PDF herunterladen</a>
                <a href={pdf} target="_blank" rel="noopener" className="btn-secondary btn-sm max-sm:hidden">PDF in neuem Tab öffnen<span className="sr-only"> (neues Fenster)</span></a>
                <button type="button" onClick={() => setOffen(false)} className="btn-primary btn-sm" aria-label="Dialog schließen">Schließen</button>
              </div>
            </div>
            <iframe
              title={`${art} ${nummer}${html ? '' : ' (PDF)'}`}
              src={html ? `${pdf}?html=1` : `${pdf}#view=FitH`}
              className="min-h-0 w-full flex-1 bg-[#e7e2d8]"
            />
            <p className="border-t border-line px-4 py-2 text-xs text-muted">
              {html ? 'Vorschau der Rechnung. ' : 'Wird das PDF nicht angezeigt? '}
              <a href={pdf} target="_blank" rel="noopener" className="underline underline-offset-4">PDF in neuem Tab öffnen<span className="sr-only"> (neues Fenster)</span></a>
              {!html && <> · <button type="button" className="underline underline-offset-4" onClick={() => setHtml(true)}>Als Webseite anzeigen</button></>}
            </p>
          </div>
        )}
      </dialog>
    </>
  );
}
