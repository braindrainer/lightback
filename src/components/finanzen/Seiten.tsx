import Link from 'next/link';

/** Blättern in langen Listen (lange Tabellen auf einer Seite machen das Laden zäh) */
export function Seiten({ seite, gesamt, je, params }: { seite: number; gesamt: number; je: number; params: Record<string, string> }) {
  const max = Math.ceil(gesamt / je);
  if (max <= 1) return null;
  const href = (n: number) => '?' + new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter(([, v]) => v)), seite: String(n) }).toString();
  return (
    <nav aria-label="Seiten" className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
      <span>Seite {seite} von {max}</span>
      <span className="flex gap-2">
        {seite > 1 && <Link href={href(seite - 1)} className="btn-secondary btn-sm">Vorherige Seite</Link>}
        {seite < max && <Link href={href(seite + 1)} className="btn-secondary btn-sm">Nächste Seite</Link>}
      </span>
    </nav>
  );
}
