// Registrierkassensicherheitsverordnung (RKSV): Belegnummern, Umsatzzähler, Verkettung,
// maschinenlesbarer Code und Signatur. Grundlage: Detailspezifikation zur RKSV (BMF).
//
// Ablauf je Beleg (in einer Transaktion, Kasse per FOR UPDATE gesperrt):
//   Belegnummer = letzte + 1 → Umsatzzähler fortschreiben und mit AES-256-ICM verschlüsseln →
//   Verkettungswert aus der Signatur des Vorbelegs → Code bilden → signieren (JWS ES256) → speichern.
import { createCipheriv, createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as ecSign, verify as ecVerify } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { TZ } from './dates';
import { decrypt, encrypt } from './secret';

type Tx = Prisma.TransactionClient;

export const BELEGARTEN = ['standard', 'storno', 'training', 'null', 'start', 'monat', 'jahr', 'schluss'] as const;
export type Belegart = (typeof BELEGARTEN)[number];
export const BELEGART_NAME: Record<Belegart, string> = {
  standard: 'Beleg', storno: 'Stornobeleg', training: 'Trainingsbuchung', null: 'Nullbeleg',
  start: 'Startbeleg', monat: 'Monatsbeleg', jahr: 'Jahresbeleg', schluss: 'Schlussbeleg',
};
/** Belege ohne Betrag (Nullbelege), die immer signiert sein müssen */
export const SONDERBELEGE: Belegart[] = ['start', 'monat', 'jahr', 'schluss'];

export const SIG_AUSGEFALLEN = 'Sicherheitseinrichtung ausgefallen';
const JWS_HEADER = Buffer.from('{"alg":"ES256"}').toString('base64url'); // eyJhbGciOiJFUzI1NiJ9
export const UMSATZ_BYTES = 8;

/** Steuersatz → Feld im Code. 20 % Normal, 10 % Ermäßigt-1, 13 % Ermäßigt-2, 0 % Null, Rest Besonders */
export type Satzfeld = 'normal' | 'erm1' | 'erm2' | 'null' | 'besonders';
export const satzFeld = (vatRate: number): Satzfeld => (vatRate === 20 ? 'normal' : vatRate === 10 ? 'erm1' : vatRate === 13 ? 'erm2' : vatRate === 0 ? 'null' : 'besonders');
export type Betraege = Record<Satzfeld, number>;
export const leereBetraege = (): Betraege => ({ normal: 0, erm1: 0, erm2: 0, null: 0, besonders: 0 });

export type Position = {
  productId?: string; name: string; quantity: number; unitCents: number; vatRate: number; category?: string; ticketIds?: string[]; voucherCodes?: string[];
  /** category 'ticket-aufpreis': Aufzahlung zu einem Ticket (Umsetzen, ermäßigt → Vollpreis) */
  aufpreis?: { ticketId: string; artVorher: string; artNachher: string; seatVorher: string; seatNachher: string };
};

export function betraegeAus(items: Position[]): Betraege {
  const b = leereBetraege();
  for (const i of items) b[satzFeld(i.vatRate)] += i.quantity * i.unitCents;
  return b;
}

/** Cent → "12,50" bzw. "-3,00" (Betragsformat im Code) */
export function betragRksv(cents: number): string {
  const neg = cents < 0;
  const a = Math.abs(cents);
  return `${neg ? '-' : ''}${Math.floor(a / 100)},${String(a % 100).padStart(2, '0')}`;
}

