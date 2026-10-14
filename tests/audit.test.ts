import { describe, expect, it } from 'vitest';
import { abschnittPruefen, eintragHash, GENESIS, kanonisch, normalisieren, type KettenZeile } from '../src/lib/audit-kette';
import { schutzSql } from '../src/lib/schutz';

describe('kanonisch', () => {
  it('sortiert Schlüssel, lässt undefined weg, ohne Leerzeichen', () => {
    expect(kanonisch({ b: 1, a: { d: [1, 'x'], c: null }, e: undefined })).toBe('{"a":{"c":null,"d":[1,"x"]},"b":1}');
  });
  it('ist unabhängig von der Reihenfolge der Schlüssel (wie jsonb)', () => {
    expect(kanonisch({ x: 1, y: { q: 2, p: 3 } })).toBe(kanonisch({ y: { p: 3, q: 2 }, x: 1 }));
  });
  it('Datum wird ISO-Text, Sonderzeichen werden JSON-maskiert', () => {
    expect(kanonisch({ t: new Date('2026-10-14T08:00:00.000Z'), s: 'Grüß "Gott"\n' })).toBe('{"s":"Grüß \\"Gott\\"\\n","t":"2026-10-14T08:00:00.000Z"}');
  });
  it('normalisieren entspricht der Rückgabe aus Postgres', () => {
    expect(normalisieren({ a: undefined, d: new Date('2026-01-01T00:00:00Z') })).toEqual({ d: '2026-01-01T00:00:00.000Z' });
    expect(normalisieren(undefined)).toBeNull();
  });
});

function kette(n: number): KettenZeile[] {
  const zeilen: KettenZeile[] = [];
  let prev = GENESIS;
  for (let i = 1; i <= n; i++) {
    const e = { createdAt: new Date(Date.UTC(2026, 9, 14, 10, 0, i)), userId: 'u1', userName: 'Test', action: 'storno', entity: 'order', entityId: `o${i}`, data: { betragCents: i * 100, tickets: [{ code: `C${i}` }] }, vorher: { status: 'bezahlt' }, nachher: { status: 'storniert' }, ip: '10.0.0.1', userAgent: 'vitest', prevHash: prev };
    const hash = eintragHash(e);
    zeilen.push({ ...e, seq: i, id: `id${i}`, hash });
    prev = hash;
  }
  return zeilen;
}

describe('Hash-Kette', () => {
  it('Hash ist stabil und hängt an jedem Feld', () => {
    const [z] = kette(1);
    expect(z.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(eintragHash(z)).toBe(z.hash);
    // gleiche Daten in anderer Schlüsselreihenfolge → gleicher Hash
    expect(eintragHash({ ...z, data: { tickets: [{ code: 'C1' }], betragCents: 100 } })).toBe(z.hash);
    for (const feld of ['userName', 'action', 'entityId', 'ip', 'prevHash'] as const) expect(eintragHash({ ...z, [feld]: 'x' })).not.toBe(z.hash);
    expect(eintragHash({ ...z, createdAt: new Date(new Date(z.createdAt).getTime() + 1) })).not.toBe(z.hash);
    expect(eintragHash({ ...z, nachher: { status: 'bezahlt' } })).not.toBe(z.hash);
  });

  it('intakte Kette wird bestätigt', () => {
    const z = kette(5);
    const r = abschnittPruefen(z, GENESIS);
    expect(r.fehler).toBeUndefined();
    expect(r.letzter).toBe(z[4].hash);
    expect(r.luecken).toEqual([]);
  });

  it('erkennt geänderte Daten', () => {
    const z = kette(5);
    z[2] = { ...z[2], data: { betragCents: 1, tickets: [{ code: 'C3' }] } };
    expect(abschnittPruefen(z, GENESIS).fehler).toMatchObject({ seq: 3, art: 'hash' });
  });

  it('erkennt gelöschte Einträge', () => {
    const z = kette(5);
    z.splice(1, 1);
    expect(abschnittPruefen(z, GENESIS).fehler).toMatchObject({ seq: 3, art: 'verkettung' });
  });

  it('erkennt neu berechneten Hash ohne Folgeeinträge (Kette bricht beim Nachfolger)', () => {
    const z = kette(5);
    const neu = { ...z[1], data: { betragCents: 0 } };
    z[1] = { ...neu, hash: eintragHash(neu) };
    expect(abschnittPruefen(z, GENESIS).fehler).toMatchObject({ seq: 3, art: 'verkettung' });
  });

  it('erkennt fehlenden Hash und meldet Nummernlücken nur als Hinweis', () => {
    const z = kette(4);
    z[3] = { ...z[3], seq: 7 };
    const r = abschnittPruefen(z, GENESIS);
    expect(r.fehler).toBeUndefined();
    expect(r.luecken).toEqual([7]);
    z[3] = { ...z[3], hash: null };
    expect(abschnittPruefen(z, GENESIS).fehler).toMatchObject({ seq: 7, art: 'fehlt' });
  });
});

describe('Schutz-Trigger', () => {
  it('sperrt Löschen und Ändern der geschützten Tabellen', () => {
    const sql = schutzSql().join('\n');
    for (const t of ['JournalEntry', 'JournalLine', 'Receipt', 'Ticket', 'Invoice', 'Payment', 'Refund']) expect(sql).toContain(`BEFORE DELETE ON "${t}"`);
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON "AuditLog"');
    expect(sql).toContain('BEFORE INSERT ON "AuditLog"');
    expect(sql).toContain('BEFORE UPDATE ON "JournalLine"');
    expect(sql).toContain('BEFORE UPDATE ON "Receipt"');
    expect(sql).toMatch(/BEFORE UPDATE ON "JournalEntry" FOR EACH ROW EXECUTE FUNCTION lb_journal_update/);
  });
});
