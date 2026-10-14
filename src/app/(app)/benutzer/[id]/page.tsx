import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatumZeit } from '@/lib/dates';
import { Formular } from '@/components/system/Formular';
import { DetailKopf, StatusPill } from '@/components/ui';
import { benutzerSpeichern, passwortZuruecksetzen } from '../actions';
import { RollenFelder } from '../RollenFelder';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Benutzer bearbeiten' };

export default async function Bearbeiten({ params }: { params: Promise<{ id: string }> }) {
  const ich = await requireRole('admin');
  const u = await db.user.findUnique({ where: { id: (await params).id } });
  if (!u) notFound();
  const selbst = u.id === ich.id;
  return (
    <>
      <DetailKopf krumen={[{ label: 'System' }, { label: 'Benutzer', href: '/benutzer' }, { label: u.name }]} titel={u.name}
        status={u.active ? <StatusPill status="bezahlt" label="Aktiv" /> : <StatusPill status="storniert" label="Deaktiviert" />}
        untertitel={<><span className="font-mono">{u.username}</span> · angelegt {fmtDatumZeit(u.createdAt)} · letzte Anmeldung {u.lastLoginAt ? fmtDatumZeit(u.lastLoginAt) : 'nie'}</>} />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Formular action={benutzerSpeichern} knopf="Speichern" className="card grid gap-4 !overflow-visible p-5">
          <h2 className="h2">Daten und Rollen</h2>
          <input type="hidden" name="id" value={u.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label htmlFor="name" className="label">Name</label><input id="name" name="name" defaultValue={u.name} required className="input" /></div>
            <div><label htmlFor="email" className="label">E-Mail</label><input id="email" name="email" type="email" defaultValue={u.email} required className="input" /></div>
          </div>
          <RollenFelder aktiv={u.roles} />
          {selbst && <p className="text-sm text-muted">Die Rolle Administration und den Status Ihres eigenen Kontos können Sie nicht ändern.</p>}
          <label className="flex min-h-10 items-center gap-2.5"><input type="checkbox" name="active" defaultChecked={u.active} className="h-4 w-4 accent-[#6e5118]" /> <span className="text-sm font-semibold">Konto aktiv</span></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label htmlFor="pin" className="label">{u.pin ? 'Neue PIN (optional)' : 'PIN für Kassa/Einlass (optional)'}</label><input id="pin" name="pin" inputMode="numeric" pattern="\d{4,6}" autoComplete="off" aria-describedby="pin-h" className="input" /><p id="pin-h" className="mt-1 text-xs text-muted">{u.pin ? 'Eine PIN ist gesetzt. Leer lassen = unverändert.' : '4 bis 6 Ziffern'}</p></div>
            {u.pin && <label className="flex min-h-10 items-center gap-2.5 self-center"><input type="checkbox" name="pinLoeschen" className="h-4 w-4 accent-[#6e5118]" /> <span className="text-sm">PIN entfernen</span></label>}
          </div>
        </Formular>
        <Formular action={passwortZuruecksetzen} knopf="Neues Passwort erzeugen" variante="btn-danger" bestaetigen={`Passwort von ${u.name} wirklich zurücksetzen? Das alte gilt dann nicht mehr.`} className="card p-5">
          <h2 className="h2">Passwort zurücksetzen</h2>
          <p className="mt-1 text-sm text-muted">Erzeugt ein neues, zufälliges Passwort, das nur einmal angezeigt wird.</p>
          <input type="hidden" name="id" value={u.id} />
        </Formular>
      </div>
    </>
  );
}
