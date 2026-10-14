// API-Schlüssel für Vertriebspartner: loc_live_ + 32 Zeichen base64url. Gespeichert wird nur der SHA-256-Hash.
import { createHash, randomBytes } from 'node:crypto';

export const KEY_PREFIX = 'loc_live_';
export const KEY_RE = /^loc_live_[A-Za-z0-9_-]{32}$/;

export function neuerSchluessel() {
  const key = KEY_PREFIX + randomBytes(24).toString('base64url'); // 24 Byte → genau 32 Zeichen
  return { key, hash: schluesselHash(key), prefix: key.slice(0, KEY_PREFIX.length + 6) };
}

export const schluesselHash = (key: string) => createHash('sha256').update(key, 'utf8').digest('hex');

/** Geheimnis für die Webhook-Signatur (HMAC-SHA256) */
export const neuesWebhookGeheimnis = () => 'whsec_' + randomBytes(24).toString('base64url');
