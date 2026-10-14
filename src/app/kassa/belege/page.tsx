import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtZeit, wienTag, wienZuUtc } from '@/lib/dates';
import { ZAHLART_NAME } from '@/lib/kassa';
import { formatEur } from '@/lib/money';
import { BELEGART_NAME, type Belegart } from '@/lib/rksv';
import { kasseWaehlen } from '../daten';
import Storno from './Storno';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Belege' };

export default async function Belege() {
  await requireRole('kassa');
  const { reg, schicht } = await kasseWaehlen();
  const ab = wienZuUtc(wienTag(new Date()), '00:00');
  const belege = reg ? await db.receipt.findMany({ where: { registerId: reg.id, createdAt: { gte: ab } }, orderBy: { number: 'desc' }, take: 200 }) : [];
  const storniert = new Set(belege.map((b) => b.cancelsId).filter(Boolean));
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4 px-3 py-5 sm:px-4">
      <h1 className="h1">Belege heute{reg ? ` – ${reg.name}` : ''}</h1>
      {!belege.length && <p className="card p-5 text-base text-muted">Heute noch keine Belege.</p>}
      <ul className="grid gap-2">
        {belege.map((b) => (
          <li key={b.id} className="card flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold">Nr. {b.number} · {fmtZeit(b.createdAt)} Uhr{b.type !== 'standard' && <span className="pill ml-2 bg-gray-100 text-ink">{BELEGART_NAME[b.type as Belegart]}</span>}{storniert.has(b.id) && <span className="pill ml-2 bg-red-50 text-neg">storniert</span>}{b.signerFailed && <span className="pill ml-2 bg-amber-50 text-warn">ohne Signatur</span>}</p>
              <p className="text-sm text-muted">{(b.items as { name: string; quantity: number }[]).map((i) => `${Math.abs(i.quantity)}× ${i.name}`).join(', ') || '–'}</p>
            </div>
            <p className="num text-lg font-semibold">{formatEur(b.totalCents)}<span className="block text-right text-xs font-normal text-muted">{ZAHLART_NAME[b.payment] ?? b.payment}</span></p>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <Link href={`/kassa/beleg/${b.id}?druck=1`} prefetch={false} className="btn-secondary min-h-12 flex-1 text-base">Kopie drucken</Link>
              {b.type === 'standard' && !storniert.has(b.id) && schicht && <Storno receiptId={b.id} number={b.number} sessionId={schicht.id} />}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
