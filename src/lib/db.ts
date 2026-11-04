import type { Transaction, Account } from '../types/index.ts';
export { DEFAULT_ACCOUNT, DEFAULT_CATEGORIES, DEFAULT_RULES, COMDIRECT_TEMPLATE } from '../data/defaults.ts';

/**
 * Calculates current real account balance.
 * If a comdirect checkpoint (Neuer Kontostand) exists:
 * current = checkpointBalance + sum(transactions where date > checkpointDate)
 * Otherwise:
 * current = initialBalance + sum(transactions where date >= initialBalanceDate)
 */
function bookedAccountTransactions(account: Account, txs: Transaction[]): Transaction[] {
  // STRICT ACCOUNT SCOPING: Only include transactions belonging to this account and exclude unbooked 'pending' items!
  return txs.filter(t =>
    (t.accountId ? t.accountId === account.id : (!t.account || t.account === account.name || t.account === account.id)) &&
    t.status !== 'pending'
  );
}

function sumCents(txs: Transaction[]): number {
  return txs.reduce((sum, t) => sum + Math.round(t.amount * 100), 0);
}

/**
 * Balance at the end of `date` (YYYY-MM-DD), derived from the same anchors as the current balance.
 * Checkpoint: walks forward or backward from the comdirect balance. Without checkpoint, dates before
 * the start balance are unknown and return null. Never changes stored data.
 */
export function calculateAccountBalanceAt(account: Account | undefined, txs: Transaction[], date: string): number | null {
  if (!account || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const accountTxs = bookedAccountTransactions(account, txs);
  if (typeof account.checkpointBalance === 'number' && account.checkpointDate) {
    const checkpoint = account.checkpointDate;
    const delta = date >= checkpoint
      ? sumCents(accountTxs.filter(t => t.date > checkpoint && t.date <= date))
      : -sumCents(accountTxs.filter(t => t.date > date && t.date <= checkpoint));
    return (Math.round(account.checkpointBalance * 100) + delta) / 100;
  }
  if (date < account.initialBalanceDate) return null;
  const delta = sumCents(accountTxs.filter(t => t.date >= account.initialBalanceDate && t.date <= date));
  return (Math.round(account.initialBalance * 100) + delta) / 100;
}

/** Earliest booked transaction date of this account, or null without bookings. */
export function firstBookedAccountDate(account: Account | undefined, txs: Transaction[]): string | null {
  if (!account) return null;
  let first: string | null = null;
  for (const t of bookedAccountTransactions(account, txs)) if (first === null || t.date < first) first = t.date;
  return first;
}

/** Latest booked transaction date of this account, or null without bookings. */
export function lastBookedAccountDate(account: Account | undefined, txs: Transaction[]): string | null {
  if (!account) return null;
  let last: string | null = null;
  for (const t of bookedAccountTransactions(account, txs)) if (last === null || t.date > last) last = t.date;
  return last;
}

export interface MonthEndBalance { month: string; date: string; balance: number | null; current: boolean }

/**
 * Month-end balances for `count` months ending at `endMonth` (YYYY-MM). Months after `today`'s month are
 * dropped; the running month uses the current balance instead of a month end that has not happened yet.
 */
export function monthEndBalances(account: Account | undefined, txs: Transaction[], endMonth: string, count: number, today: Date = new Date()): MonthEndBalance[] {
  const running = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const [endYear, endNumber] = endMonth.split('-').map(Number);
  const result: MonthEndBalance[] = [];
  for (let offset = count - 1; offset >= 0; offset--) {
    const index = endYear * 12 + (endNumber - 1) - offset;
    const month = `${String(Math.floor(index / 12)).padStart(4, '0')}-${String(index % 12 + 1).padStart(2, '0')}`;
    if (month > running) continue;
    const lastDay = new Date(Date.UTC(Math.floor(index / 12), index % 12 + 1, 0)).getUTCDate();
    const date = `${month}-${String(lastDay).padStart(2, '0')}`;
    const current = month === running;
    result.push({ month, date, current, balance: current ? (account ? calculateRealAccountBalance(account, txs) : null) : calculateAccountBalanceAt(account, txs, date) });
  }
  return result;
}

export function calculateRealAccountBalance(account: Account | undefined, txs: Transaction[]): number {
  if (!account) return 0;
  const accountTxs = bookedAccountTransactions(account, txs);

  if (typeof account.checkpointBalance === 'number' && account.checkpointDate) {
    // Only transactions AFTER checkpoint date
    const afterCheckpoint = accountTxs.filter(t => t.date > account.checkpointDate!);
    const delta = afterCheckpoint.reduce((sum, t) => sum + Math.round(t.amount * 100), 0) / 100;
    return (Math.round(account.checkpointBalance * 100) + Math.round(delta * 100)) / 100;
  }

  const fromInitial = accountTxs.filter(t => t.date >= account.initialBalanceDate);
  const sum = fromInitial.reduce((sum, t) => sum + Math.round(t.amount * 100), 0) / 100;
  return (Math.round(account.initialBalance * 100) + Math.round(sum * 100)) / 100;
}
