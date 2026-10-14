// CSV schreiben (Excel-tauglich, Semikolon, Dezimalkomma) und lesen (RFC 4180, ohne Fremdbibliothek)

export function csvFeld(v: unknown, trenner = ';'): string {
  const s = v == null ? '' : String(v);
  return /["\r\n]/.test(s) || s.includes(trenner) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csv(zeilen: unknown[][], trenner = ';'): string {
  return zeilen.map((z) => z.map((f) => csvFeld(f, trenner)).join(trenner)).join('\r\n') + '\r\n';
}

/** Cent → "1234,56" (ohne Tausenderpunkt) */
export const dezimal = (cent: number) => (cent < 0 ? '-' : '') + (Math.abs(cent) / 100).toFixed(2).replace('.', ',');

/** Zeichen außerhalb von ISO-8859-1 ersetzen (BMD und RZL lesen Windows-Zeichensätze) */
export const nachLatin1 = (s: string) => s.replace(/[–—]/g, '-').replace(/[„“”]/g, '"').replace(/[‘’‚]/g, "'").replace(/€/g, 'EUR').replace(/…/g, '...').replace(/[^\x00-\xff]/g, '?');

export function csvAntwort(inhalt: string, datei: string, opt: { latin1?: boolean } = {}) {
  const kopf = { 'Content-Disposition': `attachment; filename="${datei}"`, 'Cache-Control': 'no-store' };
  if (opt.latin1) return new Response(new Uint8Array(Buffer.from(nachLatin1(inhalt), 'latin1')), { headers: { ...kopf, 'Content-Type': 'text/csv; charset=iso-8859-1' } });
  // BOM, damit Excel UTF-8 erkennt
  return new Response(String.fromCharCode(0xfeff) + inhalt, { headers: { ...kopf, 'Content-Type': 'text/csv; charset=utf-8' } });
}

export function csvLesen(text: string, trenner?: string): string[][] {
  const t = trenner ?? (() => { const z = text.split(/\r?\n/, 1)[0] ?? ''; return z.includes(';') ? ';' : z.includes('\t') ? '\t' : ','; })();
  const zeilen: string[][] = [];
  let feld = '';
  let zeile: string[] = [];
  let quote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '"' && text[i + 1] === '"') { feld += '"'; i++; }
      else if (c === '"') quote = false;
      else feld += c;
    } else if (c === '"' && feld === '') quote = true;
    else if (c === t) { zeile.push(feld); feld = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      zeile.push(feld); feld = '';
      if (zeile.some((f) => f.trim() !== '')) zeilen.push(zeile);
      zeile = [];
    } else feld += c;
  }
  zeile.push(feld);
  if (zeile.some((f) => f.trim() !== '')) zeilen.push(zeile);
  return zeilen;
}
