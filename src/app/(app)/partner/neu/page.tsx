import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { Formular } from '@/components/system/Formular';
import { PageHeader } from '@/components/ui';
import { partnerAnlegen } from '../actions';
import { PartnerFelder } from '../Felder';

export const metadata = { title: 'Partner anlegen' };

export default async function Neu() {
  await requireRole('leitung');
  return (
    <>
      <PageHeader title="Partner anlegen" sub="Der API-Schlüssel wird beim Anlegen erzeugt und nur einmal angezeigt."><Link href="/partner" className="btn-secondary">Zur Liste</Link></PageHeader>
      <Formular action={partnerAnlegen} knopf="Anlegen und Schlüssel erzeugen" className="card max-w-3xl p-5"><PartnerFelder /></Formular>
    </>
  );
}
