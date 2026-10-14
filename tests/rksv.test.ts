import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  betragRksv, betraegeAus, demoPruefen, demoSchluessel, demoSignierer, ivFuer, jwsKompakt, jwsZerlegen, mrcInhalt, qrInhaltRksv,
  rksvZeit, satzFeld, signierEingabe, umsatzEntschluesseln, umsatzVerschluesseln, UMSATZ_STORNO, UMSATZ_TRAINING, verkettung,
} from '../src/lib/rksv';

beforeAll(() => { process.env.SESSION_SECRET ??= 'x'.repeat(40); });

describe('Umsatzzähler AES-256-ICM', () => {
  const key = randomBytes(32);
  it('ver- und entschlüsselt verlustfrei', () => {
    for (const cents of [0, 1, 1250, 99_999_999, -350, -1, 2 ** 40]) {
      const enc = umsatzVerschluesseln(cents, key, 'LOC-KASSA-1', '17');
      expect(Buffer.from(enc, 'base64')).toHaveLength(8);
      expect(umsatzEntschluesseln(enc, key, 'LOC-KASSA-1', '17')).toBe(cents);
    }
  });
  it('kürzere Zähler (5 Byte)', () => {
    const enc = umsatzVerschluesseln(-12345, key, 'K', '3', 5);
    expect(Buffer.from(enc, 'base64')).toHaveLength(5);
    expect(umsatzEntschluesseln(enc, key, 'K', '3')).toBe(-12345);
  });
  it('IV hängt von Kasse und Belegnummer ab', () => {
    expect(ivFuer('K', '1')).toHaveLength(16);
    expect(ivFuer('K', '1').equals(ivFuer('K', '2'))).toBe(false);
    expect(umsatzVerschluesseln(100, key, 'K', '1')).not.toBe(umsatzVerschluesseln(100, key, 'K', '2'));
  });
  it('falscher Schlüssel ergibt anderen Stand', () => {
    const enc = umsatzVerschluesseln(5000, key, 'K', '1');
    expect(umsatzEntschluesseln(enc, randomBytes(32), 'K', '1')).not.toBe(5000);
  });
  it('Storno- und Trainingsmarke', () => {
    expect(UMSATZ_STORNO).toBe('U1RP');
    expect(UMSATZ_TRAINING).toBe('VFJB');
  });
});

describe('Verkettung', () => {
  it('erster Beleg: SHA-256 der Kassen-ID, 8 Byte Base64', () => {
    const v = verkettung(null, 'LOC-KASSA-1');
    expect(Buffer.from(v, 'base64')).toHaveLength(8);
    expect(v).toBe(verkettung('LOC-KASSA-1', 'egal'));
  });
  it('folgende Belege: Hash des vorigen JWS', () => {
    expect(verkettung('a.b.c', 'K')).not.toBe(verkettung('a.b.d', 'K'));
  });
});

describe('Maschinenlesbarer Code', () => {
  it('Beträge mit Komma', () => {
    expect(betragRksv(1250)).toBe('12,50');
    expect(betragRksv(5)).toBe('0,05');
    expect(betragRksv(-300)).toBe('-3,00');
    expect(betragRksv(0)).toBe('0,00');
  });
  it('Steuersätze', () => {
    expect([20, 10, 13, 0, 19].map(satzFeld)).toEqual(['normal', 'erm1', 'erm2', 'null', 'besonders']);
    expect(betraegeAus([{ name: 'a', quantity: 2, unitCents: 350, vatRate: 20 }, { name: 'b', quantity: 1, unitCents: 2800, vatRate: 13 }])).toMatchObject({ normal: 700, erm2: 2800, erm1: 0 });
  });
  it('Zeit in Wien', () => {
    expect(rksvZeit(new Date('2026-07-01T10:00:05Z'))).toBe('2026-07-01T12:00:05');
    expect(rksvZeit(new Date('2026-01-01T10:00:05Z'))).toBe('2026-01-01T11:00:05');
  });
  it('Aufbau', () => {
    const mrc = mrcInhalt({ zda: 'AT0', kassenId: 'LOC-KASSA-1', belegNr: '5', zeit: '2026-10-14T19:30:00', betraege: { normal: 1050, erm1: 800, erm2: 2800, null: 0, besonders: 0 }, umsatz: 'AAAAAAAAAAA=', certSerial: 'DEMO', prevSig: 'q83vEjRWeJA=' });
    expect(mrc).toBe('_R1-AT0_LOC-KASSA-1_5_2026-10-14T19:30:00_10,50_8,00_28,00_0,00_0,00_AAAAAAAAAAA=_DEMO_q83vEjRWeJA=');
    expect(mrc.split('_')).toHaveLength(13);
  });
});

describe('Demo-Signatur', () => {
  it('JWS ES256 ist prüfbar, QR enthält Signatur Base64', async () => {
    const k = demoSchluessel();
    const s = demoSignierer(k);
    const mrc = '_R1-AT0_K_1_2026-10-14T10:00:00_0,00_0,00_0,00_0,00_0,00_AAAAAAAAAAA=_DEMO_abc=';
    const sig = await s.signieren(signierEingabe(mrc));
    expect(sig).toHaveLength(64);
    const jws = jwsKompakt(mrc, sig);
    expect(jws.startsWith('eyJhbGciOiJFUzI1NiJ9.')).toBe(true);
    expect(jwsZerlegen(jws).mrc).toBe(mrc);
    expect(demoPruefen(jws, k.publicKey)).toBe(true);
    expect(demoPruefen(jws.slice(0, -2) + (jws.endsWith('A') ? 'BB' : 'AA'), k.publicKey)).toBe(false);
    expect(qrInhaltRksv(mrc, sig)).toBe(`${mrc}_${sig.toString('base64')}`);
  });
});
