import React, { useMemo } from 'react';
import { TrendingUp, TrendingDown, Wallet, ChevronLeft, ChevronRight, Upload, Sparkles } from 'lucide-react';
import type { Transaction, Category } from '../types/index.ts';
import { DonutChart, type DonutSlice } from './DonutChart.tsx';

interface DashboardProps {
  transactions: Transaction[];
  categories: Category[];
  selectedMonth: string; // YYYY-MM
  onMonthChange: (month: string) => void;
  onOpenImport: () => void;
  onSelectCategoryFilter: (catId: string) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  transactions,
  categories,
  selectedMonth,
  onMonthChange,
  onOpenImport,
  onSelectCategoryFilter,
}) => {
  // Category map
  const catMap = useMemo(() => {
    return new Map(categories.map(c => [c.id, c]));
  }, [categories]);

  // Filter transactions by selected month
  const monthTransactions = useMemo(() => {
    return transactions.filter(t => t.date.startsWith(selectedMonth));
  }, [transactions, selectedMonth]);

  // Calculate totals
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
    <div className="space-y-6 pb-24 max-w-5xl mx-auto px-4 pt-4">
      {/* Month Switcher Bar */}
      <div className="flex items-center justify-between bg-white dark:bg-ios-darkCard rounded-2xl p-2 shadow-sm border border-ios-separator dark:border-ios-darkSeparator">
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Net Cashflow / Saldo */}
        <div className="col-span-2 bg-gradient-to-br from-slate-900 to-neutral-800 text-white rounded-3xl p-5 shadow-md relative overflow-hidden">
          <div className="flex justify-between items-start">
            <span className="text-xs uppercase font-semibold tracking-wider text-slate-400">Netto Cashflow</span>
            <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
              <Wallet className="w-4 h-4 text-ios-tint" />
            </div>
          </div>
          <div className="mt-3">
            <div className={`text-2xl sm:text-3xl font-extrabold tracking-tight ${balance >= 0 ? 'text-ios-green' : 'text-ios-red'}`}>
              {balance >= 0 ? '+' : ''}{balance.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €
            </div>
            <p className="text-xs text-slate-300 mt-1 flex items-center gap-1">
              <span>Sparquote:</span>
              <span className="font-bold text-white">{savingsRate}%</span>
            </p>
          </div>
        </div>

        {/* Income Card */}
        <div className="bg-white dark:bg-ios-darkCard rounded-3xl p-4 shadow-sm border border-ios-separator dark:border-ios-darkSeparator">
          <div className="flex items-center justify-between text-ios-gray mb-1">
            <span className="text-xs font-medium">Einnahmen</span>
            <TrendingUp className="w-4 h-4 text-ios-green" />
          </div>
          <div className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">
            +{income.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €
          </div>
        </div>

        {/* Expense Card */}
        <div className="bg-white dark:bg-ios-darkCard rounded-3xl p-4 shadow-sm border border-ios-separator dark:border-ios-darkSeparator">
          <div className="flex items-center justify-between text-ios-gray mb-1">
            <span className="text-xs font-medium">Ausgaben</span>
            <TrendingDown className="w-4 h-4 text-ios-red" />
          </div>
          <div className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">
            -{expense.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €
          </div>
        </div>
      </div>

      {/* Category Breakdown Card */}
      <div className="bg-white dark:bg-ios-darkCard rounded-3xl p-5 shadow-sm border border-ios-separator dark:border-ios-darkSeparator">
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
              Lade deine comdirect CSV-Datei hoch. Umlaute (Windows-1252) und Buchungstexte werden automatisch erkannt und kategorisiert.
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
