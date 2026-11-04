import { describe, it, expect } from 'vitest';
import { COMDIRECT_SOURCE, mapComdirectTransactions, possibleCrossSourceDuplicate, readAllComdirectTransactions } from '../lib/bankImport.ts';
import type { BankTransaction } from '../lib/bankImport.ts';
import type { Transaction } from '../types/index.ts';

const bank: BankTransaction = { reference: 'reference-1', bookingStatus: 'BOOKED', bookingDate: '2026-11-03',
  amount: { value: '-12.34', unit: 'EUR' }, creditor: { holderName: 'Testgeschäft' }, remittanceInfo: 'Synthetischer Einkauf' };
const existing: Transaction = { date: '2026-11-02', amount: -12.34, currency: 'EUR', payee: 'Mein eigener Text',
  purpose: 'Manuell bearbeitet', rawText: 'Original CSV', type: 'Karte', category: 'freizeit', account: 'Giro',
  importedAt: '2026-11-02T00:00:00Z', sourceHash: 'tx_csv1', status: 'booked' };

describe('comdirect import with existing CSV data', () => {
  it('maps exact cents, creditor and documented invalid valuta date without touching the source', () => {
    const input = { ...bank, valutaDate: '2026-11-32' };
    const before = JSON.stringify(input);
    const row = mapComdirectTransactions([input], 'bank-1')[0];
    expect(row.amount).toBe(-12.34); expect(row.payee).toBe('Testgeschäft'); expect(row.valutaDate).toBeUndefined();
    expect(JSON.stringify(input)).toBe(before);
  });
  it('identifies a bank reference across changing descriptions and booking dates, scoped to the bank account', () => {
    const original = mapComdirectTransactions([bank], 'bank-1')[0];
    const changed = mapComdirectTransactions([{ ...bank, bookingDate: '2026-11-04', remittanceInfo: 'Anderer Banktext' }], 'bank-1')[0];
    expect(original.sourceHash).toBe(changed.sourceHash);
    expect(original.sourceHash).not.toBe(mapComdirectTransactions([bank], 'bank-2')[0].sourceHash);
  });
  it('protects historical CSV entries even if text or amounts have been edited, with no mutation', () => {
    const row = mapComdirectTransactions([{ ...bank, bookingDate: '2026-11-01' }], 'bank-1')[0];
    const snapshot = JSON.stringify(existing);
    expect(possibleCrossSourceDuplicate(row, 'Giro', [existing])).toBe(true);
    expect(possibleCrossSourceDuplicate(row, 'Anderes Konto', [existing])).toBe(false);
    expect(possibleCrossSourceDuplicate(row, 'Giro', [{ ...existing, isManual: true }])).toBe(false);
    expect(possibleCrossSourceDuplicate(mapComdirectTransactions([bank], 'bank-1')[0], 'Giro', [existing])).toBe(false);
    expect(JSON.stringify(existing)).toBe(snapshot);
  });
  it('also protects the historical range when CSV follows the API', () => {
    const row = { ...mapComdirectTransactions([bank], 'bank-1')[0], sourceHash: 'tx_csv2' };
    expect(possibleCrossSourceDuplicate(row, 'Giro', [{ ...existing, date: '2026-11-04', sourceHash: COMDIRECT_SOURCE + '["bank-1","ref"]' }])).toBe(true);
  });
  it('reads every page before returning data', async () => {
    const offsets: number[] = [];
    const values = await readAllComdirectTransactions(async first => {
      offsets.push(first);
      return { paging: { index: first, matches: 2 }, values: [{ ...bank, reference: `reference-${first}` }] };
    });
    expect(offsets).toEqual([0, 1]); expect(values.length).toBe(2);
  });
  it('rejects incomplete or changing pagination without returning a partial import', async () => {
    await expect(readAllComdirectTransactions(async first => ({ paging: { index: first, matches: 2 }, values: first === 0 ? [bank] : [] }))).rejects.toThrow();
    await expect(readAllComdirectTransactions(async first => ({ paging: { index: first, matches: first === 0 ? 2 : 3 }, values: [bank] }))).rejects.toThrow();
    await expect(readAllComdirectTransactions(async () => ({ values: [bank] }))).rejects.toThrow();
  });
  it('rejects pending, malformed money, foreign currency, invalid dates and repeated references as a whole', () => {
    for (const broken of [{ ...bank, bookingStatus: 'NOTBOOKED' }, { ...bank, bookingDate: '2026-02-31' },
      { ...bank, amount: { value: '12.345', unit: 'EUR' } }, { ...bank, amount: { value: '-12.34', unit: 'USD' } },
      { ...bank, reference: '' }]) expect(() => mapComdirectTransactions([bank, broken], 'bank-1')).toThrow();
    expect(() => mapComdirectTransactions([bank, bank], 'bank-1')).toThrow();
  });
});
