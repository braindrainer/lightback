import { fmtTagStr } from '@/lib/finanzen/zeitraum';

/** Zeitraumfilter (GET) mit Schnellwahl Jahr */
export function ZeitraumFilter({ von, bis, label = 'Zeitraum wählen', extra, ziel }: { von: string; bis: string; label?: string; extra?: React.ReactNode; ziel?: string }) {
  const jahr = Number(von.slice(0, 4));
  return (
    <form action={ziel} className="card mb-4 flex flex-wrap items-end gap-3 p-4" aria-label={label}>
      <div><label className="label" htmlFor="z-von">Von</label><input id="z-von" type="date" name="von" defaultValue={von} className="input" required /></div>
      <div><label className="label" htmlFor="z-bis">Bis</label><input id="z-bis" type="date" name="bis" defaultValue={bis} className="input" required /></div>
      {extra}
      <button className="btn-secondary">Anzeigen</button>
      <p className="basis-full text-xs text-muted sm:basis-auto">
        Schnellwahl: {[jahr - 1, jahr].map((j) => <a key={j} href={`?von=${j}-01-01&bis=${j}-12-31`} className="mr-2 underline underline-offset-4">{j}</a>)}
        <span className="sr-only">Gewählt: {fmtTagStr(von)} bis {fmtTagStr(bis)}</span>
      </p>
    </form>
  );
}
