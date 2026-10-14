import { describe, expect, it } from 'vitest';
import { uvaBerechnen, uvaUmbuchung, type UvaZeile } from '../src/lib/finanzen/uva';
import { bmdCsv, bmdWirkung, bmdZeilen, type BmdEntry } from '../src/lib/finanzen/bmd';
import { camtLesen, csvBankLesen, vorschlaege } from '../src/lib/finanzen/bank';
import { csvLesen, dezimal } from '../src/lib/finanzen/csv';
import { euroZuCent, gjBeginn, uvaFaellig, zeitraum } from '../src/lib/finanzen/zeitraum';
import { manuelleZeilen } from '../src/lib/finanzen/buchhaltung';
import { rechnungsZeilen } from '../src/lib/finanzen/rechnungen';
import { steuerAufstellung } from '../src/lib/invoice-html';

// Buchungssätze wie sie ledger.ts erzeugt
const ticket = (id: string, brutto: number): UvaZeile[] => {
  const netto = Math.round(brutto / 1.13);
  return [
    { entryId: id, konto: '2880', soll: brutto, haben: 0, vatCode: null, base: null },
    { entryId: id, konto: '3480', soll: 0, haben: netto, vatCode: 'U13', base: netto },
    { entryId: id, konto: '3502', soll: 0, haben: brutto - netto, vatCode: null, base: null },
  ];
};
const eingang = (id: string, netto: number, ust: number): UvaZeile[] => [
  { entryId: id, konto: '7400', soll: netto, haben: 0, vatCode: 'V20', base: netto },
  { entryId: id, konto: '2500', soll: ust, haben: 0, vatCode: 'V20', base: netto },
  { entryId: id, konto: '3300', soll: 0, haben: netto + ust, vatCode: null, base: null },
];
const kassa20 = (id: string): UvaZeile[] => [
  { entryId: id, konto: '2700', soll: 1200, haben: 0, vatCode: null, base: null },
  { entryId: id, konto: '4200', soll: 0, haben: 1000, vatCode: 'U20', base: 1000 },
  { entryId: id, konto: '3500', soll: 0, haben: 200, vatCode: null, base: null },
];

describe('UVA', () => {
  it('summiert Bemessungsgrundlagen je Kennzahl und Steuer aus den Steuerkonten', () => {
    const e = uvaBerechnen([...ticket('a', 5600), ...ticket('b', 2800), ...eingang('c', 100000, 20000), ...kassa20('d')]);
    const k = Object.fromEntries(e.saetze.map((s) => [s.kz, s]));
    expect(k['006'].base).toBe(4956 + 2478);
    expect(k['006'].gebucht).toBe(5600 - 4956 + 2800 - 2478);
    expect(k['022'].base).toBe(1000);
    expect(k['022'].gebucht).toBe(200);
    expect(k['029'].base).toBe(0);
    expect(e.kz000).toBe(4956 + 2478 + 1000);
    expect(e.vorsteuer).toBe(20000);
    expect(e.vorsteuerBasis).toBe(100000); // Vorsteuerzeile mit Code zählt nicht doppelt
    expect(e.zahllast).toBe(644 + 322 + 200 - 20000);
    expect(e.differenzen).toEqual([]);
  });

  it('Storno mit negativer Bemessungsgrundlage mindert die Kennzahl', () => {
    const storno: UvaZeile[] = [
      { entryId: 's', konto: '3480', soll: 4956, haben: 0, vatCode: 'U13', base: -4956 },
      { entryId: 's', konto: '3502', soll: 644, haben: 0, vatCode: null, base: null },
      { entryId: 's', konto: '2880', soll: 0, haben: 5600, vatCode: null, base: null },
    ];
    const e = uvaBerechnen([...ticket('a', 5600), ...storno]);
    expect(e.kz000).toBe(0);
    expect(e.zahllast).toBe(0);
  });

  it('ignoriert die UVA-Umbuchung auf 3540 und baut sie ausgeglichen auf', () => {
    const basis = [...ticket('a', 5600), ...eingang('c', 1000, 200)];
    const e = uvaBerechnen(basis);
    const um = uvaUmbuchung(e);
    const soll = um.reduce((s, z) => s + (z.soll ?? 0), 0);
    const haben = um.reduce((s, z) => s + (z.haben ?? 0), 0);
    expect(soll).toBe(haben);
    expect(um.find((z) => z.konto === '3540')?.haben).toBe(644 - 200);
    const gebucht: UvaZeile[] = um.map((z) => ({ entryId: 'uva', konto: z.konto, soll: z.soll ?? 0, haben: z.haben ?? 0, vatCode: null, base: null }));
    expect(uvaBerechnen([...basis, ...gebucht]).zahllast).toBe(e.zahllast);
  });

  it('meldet Abweichungen zwischen Bemessungsgrundlage und gebuchter Steuer', () => {
    const e = uvaBerechnen([{ entryId: 'x', konto: '4200', soll: 0, haben: 10000, vatCode: 'U20', base: 10000 }, { entryId: 'x', konto: '2800', soll: 10000, haben: 0, vatCode: null, base: null }]);
    expect(e.differenzen.length).toBe(1);
  });

  it('Fälligkeit am 15. des zweitfolgenden Monats', () => {
    expect(uvaFaellig('2026-10')).toBe('2026-12-15');
    expect(uvaFaellig('2026-11')).toBe('2027-01-15');
    expect(uvaFaellig('2026-12')).toBe('2027-02-15');
  });
});

