import { useCallback, useMemo } from 'react';
import { detectPlatform } from '../platform/capabilities.ts';
import { SAVINGS_MODES, dashboardPreferencesStorageKey, readDashboardPreferences, type DashboardPreferences } from './dashboardPreferences.ts';
import { useLocalPreferenceRaw, writeLocalPreference } from './useLocalPreference.ts';

export function useDashboardPreferences(profileId: string) {
  const key = dashboardPreferencesStorageKey(profileId, detectPlatform().isNative ? 'ios' : 'web');
  const raw = useLocalPreferenceRaw(key);
  const preference = useMemo(() => readDashboardPreferences(raw), [raw]);
  const save = useCallback((value: DashboardPreferences) => {
    if (!SAVINGS_MODES.includes(value.savingsMode)) throw new Error('Bitte eine Darstellung für Sparen & Investieren wählen.');
    writeLocalPreference(key, { showMonthResult: value.showMonthResult === true, savingsMode: value.savingsMode },
      'Die Übersicht-Einstellung konnte auf diesem Gerät nicht gespeichert werden.');
  }, [key]);
  return { preference, save };
}
