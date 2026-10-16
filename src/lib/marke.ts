// Markenauftritt für Dokumente (Ticket, Rechnung): Farben wie im Shop, Schrift Inter selbst gehostet.
// Im PDF (Gotenberg, ohne JavaScript) liegen Schriften und Bilder als Beilagen neben index.html,
// im Browser kommen sie aus /fonts und /img.
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export type Modus = 'pdf' | 'web';

export const FARBE = {
  nacht: '#070b14', tiefe: '#0c1322', flaeche: '#121b2e', linie: '#2a3654', text: '#f4efe6', gedaempft: '#b9b3a6',
  gold: '#d9b877', goldHell: '#ecd3a0', goldTief: '#7a5a1c', tinte: '#121a2b', grau: '#525b6e', papier: '#fbf9f5', sand: '#e2dacb',
  violett: '#b3a6ff', violettTief: '#5b4bc4', rs: '#7cc4ff', rsTief: '#2a6fae',
} as const;

const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';

const SCHRIFTEN = [
  { family: 'Inter', style: 'normal', weight: '100 900', datei: 'inter-latin-wght-normal.woff2', range: LATIN },
  { family: 'Inter', style: 'normal', weight: '100 900', datei: 'inter-latin-ext-wght-normal.woff2', range: LATIN_EXT },
];

export const SCHRIFT_TEXT = '"Inter", "Helvetica Neue", Arial, sans-serif';
export const SCHRIFT_TITEL = SCHRIFT_TEXT;

/** @font-face-Regeln; im PDF liegen die Dateien direkt neben dem Dokument */
export const schriftCss = (m: Modus) =>
  SCHRIFTEN.map((f) => `@font-face{font-family:"${f.family}";font-style:${f.style};font-weight:${f.weight};font-display:block;src:url("${m === 'pdf' ? f.datei : `/fonts/${f.datei}`}") format("woff2");unicode-range:${f.range}}`).join('\n');

export const bild = (name: string, m: Modus) => (m === 'pdf' ? name : `/img/${name}`);

const TYP: Record<string, string> = { woff2: 'font/woff2', webp: 'image/webp', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg' };
const cache = new Map<string, Buffer>();

async function datei(rel: string) {
  let b = cache.get(rel);
  if (!b) {
    b = await readFile(path.join(process.cwd(), 'public', rel));
    cache.set(rel, b);
  }
  return b;
}

/** Beilagen für Gotenberg: alle Schriften + die genannten Bilder aus public/img */
export async function pdfBeilagen(bilder: string[] = []) {
  const liste = [...SCHRIFTEN.map((f) => `fonts/${f.datei}`), ...bilder.map((b) => `img/${b}`)];
  return Promise.all(liste.map(async (rel) => ({ name: path.basename(rel), data: await datei(rel), type: TYP[rel.split('.').pop()!] ?? 'application/octet-stream' })));
}

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
