import { useState } from 'react';
import { Landmark } from 'lucide-react';
import type { MonthEndBalance } from '../lib/db.ts';

const currency = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const monthLong = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });
const monthShort = new Intl.DateTimeFormat('de-DE', { month: 'short' });
const toDate = (month: string) => new Date(`${month}-15T12:00:00`);
const secondary = 'text-slate-600 dark:text-slate-300';

/** Single-series line of month-end balances. The readout replaces a floating tooltip (works on touch). */
export function BalanceHistory({ points, className }: { points: MonthEndBalance[]; className: string }) {
  const known = points.filter((point): point is MonthEndBalance & { balance: number } => point.balance !== null);
  const [active, setActive] = useState<number | null>(null);
  if (known.length === 0) return null;
  const values = known.map(point => point.balance);
  let low = Math.min(...values); let high = Math.max(...values);
  if (high - low < 1) { low -= 1; high += 1; }
  const y = (value: number) => 8 + (1 - (value - low) / (high - low)) * 84;
  const x = (index: number) => (index + 0.5) / points.length * 100;
  const line = points.flatMap((point, index) => point.balance === null ? [] : [`${x(index)},${y(point.balance)}`]).join(' ');
  const shown = active !== null && points[active]?.balance !== null ? points[active] : known[known.length - 1];
  const label = (point: MonthEndBalance) => point.current ? `${monthLong.format(toDate(point.month))} (aktuell)` : `Ende ${monthLong.format(toDate(point.month))}`;
  return <section className={className} aria-labelledby="balance-history-title">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 id="balance-history-title" className="font-bold">Kontostand-Verlauf</h2>
        <p className={`mt-1 text-xs ${secondary}`}>Kontostand jeweils zum Monatsende, laufender Monat mit aktuellem Stand.</p>
      </div>
      <Landmark aria-hidden="true" className="w-5 h-5 shrink-0 text-ios-tint" />
    </div>
    <p className="mt-3 text-sm" aria-live="polite">
      <span className={secondary}>{label(shown)}: </span>
      <span className="font-bold tabular-nums">{currency.format(shown.balance as number)}</span>
    </p>
    <div className="relative mt-2 h-40" onMouseLeave={() => setActive(null)}>
      <svg aria-hidden="true" className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
        {[8, 50, 92].map(position => <line key={position} x1="0" x2="100" y1={position} y2={position}
          className="stroke-slate-200 dark:stroke-neutral-700" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
        {low < 0 && high > 0 && <line x1="0" x2="100" y1={y(0)} y2={y(0)} className="stroke-slate-400 dark:stroke-neutral-500"
          strokeWidth="1" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />}
        <polyline points={line} fill="none" className="stroke-ios-tint" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="absolute inset-0 flex">
        {points.map((point, index) => <button key={point.month} type="button" disabled={point.balance === null}
          aria-label={point.balance === null ? `${label(point)}: vor dem Startsaldo` : `${label(point)}: ${currency.format(point.balance)}`}
          aria-pressed={shown === point}
          onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onClick={() => setActive(index)}
          className="relative h-full min-w-0 flex-1 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-ios-tint">
          {point.balance !== null && <span aria-hidden="true" style={{ top: `${y(point.balance)}%` }}
            className={`absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ios-tint ring-2 ring-white dark:ring-neutral-900 ${shown === point ? 'h-3.5 w-3.5' : 'h-2.5 w-2.5'}`} />}
        </button>)}
      </div>
    </div>
    <div aria-hidden="true" className={`mt-1 flex text-[10px] ${secondary}`}>
      {points.map(point => <span key={point.month} className="min-w-0 flex-1 truncate text-center">{monthShort.format(toDate(point.month)).replace('.', '')}</span>)}
    </div>
    <p className={`mt-2 flex justify-between text-[11px] tabular-nums ${secondary}`}>
      <span>Tief {currency.format(Math.min(...values))}</span><span>Hoch {currency.format(Math.max(...values))}</span>
    </p>
    <details className="mt-2 text-sm">
      <summary className="min-h-11 cursor-pointer py-2 font-semibold text-ios-tint">Als Tabelle anzeigen</summary>
      <table className="w-full text-left">
        <thead><tr className={secondary}><th className="py-1 font-medium">Monat</th><th className="py-1 text-right font-medium">Kontostand</th></tr></thead>
        <tbody>{points.map(point => <tr key={point.month} className="border-t border-ios-separator dark:border-ios-darkSeparator">
          <td className="py-1.5">{label(point)}</td>
          <td className="py-1.5 text-right tabular-nums">{point.balance === null ? '–' : currency.format(point.balance)}</td>
        </tr>)}</tbody>
      </table>
    </details>
  </section>;
}
