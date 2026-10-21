import React, { useMemo } from 'react';
import { TrendingUp, TrendingDown, Wallet, ChevronLeft, ChevronRight, Upload, Sparkles, Landmark } from 'lucide-react';
import type { Transaction, Category, Account } from '../types/index.ts';
import { DonutChart, type DonutSlice } from './DonutChart.tsx';
import { calculateRealAccountBalance } from '../lib/db.ts';

interface DashboardProps {
  transactions: Transaction[];
  categories: Category[];
  account?: Account;
  selectedMonth: string; // YYYY-MM
  onMonthChange: (month: string) => void;
  onOpenImport: () => void;
  onSelectCategoryFilter: (catId: string) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  transactions,
  categories,
  account,
  selectedMonth,
  onMonthChange,
  onOpenImport,
  onSelectCategoryFilter,
}) => {
  // Category map
  const catMap = useMemo(() => {
    return new Map(categories.map(c => [c.id, c]));
  }, [categories]);

  // Real account balance
  const realBalance = useMemo(() => {
    return calculateRealAccountBalance(account, transactions);
  }, [account, transactions]);

  // Filter transactions by selected month
  const monthTransactions = useMemo(() => {
    return transactions.filter(t => t.date.startsWith(selectedMonth));
  }, [transactions, selectedMonth]);

  // Calculate monthly cashflow totals
  const { income, expense, balance, savingsRate } = useMemo(() => {
    let inc = 0;
    let exp = 0;
    for (const t of monthTransactions) {
      if (t.amount > 0) {
        inc += t.amount;
      } else {
        exp += Math.abs(t.amount);
      }
    }
    const bal = inc - exp;
    const rate = inc > 0 ? Math.max(0, Math.round((bal / inc) * 100)) : 0;
    return { income: inc, expense: exp, balance: bal, savingsRate: rate };
  }, [monthTransactions]);

  // Donut Slices
  const categorySlices: DonutSlice[] = useMemo(() => {
    const expenseMap = new Map<string, number>();
    for (const t of monthTransactions) {
      if (t.amount < 0) {
        const cat = t.category || 'sonstiges';
        expenseMap.set(cat, (expenseMap.get(cat) || 0) + Math.abs(t.amount));
      }
    }

    return Array.from(expenseMap.entries())
      .map(([catId, amount]) => {
        const c = catMap.get(catId);
        return {
          id: catId,
          label: c?.name || catId,
          value: amount,
          color: c?.color || '#8E8E93',
          icon: c?.icon || 'Package'
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [monthTransactions, catMap]);

  // Month navigation helpers
  const handlePrevMonth = () => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const date = new Date(year, month - 2, 1);
    const newY = date.getFullYear();
    const newM = String(date.getMonth() + 1).padStart(2, '0');
    onMonthChange(`${newY}-${newM}`);
  };

  const handleNextMonth = () => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const date = new Date(year, month, 1);
    const newY = date.getFullYear();
    const newM = String(date.getMonth() + 1).padStart(2, '0');
    onMonthChange(`${newY}-${newM}`);
  };

  const monthLabel = useMemo(() => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const d = new Date(year, month - 1, 1);
    return d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  }, [selectedMonth]);

  return (
    <div className="space-y-4 sm:space-y-6 pb-8 max-w-6xl mx-auto px-3 sm:px-6 lg:px-8 pt-4 sm:pt-7">
      {/* Month Switcher Bar */}
      <div className="flex items-center justify-between glass-surface rounded-2xl p-2 shadow-sm border border-ios-separator dark:border-ios-darkSeparator">
        <button
          onClick={handlePrevMonth}
          className="min-w-[48px] min-h-[48px] rounded-xl flex items-center justify-center text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-neutral-800 transition-colors"
          aria-label="Vorheriger Monat"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <span className="font-semibold text-base text-slate-900 dark:text-white capitalize">
          {monthLabel}
        </span>

        <button
          onClick={handleNextMonth}
          className="min-w-[48px] min-h-[48px] rounded-xl flex items-center justify-center text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-neutral-800 transition-colors"
          aria-label="Nächster Monat"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Main KPI Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
        {/* Real Account Balance Card */}
        <div className="glass-surface glass-kpi">
          <div className="flex items-center justify-between text-ios-gray mb-1">
            <span className="text-xs font-semibold">Kontostand</span>
            <Landmark className="w-4 h-4 text-ios-tint" />
          </div>
          <div className="glass-kpi-value text-slate-900 dark:text-white tracking-tight">
            {realBalance.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €
          </div>
          <p className="text-[10px] text-ios-gray mt-1 truncate">
            {account?.checkpointDate ? `per ${account.checkpointDate} (aus comdirect)` : 'aus Startsaldo'}
          </p>
        </div>

        {/* Net Cashflow / Monatssaldo */}
        <div className="glass-kpi glass-kpi-cashflow relative overflow-hidden">
          <div className="flex justify-between items-start text-xs font-semibold text-slate-400">
            <span>Cashflow (Monat)</span>
            <Wallet className="w-4 h-4 text-amber-300" />
          </div>
          <div className="mt-1">
            <div className={`glass-kpi-value tracking-tight ${balance >= 0 ? 'text-ios-green' : 'text-ios-red'}`}>
              {balance >= 0 ? '+' : ''}{balance.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €
            </div>
            <p className="text-[10px] text-slate-300 mt-1">
              Sparquote: <span className="font-bold text-white">{savingsRate}%</span>
            </p>
          </div>
        </div>

        {/* Income Card */}
        <div className="glass-surface glass-kpi">
          <div className="flex items-center justify-between text-ios-gray mb-1">
            <span className="text-xs font-medium">Einnahmen</span>
            <TrendingUp className="w-4 h-4 text-ios-green" />
          </div>
          <div className="glass-kpi-value text-slate-900 dark:text-white">
            +{income.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €
          </div>
        </div>

        {/* Expense Card */}
        <div className="glass-surface glass-kpi">
          <div className="flex items-center justify-between text-ios-gray mb-1">
            <span className="text-xs font-medium">Ausgaben</span>
            <TrendingDown className="w-4 h-4 text-ios-red" />
          </div>
          <div className="glass-kpi-value text-slate-900 dark:text-white">
            -{expense.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €
          </div>
        </div>
      </div>

      {/* Category Breakdown Card */}
      <div className="glass-surface rounded-3xl p-4 sm:p-6 lg:p-7">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-bold text-base text-slate-900 dark:text-white flex items-center gap-2">
            <span>Ausgaben nach Kategorien</span>
          </h2>
          <span className="text-xs text-ios-gray font-medium">
            {monthTransactions.length} Buchungen
          </span>
        </div>

        <DonutChart
          slices={categorySlices}
          currency="€"
          onSelectCategory={onSelectCategoryFilter}
        />
      </div>

      {/* Empty State / Quick Import Banner */}
      {transactions.length === 0 && (
        <div className="bg-gradient-to-r from-ios-tint/10 to-purple-500/10 border border-ios-tint/30 rounded-3xl p-6 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-ios-tint text-white flex items-center justify-center mx-auto shadow-lg shadow-ios-tint/30">
            <Sparkles className="w-7 h-7" />
          </div>
          <div>
            <h3 className="font-bold text-lg text-slate-900 dark:text-white">Noch keine Buchungen vorhanden</h3>
            <p className="text-sm text-ios-gray max-w-md mx-auto mt-1">
              Lade deine comdirect CSV-Datei hoch. Umlaute (Windows-1252), Kontostände und Buchungstexte werden automatisch erkannt.
            </p>
          </div>
          <button
            onClick={onOpenImport}
            className="inline-flex items-center space-x-2 px-5 py-3 rounded-2xl bg-ios-tint text-white font-semibold shadow-md hover:brightness-110 active:scale-95 transition-all min-h-[48px]"
          >
            <Upload className="w-5 h-5" />
            <span>Erste comdirect CSV importieren</span>
          </button>
        </div>
      )}
    </div>
  );
};
