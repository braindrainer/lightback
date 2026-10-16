import Link from 'next/link';
import Nav from '@/components/Nav';
import { Hinweis, ToastBereich } from '@/components/ui';
import ScrollBereiche from '@/components/ScrollBereiche';
import { hat, requireRole } from '@/lib/auth';
import { NAV } from '@/lib/nav';
import { ROLLEN_NAME } from '@/lib/session';
import { db, getSettings } from '@/lib/db';
import { modulStand } from '@/lib/module';

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
  const m = modulStand(s.module);
  const gruppen = NAV.map((g) => ({ titel: g.titel, items: g.items.filter((i) => (!i.rollen.length || hat(u, ...i.rollen)) && (!i.modul || m[i.modul])) })).filter((g) => g.items.length);
  return (
    <div className="lg:flex">
      <Nav gruppen={gruppen} badges={badges} suche={hat(u, 'leitung')} name={u.name} rollen={u.roles.map((r) => ROLLEN_NAME[r]).join(', ')} />
      <main id="inhalt" className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-10 lg:py-8">
        <div className="mx-auto max-w-[1400px]">
          {s.demoMode && <Hinweis art="demo">Demo-Modus: Zahlungen sind simuliert, E-Mails werden nicht verschickt (siehe <Link href="/einstellungen" className="underline underline-offset-4">Einstellungen</Link>).</Hinweis>}
          {children}
        </div>
      </main>
      <ScrollBereiche />
      <ToastBereich />
    </div>
  );
}
