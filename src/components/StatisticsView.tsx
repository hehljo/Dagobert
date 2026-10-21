import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, CalendarDays, ChevronRight, Filter, TrendingDown, TrendingUp, Wallet, X } from 'lucide-react';
import type { Category, Transaction } from '../types/index.ts';
import { calculateStatistics, getStatisticsYears } from '../lib/statistics.ts';
import { CategoryIcon } from './CategoryIcon.tsx';
import { DonutChart } from './DonutChart.tsx';

interface StatisticsViewProps {
  transactions: Transaction[];
  categories: Category[];
  onSelectTransaction: (transaction: Transaction) => void;
}

const currency = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const percentage = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const months = Array.from({ length: 12 }, (_, index) =>
  new Intl.DateTimeFormat('de-DE', { month: 'long' }).format(new Date(2020, index, 1)));
const card = 'rounded-3xl border border-ios-separator dark:border-ios-darkSeparator glass-surface p-4 sm:p-5 shadow-sm';
const secondary = 'text-slate-600 dark:text-slate-300';
const control = 'min-h-[48px] rounded-xl px-4 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ios-tint';

function signedMoney(value: number): string {
  return `${value > 0 ? '+' : ''}${currency.format(value)}`;
}

function TransactionRanking({ items, onSelectTransaction, emptyMessage }: {
  items: Transaction[];
  onSelectTransaction: (transaction: Transaction) => void;
  emptyMessage: string;
}) {
  if (items.length === 0) return <p className={`py-6 text-sm ${secondary}`}>{emptyMessage}</p>;
  return (
    <ol className="divide-y divide-ios-separator dark:divide-ios-darkSeparator">
      {items.map((transaction, index) => (
        <li key={transaction.id ?? `${transaction.sourceHash}-${index}`}>
          <button
            type="button"
            onClick={() => onSelectTransaction(transaction)}
            className="w-full min-h-[64px] flex flex-wrap items-center gap-3 rounded-xl py-3 text-left hover:bg-slate-50 dark:hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ios-tint"
          >
            <span className={`w-5 shrink-0 text-xs tabular-nums ${secondary}`}>{index + 1}.</span>
            <span className="min-w-0 flex-1 basis-28">
              <span className="block break-words text-sm font-semibold">{transaction.payee || 'Unbekannt'}</span>
              <span className={`block break-words text-xs ${secondary}`}>
                {transaction.date.split('-').reverse().join('.')} · {transaction.purpose || transaction.type}
              </span>
            </span>
            <span className="ml-auto flex items-center gap-1 text-sm font-bold tabular-nums">
              {signedMoney(transaction.amount)}
              <ChevronRight aria-hidden="true" className="w-4 h-4 shrink-0 text-slate-400" />
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

export function StatisticsView({ transactions, categories, onSelectTransaction }: StatisticsViewProps) {
  const [mode, setMode] = useState<'year' | 'month'>('year');
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const [direction, setDirection] = useState<'expense' | 'income'>('expense');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const categoryDetailsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedCategoryId) {
      categoryDetailsRef.current?.scrollIntoView({
        block: 'start',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      });
    }
  }, [selectedCategoryId]);

  const years = useMemo(() => [...new Set([year, ...getStatisticsYears(transactions, new Date().getFullYear())])]
    .sort((a, b) => b - a), [transactions, year]);
  const statistics = useMemo(() => calculateStatistics(transactions, categories, {
    year, month: mode === 'month' ? month : undefined,
  }), [transactions, categories, year, month, mode]);
  const ranking = direction === 'expense' ? statistics.expenseCategories : statistics.incomeCategories;
  const selectedCategory = ranking.find(category => category.id === selectedCategoryId);
  const categoryLabel = direction === 'expense' ? 'Ausgaben' : 'Einnahmen';
  const periodLabel = mode === 'year' ? String(year) : `${months[month - 1]} ${year}`;
  const maxMonthlyAmount = Math.max(1, ...statistics.months.flatMap(m => [m.income, m.expense]));
  const kpis = [
    { label: 'Gesamtausgaben', value: statistics.expense, icon: TrendingDown, tone: 'text-red-700 dark:text-red-400', hint: periodLabel },
    { label: 'Gesamteinnahmen', value: statistics.income, icon: TrendingUp, tone: 'text-emerald-700 dark:text-emerald-400', hint: periodLabel },
    { label: 'Netto-Ergebnis', value: statistics.net, icon: Wallet, tone: statistics.net >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400', hint: 'Einnahmen minus Ausgaben' },
    ...(mode === 'year' ? [
      { label: 'Ø Monatsausgaben', value: statistics.averageMonthlyExpense, icon: TrendingDown, tone: '', hint: 'Jahressumme ÷ 12 Monate' },
      { label: 'Ø Monatseinnahmen', value: statistics.averageMonthlyIncome, icon: TrendingUp, tone: '', hint: 'Jahressumme ÷ 12 Monate' },
    ] : []),
  ];

  const clearCategory = () => setSelectedCategoryId(null);
  const selectCategory = (id: string) => setSelectedCategoryId(current => current === id ? null : id);

  return (
    <div className="max-w-5xl mx-auto space-y-5 px-4 pt-4 pb-6 text-slate-900 dark:text-white">
      <section className={`${card} space-y-4`} aria-labelledby="statistics-title">
        <div className="flex items-start gap-3">
          <BarChart3 aria-hidden="true" className="w-6 h-6 shrink-0 text-ios-tint" />
          <div className="min-w-0">
            <h1 id="statistics-title" className="text-lg font-bold">Statistik</h1>
            <p className={`mt-1 text-sm ${secondary}`}>Einnahmen, Ausgaben und Kategorien im Überblick.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="inline-flex rounded-2xl glass-pill p-1 border border-ios-separator dark:border-ios-darkSeparator" role="group" aria-label="Zeitraumansicht">
            {(['year', 'month'] as const).map(value => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => { setMode(value); clearCategory(); }}
                className={`${control} transition-all ${
                  mode === value
                    ? 'bg-ios-tint text-white shadow-sm font-bold'
                    : 'text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white'
                }`}
              >{value === 'year' ? 'Jahr' : 'Monat'}</button>
            ))}
          </div>
          <label className="flex min-w-28 flex-col gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
            <span>Jahr</span>
            <select
              aria-label="Jahr"
              value={year}
              onChange={event => { setYear(Number(event.target.value)); clearCategory(); }}
              className={`${control} glass-surface border border-ios-separator dark:border-ios-darkSeparator text-slate-900 dark:text-white outline-none cursor-pointer shadow-sm`}
            >
              {years.map(value => (
                <option key={value} value={value} className="bg-white dark:bg-neutral-900 text-slate-900 dark:text-white">
                  {value}
                </option>
              ))}
            </select>
          </label>
          {mode === 'month' && (
            <label className="flex min-w-36 flex-col gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
              <span>Monat</span>
              <select
                aria-label="Monat"
                value={month}
                onChange={event => { setMonth(Number(event.target.value)); clearCategory(); }}
                className={`${control} glass-surface border border-ios-separator dark:border-ios-darkSeparator text-slate-900 dark:text-white outline-none cursor-pointer shadow-sm`}
              >
                {months.map((name, index) => (
                  <option key={name} value={index + 1} className="bg-white dark:bg-neutral-900 text-slate-900 dark:text-white">
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <p className={`text-xs leading-relaxed ${secondary}`}>
          Nur gebuchte EUR-Buchungen des aktiven Profils, ohne Vormerkungen. Das Netto-Ergebnis ist die Veränderung im Zeitraum, kein Kontostand.
        </p>
      </section>

      <section aria-label={`Kennzahlen ${periodLabel}`} className={`grid gap-3 sm:grid-cols-2 ${mode === 'year' ? 'lg:grid-cols-5' : 'lg:grid-cols-3'}`}>
        {kpis.map(kpi => (
          <div key={kpi.label} className={`${card} min-w-0`}>
            <div className={`flex items-center gap-2 text-xs font-semibold ${secondary}`}>
              <kpi.icon aria-hidden="true" className="w-4 h-4 shrink-0" />
              <span>{kpi.label}</span>
            </div>
            <p className={`mt-2 break-words text-xl font-extrabold tabular-nums ${kpi.tone}`}>{currency.format(kpi.value)}</p>
            <p className={`mt-1 text-xs ${secondary}`}>{kpi.hint}</p>
          </div>
        ))}
      </section>

      {mode === 'year' && (
        <section className={card} aria-labelledby="statistics-months-title">
          <h2 id="statistics-months-title" className="font-bold">Monatlicher Verlauf · {year}</h2>
          <p className={`mt-1 text-xs ${secondary}`}>Alle zwölf Monate. Wähle einen Monat für die Detailansicht.</p>
          <div className={`mt-4 flex flex-wrap gap-4 text-xs font-medium ${secondary}`}>
            <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-ios-green" />Einnahmen</span>
            <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-ios-red" />Ausgaben</span>
          </div>
          <div className="mt-3 grid gap-1 sm:grid-cols-2 sm:gap-3">
            {statistics.months.map(item => (
              <button
                key={item.month}
                type="button"
                aria-label={`${months[item.month - 1]} ${year}: Einnahmen ${currency.format(item.income)}, Ausgaben ${currency.format(item.expense)}, Netto ${signedMoney(item.net)}. Monat anzeigen`}
                onClick={() => { setMonth(item.month); setMode('month'); clearCategory(); }}
                className="min-w-0 rounded-2xl p-3 text-left glass-pill border border-ios-separator dark:border-ios-darkSeparator hover:border-ios-tint/50 transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-ios-tint"
              >
                <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs">
                  <span className="font-bold text-slate-900 dark:text-white">{months[item.month - 1]}</span>
                  <span className={secondary}>Netto <span className={`font-semibold tabular-nums ${item.net < 0 ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{signedMoney(item.net)}</span></span>
                </div>
                <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5">
                  <div aria-hidden="true" className="h-2 rounded-full bg-slate-100 dark:bg-neutral-800"><div className="h-full rounded-full bg-ios-green" style={{ width: `${item.income / maxMonthlyAmount * 100}%` }} /></div>
                  <span className={`text-xs tabular-nums ${secondary}`}>{currency.format(item.income)}</span>
                  <div aria-hidden="true" className="h-2 rounded-full bg-slate-100 dark:bg-neutral-800"><div className="h-full rounded-full bg-ios-red" style={{ width: `${item.expense / maxMonthlyAmount * 100}%` }} /></div>
                  <span className={`text-xs tabular-nums ${secondary}`}>{currency.format(item.expense)}</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className={card} aria-labelledby="statistics-categories-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="statistics-categories-title" className="font-bold">{categoryLabel} nach Kategorie · {periodLabel}</h2>
          <div role="group" aria-label="Kategorieauswertung" className="inline-flex rounded-2xl glass-pill p-1 border border-ios-separator dark:border-ios-darkSeparator">
            {(['expense', 'income'] as const).map(value => (
              <button
                key={value}
                type="button"
                aria-label={value === 'expense' ? 'Ausgaben' : 'Einnahmen'}
                aria-pressed={direction === value}
                onClick={() => { setDirection(value); clearCategory(); }}
                className={`${control} transition-all ${
                  direction === value
                    ? 'bg-ios-tint text-white shadow-sm font-bold'
                    : 'text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {value === 'expense' ? 'Ausgaben' : 'Einnahmen'}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 grid items-start gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <DonutChart
            slices={ranking.filter(category => category.amount > 0).map(category => ({
              id: category.id, label: category.name, value: category.amount, color: category.color, icon: category.icon,
            }))}
            label={categoryLabel}
            emptyMessage={`Keine ${categoryLabel} in diesem Zeitraum`}
            showLegend={false}
            selectedCategoryId={selectedCategoryId}
            onSelectCategory={selectCategory}
          />
          <div className="min-w-0">
            <p className={`mb-2 text-xs ${secondary}`}>Alle Kategorien · Betrag, Anteil und Anzahl · zum Filtern auswählen</p>
            <ol className="space-y-1">
              {ranking.map((category, index) => (
                <li key={category.id}>
                  <button
                    type="button"
                    aria-label={`${category.name}: ${currency.format(category.amount)}, ${percentage.format(category.share)} %, ${category.count} Buchungen`}
                    aria-pressed={selectedCategoryId === category.id}
                    onClick={() => selectCategory(category.id)}
                    className={`w-full min-h-[56px] flex items-center gap-2 rounded-2xl border p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-ios-tint transition-all ${selectedCategoryId === category.id ? 'border-ios-tint bg-ios-tint/15 shadow-sm' : 'border-transparent glass-pill hover:border-ios-separator dark:hover:border-ios-darkSeparator'}`}
                  >
                    <span className={`w-5 shrink-0 text-xs tabular-nums ${secondary}`}>{index + 1}.</span>
                    <CategoryIcon name={category.icon} className="w-5 h-5 shrink-0 text-slate-500 dark:text-slate-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm font-semibold">{category.name}</span>
                      <span className={`block text-xs ${secondary}`}>{category.count} {category.count === 1 ? 'Buchung' : 'Buchungen'}</span>
                    </span>
                    <span className="shrink-0 text-right tabular-nums">
                      <span className="block text-sm font-bold">{currency.format(category.amount)}</span>
                      <span className={`block text-xs ${secondary}`}>{percentage.format(category.share)} %</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <div ref={categoryDetailsRef} className="mt-5 scroll-mt-4 border-t border-ios-separator dark:border-ios-darkSeparator pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="flex min-w-0 items-center gap-2 text-sm font-bold">
              <Filter aria-hidden="true" className="w-4 h-4 shrink-0 text-ios-tint" />
              <span className="break-words">{selectedCategory ? `Größte Buchungen: ${selectedCategory.name}` : 'Kategorie auswählen für Einzelbuchungen'}</span>
            </h3>
            {selectedCategory && (
              <button type="button" aria-label="Filter aufheben" onClick={clearCategory} className={`${control} flex items-center gap-2 bg-slate-100 dark:bg-neutral-800`}>
                <X aria-hidden="true" className="w-4 h-4" />
                Filter aufheben
              </button>
            )}
          </div>
          {selectedCategory && <>
            <p className={`mt-2 text-xs ${secondary}`}>Die größten {Math.min(10, selectedCategory.count)} von {selectedCategory.count} Buchungen · {periodLabel}</p>
            <TransactionRanking items={selectedCategory.transactions.slice(0, 10)} onSelectTransaction={onSelectTransaction} emptyMessage="Keine Buchungen für diese Kategorie im gewählten Zeitraum." />
          </>}
        </div>
      </section>

      <section className={card} aria-labelledby="statistics-top-title">
        <h2 id="statistics-top-title" className="font-bold">Top 10 Ausgaben · {periodLabel}</h2>
        <p className={`mt-1 text-xs ${secondary}`}>Die größten einzelnen Ausgaben, unabhängig vom Kategoriefilter.</p>
        <TransactionRanking items={statistics.topExpenses} onSelectTransaction={onSelectTransaction} emptyMessage="Keine Ausgaben im gewählten Zeitraum." />
      </section>
      <p className={`flex items-center gap-2 px-1 text-xs ${secondary}`}><CalendarDays aria-hidden="true" className="h-4 w-4 shrink-0" />{statistics.transactions.length} gebuchte EUR-Buchungen · {periodLabel}</p>
    </div>
  );
}
