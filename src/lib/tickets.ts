// Ticketcodes und QR-Inhalt. Der QR enthält Code + Vorstellung + HMAC-Signatur, damit die
// Einlass-App ihn auch offline prüfen kann (Fälschungen fallen ohne Server auf).
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne 0/O, 1/I
export function neuerCode(len = 10): string {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

const key = () => {
  const k = process.env.TICKET_SECRET;
  if (!k || k.length < 32) throw new Error('TICKET_SECRET fehlt');
  return k;
};
const sig = (code: string, showId: string) => createHmac('sha256', key()).update(`${code}.${showId}`).digest('base64url').slice(0, 16);

/** QR-Inhalt: LOC1.<code>.<showId>.<sig> */
export const qrInhalt = (code: string, showId: string) => `LOC1.${code}.${showId}.${sig(code, showId)}`;

export function qrPruefen(inhalt: string): { code: string; showId: string } | null {
  const m = inhalt.trim().match(/^LOC1\.([A-Z0-9]{6,16})\.([a-z0-9]+)\.([A-Za-z0-9_-]{16})$/);
  if (!m) return null;
  const soll = Buffer.from(sig(m[1], m[2]));
  const ist = Buffer.from(m[3]);
  return soll.length === ist.length && timingSafeEqual(soll, ist) ? { code: m[1], showId: m[2] } : null;
}

/** Schlüssel für die Offline-Prüfung in der Einlass-App (nur für angemeldete Geräte) */
export const offlineSchluessel = () => createHmac('sha256', key()).update('offline').digest('base64url');

export const qrSvg = (inhalt: string) => QRCode.toString(inhalt, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
export const qrPng = (inhalt: string) => QRCode.toBuffer(inhalt, { type: 'png', margin: 1, width: 360, errorCorrectionLevel: 'M' });
