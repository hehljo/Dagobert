import type { Category, Transaction } from '../types/index.ts';
import { isValidCalendarDate } from './csvParser.ts';

export interface StatisticsPeriod {
  year: number;
  month?: number;
}

export interface MonthlyStatistics {
  month: number;
  income: number;
  expense: number;
  net: number;
}

export interface CategoryStatistics {
  id: string;
  name: string;
  icon: string;
  color: string;
  amount: number;
  share: number;
  count: number;
  transactions: Transaction[];
}

function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split('-').map(Number);
  return isValidCalendarDate(year, month, day);
}

function amountInCents(amount: number): number {
  return Math.sign(amount) * Math.round((Math.abs(amount) + Number.EPSILON) * 100);
}

export function getStatisticsYears(transactions: Transaction[], currentYear: number): number[] {
  return [...new Set([currentYear, ...transactions
    .filter(t => validDate(t.date))
    .map(t => Number(t.date.slice(0, 4)))])].sort((a, b) => b - a);
}

export function largestTransactions(transactions: Transaction[]): Transaction[] {
  return [...transactions].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)
    || b.date.localeCompare(a.date) || (b.id ?? 0) - (a.id ?? 0));
}

export function calculateStatistics(
  transactions: Transaction[],
  categories: Category[],
  period: StatisticsPeriod,
) {
  const eligible = transactions.filter(t => validDate(t.date)
    && Number(t.date.slice(0, 4)) === period.year
    && (t.status === 'booked' || t.status === undefined)
    && t.currency === 'EUR'
    && Number.isFinite(t.amount)
    && Number.isSafeInteger(amountInCents(t.amount)));
  const selected = eligible.filter(t => period.month === undefined || Number(t.date.slice(5, 7)) === period.month);
  const monthCents = Array.from({ length: 12 }, (_, index) => ({ month: index + 1, income: 0, expense: 0 }));
  for (const transaction of eligible) {
    const month = monthCents[Number(transaction.date.slice(5, 7)) - 1];
    const cents = amountInCents(transaction.amount);
    if (cents > 0) month.income += cents;
    if (cents < 0) month.expense -= cents;
  }
  const months: MonthlyStatistics[] = monthCents.map(m => ({
    month: m.month, income: m.income / 100, expense: m.expense / 100, net: (m.income - m.expense) / 100,
  }));
  const incomeCents = selected.reduce((sum, t) => sum + Math.max(0, amountInCents(t.amount)), 0);
  const expenseCents = selected.reduce((sum, t) => sum + Math.max(0, -amountInCents(t.amount)), 0);

  const categoryTotals = (direction: 'income' | 'expense'): CategoryStatistics[] => {
    const groups = new Map(categories.map(category => [category.id, {
      id: category.id, name: category.name, icon: category.icon, color: category.color,
      cents: 0, transactions: [] as Transaction[],
    }]));
    for (const transaction of selected) {
      const cents = amountInCents(transaction.amount);
      if (direction === 'income' ? cents <= 0 : cents >= 0) continue;
      const id = transaction.category || 'sonstiges';
      const group = groups.get(id) ?? {
        id, name: id, icon: 'Package', color: '#8E8E93', cents: 0, transactions: [] as Transaction[],
      };
      group.cents += Math.abs(cents);
      group.transactions.push(transaction);
      groups.set(id, group);
    }
    const total = direction === 'income' ? incomeCents : expenseCents;
    return [...groups.values()].map(group => ({
      id: group.id, name: group.name, icon: group.icon, color: group.color,
      amount: group.cents / 100,
      share: total > 0 ? group.cents / total * 100 : 0,
      count: group.transactions.length,
      transactions: largestTransactions(group.transactions),
    })).sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'de'));
  };

  return {
    transactions: selected,
    income: incomeCents / 100,
    expense: expenseCents / 100,
    net: (incomeCents - expenseCents) / 100,
    averageMonthlyIncome: incomeCents / 1200,
    averageMonthlyExpense: expenseCents / 1200,
    months,
    expenseCategories: categoryTotals('expense'),
    incomeCategories: categoryTotals('income'),
    topExpenses: largestTransactions(selected.filter(t => amountInCents(t.amount) < 0)).slice(0, 10),
  };
}
