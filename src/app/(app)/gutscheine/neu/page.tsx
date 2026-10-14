import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { Abschnitt, PageHeader } from '@/components/ui';
import { AusstellenFormular, ImportFormular, VerkaufenFormular } from '@/components/verkauf/GutscheinFormulare';
import { gutscheineAusstellen, gutscheinVerkaufenAktion, partnerImport } from '../actions';

export const metadata = { title: 'Gutscheine anlegen' };

export default async function GutscheinNeu() {
  await requireRole('leitung', 'buchhaltung');
  return (
    <>
      <PageHeader title="Gutscheine anlegen" krumen={[{ label: 'Verkauf' }, { label: 'Gutscheine', href: '/gutscheine' }, { label: 'Anlegen' }]}
        sub="Verkaufen (wird gebucht), kostenlos ausstellen oder Codes von Partnern übernehmen." />
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Abschnitt id="verkaufen" titel="Gutschein verkaufen" beschreibung="Gegen Bezahlung an der Kassa oder am Telefon."><VerkaufenFormular action={gutscheinVerkaufenAktion} /></Abschnitt>
        <Abschnitt id="ausstellen" titel="Eigene Gutscheine ausstellen" beschreibung="Kulanz, Gewinnspiel, Kooperation – auch als Serie."><AusstellenFormular action={gutscheineAusstellen} /></Abschnitt>
        <Abschnitt id="import" className="xl:col-span-2" titel="Partner-Gutscheine importieren" beschreibung={<>Codes von Tiqets, GetYourGuide &amp; Co. – danach unter <Link href="/gutscheine?zustand=alle" className="link">Gutscheine</Link> auffindbar.</>}><ImportFormular action={partnerImport} /></Abschnitt>
      </div>
    </>
  );
}
