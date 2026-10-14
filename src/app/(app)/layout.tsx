import Nav from '@/components/Nav';
import { hat, requireRole } from '@/lib/auth';
import { NAV } from '@/lib/nav';
import { ROLLEN_NAME } from '@/lib/session';
import { getSettings } from '@/lib/db';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await requireRole();
  const s = await getSettings();
  const gruppen = NAV.map((g) => ({ titel: g.titel, items: g.items.filter((i) => !i.rollen.length || hat(u, ...i.rollen)) })).filter((g) => g.items.length);
  return (
    <div className="lg:flex">
      <Nav gruppen={gruppen} name={u.name} rollen={u.roles.map((r) => ROLLEN_NAME[r]).join(', ')} />
      <main id="inhalt" className="min-w-0 flex-1 px-3 py-5 sm:px-6 lg:px-8 lg:py-7">
        {s.demoMode && <p className="mb-4 rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-900">Demo-Modus: Zahlungen sind simuliert, E-Mails werden nicht verschickt (siehe Einstellungen).</p>}
        {children}
      </main>
    </div>
  );
}