const entry = (lines: BmdEntry['lines'], source = 'order'): BmdEntry => ({ number: 7, date: '2026-10-14', docRef: 'LOC-2026-000001', text: 'Ticketverkauf LOC-2026-000001', source, lines });

describe('BMD-Export', () => {
  it('fasst Steuerzeile mit Grundzeile zusammen, Gegenkonto ist das Hauptkonto', () => {
    const rows = bmdZeilen(entry([
      { konto: '2880', soll: 5600, haben: 0, vatCode: null, base: null },
      { konto: '3480', soll: 0, haben: 4956, vatCode: 'U13', base: 4956 },
      { konto: '3502', soll: 0, haben: 644, vatCode: null, base: null },
    ]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ satzart: 0, konto: '3480', gkonto: '2880', buchcode: 2, prozent: 13, steuercode: 3, betrag: -5600, steuer: -644, belegdatum: '14.10.2026', buchsymbol: 'AR', belegnr: 'LOC-2026-000001' });
  });

  it('Eingangsrechnung: Vorsteuer mit Steuercode 1 gegen Lieferverbindlichkeit', () => {
    const rows = bmdZeilen(entry([
      { konto: '7400', soll: 100000, haben: 0, vatCode: 'V20', base: 100000 },
      { konto: '2500', soll: 20000, haben: 0, vatCode: 'V20', base: 100000 },
      { konto: '3300', soll: 0, haben: 120000, vatCode: null, base: null },
    ], 'expense'));
    expect(rows).toEqual([expect.objectContaining({ konto: '7400', gkonto: '3300', buchcode: 1, betrag: 120000, steuer: 20000, prozent: 20, steuercode: 1, buchsymbol: 'ER' })]);
  });

  it('mehrzeilige Buchung: Wirkung je Konto entspricht dem Journal', () => {
    const lines = [
      { konto: '2700', soll: 3100, haben: 0, vatCode: null, base: null },
      { konto: '4200', soll: 0, haben: 1000, vatCode: 'U20', base: 1000 },
      { konto: '3500', soll: 0, haben: 200, vatCode: null, base: null },
      { konto: '4000', soll: 0, haben: 1681, vatCode: 'U13', base: 1681 },
      { konto: '3502', soll: 0, haben: 219, vatCode: null, base: null },
    ];
    const rows = bmdZeilen(entry(lines, 'receipt'));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.gkonto === '2700' && r.buchsymbol === 'KA')).toBe(true);
    const w = bmdWirkung(rows);
    for (const l of lines) expect(w.get(l.konto)).toBe(l.soll - l.haben);
  });

  it('Steuerzeile ohne Grundzeile (UVA-Umbuchung) bleibt eigene Zeile ohne Steuercode', () => {
    const rows = bmdZeilen(entry([
      { konto: '3502', soll: 644, haben: 0, vatCode: null, base: null },
      { konto: '2500', soll: 0, haben: 200, vatCode: null, base: null },
      { konto: '3540', soll: 0, haben: 444, vatCode: null, base: null },
    ], 'uva'));
    expect(rows.map((r) => [r.konto, r.gkonto, r.steuercode, r.betrag])).toEqual([['3502', '3540', '', 644], ['2500', '3540', '', -200]]);
  });

  it('CSV: Kopfzeile, Semikolon, Dezimalkomma, Maskierung', () => {
    const out = bmdCsv([{ ...entry([
      { konto: '2800', soll: 123456, haben: 0, vatCode: null, base: null },
      { konto: '2000', soll: 0, haben: 123456, vatCode: null, base: null },
    ], 'invoice-paid'), text: 'Zahlung; "Firma"' }]);
    const z = out.trim().split('\r\n');
    expect(z[0]).toBe('satzart;konto;gkonto;belegnr;belegdatum;buchsymbol;buchcode;prozent;steuercode;betrag;steuer;text');
    expect(z[1]).toBe('0;2000;2800;LOC-2026-000001;14.10.2026;BK;2;;;-1234,56;0,00;"Zahlung; ""Firma"""');
    expect(csvLesen(out)[1][11]).toBe('Zahlung; "Firma"');
  });
});

