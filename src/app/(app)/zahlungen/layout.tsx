import { Meldungsbereich } from '@/components/finanzen/Formular';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <Meldungsbereich>{children}</Meldungsbereich>;
}
