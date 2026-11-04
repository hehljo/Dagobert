import { describe, expect, it } from 'vitest';
import type { Transaction } from '../types/index.ts';
import { DEFAULT_CATEGORIES } from '../data/defaults.ts';
import { calculateRealAccountBalance } from '../lib/db.ts';
import { calculateStatistics } from '../lib/statistics.ts';
import { DEFAULT_SALARY_BUDGET, budgetPeriod, dayBefore, isSalaryBudgetPreferences, readSalaryBudgetPreferences, salaryBudgetStorageKey, transactionBudgetMonth } from '../lib/salaryBudget.ts';

const preference = { enabled: true, startDay: 25 };
function transaction(date: string, amount = 3000, extra: Partial<Transaction> = {}): Transaction {
  return { date, amount, currency: 'EUR', payee: 'Arbeitgeber', purpose: 'Gehalt', rawText: 'Gehalt', type: '',
    category: 'gehalt', account: 'Testkonto', importedAt: '', sourceHash: `test-${date}-${amount}`, status: 'booked', ...extra };
}

describe('Gehaltszuordnung zum Budgetmonat', () => {
  it.each(['2026-10-25', '2026-10-27', '2026-10-30', '2026-10-31'])('ordnet variable Zahltage ab dem Stichtag einschließlich zu: %s', date => {
    expect(transactionBudgetMonth(transaction(date), preference)).toBe('2026-11');
  });
  it.each(['2026-10-01', '2026-10-24'])('belässt frühere Zahlungen im Buchungsmonat: %s', date => {
    expect(transactionBudgetMonth(transaction(date), preference)).toBe('2026-10');
  });
  it('ist standardmäßig aus und lässt sich ohne Datenänderung abschalten', () => {
    expect(DEFAULT_SALARY_BUDGET).toEqual({ enabled: false, startDay: 25 });
    expect(transactionBudgetMonth(transaction('2026-10-30'), DEFAULT_SALARY_BUDGET)).toBe('2026-10');
  });
  it.each([
    ['2026-02-27', 31, '2026-02'], ['2026-02-28', 31, '2026-03'],
    ['2024-02-28', 30, '2024-02'], ['2024-02-29', 30, '2024-03'],
    ['2026-04-29', 31, '2026-04'], ['2026-04-30', 31, '2026-05'],
    ['2026-12-25', 25, '2027-01'], ['2026-10-01', 1, '2026-11'],
  ])('behandelt Monatslängen, Schaltjahr und Jahreswechsel: %s ab %s', (date, startDay, expected) => {
    expect(transactionBudgetMonth(transaction(date), { enabled: true, startDay })).toBe(expected);
  });
  it.each([
    { category: 'rueckerstattung' }, { category: 'sonstiges' }, { amount: -100 }, { amount: 0 },
    { status: 'pending' as const }, { status: 'invalid' as Transaction['status'] }, { currency: 'USD' },
    { amount: NaN }, { amount: Infinity },
  ])('verschiebt ausschließlich positive gebuchte EUR-Gehaltszahlungen: %j', extra => {
    expect(transactionBudgetMonth(transaction('2026-10-30', 3000, extra), preference)).toBe('2026-10');
  });
  it('akzeptiert ältere Buchungen ohne expliziten Status', () => {
    expect(transactionBudgetMonth(transaction('2026-10-30', 3000, { status: undefined }), preference)).toBe('2026-11');
  });
  it.each(['2026-02-30', '2026-13-25', '2026-10-99', '2026-10-2x'])('korrigiert keine ungültigen Bankdaten: %s', date => {
    expect(transactionBudgetMonth(transaction(date), preference)).toBe(date.slice(0, 7));
  });
  it('zählt jede Zahlung genau einmal und verändert weder Daten noch Kontostand oder Kalenderstatistik', () => {
    const transactions = [transaction('2026-10-30'), transaction('2026-11-02', -2000, { category: 'wohnen' }),
      transaction('2026-11-28'), transaction('2026-11-05', 100, { category: 'rueckerstattung' })];
    const before = structuredClone(transactions);
    const account = { id: 'test', name: 'Testkonto', initialBalance: 0, initialBalanceDate: '2026-01-01' };
    const balance = calculateRealAccountBalance(account, transactions);
    const budget = (month: string) => transactions.filter(t => transactionBudgetMonth(t, preference) === month);
    expect(budget('2026-11').reduce((sum, t) => sum + t.amount, 0)).toBe(1100);
    expect(budget('2026-10')).toHaveLength(0);
    expect(budget('2026-12')).toHaveLength(1);
    expect(['2026-10', '2026-11', '2026-12'].flatMap(budget)).toHaveLength(transactions.length);
    expect(transactions).toEqual(before);
    expect(calculateRealAccountBalance(account, transactions)).toBe(balance);
    expect(calculateStatistics(transactions, DEFAULT_CATEGORIES, { year: 2026, month: 10 }).income).toBe(3000);
    expect(calculateStatistics(transactions, DEFAULT_CATEGORIES, { year: 2026, month: 11 }).income).toBe(3100);
  });
});

