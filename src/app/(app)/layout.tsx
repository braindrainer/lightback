import Nav from '@/components/Nav';
import ScrollBereiche from '@/components/ScrollBereiche';
import { hat, requireRole } from '@/lib/auth';
import { NAV } from '@/lib/nav';
import { ROLLEN_NAME } from '@/lib/session';
import { db, getSettings } from '@/lib/db';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await requireRole();
  const s = await getSettings();
  // Zähler für die Sidebar (nur was die Rolle betrifft)
  const [offen, mailFehler, belege] = await Promise.all([
    hat(u, 'leitung') ? db.order.count({ where: { status: 'offen', createdAt: { lt: new Date(Date.now() - 30 * 60e3) } } }) : 0,
    hat(u, 'leitung') ? db.emailLog.count({ where: { status: 'fehler', createdAt: { gte: new Date(Date.now() - 7 * 864e5) } } }) : 0,
    hat(u, 'buchhaltung') ? db.expense.count({ where: { status: 'offen', dueDate: { lte: new Date(Date.now() + 7 * 864e5) } } }) : 0,
  ]);
  const badges: Record<string, { n: number; text: string }> = {
    '/bestellungen': { n: offen, text: 'unbezahlt' },
    '/emails': { n: mailFehler, text: 'Fehler' },
    '/buchhaltung': { n: belege, text: 'Belege fällig' },
  };
  const gruppen = NAV.map((g) => ({ titel: g.titel, items: g.items.filter((i) => !i.rollen.length || hat(u, ...i.rollen)) })).filter((g) => g.items.length);
  return (
    <div className="lg:flex">
      <Nav gruppen={gruppen} badges={badges} suche={hat(u, 'leitung')} name={u.name} rollen={u.roles.map((r) => ROLLEN_NAME[r]).join(', ')} />
      <main id="inhalt" className="min-w-0 flex-1 px-3 py-5 sm:px-6 lg:px-8 lg:py-7">
        {s.demoMode && <p className="mb-4 rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-900">Demo-Modus: Zahlungen sind simuliert, E-Mails werden nicht verschickt (siehe Einstellungen).</p>}
        {children}
      </main>
      <ScrollBereiche />
    </div>
  );
}
