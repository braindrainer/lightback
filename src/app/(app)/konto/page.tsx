import { requireRole } from '@/lib/auth';
import { ROLLEN_NAME } from '@/lib/session';
import { Formular } from '@/components/system/Formular';
import { Abschnitt, Feldliste, PageHeader } from '@/components/ui';
import { ROLLEN_TEXT } from '../benutzer/RollenFelder';
import { passwortAendern } from './actions';

export const metadata = { title: 'Mein Konto' };

export default async function Konto() {
  const u = await requireRole();
  return (
    <>
      <PageHeader krumen={[{ label: 'Mein Konto' }]} title="Mein Konto" sub="Ihre Anmeldedaten und Rollen." />
      <div className="grid items-start gap-6 lg:grid-cols-2">
      <Abschnitt id="h-ich" titel="Angemeldet als">
        <div className="mb-5 flex items-center gap-4">
          <span aria-hidden="true" className="grid h-14 w-14 place-items-center rounded-full bg-nacht text-lg font-bold text-gold">{u.name.split(/\s+/).slice(0, 2).map((t) => t[0]?.toUpperCase()).join('')}</span>
          <div><p className="text-lg font-semibold">{u.name}</p><p className="text-sm text-muted">{u.email}</p></div>
        </div>
        <Feldliste spalten={1} felder={u.roles.map((r) => ({ label: ROLLEN_NAME[r], wert: ROLLEN_TEXT[r] }))} />
        <p className="mt-5 text-xs text-muted">Rollen ändert die Administration unter Benutzer. Die Anmeldung gilt für eine Arbeitsschicht (12 Stunden).</p>
      </Abschnitt>
      <Formular action={passwortAendern} knopf="Passwort ändern" className="card grid gap-4 p-5" zuruecksetzen>
        <h2 className="h2">Passwort ändern</h2>
        <div><label htmlFor="alt" className="label">Aktuelles Passwort</label><input id="alt" name="alt" type="password" required autoComplete="current-password" className="input" /></div>
        <div><label htmlFor="neu" className="label">Neues Passwort</label><input id="neu" name="neu" type="password" required minLength={12} autoComplete="new-password" aria-describedby="neu-h" className="input" /><p id="neu-h" className="mt-1 text-xs text-muted">Mindestens 12 Zeichen</p></div>
        <div><label htmlFor="neu2" className="label">Neues Passwort wiederholen</label><input id="neu2" name="neu2" type="password" required minLength={12} autoComplete="new-password" className="input" /></div>
      </Formular>
      </div>
    </>
  );
}
