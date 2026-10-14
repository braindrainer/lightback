// EPC-QR-Code („Zahlen mit Code“, GiroCode) für Banking-Apps – aus skillfinance übernommen.
export function epcPayload(o: { name: string; iban: string; bic?: string; cents: number; reference?: string; text?: string }): string {
  return [
    'BCD', '002', '1', 'SCT', o.bic ?? '', o.name.slice(0, 70), o.iban.replace(/\s+/g, ''),
    'EUR' + (o.cents / 100).toFixed(2), '', o.reference ?? '', o.reference ? '' : (o.text ?? '').slice(0, 140),
  ].join('\n');
}