describe('Bankimport', () => {
  it('liest George-CSV mit Semikolon und Dezimalkomma', () => {
    const r = csvBankLesen('Buchungsdatum;Partnername;Partner IBAN;Betrag;Währung;Verwendungszweck\n01.10.2026;Hobex AG;AT611904300234573201;1.234,56;EUR;Auszahlung 4711\n02.10.2026;Wien Energie;AT02;-89,90;EUR;"Rechnung 77; Oktober"\n');
    expect(r.zeilen).toHaveLength(2);
    expect(r.zeilen[0]).toMatchObject({ amountCents: 123456, counterparty: 'Hobex AG', iban: 'AT611904300234573201' });
    expect(r.zeilen[0].bookingDate.toISOString().slice(0, 10)).toBe('2026-10-01');
    expect(r.zeilen[1]).toMatchObject({ amountCents: -8990, reference: 'Rechnung 77; Oktober' });
    expect(csvBankLesen('Buchungsdatum;Partnername;Partner IBAN;Betrag;Währung;Verwendungszweck\n01.10.2026;Hobex AG;AT611904300234573201;1.234,56;EUR;Auszahlung 4711\n').zeilen[0].externalId).toBe(r.zeilen[0].externalId);
  });

  it('liest CAMT.053', () => {
    const xml = `<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
<Ntry><Amt Ccy="EUR">250.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-05</Dt></BookgDt><AcctSvcrRef>X1</AcctSvcrRef>
<NtryDtls><TxDtls><RltdPties><Dbtr><Nm>Schule &amp; Co</Nm></Dbtr><DbtrAcct><Id><IBAN>AT12 3456</IBAN></Id></DbtrAcct></RltdPties><RmtInf><Ustrd>RE2026-00001</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
<Ntry><Amt Ccy="EUR">10.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>PDNG</Sts><BookgDt><Dt>2026-10-06</Dt></BookgDt></Ntry>
</Stmt></BkToCstmrStmt></Document>`;
    const r = camtLesen(xml);
    expect(r.zeilen).toEqual([expect.objectContaining({ externalId: 'camt_X1', amountCents: 25000, counterparty: 'Schule & Co', iban: 'AT123456', reference: 'RE2026-00001' })]);
    expect(r.uebersprungen).toHaveLength(1);
  });

  it('schlägt Rechnung über Nummer und Betrag vor', () => {
    const v = vorschlaege({ amountCents: 25000, counterparty: 'Schule', reference: 'RE2026-00001' }, { rechnungen: [{ id: 'r1', number: 'RE2026-00001', grossCents: 25000, name: 'Schule' }, { id: 'r2', number: 'RE2026-00002', grossCents: 9900, name: 'X' }], belege: [] });
    expect(v).toEqual([expect.objectContaining({ id: 'r1', stark: true })]);
  });
});

