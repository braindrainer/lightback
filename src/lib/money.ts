// Geldbeträge werden durchgehend als ganze Cent geführt.

export const toCents = (eur: number): number => Math.round(eur * 100);

export function formatEur(cents: number, opts: { sign?: boolean } = {}): string {
  const s = new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(cents / 100);
  return opts.sign && cents > 0 ? `+${s}` : s;
}

export const formatNumber = (n: number, digits = 2): string =>
  new Intl.NumberFormat('de-AT', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);

/**
 * Liest Beträge wie "1.234,56", "1,234.56", "-96.00", "1 234,56-", ",50".
 * Regel aus Elevate: Das letzte Trennzeichen ist Dezimaltrenner genau dann,
 * wenn ihm 1–2 Ziffern folgen; alle anderen sind Tausendertrenner.
 */
export function parseAmountToCents(raw: string): number {
  let s = String(raw ?? '').replace(/[^0-9,.+-]/g, '');
  const neg = s.includes('-');
  s = s.replace(/[+-]/g, '');
  if (s === '') return 0;
  const last = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  if (last < 0) return Number(s) * 100;
  const frac = s.slice(last + 1);
  let cents: number;
  if (/^[0-9]{1,2}$/.test(frac)) {
    const int = s.slice(0, last).replace(/[^0-9]/g, '') || '0';
    cents = Number(int) * 100 + Number(frac.padEnd(2, '0'));
  } else {
    cents = Number(s.replace(/[^0-9]/g, '')) * 100;
  }
  return neg ? -cents : cents;
}

/** "1.234" ist mehrdeutig (1234 oder 1,234) → manuell prüfen. */
export function amountNeedsReview(raw: string): boolean {
  const s = String(raw ?? '').replace(/[^0-9,.]/g, '');
  const seps = s.match(/[.,]/g) ?? [];
  return seps.length === 1 && /[.,][0-9]{3}$/.test(s);
}

/** Bruttobetrag in Netto + USt zerlegen. */
export function splitGross(grossCents: number, vatRate: number): { net: number; vat: number } {
  const net = vatRate > 0 ? Math.round(grossCents / (1 + vatRate / 100)) : grossCents;
  return { net, vat: grossCents - net };
}

export const vatFromNet = (netCents: number, vatRate: number): number => Math.round((netCents * vatRate) / 100);
