import { describe, expect, it } from 'vitest';
import type { Account, Transaction } from '../types/index.ts';
import { calculateAccountBalanceAt, calculateRealAccountBalance, firstBookedAccountDate, monthEndBalances } from '../lib/db.ts';
import { summarizeMonth } from '../lib/monthSummary.ts';
import { DEFAULT_CATEGORIES } from '../data/defaults.ts';
import { currentMonth, dashboardPreferencesStorageKey, monthEndDate, readDashboardPreferences } from '../lib/dashboardPreferences.ts';

function tx(date: string, amount: number, extra: Partial<Transaction> = {}): Transaction {
  return { date, amount, currency: 'EUR', payee: 'Test', purpose: '', rawText: '', type: '', category: 'sonstiges',
    account: 'Girokonto', importedAt: '', sourceHash: `t-${date}-${amount}`, status: 'booked', ...extra };
}
const base: Account = { id: 'giro', name: 'Girokonto', initialBalance: 1000, initialBalanceDate: '2026-01-01' };
const txs = [tx('2026-09-30', -100), tx('2026-10-01', 3000), tx('2026-10-31', -500.55), tx('2026-11-02', -200),
  tx('2026-10-15', -999, { status: 'pending' }), tx('2026-10-10', -50, { account: 'Fremdkonto' })];

describe('Kontostand zum Monatsende', () => {
  it('rechnet ab Startsaldo bis einschließlich Stichtag', () => {
    expect(calculateAccountBalanceAt(base, txs, '2026-09-30')).toBe(900);
    expect(calculateAccountBalanceAt(base, txs, '2026-10-31')).toBe(3399.45);
  });
  it('kennt vor dem Startsaldo keinen Kontostand', () => {
    expect(calculateAccountBalanceAt(base, txs, '2025-12-31')).toBeNull();
  });
  it('rechnet vom comdirect-Kontrollpunkt vorwärts und rückwärts', () => {
    const account = { ...base, checkpointBalance: 3199.45, checkpointDate: '2026-11-02' };
    expect(calculateAccountBalanceAt(account, txs, '2026-11-02')).toBe(3199.45);
    expect(calculateAccountBalanceAt(account, txs, '2026-10-31')).toBe(3399.45);
    expect(calculateAccountBalanceAt(account, txs, '2026-09-30')).toBe(900);
    // Vor dem Startsaldo bleibt der Kontrollpunkt die Quelle.
    expect(calculateAccountBalanceAt(account, txs, '2025-12-31')).toBe(1000);
  });
  it('stimmt am letzten Buchungstag mit dem aktuellen Kontostand überein', () => {
    expect(calculateAccountBalanceAt(base, txs, '2026-11-30')).toBe(calculateRealAccountBalance(base, txs));
  });
  it('liefert Monatsende inklusive Schaltjahr', () => {
    expect(monthEndDate('2028-02')).toBe('2028-02-29');
    expect(monthEndDate('2026-02')).toBe('2026-02-28');
    expect(monthEndDate('2026-12')).toBe('2026-12-31');
    expect(currentMonth(new Date(2026, 0, 1))).toBe('2026-01');
  });
});

describe('Übersicht-Einstellung', () => {
  it('zeigt das Monatsergebnis standardmäßig und fällt bei defekten Werten darauf zurück', () => {
    const standard = { showMonthResult: true, savingsMode: 'netted' };
    expect(readDashboardPreferences(null)).toEqual(standard);
    expect(readDashboardPreferences('{"showMonthResult":"nein"}')).toEqual(standard);
    expect(readDashboardPreferences('kaputt')).toEqual(standard);
    expect(readDashboardPreferences('{"showMonthResult":false}')).toEqual({ showMonthResult: false, savingsMode: 'netted' });
    expect(readDashboardPreferences('{"showMonthResult":true,"savingsMode":"transfer"}')).toEqual({ showMonthResult: true, savingsMode: 'transfer' });
    expect(readDashboardPreferences('{"showMonthResult":true,"savingsMode":"egal"}')).toEqual(standard);
  });
  it('trennt Profile und Plattformen', () => {
    expect(dashboardPreferencesStorageKey('a', 'web')).not.toBe(dashboardPreferencesStorageKey('a', 'ios'));
    expect(dashboardPreferencesStorageKey('a', 'web')).not.toBe(dashboardPreferencesStorageKey('b', 'web'));
  });
});

describe('Kontostand-Verlauf', () => {
  it('liefert Monatsenden, laufenden Monat mit aktuellem Stand und keine Zukunft', () => {
    const series = monthEndBalances(base, txs, '2026-12', 4, new Date(2026, 10, 4));
    expect(series.map(point => point.month)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(series.map(point => point.balance)).toEqual([900, 3399.45, calculateRealAccountBalance(base, txs)]);
    expect(series.map(point => point.current)).toEqual([false, false, true]);
  });
  it('überspringt den Jahreswechsel korrekt und kennzeichnet Monate vor dem Startsaldo', () => {
    const series = monthEndBalances(base, txs, '2026-02', 3, new Date(2026, 10, 4));
    expect(series.map(point => point.month)).toEqual(['2025-12', '2026-01', '2026-02']);
    expect(series[0].balance).toBeNull();
    expect(series[1].date).toBe('2026-01-31');
  });
  it('findet die erste gebuchte Buchung des Kontos', () => {
    expect(firstBookedAccountDate(base, txs)).toBe('2026-09-30');
    expect(firstBookedAccountDate(base, [tx('2026-01-05', 1, { status: 'pending' })])).toBeNull();
  });
});

describe('Sparen & Investieren in der Übersicht', () => {
  // Sparen -500, Rückübertrag +510: unterm Strich +10 in der Sparkategorie.
  const month = [tx('2026-10-01', 3000, { category: 'gehalt' }), tx('2026-10-02', -800, { category: 'wohnen' }),
    tx('2026-10-03', -500, { category: 'investieren' }), tx('2026-10-20', 510, { category: 'investieren' })];
  it('verrechnet standardmäßig wie bisher: Plus zählt als Einnahme, Kategorie fehlt', () => {
    const summary = summarizeMonth(month, DEFAULT_CATEGORIES);
    expect(summary).toMatchObject({ income: 3010, expense: 800, balance: 2210, surplusSlices: [] });
    expect(summary.categorySlices.map(slice => slice.id)).toEqual(['wohnen']);
  });
  it('zeigt im Überschuss-Modus die Kategorie, ohne Summen zu ändern', () => {
    const summary = summarizeMonth(month, DEFAULT_CATEGORIES, 'surplus');
    expect(summary).toMatchObject({ income: 3010, expense: 800, balance: 2210 });
    expect(summary.surplusSlices).toMatchObject([{ id: 'investieren', value: 10 }]);
  });
  it('lässt Sparbuchungen als Umbuchung ganz heraus', () => {
    const summary = summarizeMonth(month, DEFAULT_CATEGORIES, 'transfer');
    expect(summary).toMatchObject({ income: 3000, expense: 800, balance: 2200, surplusSlices: [] });
  });
  it('zeigt reines Sparen weiterhin als Ausgabe', () => {
    const summary = summarizeMonth([tx('2026-10-03', -500, { category: 'investieren' })], DEFAULT_CATEGORIES, 'surplus');
    expect(summary.categorySlices).toMatchObject([{ id: 'investieren', value: 500 }]);
    expect(summary.surplusSlices).toEqual([]);
  });
});
