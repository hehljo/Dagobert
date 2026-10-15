import React, { useState, useMemo } from 'react';
import { Search, Filter, Calendar, X } from 'lucide-react';
import type { Transaction, Category } from '../types/index.ts';
import { CategoryIcon } from './CategoryIcon.tsx';

interface TransactionsViewProps {
  transactions: Transaction[];
  categories: Category[];
  selectedCategoryFilter: string | null;
  onClearCategoryFilter: () => void;
  onSelectTransaction: (tx: Transaction) => void;
  selectedMonth: string;
}

export const TransactionsView: React.FC<TransactionsViewProps> = ({
  transactions,
  categories,
  selectedCategoryFilter,
  onClearCategoryFilter,
  onSelectTransaction,
  selectedMonth,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'expense' | 'income'>('all');

  const catMap = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories]);

  // Filter transactions
  const filtered = useMemo(() => {
    return transactions.filter(t => {
      // Month
      if (!t.date.startsWith(selectedMonth)) return false;

      // Type
      if (typeFilter === 'expense' && t.amount >= 0) return false;
      if (typeFilter === 'income' && t.amount <= 0) return false;

      // Category filter
      if (selectedCategoryFilter && t.category !== selectedCategoryFilter) return false;

      // Search term
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const inPayee = t.payee?.toLowerCase().includes(term);
        const inPurpose = t.purpose?.toLowerCase().includes(term);
        const inType = t.type?.toLowerCase().includes(term);
        const inRaw = t.rawText?.toLowerCase().includes(term);
        if (!inPayee && !inPurpose && !inType && !inRaw) return false;
      }

      return true;
    }).sort((a, b) => b.date.localeCompare(a.date) || (b.id || 0) - (a.id || 0));
  }, [transactions, selectedMonth, typeFilter, selectedCategoryFilter, searchTerm]);

  // Group by Date
  const groupedByDate = useMemo(() => {
    const groups: { date: string; formattedDate: string; items: Transaction[]; dayTotal: number }[] = [];
    let currentDate = '';
    let currentGroup: (typeof groups)[0] | null = null;

    for (const t of filtered) {
      if (t.date !== currentDate) {
        currentDate = t.date;
        const [y, m, d] = t.date.split('-');
        const dateObj = new Date(Number(y), Number(m) - 1, Number(d));
        const formattedDate = dateObj.toLocaleDateString('de-DE', {
          weekday: 'short',
          day: '2-digit',
          month: 'short'
        });

        currentGroup = {
          date: t.date,
          formattedDate,
          items: [],
          dayTotal: 0
        };
        groups.push(currentGroup);
      }
      if (currentGroup) {
        currentGroup.items.push(t);
        currentGroup.dayTotal += t.amount;
      }
    }
    return groups;
  }, [filtered]);

  return (
    <div className="space-y-4 pb-24 max-w-5xl mx-auto px-4 pt-4">
      {/* Search and Filters Header */}
      <div className="space-y-3 bg-white dark:bg-ios-darkCard p-4 rounded-3xl shadow-sm border border-ios-separator dark:border-ios-darkSeparator">
        {/* Search Input */}
        <div className="relative">
          <Search className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-ios-gray" />
          <input
            type="text"
            placeholder="Buchungen durchsuchen (Empfänger, Zweck, Betrag)..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-100 dark:bg-neutral-800 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-ios-tint transition-all"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar text-xs">
          <button
            onClick={() => setTypeFilter('all')}
            className={`px-3 py-1.5 rounded-full font-medium min-h-[36px] flex items-center transition-colors ${
              typeFilter === 'all'
                ? 'bg-ios-tint text-white'
                : 'bg-slate-100 dark:bg-neutral-800 text-slate-700 dark:text-slate-300'
            }`}
          >
            Alle
          </button>
          <button
            onClick={() => setTypeFilter('expense')}
            className={`px-3 py-1.5 rounded-full font-medium min-h-[36px] flex items-center transition-colors ${
              typeFilter === 'expense'
                ? 'bg-ios-red text-white'
                : 'bg-slate-100 dark:bg-neutral-800 text-slate-700 dark:text-slate-300'
            }`}
          >
            Ausgaben
          </button>
          <button
            onClick={() => setTypeFilter('income')}
            className={`px-3 py-1.5 rounded-full font-medium min-h-[36px] flex items-center transition-colors ${
              typeFilter === 'income'
                ? 'bg-ios-green text-white'
                : 'bg-slate-100 dark:bg-neutral-800 text-slate-700 dark:text-slate-300'
            }`}
          >
            Einnahmen
          </button>

          {/* Active Category Filter Badge */}
          {selectedCategoryFilter && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold border border-amber-500/20">
              <Filter className="w-3.5 h-3.5" />
              <span>{catMap.get(selectedCategoryFilter)?.name || selectedCategoryFilter}</span>
              <button
                onClick={onClearCategoryFilter}
                className="ml-1 hover:text-amber-700 dark:hover:text-amber-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Transaction List */}
      <div className="space-y-4">
        {groupedByDate.length === 0 ? (
          <div className="bg-white dark:bg-ios-darkCard rounded-3xl p-8 text-center text-ios-gray">
            <Calendar className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="font-medium text-sm">Keine passenden Buchungen gefunden</p>
          </div>
        ) : (
          groupedByDate.map((group) => (
            <div key={group.date} className="space-y-1.5">
              {/* Date Header */}
              <div className="flex items-center justify-between px-3 text-xs font-semibold text-ios-gray">
                <span>{group.formattedDate}</span>
                <span className="font-mono">
                  {group.dayTotal >= 0 ? '+' : ''}{group.dayTotal.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €
                </span>
              </div>

              {/* Transactions in Date */}
              <div className="bg-white dark:bg-ios-darkCard rounded-2xl overflow-hidden shadow-sm border border-ios-separator dark:border-ios-darkSeparator divide-y divide-ios-separator/50 dark:divide-ios-darkSeparator/50">
                {group.items.map((t) => {
                  const cat = catMap.get(t.category);
                  const isPositive = t.amount > 0;

                  return (
                    <div
                      key={t.id}
                      onClick={() => onSelectTransaction(t)}
                      className="min-h-[56px] px-3.5 py-2.5 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-neutral-800/60 active:bg-slate-100 cursor-pointer transition-colors"
                    >
                      {/* Left: Icon & Names */}
                      <div className="flex items-center space-x-3 min-w-0 pr-2">
                        <div
                          className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 text-sm shadow-sm"
                          style={{
                            backgroundColor: `${cat?.color || '#8E8E93'}20`,
                            color: cat?.color || '#8E8E93'
                          }}
                        >
                          <CategoryIcon name={cat?.icon || 'Package'} className="w-5 h-5" />
                        </div>

                        <div className="min-w-0">
                          <p className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                            {t.payee || t.purpose || 'Unbekannt'}
                          </p>
                          <p className="text-xs text-ios-gray truncate max-w-[200px] sm:max-w-md">
                            {t.purpose || t.type}
                          </p>
                        </div>
                      </div>

                      {/* Right: Category tag & Amount */}
                      <div className="text-right flex-shrink-0">
                        <div className={`font-bold text-sm sm:text-base ${isPositive ? 'text-ios-green' : 'text-slate-900 dark:text-white'}`}>
                          {isPositive ? '+' : ''}{t.amount.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €
                        </div>
                        <span
                          className="inline-block text-[10px] font-medium px-2 py-0.5 rounded-full mt-0.5"
                          style={{
                            backgroundColor: `${cat?.color || '#8E8E93'}20`,
                            color: cat?.color || '#8E8E93'
                          }}
                        >
                          {cat?.name || 'Sonstiges'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
