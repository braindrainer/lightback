import { requireRole } from '@/lib/auth';
import { ROLLEN_NAME } from '@/lib/session';
import { Formular } from '@/components/system/Formular';
import { PageHeader } from '@/components/ui';
import { passwortAendern } from './actions';

export const metadata = { title: 'Mein Konto' };

export default async function Konto() {
  const u = await requireRole();
  return (
    <>
      <PageHeader title="Mein Konto" sub={`${u.name} · ${u.email} · ${u.roles.map((r) => ROLLEN_NAME[r]).join(', ')}`} />
      <Formular action={passwortAendern} knopf="Passwort ändern" className="card grid max-w-md gap-4 p-5" zuruecksetzen>
        <h2 className="h2">Passwort ändern</h2>
        <div><label htmlFor="alt" className="label">Aktuelles Passwort</label><input id="alt" name="alt" type="password" required autoComplete="current-password" className="input" /></div>
        <div><label htmlFor="neu" className="label">Neues Passwort</label><input id="neu" name="neu" type="password" required minLength={12} autoComplete="new-password" aria-describedby="neu-h" className="input" /><p id="neu-h" className="mt-1 text-xs text-muted">Mindestens 12 Zeichen</p></div>
        <div><label htmlFor="neu2" className="label">Neues Passwort wiederholen</label><input id="neu2" name="neu2" type="password" required minLength={12} autoComplete="new-password" className="input" /></div>
      </Formular>
    </>
  );
}
