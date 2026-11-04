/** How the dashboard treats "Sparen & Investieren": netted (default, as before), net inflow listed, or as a transfer. */
export type SavingsMode = 'netted' | 'surplus' | 'transfer';
export const SAVINGS_MODES: readonly SavingsMode[] = ['netted', 'surplus', 'transfer'];
export interface DashboardPreferences {
  /** Einnahmen minus Ausgaben des gewählten Monats als eigene Kachel. Reine Auswertung, kein Kontobestand. */
  showMonthResult: boolean;
  savingsMode: SavingsMode;
}
export const DEFAULT_DASHBOARD_PREFERENCES: Readonly<DashboardPreferences> = Object.freeze({ showMonthResult: true, savingsMode: 'netted' });

export function isDashboardPreferences(value: unknown): value is DashboardPreferences {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && typeof (value as Partial<DashboardPreferences>).showMonthResult === 'boolean'
    && SAVINGS_MODES.includes((value as Partial<DashboardPreferences>).savingsMode as SavingsMode);
}

export function readDashboardPreferences(raw: string | null): DashboardPreferences {
  try {
    const value: unknown = JSON.parse(raw || 'null');
    // Older stored values have no savingsMode: keep their result toggle, default the rest.
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const stored = value as Partial<DashboardPreferences>;
      return {
        showMonthResult: typeof stored.showMonthResult === 'boolean' ? stored.showMonthResult : DEFAULT_DASHBOARD_PREFERENCES.showMonthResult,
        savingsMode: SAVINGS_MODES.includes(stored.savingsMode as SavingsMode) ? stored.savingsMode as SavingsMode : DEFAULT_DASHBOARD_PREFERENCES.savingsMode,
      };
    }
  } catch { /* Invalid local preferences use the defaults. */ }
  return { ...DEFAULT_DASHBOARD_PREFERENCES };
}

export function dashboardPreferencesStorageKey(profileId: string, platform: 'web' | 'ios'): string {
  return `dagobert_dashboard_${JSON.stringify([platform, profileId])}`;
}

/** Last calendar day of a YYYY-MM month as YYYY-MM-DD. */
export function monthEndDate(month: string): string {
  const [year, number] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return `${month}-${String(lastDay).padStart(2, '0')}`;
}

/** Local YYYY-MM of `now`; months before it are complete. */
export function currentMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
