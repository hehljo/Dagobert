import React, { useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, Wallet, ChevronLeft, ChevronRight, Upload, Sparkles, Landmark } from 'lucide-react';
import type { Transaction, Category, Account } from '../types/index.ts';
import { DonutChart } from './DonutChart.tsx';
import { summarizeMonth } from '../lib/monthSummary.ts';
import { calculateAccountBalanceAt, calculateRealAccountBalance, firstBookedAccountDate, lastBookedAccountDate } from '../lib/db.ts';
import { currentMonth, monthEndDate } from '../lib/dashboardPreferences.ts';
import { useDashboardPreferences } from '../lib/useDashboardPreferences.ts';
import { SALARY_CATEGORY_ID, budgetPeriod, dayBefore } from '../lib/salaryBudget.ts';
import { useSalaryBudget } from '../lib/useSalaryBudget.ts';

interface DashboardProps {
  profileId: string;
  transactions: Transaction[];
  categories: Category[];
  account?: Account;
  selectedMonth: string; // YYYY-MM
  onMonthChange: (month: string) => void;
  onOpenImport: () => void;
  /** `range` (start inclusive, end exclusive) is set in the budget view: the list then shows the same salary-to-salary period. */
  onSelectCategoryFilter: (catId: string, range?: { start: string; end: string }) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  profileId,
  transactions,
  categories,
  account,
  selectedMonth,
  onMonthChange,
  onOpenImport,
  onSelectCategoryFilter,
}) => {
  const { preference } = useSalaryBudget(profileId);
  const { preference: dashboardPreference } = useDashboardPreferences(profileId);
  const showMonthResult = dashboardPreference.showMonthResult;
  const [calendarView, setCalendarView] = useState(false);
  const budgetAvailable = preference.enabled && categories.some(category => category.id === SALARY_CATEGORY_ID && category.type === 'income');
  const budgetView = budgetAvailable && !calendarView;

  // Real account balance
  const firstBookingDate = useMemo(() => firstBookedAccountDate(account, transactions), [account, transactions]);
  const realBalance = useMemo(() => {
    return calculateRealAccountBalance(account, transactions);
  }, [account, transactions]);

  // Balance at the end of a completed month (calendar month end, independent of the budget view)
  // Budget view: one month runs from salary to salary (all bookings, not only the salary).
  const period = useMemo(() => budgetView ? budgetPeriod(selectedMonth, transactions, preference) : null,
    [budgetView, selectedMonth, transactions, preference]);
  const now = new Date();
  const today = `${currentMonth(now)}-${String(now.getDate()).padStart(2, '0')}`;
  const isPastMonth = period ? period.end <= today : selectedMonth < currentMonth(now);
  const selectedMonthEnd = period ? dayBefore(period.end) : monthEndDate(selectedMonth);
  const formatDay = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('de-DE');
  // Latest booked transaction after the comdirect balance: the shown balance is carried forward to it.
  const lastBookingDate = useMemo(() => lastBookedAccountDate(account, transactions), [account, transactions]);
  const carriedTo = account?.checkpointDate && lastBookingDate && lastBookingDate > account.checkpointDate ? lastBookingDate : null;
  const monthEndBalance = useMemo(() => {
    return isPastMonth ? calculateAccountBalanceAt(account, transactions, selectedMonthEnd) : null;
  }, [isPastMonth, account, transactions, selectedMonthEnd]);
  // Balance before the first imported booking is only derived backwards from a later anchor.
  const monthEndBeforeData = monthEndBalance !== null && firstBookingDate !== null && selectedMonthEnd < firstBookingDate;
  const tileCount = 1 + (isPastMonth ? 1 : 0) + (showMonthResult ? 1 : 0);
  const lgColumns = ({ 1: 'lg:grid-cols-1', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3' } as Record<number, string>)[tileCount];
  // Phone grid (2 columns): Kontostand next to the result tile, or next to the month-end tile for a
  // completed month (then the result tile takes the row below). A lone tile fills its row.
  const spanResult = showMonthResult && isPastMonth;
  const spanBalance = tileCount === 1;

  // Filter transactions by selected month
  const monthTransactions = useMemo(() => {
    return transactions.filter(t => period ? t.date >= period.start && t.date < period.end : t.date.slice(0, 7) === selectedMonth);
  }, [transactions, selectedMonth, period]);

  // Monthly cashflow totals & net category expenses (refunds offset their category)
  const { income, expense, balance, savingsRate, categorySlices, surplusSlices } = useMemo(
    () => summarizeMonth(monthTransactions, categories, dashboardPreference.savingsMode),
    [monthTransactions, categories, dashboardPreference.savingsMode]);

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

      {budgetAvailable && <div className="space-y-2">
        <div role="group" aria-label="Monatsansicht" className="grid grid-cols-2 gap-1 rounded-2xl glass-surface p-1">
          {([['calendar', 'Kalendermonat'], ['budget', 'Budgetmonat']] as const).map(([mode, label]) =>
            <button key={mode} type="button" aria-pressed={mode === 'budget' ? budgetView : !budgetView}
              onClick={() => setCalendarView(mode === 'calendar')}
              className={`min-h-12 min-w-0 rounded-xl px-2 py-2 text-sm font-semibold ${((mode === 'budget') === budgetView) ? 'bg-ios-tint text-white' : 'text-slate-700 dark:text-slate-300'}`}>{label}</button>)}
        </div>
        <p className="text-xs text-ios-gray">{budgetView
          ? `Von Gehalt zu Gehalt: ${formatDay(period!.start)} – ${formatDay(dayBefore(period!.end))}. Ohne Gehalt ab dem ${preference.startDay}. gilt die Monatsgrenze.`
          : 'Kalendermonat: Einnahmen und Ausgaben nach Buchungsdatum.'}</p>
      </div>}

      {/* Main KPI Cards Grid */}
      <div className={`grid grid-cols-2 ${lgColumns} gap-2.5 sm:gap-4`}>
        {/* Real Account Balance Card */}
        <div className={`glass-surface glass-kpi ${spanBalance ? 'col-span-2 lg:col-span-1' : ''}`}>
          <div className="flex items-center justify-between text-ios-gray mb-1">
            <span className="text-xs font-semibold">{isPastMonth ? 'Kontostand aktuell' : 'Kontostand'}</span>
            <Landmark className="w-4 h-4 text-ios-tint" />
          </div>
          <div className="glass-kpi-value text-slate-900 dark:text-white tracking-tight">
            {realBalance.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €
          </div>
          <p className="text-[10px] text-ios-gray mt-1 truncate">
            {carriedTo ? `fortgeschrieben bis ${formatDay(carriedTo)}`
              : account?.checkpointDate ? `comdirect-Saldo vom ${formatDay(account.checkpointDate)}` : 'aus Startsaldo'}
          </p>
        </div>

        {/* Balance at the end of the selected, completed month */}
        {isPastMonth && <div className="glass-surface glass-kpi">
          <div className="flex items-center justify-between text-ios-gray mb-1">
            <span className="text-xs font-semibold">Kontostand Monatsende</span>
            <Landmark className="w-4 h-4 text-ios-gray" />
          </div>
          <div className="glass-kpi-value text-slate-900 dark:text-white tracking-tight">
            {monthEndBalance === null ? '–' : `${monthEndBalance.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €`}
          </div>
          <p className="text-[10px] text-ios-gray mt-1 truncate">
            {monthEndBalance === null
              ? `vor dem Startsaldo${account?.initialBalanceDate ? ` (${new Date(`${account.initialBalanceDate}T12:00:00`).toLocaleDateString('de-DE')})` : ''}`
              : `am ${new Date(`${selectedMonthEnd}T12:00:00`).toLocaleDateString('de-DE')}`}
          </p>
          {monthEndBeforeData && <p className="text-[10px] text-amber-700 dark:text-amber-300 mt-0.5"
            title={`Vor der ersten importierten Buchung (${new Date(`${firstBookingDate}T12:00:00`).toLocaleDateString('de-DE')}) – aus späteren Daten zurückgerechnet.`}>
            vor erster Buchung, zurückgerechnet
          </p>}
        </div>}

        {/* Net Cashflow / Monatssaldo */}
        {showMonthResult && <div className={`glass-kpi glass-kpi-cashflow relative overflow-hidden ${spanResult ? 'col-span-2 lg:col-span-1' : ''}`}>
          <div className="flex justify-between items-start text-xs font-semibold text-slate-400">
            <span>{budgetView ? 'Budgetsaldo (Monat)' : 'Cashflow (Monat)'}</span>
            <Wallet className="w-4 h-4 text-amber-300" />
          </div>
          <div className="mt-1">
            <div className={`glass-kpi-value tracking-tight ${balance >= 0 ? 'text-ios-green' : 'text-ios-red'}`}>
              {balance >= 0 ? '+' : ''}{balance.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €
            </div>
            {/* Einnahmen/Ausgaben gehören zum Monatsergebnis – eine Kachel statt drei. */}
            <dl className="mt-2 space-y-0.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <dt className="flex items-center gap-1 text-slate-300"><TrendingUp aria-hidden="true" className="w-3.5 h-3.5 shrink-0 text-ios-green" /><span className="sr-only sm:not-sr-only">{budgetView ? 'Einnahmen (Budget)' : 'Einnahmen'}</span></dt>
                <dd className="font-semibold tabular-nums whitespace-nowrap text-white">+{income.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="flex items-center gap-1 text-slate-300"><TrendingDown aria-hidden="true" className="w-3.5 h-3.5 shrink-0 text-ios-red" /><span className="sr-only sm:not-sr-only">Ausgaben</span></dt>
                <dd className="font-semibold tabular-nums whitespace-nowrap text-white">-{expense.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €</dd>
              </div>
            </dl>
            <p className="text-[10px] text-slate-300 mt-1">
              Sparquote: <span className="font-bold text-white">{savingsRate}%</span>
            </p>
          </div>
        </div>}
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
          surplusSlices={surplusSlices}
          onSelectCategory={catId => onSelectCategoryFilter(catId, period ?? undefined)}
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
            aria-label="Erste comdirect CSV importieren"
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
