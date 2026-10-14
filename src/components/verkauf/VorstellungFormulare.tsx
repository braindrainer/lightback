'use client';
// Formulare: Einzelvorstellung und Serie anlegen
import type { Preise } from '@/lib/saal';
import type { Ergebnis } from './ergebnis';
import { Absenden, AktionForm } from './form';
import PreisFelder from './PreisFelder';
import { WOCHENTAGE } from './texte';

type Aktion = (p: Ergebnis, fd: FormData) => Promise<Ergebnis>;

export function EinzelFormular({ action, preise, heute }: { action: Aktion; preise: Preise; heute: string }) {
  return (
    <AktionForm action={action} aria-labelledby="einzel-titel">
      <div className="grid gap-3 sm:grid-cols-4">
        <div><label htmlFor="e-datum" className="label">Datum</label><input id="e-datum" name="datum" type="date" min={heute} required className="input" /></div>
        <div><label htmlFor="e-zeit" className="label">Beginn</label><input id="e-zeit" name="zeit" type="time" required defaultValue="20:00" className="input" /></div>
        <div><label htmlFor="e-dauer" className="label">Dauer (Minuten)</label><input id="e-dauer" name="dauer" type="number" min={5} max={600} defaultValue={30} required className="input" /></div>
        <div><label htmlFor="e-status" className="label">Status</label>
          <select id="e-status" name="status" className="input" defaultValue="verkauf"><option value="verkauf">Im Verkauf</option><option value="geplant">Geplant (noch nicht im Verkauf)</option><option value="pausiert">Verkauf pausiert</option></select></div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label htmlFor="e-titel" className="label">Titel</label><input id="e-titel" name="titel" defaultValue="Light of Creation" required className="input" /></div>
        <div><label htmlFor="e-notes" className="label">Notiz (intern)</label><input id="e-notes" name="notes" className="input" /></div>
      </div>
      <PreisFelder preise={preise} prefix="e-" />
      <div><Absenden>Vorstellung anlegen</Absenden></div>
    </AktionForm>
  );
}

export function SerienFormular({ action, preise, heute }: { action: Aktion; preise: Preise; heute: string }) {
  return (
    <AktionForm action={action} aria-labelledby="serie-titel">
      <div className="grid gap-3 sm:grid-cols-3">
        <div><label htmlFor="s-name" className="label">Name der Serie</label><input id="s-name" name="name" required placeholder="z. B. Spielzeit Frühjahr 2027" className="input" /></div>
        <div><label htmlFor="s-von" className="label">Erster Tag</label><input id="s-von" name="von" type="date" min={heute} required className="input" /></div>
        <div><label htmlFor="s-bis" className="label">Letzter Tag</label><input id="s-bis" name="bis" type="date" min={heute} required className="input" /></div>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Spieltage</legend>
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5, 6, 0].map((w) => (
            <label key={w} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
              <input type="checkbox" name="wochentag" value={w} defaultChecked={w !== 2} className="h-4 w-4 accent-accent" />{WOCHENTAGE[w]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <div><label htmlFor="s-zeiten" className="label">Uhrzeiten (durch Komma getrennt)</label><input id="s-zeiten" name="zeiten" defaultValue="18:30, 20:00" required aria-describedby="s-zeiten-hilfe" className="input" /><p id="s-zeiten-hilfe" className="mt-1 text-xs text-muted">Wiener Ortszeit, z. B. 18:30, 20:00</p></div>
        <div><label htmlFor="s-dauer" className="label">Dauer (Minuten)</label><input id="s-dauer" name="dauer" type="number" min={5} max={600} defaultValue={30} required className="input" /></div>
        <div><label htmlFor="s-status" className="label">Status der neuen Vorstellungen</label>
          <select id="s-status" name="status" className="input" defaultValue="verkauf"><option value="verkauf">Im Verkauf</option><option value="geplant">Geplant (noch nicht im Verkauf)</option></select></div>
      </div>
      <PreisFelder preise={preise} prefix="s-" />
      <p className="text-sm text-muted">Termine, zu denen es schon eine Vorstellung gibt, werden übersprungen.</p>
      <div><Absenden>Serie anlegen</Absenden></div>
    </AktionForm>
  );
}
