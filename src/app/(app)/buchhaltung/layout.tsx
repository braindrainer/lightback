import { requireRole } from '@/lib/auth';
import { getSettings } from '@/lib/db';
import { HINWEIS_VORSCHLAG } from '@/lib/finanzen/texte';
import { fmtBuchDatum } from '@/lib/finanzen/zeitraum';
import { Meldungsbereich } from '@/components/finanzen/Formular';
import { Tabs } from '@/components/finanzen/Tabs';
import { PageHeader } from '@/components/ui';

const TABS = [
  { href: '/buchhaltung', label: 'Journal' },
  { href: '/buchhaltung/buchen', label: 'Buchen' },
  { href: '/buchhaltung/konten', label: 'Konten' },
  { href: '/buchhaltung/saldenliste', label: 'Saldenliste' },
  { href: '/buchhaltung/bilanz', label: 'GuV & Bilanz' },
  { href: '/buchhaltung/uva', label: 'UVA' },
  { href: '/buchhaltung/belege', label: 'Belege' },
  { href: '/buchhaltung/bank', label: 'Bank' },
  { href: '/buchhaltung/abschluss', label: 'Abschluss & Export' },
];

export default async function BuchhaltungLayout({ children }: { children: React.ReactNode }) {
  await requireRole('buchhaltung');
  const s = await getSettings();
  return (
    <>
      <PageHeader krumen={[{ label: 'Finanzen' }, { label: 'Buchhaltung' }]} title="Buchhaltung" sub={<>{HINWEIS_VORSCHLAG}{s.lockedUntil && <> Festgeschrieben bis {fmtBuchDatum(s.lockedUntil)}.</>}</>} />
      <Tabs label="Bereiche der Buchhaltung" tabs={TABS} />
      <Meldungsbereich>{children}</Meldungsbereich>
    </>
  );
}