describe('Gespeicherte Monatsansicht', () => {
  it('trennt Profil- und Plattformschlüssel eindeutig', () => {
    const keys = [salaryBudgetStorageKey('haushalt', 'web'), salaryBudgetStorageKey('firma', 'web'),
      salaryBudgetStorageKey('haushalt', 'ios'), salaryBudgetStorageKey('web,haushalt', 'ios')];
    expect(new Set(keys).size).toBe(keys.length);
  });
  it.each([null, '', '{kaputt', 'null', '[]', '{"enabled":"true","startDay":25}',
    '{"enabled":true,"startDay":0}', '{"enabled":true,"startDay":32}', '{"enabled":true,"startDay":25.5}',
    '{"enabled":true,"startDay":"25"}', '{"enabled":true}'])('fällt bei fehlenden oder defekten Einstellungen sicher auf Kalender zurück: %s', raw => {
    expect(readSalaryBudgetPreferences(raw)).toEqual(DEFAULT_SALARY_BUDGET);
  });
  it('liest nur gültige Einstellungen und übernimmt keine fremden Felder', () => {
    expect(readSalaryBudgetPreferences('{"enabled":true,"startDay":28,"extra":123}')).toEqual({ enabled: true, startDay: 28 });
    expect(isSalaryBudgetPreferences({ enabled: true, startDay: 31 })).toBe(true);
    expect(transactionBudgetMonth(transaction('2026-10-30'), { enabled: true, startDay: 0 })).toBe('2026-10');
  });
});

describe('Budgetmonat von Gehalt zu Gehalt', () => {
  const pay = [transaction('2026-10-24', 400), transaction('2026-10-27', 3000), transaction('2026-11-26', 3100),
    transaction('2026-11-05', -80, { category: 'lebensmittel' })];
  it('beginnt mit dem ersten verschobenen Gehalt und endet vor dem nächsten', () => {
    expect(budgetPeriod('2026-11', pay, preference)).toEqual({ start: '2026-10-27', end: '2026-11-26' });
  });
  it('fällt ohne Gehalt auf die Monatsgrenze zurück', () => {
    expect(budgetPeriod('2026-12', pay, preference)).toEqual({ start: '2026-11-26', end: '2027-01-01' });
    expect(budgetPeriod('2026-11', pay, { enabled: false, startDay: 25 })).toEqual({ start: '2026-11-01', end: '2026-12-01' });
  });
  it('lässt Gehalt vor dem Stichtag im laufenden Zeitraum', () => {
    expect(budgetPeriod('2026-10', pay, preference)).toEqual({ start: '2026-10-01', end: '2026-10-27' });
  });
  it('rechnet den Vortag über Monats- und Jahresgrenzen', () => {
    expect(dayBefore('2027-01-01')).toBe('2026-12-31');
    expect(dayBefore('2028-03-01')).toBe('2028-02-29');
  });
});
