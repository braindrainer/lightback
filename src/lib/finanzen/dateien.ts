// Ablage unter DATA_DIR (Docker: /data, lokal ./data)
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const datenOrdner = () => path.resolve(process.env.DATA_DIR || './data');

/** Relativen Pfad (gespeichert in der DB) sicher auflösen – nie außerhalb von DATA_DIR */
export function absolut(rel: string) {
  const basis = datenOrdner();
  const p = path.resolve(basis, rel);
  if (!p.startsWith(basis + path.sep)) throw new Error('Ungültiger Dateipfad');
  return p;
}

export async function ablegen(rel: string, inhalt: Buffer) {
  const p = absolut(rel);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, inhalt);
  return rel;
}

export async function lesen(rel: string) {
  return readFile(absolut(rel));
}

export const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

export const MIME: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', heic: 'image/heic' };
export const sichererName = (n: string) => n.normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '_').slice(0, 80) || 'datei';
