// Kassa-Hilfen ohne Server-Abhängigkeiten (auch im Browser verwendet).
import type { Kat, Preise } from './saal';

export const KATEGORIEN: { key: string; label: string }[] = [
  { key: 'ticket', label: 'Abendkasse' },
  { key: 'merch', label: 'Shop' },
  { key: 'getraenk', label: 'Getränke' },
  { key: 'snack', label: 'Snacks' },
  { key: 'sonstiges', label: 'Gutscheine & Sonstiges' },
];

type ProduktLite = { name: string; category: string; sku?: string | null };

/** Abendkasse-Artikel → Kategorie und Tarif. SKU „I“, „II“, „R“ (optional „-erm“) oder aus dem Namen. */
export function ticketArt(p: ProduktLite): { kat: Kat; art: 'normal' | 'ermaessigt' | 'rollstuhl' } | null {
  if (p.category !== 'ticket') return null;
  const quelle = `${p.sku ?? ''} ${p.name}`;
  const kat: Kat = /(^|\W)R(\W|$)|rollstuhl/i.test(quelle) ? 'R' : /kat\.?\s*II\b|(^|\s)II(\W|$)/i.test(quelle) ? 'II' : 'I';
  if (kat === 'R') return { kat, art: 'rollstuhl' };
  return { kat, art: /erm(ä|ae|a)?(ß|ss)?igt|-erm/i.test(quelle) ? 'ermaessigt' : 'normal' };
}

/** Wertgutschein-Artikel (Mehrzweckgutschein, 0 % – USt erst bei Einlösung) */
export const istGutschein = (p: ProduktLite) => p.category === 'sonstiges' && /gutschein/i.test(p.name);

/** Ticketpreis laut Vorstellung (gleiche Regel wie orders.positionen) */
export function ticketPreis(prices: Preise, kat: Kat, art: string): number {
  if (kat === 'R') return prices.R.normal;
  return art === 'ermaessigt' ? prices[kat].ermaessigt : prices[kat].normal;
}

export const SCHNELLGELD = [500, 1000, 2000, 5000];
