import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatumZeit } from '@/lib/dates';
import { ROLLEN_NAME, type Rolle } from '@/lib/session';
import { PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Benutzer' };

export default async function Benutzer() {
  const ich = await requireRole('admin');
  const users = await db.user.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] });
  return (
    <>
      <PageHeader title="Benutzer" sub={`${users.filter((u) => u.active).length} aktiv`}>
        <Link href="/benutzer/neu" className="btn-primary">Benutzer anlegen</Link>
      </PageHeader>
      <div className="card">
        <table className="table">
          <thead><tr><th scope="col">Name</th><th scope="col">Benutzername</th><th scope="col">E-Mail</th><th scope="col">Rollen</th><th scope="col">Status</th><th scope="col">Letzte Anmeldung</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td><Link href={`/benutzer/${u.id}`} className="font-medium underline underline-offset-4">{u.name}</Link>{u.id === ich.id && <span className="ml-1.5 text-xs text-muted">(Sie)</span>}</td>
                <td className="font-mono text-[13px]">{u.username}</td>
                <td>{u.email}</td>
                <td>{u.roles.map((r) => ROLLEN_NAME[r as Rolle] ?? r).join(', ')}{u.pin && <span className="ml-1.5 pill bg-gray-100 text-gray-700">PIN</span>}</td>
                <td>{u.active ? <span className="pill bg-emerald-50 text-emerald-800">Aktiv</span> : <span className="pill bg-gray-100 text-gray-700">Deaktiviert</span>}</td>
                <td className="whitespace-nowrap">{u.lastLoginAt ? fmtDatumZeit(u.lastLoginAt) : <span className="text-muted">nie</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
