import { describe, expect, it } from 'vitest';
import type { Category, Transaction } from '../types/index.ts';
import { calculateStatistics, getStatisticsYears, largestTransactions } from '../lib/statistics.ts';

const categories: Category[] = [
  { id: 'food', name: 'Lebensmittel', icon: 'ShoppingCart', color: '#30D158', type: 'expense' },
  { id: 'salary', name: 'Gehalt', icon: 'Briefcase', color: '#32D74B', type: 'income' },
  { id: 'unused', name: 'Ohne Buchungen', icon: 'Package', color: '#8E8E93', type: 'expense' },
];
let id = 0;
function transaction(amount: number, date: string, extra: Partial<Transaction> = {}): Transaction {
  return { id: ++id, amount, date, currency: 'EUR', payee: 'Test', purpose: '', rawText: '', type: '',
    category: amount < 0 ? 'food' : 'salary', account: 'Testkonto', sourceHash: String(id), importedAt: '', status: 'booked', ...extra };
}

describe('Statistics', () => {
  it('calculates a full year, all twelve months, net and twelve-month averages', () => {
    const result = calculateStatistics([
      transaction(2400, '2025-01-01'), transaction(-120, '2025-01-31'),
      transaction(1200, '2025-12-31'), transaction(-480, '2025-12-31'),
      transaction(-1000, '2024-12-31'), transaction(999, '2026-01-01'),
    ], categories, { year: 2025 });
    expect([result.income, result.expense, result.net]).toEqual([3600, 600, 3000]);
    expect([result.averageMonthlyIncome, result.averageMonthlyExpense]).toEqual([300, 50]);
    expect(result.months).toHaveLength(12);
    expect(result.months[0]).toEqual({ month: 1, income: 2400, expense: 120, net: 2280 });
    expect(result.months[1]).toEqual({ month: 2, income: 0, expense: 0, net: 0 });
    expect(result.months[11].net).toBe(720);
  });

  it('filters months and year boundaries, retaining the full-year monthly comparison', () => {
    const result = calculateStatistics([transaction(-10, '2025-01-31'), transaction(-20, '2025-02-01'), transaction(-30, '2026-01-01')], categories, { year: 2025, month: 2 });
    expect(result.expense).toBe(20);
    expect(result.transactions).toHaveLength(1);
    expect(result.months[0].expense).toBe(10);
  });

  it('excludes pending, unsupported status, foreign currency and malformed records, accepting legacy booked records', () => {
    const result = calculateStatistics([
      transaction(-10, '2024-02-29', { status: undefined }), transaction(-900, '2024-03-01', { status: 'pending' }),
      transaction(100, '2024-03-01', { currency: 'USD' }), transaction(-50, '2024-02-30'),
      transaction(-80, '2024-13-01'), transaction(NaN, '2024-01-01'), transaction(Infinity, '2024-01-01'),
      transaction(-10, '2024-01-01', { status: 'invalid' as Transaction['status'] }),
    ], categories, { year: 2024 });
    expect(result.expense).toBe(10);
    expect(result.transactions).toHaveLength(1);
  });

  it('totals monetary amounts in cents and separates income and expense in the same category', () => {
    const result = calculateStatistics([transaction(-0.1, '2025-01-01'), transaction(-0.2, '2025-01-02'), transaction(0.1, '2025-01-03', { category: 'food' })], categories, { year: 2025 });
    expect(result.expense).toBe(0.3);
    expect(result.net).toBe(-0.2);
    expect(result.expenseCategories[0].amount).toBe(0.3);
    expect(result.expenseCategories[0].count).toBe(2);
    expect(result.incomeCategories[0].amount).toBe(0.1);
    expect(result.incomeCategories[0].count).toBe(1);
  });

  it('ranks every category, including missing definitions and zero totals, with correct shares', () => {
    const result = calculateStatistics([transaction(-75, '2025-01-01'), transaction(-25, '2025-01-01', { category: 'deleted-category' })], categories, { year: 2025 });
    expect(result.expenseCategories).toHaveLength(4);
    expect(result.expenseCategories[0]).toMatchObject({ id: 'food', share: 75, count: 1 });
    expect(result.expenseCategories[1]).toMatchObject({ id: 'deleted-category', share: 25 });
    expect(result.expenseCategories.find(c => c.id === 'unused')).toMatchObject({ amount: 0, share: 0, count: 0 });
  });

  it('ranks the top ten expenses by magnitude without including incomes or mutating input', () => {
    const input = Array.from({ length: 12 }, (_, index) => transaction(-(index + 1), '2025-01-01'));
    input.push(transaction(100000, '2025-01-01'));
    const original = [...input];
    const result = calculateStatistics(input, categories, { year: 2025 });
    expect(result.topExpenses.map(t => t.amount)).toEqual([-12, -11, -10, -9, -8, -7, -6, -5, -4, -3]);
    expect(input).toEqual(original);
    expect(largestTransactions(input)[0].amount).toBe(100000);
  });

  it('handles empty periods and lists available years without duplicates or invalid dates', () => {
    const result = calculateStatistics([], categories, { year: 2025 });
    expect(result.net).toBe(0);
    expect(result.topExpenses).toEqual([]);
    expect(result.expenseCategories.every(c => c.share === 0)).toBe(true);
    expect(getStatisticsYears([transaction(-1, '2023-01-01'), transaction(-1, '2025-01-01'), transaction(-1, '2025-02-30')], 2025)).toEqual([2025, 2023]);
  });
});
