// Reine Rechenfunktionen für Rechnungen (ohne DB), damit sie testbar sind.

export interface ItemInput { quantity: number; unitCents: number; discountPct: number; vatRate: number }

export const itemNetCents = (i: ItemInput) => Math.round(i.quantity * i.unitCents * (1 - (i.discountPct || 0) / 100));

/** Summen je Steuersatz; USt wird je Satz auf die Nettosumme gerechnet (nicht je Position). */
export function invoiceTotals(items: ItemInput[], treatment: string) {
  const byRate = new Map<number, number>();
  for (const it of items) {
    const rate = treatment === 'domestic' ? it.vatRate : 0;
    byRate.set(rate, (byRate.get(rate) ?? 0) + itemNetCents(it));
  }
  const groups = [...byRate.entries()].sort((a, b) => b[0] - a[0]).map(([rate, net]) => ({ rate, net, vat: Math.round((net * rate) / 100) }));
  const net = groups.reduce((s, g) => s + g.net, 0);
  const vat = groups.reduce((s, g) => s + g.vat, 0);
  return { groups, net, vat, gross: net + vat };
}

/** Rechnungsnummer aus Format, z. B. "{PREFIX}{YYYY}-{NNNN}" → "RE-2026-0007". */
export function renderNumber(fmt: string, prefix: string, date: Date, seq: number): string {
  return fmt
    .replace('{PREFIX}', prefix)
    .replace('{YYYY}', String(date.getFullYear()))
    .replace('{YY}', String(date.getFullYear()).slice(2))
    .replace('{MM}', String(date.getMonth() + 1).padStart(2, '0'))
    .replace(/\{(N+)\}/, (_, n: string) => String(seq).padStart(n.length, '0'));
}

/** Nächste laufende Nummer: höchste vorhandene Nummer mit gleichem Präfix + 1, mindestens minSeq. */
export function nextSequence(fmt: string, prefix: string, date: Date, existing: string[], minSeq: number): number {
  const cut = fmt.indexOf('{N');
  const head = renderNumber(cut >= 0 ? fmt.slice(0, cut) : fmt, prefix, date, 0);
  let max = 0;
  for (const n of existing) {
    if (!n.startsWith(head)) continue;
    const m = n.slice(head.length).match(/^(\d+)/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return Math.max(max + 1, minSeq);
}
