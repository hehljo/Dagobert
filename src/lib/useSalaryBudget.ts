import { useCallback, useMemo } from 'react';
import { detectPlatform } from '../platform/capabilities.ts';
import { isSalaryBudgetPreferences, readSalaryBudgetPreferences, salaryBudgetStorageKey, type SalaryBudgetPreferences } from './salaryBudget.ts';
import { useLocalPreferenceRaw, writeLocalPreference } from './useLocalPreference.ts';

export function useSalaryBudget(profileId: string) {
  const key = salaryBudgetStorageKey(profileId, detectPlatform().isNative ? 'ios' : 'web');
  const raw = useLocalPreferenceRaw(key);
  const preference = useMemo(() => readSalaryBudgetPreferences(raw), [raw]);
  const save = useCallback((value: SalaryBudgetPreferences) => {
    if (!isSalaryBudgetPreferences(value)) throw new Error('Bitte einen Tag zwischen 1 und 31 wählen.');
    writeLocalPreference(key, { enabled: value.enabled, startDay: value.startDay },
      'Die Monatsansicht konnte auf diesem Gerät nicht gespeichert werden.');
  }, [key]);
  return { preference, save };
}
