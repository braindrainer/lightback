import type { Modul } from './module';
import type { Rolle } from './session';

// Navigation – jede Seite prüft die Rolle zusätzlich selbst (requireRole)
export type NavItem = { href: string; label: string; rollen: Rolle[]; icon: string; modul?: Modul };
export const NAV: { titel: string; items: NavItem[] }[] = [
  { titel: '', items: [{ href: '/', label: 'Übersicht', rollen: [], icon: 'M3 12l9-8 9 8M5 10v10h14V10' }] },
  { titel: 'Verkauf', items: [
    { href: '/vorstellungen', label: 'Vorstellungen', rollen: ['leitung'], icon: 'M4 5h16v14H4zM4 9h16M9 5v4M15 5v4' },
    { href: '/bestellungen', label: 'Bestellungen', rollen: ['leitung'], icon: 'M6 3h12l1 4H5zM5 7h14v13H5zM9 11h6' },
    { href: '/bestellungen/neu', label: 'Telefonverkauf', rollen: ['leitung', 'kassa'], icon: 'M5 4h4l2 5-3 2a11 11 0 005 5l2-3 5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2' },
    { href: '/gutscheine', label: 'Gutscheine', rollen: ['leitung', 'buchhaltung'], icon: 'M3 8h18v4a2 2 0 000 4v4H3v-4a2 2 0 000-4zM12 8v12' },
    { href: '/kunden', label: 'Kund:innen', rollen: ['leitung'], icon: 'M16 19a4 4 0 00-8 0M12 11a3 3 0 100-6 3 3 0 000 6' },
    { href: '/partner', label: 'Partner & API', rollen: ['leitung'], icon: 'M8 12h8M12 8v8M4 4h16v16H4z', modul: 'partner' },
    { href: '/statistik', label: 'Statistik', rollen: ['leitung', 'buchhaltung'], icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
  ] },
  { titel: 'Vor Ort', items: [
    { href: '/kassa', label: 'Kassa', rollen: ['kassa'], icon: 'M4 7h16v13H4zM8 7V4h8v3M8 12h8M8 16h5', modul: 'kassa' },
    { href: '/einlass', label: 'Einlass-Scanner', rollen: ['einlass'], icon: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M7 12h10' },
    { href: '/hilfe/vorstellung', label: 'Hilfe: Vorstellung', rollen: [], icon: 'M12 21a9 9 0 110-18 9 9 0 010 18zM9.5 9a2.5 2.5 0 114 2c-.9.6-1.5 1.1-1.5 2.5M12 17h.01' },
  ] },
  { titel: 'Finanzen', items: [
    { href: '/rechnungen', label: 'Rechnungen', rollen: ['buchhaltung'], icon: 'M7 3h10v18l-3-2-2 2-2-2-3 2zM9 8h6M9 12h6' },
    { href: '/zahlungen', label: 'Zahlungen', rollen: ['buchhaltung'], icon: 'M3 6h18v12H3zM3 10h18M7 15h3' },
    { href: '/buchhaltung', label: 'Buchhaltung', rollen: ['buchhaltung'], icon: 'M4 4h16v16H4zM4 9h16M9 9v11', modul: 'buchhaltung' },
    { href: '/bmd', label: 'BMD-Übergabe', rollen: ['buchhaltung'], icon: 'M4 12h12M12 6l6 6-6 6M20 4v16', modul: 'bmd' },
  ] },
  { titel: 'System', items: [
    { href: '/emails', label: 'E-Mails', rollen: ['leitung'], icon: 'M3 6h18v12H3zM3 6l9 7 9-7' },
    { href: '/benutzer', label: 'Benutzer', rollen: ['admin'], icon: 'M17 20a5 5 0 00-10 0M12 12a4 4 0 100-8 4 4 0 000 8' },
    { href: '/einstellungen', label: 'Einstellungen', rollen: ['admin'], icon: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-2-4-2 1-2-2V4h-4v2L9 7 7 6 5 10l2 1v2l-2 1 2 4 2-1 2 2v2h4v-2l2-2 2 1 2-4-2-1z' },
    { href: '/protokoll', label: 'Protokoll', rollen: ['admin'], icon: 'M12 8v4l3 2M12 21a9 9 0 110-18 9 9 0 010 18z' },
  ] },
];