/** Belegzeitpunkt in Wiener Ortszeit: YYYY-MM-DDTHH:MM:SS */
export function rksvZeit(d: Date): string {
  const t = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d);
  const g = (x: string) => t.find((p) => p.type === x)?.value ?? '00';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}:${g('second')}`;
}

/** IV für AES-256-ICM: die ersten 16 Bytes von SHA-256(Kassen-ID ‖ Belegnummer) */
export const ivFuer = (kassenId: string, belegNr: string) => createHash('sha256').update(kassenId + belegNr, 'utf8').digest().subarray(0, 16);

/** AES-256-ICM (= CTR) über 16 Byte: Zähler als vorzeichenbehaftete Ganzzahl big-endian, Rest Nullen */
function icm(block: Buffer, key: Buffer, iv: Buffer): Buffer {
  const c = createCipheriv('aes-256-ctr', key, iv);
  return Buffer.concat([c.update(block), c.final()]);
}

/** Umsatzzähler (Cent) verschlüsseln → Base64 (UMSATZ_BYTES lang) */
export function umsatzVerschluesseln(cents: number, key: Buffer, kassenId: string, belegNr: string, bytes = UMSATZ_BYTES): string {
  if (key.length !== 32) throw new Error('AES-Schlüssel muss 32 Byte haben');
  if (bytes < 5 || bytes > 8) throw new Error('Umsatzzähler: 5 bis 8 Byte');
  const acht = Buffer.alloc(8);
  acht.writeBigInt64BE(BigInt(cents)); // Zweierkomplement – negative Stände sind möglich
  const block = Buffer.alloc(16);
  acht.copy(block, 0, 8 - bytes); // niederwertige Bytes big-endian an den Anfang, Rest Nullen
  return icm(block, key, ivFuer(kassenId, belegNr)).subarray(0, bytes).toString('base64');
}

/** Gegenstück, z. B. für die Prüfung von DEP-Exporten */
export function umsatzEntschluesseln(b64: string, key: Buffer, kassenId: string, belegNr: string): number {
  const enc = Buffer.from(b64, 'base64');
  const block = Buffer.alloc(16);
  enc.copy(block);
  const dec = icm(block, key, ivFuer(kassenId, belegNr)).subarray(0, enc.length);
  const voll = Buffer.alloc(8, dec[0] & 0x80 ? 0xff : 0);
  dec.copy(voll, 8 - dec.length);
  return Number(voll.readBigInt64BE(0));
}

/** Markierungen anstelle des verschlüsselten Zählers */
export const UMSATZ_STORNO = Buffer.from('STO').toString('base64'); // U1RP
export const UMSATZ_TRAINING = Buffer.from('TRA').toString('base64'); // VFJB

/** Verkettungswert: Base64 der ersten 8 Bytes von SHA-256(JWS des Vorbelegs bzw. Kassen-ID beim ersten Beleg) */
export function verkettung(vorherigeSignatur: string | null, kassenId: string): string {
  return createHash('sha256').update(vorherigeSignatur ?? kassenId, 'utf8').digest().subarray(0, 8).toString('base64');
}

export type CodeDaten = { zda: string; kassenId: string; belegNr: string; zeit: string; betraege: Betraege; umsatz: string; certSerial: string; prevSig: string };

/** Maschinenlesbarer Code ohne Signatur (= JWS-Payload) */
export function mrcInhalt(d: CodeDaten): string {
  const b = d.betraege;
  return ['', `R1-${d.zda}`, d.kassenId, d.belegNr, d.zeit, betragRksv(b.normal), betragRksv(b.erm1), betragRksv(b.erm2), betragRksv(b.null), betragRksv(b.besonders), d.umsatz, d.certSerial, d.prevSig].join('_');
}

export const signierEingabe = (mrc: string) => `${JWS_HEADER}.${Buffer.from(mrc, 'utf8').toString('base64url')}`;
/** JWS (compact serialization) aus Code + Signaturbytes */
export const jwsKompakt = (mrc: string, sig: Buffer) => `${signierEingabe(mrc)}.${sig.toString('base64url')}`;
/** Inhalt des QR-Codes: Code + "_" + Signatur in Base64 */
export const qrInhaltRksv = (mrc: string, sig: Buffer) => `${mrc}_${sig.toString('base64')}`;

/** Code aus einem JWS zurückgewinnen (für DEP-Prüfung und Tests) */
export function jwsZerlegen(jws: string) {
  const [h, p, s] = jws.split('.');
  return { header: Buffer.from(h, 'base64url').toString('utf8'), mrc: Buffer.from(p, 'base64url').toString('utf8'), sig: Buffer.from(s, 'base64url') };
}

// ─────────── Signatur-Erstellungseinheit ───────────

export class SignaturAusfall extends Error {}
export type Signierer = { zda: string; certSerial: string; signieren(eingabe: string): Promise<Buffer>; zertifikat?: string };

type DemoKonfig = { privateKeyEnc?: string; publicKey?: string };
type FiskalyKonfig = { apiKey?: string; apiSecretEnc?: string; tssId?: string };

/** Demo-Schlüssel anlegen (einmalig je Kasse) – ECDSA P-256, privat verschlüsselt gespeichert */
export function demoSchluessel(): Required<DemoKonfig> {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    privateKeyEnc: encrypt(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()),
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
}

export function demoSignierer(k: DemoKonfig): Signierer {
  return {
    // Keine Zertifizierungsdiensteanbieter-Kennung: „AT0“ steht laut Detailspezifikation für Test/ohne ZDA.
    // DEMO – KEINE RECHTSGÜLTIGE SIGNATUR, nur für Entwicklung und Schulung.
    zda: 'AT0',
    certSerial: 'DEMO',
    async signieren(eingabe) {
      if (!k.privateKeyEnc) throw new SignaturAusfall('Kein Demo-Schlüssel');
      const key = createPrivateKey(decrypt(k.privateKeyEnc));
      return ecSign('sha256', Buffer.from(eingabe, 'ascii'), { key, dsaEncoding: 'ieee-p1363' });
    },
  };
}

/** fiskaly SIGN AT – noch nicht angebunden. Ohne Zugangsdaten gilt die Einheit als ausgefallen. */
export function fiskalySignierer(k: FiskalyKonfig, certSerial: string): Signierer {
  return {
    zda: 'AT1', // fiskaly signiert mit A-Trust-Zertifikaten
    certSerial,
    async signieren() {
      if (!k.apiKey || !k.apiSecretEnc || !k.tssId) throw new SignaturAusfall('fiskaly nicht konfiguriert');
      // TODO fiskaly SIGN AT anbinden:
      //  1. POST https://rksv.fiskaly.com/api/v1/auth { api_key, api_secret } → access_token
      //  2. Kasse (cash_register) einmalig registrieren, SCU/TSS = k.tssId
      //  3. Beleg signieren: PUT /cash_registers/{kassenId}/receipts/{belegNr} mit den Beträgen –
      //     fiskaly bildet Zähler, Verkettung und Signatur selbst; dann Zähler/QR von dort übernehmen.
      throw new SignaturAusfall('fiskaly-Anbindung noch nicht umgesetzt');
    },
  };
}

export function signiererFuer(r: { signer: string; signerConfig: unknown; certSerial: string }): Signierer {
  return r.signer === 'fiskaly' ? fiskalySignierer(r.signerConfig as FiskalyKonfig, r.certSerial) : demoSignierer(r.signerConfig as DemoKonfig);
}

/** Demo-Signatur prüfen (Kassenbuch, Tests) */
export function demoPruefen(jws: string, publicKeyB64: string): boolean {
  const [h, p, s] = jws.split('.');
  if (Buffer.from(s, 'base64url').toString('utf8') === SIG_AUSGEFALLEN) return false;
  const key = createPublicKey({ key: Buffer.from(publicKeyB64, 'base64'), format: 'der', type: 'spki' });
  return ecVerify('sha256', Buffer.from(`${h}.${p}`, 'ascii'), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
}

export const aesSchluessel = (aesKeyEnc: string) => Buffer.from(decrypt(aesKeyEnc), 'base64');

// ─────────── Beleg erstellen ───────────

export type BelegEingabe = {
  registerId: string;
  type: Belegart;
  items?: Position[];
  payment?: string;
  givenCents?: number | null;
  changeCents?: number | null;
  cashier?: { id: string; name: string } | null;
  sessionId?: string | null;
  cancelsId?: string | null;
  orderId?: string | null;
  /** Buchhaltung in derselben Transaktion */
  buchen?: (tx: Tx, beleg: { id: string; number: number; createdAt: Date }) => Promise<unknown>;
};

export async function belegErstellen(e: BelegEingabe) {
  const items = SONDERBELEGE.includes(e.type) || e.type === 'null' ? [] : (e.items ?? []);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Register" WHERE id = ${e.registerId} FOR UPDATE`;
    const reg = await tx.register.findUniqueOrThrow({ where: { id: e.registerId } });
    if (!reg.active) throw new Error('Diese Kasse ist außer Betrieb (Schlussbeleg erstellt).');
    if (e.type === 'start') {
      if (reg.startedAt || reg.lastReceiptNo > 0) throw new Error('Startbeleg ist bereits vorhanden.');
    } else if (!reg.startedAt) throw new Error('Vor dem ersten Beleg ist ein Startbeleg nötig (Kassa → Einrichtung).');

    // Demo-Schlüssel beim ersten Gebrauch anlegen
    let konfig = (reg.signerConfig ?? {}) as Record<string, unknown>;
    if (reg.signer === 'demo' && !konfig.privateKeyEnc) {
      konfig = { ...konfig, ...demoSchluessel() };
      await tx.register.update({ where: { id: reg.id }, data: { signerConfig: konfig as object } });
    }
    const signierer = signiererFuer({ signer: reg.signer, signerConfig: konfig, certSerial: reg.certSerial });

    const number = reg.lastReceiptNo + 1;
    const belegNr = String(number);
    const betraege = betraegeAus(items);
    const total = Object.values(betraege).reduce((s, x) => s + x, 0);
    const jetzt = new Date();

    // Umsatzzähler = Summe aller Belege außer Training (Storno zählt negativ)
    const bisher = (await tx.receipt.aggregate({ where: { registerId: reg.id, type: { not: 'training' } }, _sum: { totalCents: true } }))._sum.totalCents ?? 0;
    const stand = e.type === 'training' ? bisher : bisher + total;
    const umsatz = e.type === 'training' ? UMSATZ_TRAINING : e.type === 'storno' ? UMSATZ_STORNO : umsatzVerschluesseln(stand, aesSchluessel(reg.aesKeyEnc), reg.kassenId, belegNr);

    const vorher = reg.lastReceiptNo ? await tx.receipt.findUnique({ where: { registerId_number: { registerId: reg.id, number: reg.lastReceiptNo } }, select: { signature: true } }) : null;
    const prevSig = verkettung(vorher?.signature ?? null, reg.kassenId);

    const mrc = mrcInhalt({ zda: signierer.zda, kassenId: reg.kassenId, belegNr, zeit: rksvZeit(jetzt), betraege, umsatz, certSerial: signierer.certSerial, prevSig });
    let sig: Buffer;
    let ausgefallen = false;
    try {
      sig = await signierer.signieren(signierEingabe(mrc));
    } catch (err) {
      if (SONDERBELEGE.includes(e.type)) throw new Error(`${BELEGART_NAME[e.type]} muss signiert sein – Signatureinheit nicht erreichbar (${(err as Error).message}).`);
      ausgefallen = true;
      sig = Buffer.from(SIG_AUSGEFALLEN, 'utf8');
    }
    const jws = jwsKompakt(mrc, sig);

    const beleg = await tx.receipt.create({
      data: {
        registerId: reg.id, number, type: e.type, createdAt: jetzt, cashierId: e.cashier?.id, cashierName: e.cashier?.name,
        items: items as unknown as object, sumNormal: betraege.normal, sumReduced1: betraege.erm1, sumReduced2: betraege.erm2, sumZero: betraege.null, sumSpecial: betraege.besonders,
        totalCents: total, payment: e.payment ?? 'bar', givenCents: e.givenCents ?? null, changeCents: e.changeCents ?? null,
        turnoverEnc: umsatz, prevSigHash: prevSig, signature: jws, qr: qrInhaltRksv(mrc, sig), signerFailed: ausgefallen,
        cancelsId: e.cancelsId ?? null, orderId: e.orderId ?? null, sessionId: e.sessionId ?? null,
      },
    });
    await tx.register.update({
      where: { id: reg.id },
      data: {
        lastReceiptNo: number, lastSigHash: verkettung(jws, reg.kassenId),
        ...(e.type === 'start' ? { startedAt: jetzt } : {}), ...(e.type === 'schluss' ? { active: false } : {}),
      },
    });
    if (e.buchen && e.type !== 'training') await e.buchen(tx, beleg);
    return beleg;
  }, { timeout: 20000 });
}

/** Datenerfassungsprotokoll (DEP) nach Detailspezifikation, Abs. „Export-Format“ */
export async function depExport(registerId: string, von?: Date, bis?: Date) {
  const reg = await db.register.findUniqueOrThrow({ where: { id: registerId } });
  const belege = await db.receipt.findMany({ where: { registerId, createdAt: { gte: von, lte: bis } }, orderBy: { number: 'asc' }, select: { signature: true } });
  const k = (reg.signerConfig ?? {}) as DemoKonfig & { certificate?: string; chain?: string[] };
  return {
    'Belege-Gruppe': [{
      Signaturzertifikat: k.certificate ?? '',
      Zertifizierungsstellen: k.chain ?? [],
      'Belege-kompakt': belege.map((b) => b.signature),
    }],
    ...(reg.signer === 'demo' ? { Hinweis: 'DEMO-Signatur ohne Zertifikat – nicht rechtsgültig. Öffentlicher Schlüssel (SPKI, Base64) zur Prüfung beigefügt.', 'Demo-Public-Key': k.publicKey ?? '' } : {}),
  };
}
