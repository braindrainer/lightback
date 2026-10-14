// Alle Zeiten in Europe/Vienna anzeigen; gespeichert wird UTC.
export const TZ = 'Europe/Vienna';
export const fmtDatum = (d: Date | string) => new Intl.DateTimeFormat('de-AT', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d));
export const fmtZeit = (d: Date | string) => new Intl.DateTimeFormat('de-AT', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(d));
export const fmtDatumZeit = (d: Date | string) => `${fmtDatum(d)}, ${fmtZeit(d)}`;
export const fmtTag = (d: Date | string) => new Intl.DateTimeFormat('de-AT', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit' }).format(new Date(d));

/** Wiener Ortszeit (Datum "YYYY-MM-DD", Zeit "HH:MM") → UTC-Date, sommerzeitfest */
export function wienZuUtc(datum: string, zeit: string): Date {
  const [y, m, d] = datum.split('-').map(Number);
  const [h, mi] = zeit.split(':').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, h, mi));
  const teile = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(guess);
  const g = (t: string) => Number(teile.find((p) => p.type === t)?.value);
  const alsWien = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'));
  return new Date(guess.getTime() - (alsWien - guess.getTime()));
}

/** Kalendertag in Wien als "YYYY-MM-DD" */
export const wienTag = (d: Date | string) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(d));
