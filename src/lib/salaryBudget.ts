import type { Transaction } from '../types/index.ts';
import { isValidCalendarDate } from './csvParser.ts';

export const SALARY_CATEGORY_ID = 'gehalt';
export interface SalaryBudgetPreferences {
  enabled: boolean;
  startDay: number;
}
export const DEFAULT_SALARY_BUDGET: Readonly<SalaryBudgetPreferences> = Object.freeze({ enabled: false, startDay: 25 });

export function isSalaryBudgetPreferences(value: unknown): value is SalaryBudgetPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const preference = value as Partial<SalaryBudgetPreferences>;
  return typeof preference.enabled === 'boolean' && typeof preference.startDay === 'number'
    && Number.isInteger(preference.startDay) && preference.startDay >= 1 && preference.startDay <= 31;
}

export function readSalaryBudgetPreferences(raw: string | null): SalaryBudgetPreferences {
  try {
    const value: unknown = JSON.parse(raw || 'null');
    if (isSalaryBudgetPreferences(value)) return { enabled: value.enabled, startDay: value.startDay };
  } catch { /* Invalid local preferences use the calendar view. */ }
  return { ...DEFAULT_SALARY_BUDGET };
}

export function salaryBudgetStorageKey(profileId: string, platform: 'web' | 'ios'): string {
  return `dagobert_salary_budget_${JSON.stringify([platform, profileId])}`;
}

/** View-only assignment. Never change the bank date, balance or source identity. */
export function transactionBudgetMonth(transaction: Transaction, preference: SalaryBudgetPreferences): string {
  const month = transaction.date.slice(0, 7);
  if (!isSalaryBudgetPreferences(preference) || !preference.enabled || transaction.category !== SALARY_CATEGORY_ID
    || !Number.isFinite(transaction.amount) || transaction.amount <= 0 || transaction.currency !== 'EUR'
    || (transaction.status !== undefined && transaction.status !== 'booked')
    || !/^\d{4}-\d{2}-\d{2}$/.test(transaction.date)) return month;
  const [year, number, day] = transaction.date.split('-').map(Number);
  if (!isValidCalendarDate(year, number, day)) return month;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lastDay = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][number - 1];
  if (day < Math.min(preference.startDay, lastDay)) return month;
  return `${String(number === 12 ? year + 1 : year).padStart(4, '0')}-${String(number === 12 ? 1 : number + 1).padStart(2, '0')}`;
}

function nextCalendarMonth(month: string): string {
  const [year, number] = month.split('-').map(Number);
  return `${String(number === 12 ? year + 1 : year).padStart(4, '0')}-${String(number === 12 ? 1 : number + 1).padStart(2, '0')}`;
}

/**
 * First day of budget month `month`: the earliest salary that moved into it (paid in the previous
 * calendar month on/after the cut-off day). Without such a salary the calendar month boundary applies.
 */
export function budgetPeriodStart(month: string, transactions: Transaction[], preference: SalaryBudgetPreferences): string {
  const calendarStart = `${month}-01`;
  let start = calendarStart;
  for (const transaction of transactions) {
    if (transaction.date < start && transaction.date.slice(0, 7) !== month
      && transactionBudgetMonth(transaction, preference) === month) start = transaction.date;
  }
  return start;
}

/** Salary-to-salary period of a budget month: `start` inclusive, `end` exclusive (YYYY-MM-DD). View-only. */
export function budgetPeriod(month: string, transactions: Transaction[], preference: SalaryBudgetPreferences): { start: string; end: string } {
  return { start: budgetPeriodStart(month, transactions, preference), end: budgetPeriodStart(nextCalendarMonth(month), transactions, preference) };
}

/** YYYY-MM-DD of the day before `date`. */
export function dayBefore(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day - 1));
  return previous.toISOString().slice(0, 10);
}