describe('Hilfen', () => {
  it('euroZuCent', () => {
    expect(euroZuCent('1.234,56')).toBe(123456);
    expect(euroZuCent('1234.5')).toBe(123450);
    expect(euroZuCent('12')).toBe(1200);
    expect(euroZuCent('-3,10 €')).toBe(-310);
    expect(euroZuCent('abc')).toBeNull();
    expect(dezimal(-5)).toBe('-0,05');
  });
  it('Zeitraum und Geschäftsjahr', () => {
    expect(zeitraum({ monat: '2026-02' })).toEqual({ von: '2026-02-01', bis: '2026-02-28' });
    expect(zeitraum({ von: '2026-03-01', bis: '2026-03-15' })).toEqual({ von: '2026-03-01', bis: '2026-03-15' });
    expect(gjBeginn('2026-03-10', 7)).toBe('2025-07-01');
  });
  it('manuelle Zeile mit Steuercode brutto spaltet die Steuer ab', () => {
    const z = manuelleZeilen([
      { konto: '2800', soll: 12000, haben: 0, vatCode: null, brutto: false },
      { konto: '4200', soll: 0, haben: 12000, vatCode: 'U20', brutto: true },
    ]);
    expect(z).toEqual([
      expect.objectContaining({ konto: '2800', soll: 12000, haben: 0 }),
      expect.objectContaining({ konto: '4200', soll: 0, haben: 10000, vatCode: 'U20', base: 10000 }),
      expect.objectContaining({ konto: '3500', soll: 0, haben: 2000 }),
    ]);
    const v = manuelleZeilen([{ konto: '7600', soll: 1100, haben: 0, vatCode: 'V10', brutto: true }]);
    expect(v).toEqual([expect.objectContaining({ konto: '7600', soll: 1000, base: 1000 }), expect.objectContaining({ konto: '2500', soll: 100, vatCode: 'V10', base: 1000 })]);
  });
  it('Rechnungsbuchung je Steuersatz und Storno', () => {
    const items = [{ title: 'Gruppe', quantity: 30, unitCents: 2000, vatRate: 13 }, { title: 'Sekt', quantity: 30, unitCents: 500, vatRate: 20 }];
    const z = rechnungsZeilen(items);
    expect(z[0]).toEqual({ konto: '2000', soll: 60000 + 7800 + 15000 + 3000 });
    expect(z).toContainEqual(expect.objectContaining({ konto: '4000', haben: 60000, vatCode: 'U13', base: 60000 }));
    expect(z).toContainEqual(expect.objectContaining({ konto: '3502', haben: 7800 }));
    expect(z).toContainEqual(expect.objectContaining({ konto: '4200', haben: 15000, vatCode: 'U20' }));
    const s = rechnungsZeilen(items, -1);
    expect(s[0].soll).toBe(-85800);
    expect(s).toContainEqual(expect.objectContaining({ konto: '4000', haben: -60000, base: -60000 }));
  });
  it('Steueraufstellung bei Bruttopreisen (Tickets)', () => {
    const st = steuerAufstellung({ items: [{ title: 'Ticket', quantity: 2, unitCents: 2800, vatRate: 13 }], bruttoPreise: true, netCents: 4956, vatCents: 644, grossCents: 5600 });
    expect(st.gruppen).toEqual([{ rate: 13, net: 4956, vat: 644, gross: 5600 }]);
  });
});
