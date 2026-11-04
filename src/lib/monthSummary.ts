import type { Category, Transaction } from '../types/index.ts';
import type { SavingsMode } from './dashboardPreferences.ts';

export const SAVINGS_CATEGORY_ID = 'investieren';

export interface CategorySlice { id: string; label: string; value: number; color: string; icon?: string }
export interface MonthSummary {
  income: number; expense: number; balance: number; savingsRate: number;
  /** Net expenses per category, largest first. */
  categorySlices: CategorySlice[];
  /** Savings category with net inflow (mode "surplus" only); amounts already counted as income. */
  surplusSlices: CategorySlice[];
}

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * Monthly cashflow totals with net category expenses. Refunds in expense/transfer categories offset
 * that category; a net inflow counts as income. `savingsMode` only changes the savings category:
 * "netted" (default) as before, "surplus" also lists its net inflow, "transfer" leaves it out entirely.
 */
export function summarizeMonth(transactions: Transaction[], categories: Category[], savingsMode: SavingsMode = 'netted'): MonthSummary {
  const catMap = new Map(categories.map(c => [c.id, c]));
  const netCategoryMap = new Map<string, number>();
  let grossIncome = 0;
  let totalBal = 0;
  for (const t of transactions) {
    const catId = t.category || 'sonstiges';
    if (savingsMode === 'transfer' && catId === SAVINGS_CATEGORY_ID) continue;
    totalBal += t.amount;
    if (catMap.get(catId)?.type === 'income') grossIncome += t.amount;
    else netCategoryMap.set(catId, (netCategoryMap.get(catId) || 0) - t.amount);
  }
  let netExpenseSum = 0;
  let refundSurplus = 0;
  const slices: CategorySlice[] = [];
  const surplusSlices: CategorySlice[] = [];
  for (const [catId, netAmount] of netCategoryMap.entries()) {
    const c = catMap.get(catId);
    const slice = (value: number) => ({ id: catId, label: c?.name || catId, value: round(value), color: c?.color || '#8E8E93', icon: c?.icon || 'Package' });
    if (netAmount > 0.001) {
      const rounded = round(netAmount);
      netExpenseSum += rounded;
      slices.push(slice(netAmount));
    } else if (netAmount < -0.001) {
      refundSurplus += Math.abs(netAmount);
    }
    if (savingsMode === 'surplus' && catId === SAVINGS_CATEGORY_ID && netAmount <= 0.001) surplusSlices.push(slice(Math.abs(netAmount)));
  }
  slices.sort((a, b) => b.value - a.value);
  const income = round(grossIncome + refundSurplus);
  const balance = round(totalBal);
  return {
    income, expense: round(netExpenseSum), balance,
    savingsRate: income > 0 ? Math.max(0, Math.round((balance / income) * 100)) : 0,
    categorySlices: slices, surplusSlices,
  };
}
