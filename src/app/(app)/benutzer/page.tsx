import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatumZeit } from '@/lib/dates';
import { ROLLEN, ROLLEN_NAME, type Rolle } from '@/lib/session';
import { Icon, PageHeader, StatusPill } from '@/components/ui';
import { ROLLEN_TEXT } from './RollenFelder';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Benutzer' };

export default async function Benutzer() {
  const ich = await requireRole('admin');
  const users = await db.user.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] });
  return (
    <>
      <PageHeader krumen={[{ label: 'System' }, { label: 'Benutzer' }]} title="Benutzer" sub={`${users.filter((u) => u.active).length} aktiv`}>
        <Link href="/benutzer/neu" className="btn-primary"><Icon name="plus" className="h-4 w-4" />Benutzer anlegen</Link>
      </PageHeader>
      <div className="card tabelle-frei">
        <table className="table rtab">
          <thead><tr><th scope="col">Name</th><th scope="col">Benutzername</th><th scope="col">E-Mail</th><th scope="col">Rollen</th><th scope="col">Status</th><th scope="col">Letzte Anmeldung</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td className="rtab-kopf"><span className="flex items-center gap-3"><span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-nacht text-[12px] font-bold text-gold">{u.name.split(/\s+/).slice(0, 2).map((t) => t[0]?.toUpperCase()).join('')}</span><span><Link href={`/benutzer/${u.id}`} className="font-semibold underline-offset-4 hover:underline">{u.name}</Link>{u.id === ich.id && <span className="ml-1.5 text-xs text-muted">(Sie)</span>}</span></span></td>
                <td data-label="Benutzername" className="font-mono text-[13px]">{u.username}</td>
                <td data-label="E-Mail" className="break-words">{u.email}</td>
                <td data-label="Rollen"><span>{u.roles.map((r) => ROLLEN_NAME[r as Rolle] ?? r).join(', ')}{u.pin && <span className="ml-1.5 pill bg-gray-100 text-gray-700">PIN</span>}</span></td>
                <td data-label="Status">{u.active ? <StatusPill status="bezahlt" label="Aktiv" /> : <StatusPill status="storniert" label="Deaktiviert" />}</td>
                <td data-label="Letzte Anmeldung" className="whitespace-nowrap">{u.lastLoginAt ? fmtDatumZeit(u.lastLoginAt) : <span className="text-muted">nie</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section aria-labelledby="h-rollen" className="mt-6">
        <h2 id="h-rollen" className="eyebrow mb-3">Was die Rollen dürfen</h2>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {ROLLEN.map((r) => (
            <li key={r} className="card p-4">
              <p className="flex items-center justify-between gap-2 font-semibold">{ROLLEN_NAME[r]}<span className="num text-xs font-normal text-muted">{users.filter((u) => u.active && u.roles.includes(r)).length} aktiv</span></p>
              <p className="mt-1 text-sm text-muted">{ROLLEN_TEXT[r]}</p>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
