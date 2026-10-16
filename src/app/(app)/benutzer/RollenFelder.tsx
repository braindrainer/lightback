import { ROLLEN, ROLLEN_NAME, type Rolle } from '@/lib/session';

export const ROLLEN_TEXT: Record<Rolle, string> = {
  admin: 'Alles, dazu Benutzer, Einstellungen, Zahlungsanbieter und Protokoll',
  gesamt: 'Alles wie Administration, aber ohne Einstellungen, Zahlungsanbieter und Schlüssel; vergibt keine Administration',
  leitung: 'Vorstellungen, Bestellungen, Kund:innen, Partner & API, Statistik, E-Mails',
  buchhaltung: 'Rechnungen, Zahlungen, Buchhaltung, Statistik',
  kassa: 'Kassa vor Ort und Telefonverkauf',
  einlass: 'Einlass-Scanner',
};

export function RollenFelder({ aktiv = [] }: { aktiv?: string[] }) {
  return (
    <fieldset>
      <legend className="label">Rollen</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {ROLLEN.map((r) => (
          <label key={r} className="flex min-h-10 cursor-pointer items-start gap-2.5 rounded-lg border border-line p-2.5 has-[:checked]:border-accent has-[:checked]:bg-accent-soft/50">
            <input type="checkbox" name="roles" value={r} defaultChecked={aktiv.includes(r)} aria-describedby={`rolle-${r}`} className="mt-0.5 h-4 w-4 accent-[#6e5118]" />
            <span><span className="block text-sm font-semibold">{ROLLEN_NAME[r]}</span><span id={`rolle-${r}`} className="block text-xs text-muted">{ROLLEN_TEXT[r]}</span></span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
