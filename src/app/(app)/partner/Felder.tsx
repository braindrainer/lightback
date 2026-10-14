import type { Partner } from '@prisma/client';

const KATS: [string, string][] = [['I', 'Kategorie I'], ['II', 'Kategorie II'], ['R', 'Rollstuhlplätze']];

export function PartnerFelder({ p }: { p?: Partner }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label htmlFor="name" className="label">Name</label><input id="name" name="name" defaultValue={p?.name} required className="input" /></div>
        <div><label htmlFor="contactEmail" className="label">Kontakt-E-Mail</label><input id="contactEmail" name="contactEmail" type="email" defaultValue={p?.contactEmail} className="input" /></div>
        <div><label htmlFor="commissionPct" className="label">Provision in %</label><input id="commissionPct" name="commissionPct" type="number" min={0} max={50} step={1} defaultValue={p?.commissionPct ?? 0} required aria-describedby="prov-h" className="input" /><p id="prov-h" className="mt-1 text-xs text-muted">Vom Ticketpreis, wird bei jeder Bestellung gebucht</p></div>
        <div><label htmlFor="quotaPerShow" className="label">Kontingent je Vorstellung</label><input id="quotaPerShow" name="quotaPerShow" type="number" min={1} max={662} defaultValue={p?.quotaPerShow ?? ''} aria-describedby="quota-h" className="input" /><p id="quota-h" className="mt-1 text-xs text-muted">Höchstzahl Tickets; leer = unbegrenzt</p></div>
        <div className="sm:col-span-2"><label htmlFor="webhookUrl" className="label">Webhook-URL (optional)</label><input id="webhookUrl" name="webhookUrl" type="url" placeholder="https://…" defaultValue={p?.webhookUrl} aria-describedby="wh-h" className="input" /><p id="wh-h" className="mt-1 text-xs text-muted">Erhält z. B. „show.cancelled“, wenn eine Vorstellung abgesagt wird</p></div>
      </div>
      <fieldset className="mt-4">
        <legend className="label">Freigegebene Kategorien</legend>
        <div className="flex flex-wrap gap-4">
          {KATS.map(([k, l]) => <label key={k} className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" name="categories" value={k} defaultChecked={p ? p.categories.includes(k) : k !== 'R'} className="h-4 w-4 accent-[#6e5118]" /> {l}</label>)}
        </div>
      </fieldset>
    </>
  );
}
