import React, { useState } from 'react';
import { PieChart, Tag } from 'lucide-react';
import { CategoryIcon } from './CategoryIcon.tsx';

export interface DonutSlice {
  id: string;
  label: string;
  value: number;
  color: string;
  icon?: string;
}

interface DonutChartProps {
  slices: DonutSlice[];
  currency?: string;
  onSelectCategory?: (id: string) => void;
  label?: string;
  emptyMessage?: string;
  showLegend?: boolean;
  selectedCategoryId?: string | null;
}

export const DonutChart: React.FC<DonutChartProps> = ({
  slices, currency = '€', onSelectCategory, label = 'Ausgaben',
  emptyMessage = 'Keine Ausgaben in diesem Zeitraum', showLegend = true, selectedCategoryId,
}) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const total = slices.reduce((sum, s) => sum + s.value, 0);

  if (total <= 0 || slices.length === 0) {
    return (
      <div className="h-64 flex flex-col items-center justify-center text-ios-gray text-sm space-y-2">
        <PieChart className="w-8 h-8 opacity-40" />
        <span>{emptyMessage}</span>
      </div>
    );
  }

  // Calculate SVG arc paths
  const size = 200;
  const strokeWidth = 32;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  let accumulatedAngle = 0;

  const renderedSlices = slices.map((slice) => {
    const percentage = slice.value / total;
    const strokeDasharray = `${percentage * circumference} ${circumference}`;
    const strokeDashoffset = -accumulatedAngle * circumference;
    accumulatedAngle += percentage;

    const isHovered = hoveredId === slice.id || selectedCategoryId === slice.id;

    return {
      ...slice,
      percentage: Math.round(percentage * 100),
      strokeDasharray,
      strokeDashoffset,
      isHovered
    };
  });

  const activeSlice = slices.find(s => s.id === hoveredId);

  return (
    <div className="flex flex-col md:flex-row items-center justify-around gap-6 py-2">
      {/* SVG Donut */}
      <div className="relative w-48 h-48 flex-shrink-0">
        <svg role="group" aria-label={`${label} nach Kategorien`} className="w-full h-full -rotate-90 transform" viewBox={`0 0 ${size} ${size}`}>
          {/* Background circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="transparent"
            stroke="currentColor"
            className="text-slate-200 dark:text-neutral-800"
            strokeWidth={strokeWidth}
          />

          {/* Slices */}
          {renderedSlices.map((slice) => (
            <circle
              key={slice.id}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="transparent"
              stroke={slice.color}
              strokeWidth={slice.isHovered ? strokeWidth + 4 : strokeWidth}
              strokeDasharray={slice.strokeDasharray}
              strokeDashoffset={slice.strokeDashoffset}
              strokeLinecap="round"
              className="cursor-pointer transition-all duration-300 hover:opacity-90"
              onMouseEnter={() => setHoveredId(slice.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => onSelectCategory?.(slice.id)}
              role={onSelectCategory ? 'button' : undefined}
              tabIndex={onSelectCategory ? 0 : undefined}
              aria-label={`${slice.label}: ${slice.value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency} (${slice.percentage} %)`}
              aria-pressed={selectedCategoryId === slice.id}
              onFocus={() => setHoveredId(slice.id)}
              onBlur={() => setHoveredId(null)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelectCategory?.(slice.id);
                }
              }}
            />
          ))}
        </svg>

        {/* Center label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-4">
          {activeSlice ? (
            <>
              <div className="mb-1 text-slate-800 dark:text-slate-200">
                {activeSlice.icon ? <CategoryIcon name={activeSlice.icon} className="w-5 h-5 mx-auto" /> : <Tag className="w-5 h-5 mx-auto" />}
              </div>
              <span className="text-xs text-ios-gray font-medium truncate max-w-[120px]">{activeSlice.label}</span>
              <span className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                {activeSlice.value.toLocaleString('de-DE', { minimumFractionDigits: 2 })} {currency}
              </span>
            </>
          ) : (
            <>
              <span className="text-[11px] uppercase tracking-wider text-ios-gray font-medium">{label}</span>
              <span className="text-base font-extrabold text-slate-900 dark:text-white tracking-tight">
                {total.toLocaleString('de-DE', { minimumFractionDigits: 2 })} {currency}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Legend */}
      {showLegend && <div className="w-full max-w-sm space-y-2">
        {slices.slice(0, 6).map((slice) => {
          const pct = Math.round((slice.value / total) * 100);
          return (
            <button
              type="button"
              key={slice.id}
              disabled={!onSelectCategory}
              onClick={() => onSelectCategory?.(slice.id)}
              onMouseEnter={() => setHoveredId(slice.id)}
              onMouseLeave={() => setHoveredId(null)}
              className={`w-full min-h-[48px] text-left flex items-center justify-between p-2 rounded-xl cursor-pointer transition-colors ${
                hoveredId === slice.id ? 'bg-slate-100 dark:bg-neutral-800' : 'hover:bg-slate-50 dark:hover:bg-neutral-800/50'
              }`}
            >
              <span className="flex items-center space-x-2.5 min-w-0">
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: slice.color }} />
                <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate flex items-center gap-1.5">
                  {slice.icon && <CategoryIcon name={slice.icon} className="w-4 h-4 text-ios-gray flex-shrink-0" />}
                  <span>{slice.label}</span>
                </span>
              </span>
              <span className="flex items-center space-x-2 text-sm text-right flex-shrink-0">
                <span className="text-xs text-ios-gray font-mono">{pct}%</span>
                <span className="font-semibold text-slate-900 dark:text-white">
                  {slice.value.toLocaleString('de-DE', { minimumFractionDigits: 2 })} {currency}
                </span>
              </span>
            </button>
          );
        })}
      </div>}
    </div>
  );
};
