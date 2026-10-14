import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { Formular } from '@/components/system/Formular';
import { PageHeader } from '@/components/ui';
import { benutzerAnlegen } from '../actions';
import { RollenFelder } from '../RollenFelder';

export const metadata = { title: 'Benutzer anlegen' };

export default async function Neu() {
  await requireRole('admin');
  return (
    <>
      <PageHeader krumen={[{ label: 'System' }, { label: 'Benutzer', href: '/benutzer' }, { label: 'Anlegen' }]} title="Benutzer anlegen" sub="Zugang für Mitarbeiter:innen mit Rollen; das Passwort wird einmal angezeigt." />
      <Formular action={benutzerAnlegen} knopf="Anlegen" className="card grid max-w-3xl gap-4 p-5" zuruecksetzen>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label htmlFor="username" className="label">Benutzername</label><input id="username" name="username" required autoComplete="off" pattern="[a-z0-9._\-]{3,32}" aria-describedby="username-h" className="input" /><p id="username-h" className="mt-1 text-xs text-muted">Kleinbuchstaben, Ziffern, Punkt oder Bindestrich</p></div>
          <div><label htmlFor="name" className="label">Name</label><input id="name" name="name" required autoComplete="off" className="input" /></div>
          <div className="sm:col-span-2"><label htmlFor="email" className="label">E-Mail</label><input id="email" name="email" type="email" required autoComplete="off" className="input" /></div>
        </div>
        <RollenFelder />
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label htmlFor="passwort" className="label">Erstes Passwort (optional)</label><input id="passwort" name="passwort" type="password" minLength={12} autoComplete="new-password" aria-describedby="pw-h" className="input" /><p id="pw-h" className="mt-1 text-xs text-muted">Mindestens 12 Zeichen. Leer lassen: Wir erzeugen ein sicheres Passwort und zeigen es einmal an.</p></div>
          <div><label htmlFor="pin" className="label">PIN für Kassa/Einlass (optional)</label><input id="pin" name="pin" inputMode="numeric" pattern="\d{4,6}" autoComplete="off" aria-describedby="pin-h" className="input" /><p id="pin-h" className="mt-1 text-xs text-muted">4 bis 6 Ziffern für die schnelle Anmeldung am Gerät</p></div>
        </div>
      </Formular>
    </>
  );
}
