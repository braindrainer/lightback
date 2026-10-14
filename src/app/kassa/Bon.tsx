'use client';
// Druckknöpfe für 80-mm-Bons: druckt automatisch (?druck=1).
import { useEffect } from 'react';

export function DruckSteuerung({ auto, zurueck }: { auto: boolean; zurueck: string }) {
  useEffect(() => {
    if (!auto) return;
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, [auto]);
  return (
    <div className="mx-auto mb-4 flex w-[80mm] max-w-full flex-wrap gap-2 print:hidden">
      <button type="button" onClick={() => window.print()} className="btn-primary min-h-12 flex-1 text-base">Drucken</button>
      <a href={zurueck} className="btn-secondary min-h-12 flex-1 text-base">Zurück</a>
    </div>
  );
}
