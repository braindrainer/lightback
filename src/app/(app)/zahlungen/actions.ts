'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { assertRole } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { ausfuehren, pruefen, type Ergebnis } from '@/lib/finanzen/aktion';
import { auszahlungErfassen } from '@/lib/finanzen/buchhaltung';
import { euroZuCent, tag } from '@/lib/finanzen/zeitraum';
import { formatEur } from '@/lib/money';

export async function auszahlungAktion(_: Ergebnis, fd: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('buchhaltung');
    const d = pruefen(z.object({
      provider: z.enum(['hobex', 'stripe', 'paypal', 'terminal'], 'Bitte den Zahlungsanbieter wählen.'),
      datum: z.string().refine((s) => !!tag(s), 'Datum der Auszahlung fehlt'),
      brutto: z.string().transform((s) => euroZuCent(s)).refine((c) => c != null && c > 0, 'Bruttobetrag ungültig'),
      gebuehr: z.string().optional().transform((s) => euroZuCent(s ?? '') ?? 0).refine((c) => c >= 0, 'Gebühren ungültig'),
      ref: z.string().trim().max(80).optional().default(''),
    }), fd);
    const ids = fd.getAll('zahlung').map(String).filter(Boolean);
    const r = await auszahlungErfassen({ provider: d.provider, datum: tag(d.datum)!, bruttoCents: d.brutto!, gebuehrCents: d.gebuehr, ref: d.ref, paymentIds: ids }, u.id);
    await audit(u, 'auszahlung.erfassen', 'settlement', r.entry?.id, { ...d, zahlungen: ids.length });
    revalidatePath('/zahlungen');
    return `Auszahlung über ${formatEur(d.brutto!)} gebucht (Bank ${formatEur(d.brutto! - d.gebuehr)}, Gebühren ${formatEur(d.gebuehr)}); ${r.abgerechnet} Zahlungen als abgerechnet markiert.`;
  });
}
