import { requireRole } from '@/lib/auth';
import { heute, tag, tagStr } from '@/lib/finanzen/zeitraum';
import { RechnungsFormular } from '@/components/finanzen/RechnungsFormular';
import { PageHeader } from '@/components/ui';
import { rechnungNeuAktion } from '../actions';

export const metadata = { title: 'Neue Rechnung' };

export default async function NeueRechnung() {
  await requireRole('buchhaltung');
  const h = heute();
  return (
    <>
      <PageHeader title="Neue Rechnung" sub="Rechnung an eine Firma (z. B. Gruppen, Schulen, Veranstaltungen). Gebucht wird Forderung an Erlöse und Umsatzsteuer je Steuersatz." />
      <RechnungsFormular action={rechnungNeuAktion} heute={h} faellig={tagStr(new Date(tag(h)!.getTime() + 14 * 864e5))} />
    </>
  );
}
