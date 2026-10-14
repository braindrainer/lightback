'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Tabs({ label, tabs }: { label: string; tabs: { href: string; label: string }[] }) {
  const pfad = usePathname();
  const aktiv = (h: string) => pfad === h || (pfad.startsWith(h + '/') && !tabs.some((t) => t.href !== h && t.href.startsWith(h) && pfad.startsWith(t.href)));
  return (
    <nav aria-label={label} className="tabbar mb-5">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-current={aktiv(t.href) ? 'page' : undefined}
          className={`inline-flex min-h-10 items-center border-b-2 px-3 text-sm ${aktiv(t.href) ? 'border-accent font-semibold text-ink' : 'border-transparent text-muted hover:text-ink'}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
