import { describe, expect, it } from 'vitest';
import { buildDemoTransactions, DEMO_MONTHS } from '../lib/demoData.ts';
import { DEFAULT_ACCOUNT, DEFAULT_CATEGORIES } from '../data/defaults.ts';

const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('buildDemoTransactions', () => {
  it('liefert den laufenden Monat bis heute und zwei volle Vormonate', () => {
    const today = new Date(2026, 11, 10);
    const txs = buildDemoTransactions(today, 'fixed');
    const months = [...new Set(txs.map(t => t.date!.slice(0, 7)))];
    expect(months).toEqual(['2026-10', '2026-11', '2026-12']);
    expect(months).toHaveLength(DEMO_MONTHS);
    expect(txs.every(t => t.date! <= key(today))).toBe(true);
    expect(txs.some(t => t.date === '2026-12-01' && t.category === 'gehalt' && t.amount! > 0)).toBe(true);
    expect(txs.filter(t => t.date!.startsWith('2026-11')).length).toBeGreaterThan(10);
  });

  it('hat am Monatsersten nur das Gehalt im laufenden Monat und überschreitet den Jahreswechsel', () => {
    const txs = buildDemoTransactions(new Date(2027, 0, 1), 'fixed');
    expect([...new Set(txs.map(t => t.date!.slice(0, 7)))]).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(txs.filter(t => t.date!.startsWith('2027-01')).map(t => t.category)).toEqual(['gehalt']);
  });

  it('ist deterministisch, eindeutig und nutzt nur Standardkategorien und das Standardkonto', () => {
    const today = new Date(2026, 10, 6);
    const a = buildDemoTransactions(today, 'fixed');
    expect(buildDemoTransactions(today, 'fixed')).toEqual(a);
    expect(new Set(a.map(t => t.sourceHash)).size).toBe(a.length);
    const ids = new Set(DEFAULT_CATEGORIES.map(c => c.id));
    expect(a.every(t => ids.has(t.category!))).toBe(true);
    expect(a.every(t => t.accountId === DEFAULT_ACCOUNT.id && t.status === 'booked')).toBe(true);
  });
});
