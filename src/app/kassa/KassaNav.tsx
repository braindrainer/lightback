'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function KassaNav({ admin }: { admin: boolean }) {
  const p = usePathname();
  const links = [
    { href: '/kassa', label: 'Verkauf' },
    { href: '/kassa/belege', label: 'Belege' },
    { href: '/kassa/schicht', label: 'Schicht' },
    ...(admin ? [{ href: '/kassa/einrichtung', label: 'Einrichtung' }, { href: '/kassa/kassenbuch', label: 'Kassenbuch' }] : []),
  ];
  return (
    <nav aria-label="Kassa" className="min-w-0 overflow-x-auto">
      <ul className="flex gap-1 whitespace-nowrap">
        {links.map((l) => {
          const aktiv = l.href === '/kassa' ? p === '/kassa' : p.startsWith(l.href);
          return (
            <li key={l.href}>
              <Link href={l.href} aria-current={aktiv ? 'page' : undefined} className={`inline-flex min-h-12 items-center rounded-lg px-3 text-base ${aktiv ? 'bg-white/15 font-semibold text-white' : 'text-white/85 hover:bg-white/10'}`}>{l.label}</Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
