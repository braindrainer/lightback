import { requireModul } from '@/lib/module';

export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  await requireModul('partner');
  return children;
}
