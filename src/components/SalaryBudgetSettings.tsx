import { useEffect, useId, useState } from 'react';
import type { Category } from '../types/index.ts';
import { SALARY_CATEGORY_ID } from '../lib/salaryBudget.ts';
import { useSalaryBudget } from '../lib/useSalaryBudget.ts';
import { useDashboardPreferences } from '../lib/useDashboardPreferences.ts';
import type { SavingsMode } from '../lib/dashboardPreferences.ts';
import { SettingsSection } from './SettingsSection.tsx';

export function SalaryBudgetSettings({ profileId, categories }: { profileId: string; categories: Category[] }) {
  const { preference, save } = useSalaryBudget(profileId);
  const { preference: dashboardPreference, save: saveDashboard } = useDashboardPreferences(profileId);
  const [showMonthResult, setShowMonthResult] = useState(dashboardPreference.showMonthResult);
  const [savingsMode, setSavingsMode] = useState(dashboardPreference.savingsMode);
  const savingsId = useId();
  const dayId = useId();
  const [enabled, setEnabled] = useState(preference.enabled);
  const [startDay, setStartDay] = useState(preference.startDay);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const salary = categories.find(category => category.id === SALARY_CATEGORY_ID && category.type === 'income');
  useEffect(() => {
    setEnabled(preference.enabled); setStartDay(preference.startDay);
  }, [profileId, preference.enabled, preference.startDay]);
  useEffect(() => {
    setShowMonthResult(dashboardPreference.showMonthResult); setSavingsMode(dashboardPreference.savingsMode);
  }, [profileId, dashboardPreference.showMonthResult, dashboardPreference.savingsMode]);
  return <SettingsSection id="salary-budget" title="Monatsansicht & Gehalt" profileId={profileId}>
    <form className="space-y-4 text-sm" onSubmit={event => {
      event.preventDefault(); setNotice(''); setError('');
      try { save({ enabled, startDay }); saveDashboard({ showMonthResult, savingsMode }); setNotice('Monatsansicht gespeichert.'); }
      catch (cause) { setError(cause instanceof Error ? cause.message : 'Speichern fehlgeschlagen.'); }
    }}>
      <label className="flex min-h-12 items-center gap-3">
        <input type="checkbox" checked={showMonthResult} onChange={event => { setShowMonthResult(event.target.checked); setNotice(''); }} />
        <span>Monatsergebnis mit Einnahmen und Ausgaben in der Übersicht zeigen</span>
      </label>
      <div>
        <label htmlFor={savingsId} className="block font-medium">Sparen &amp; Investieren in der Übersicht</label>
        <select id={savingsId} value={savingsMode} onChange={event => { setSavingsMode(event.target.value as SavingsMode); setNotice(''); }}
          className="mt-1 block min-h-12 min-w-0 w-full max-w-full rounded-xl border border-ios-separator dark:border-ios-darkSeparator bg-white dark:bg-neutral-800 px-3 text-base">
          <option value="netted">Verrechnen (Standard)</option>
          <option value="surplus">Verrechnen, Überschuss anzeigen</option>
          <option value="transfer">Als Umbuchung (nicht in Einnahmen/Ausgaben)</option>
        </select>
        <p className="mt-1 text-ios-gray">{savingsMode === 'netted'
          ? 'Sparen zählt als Ausgabe, Rücküberträge werden verrechnet. Bleibt unterm Strich ein Plus, zählt es als Einnahme und die Kategorie fehlt in der Grafik.'
          : savingsMode === 'surplus'
            ? 'Wie Standard, aber ein Plus erscheint als graue Zeile „Überschuss“ unter den Kategorien. Summen bleiben gleich.'
            : 'Sparbuchungen und Rücküberträge zählen weder als Einnahme noch als Ausgabe. Monatsergebnis und Sparquote ändern sich; der Kontostand nicht.'}</p>
      </div>
      <label className="flex min-h-12 items-center gap-3">
        <input type="checkbox" checked={enabled} disabled={!salary && !enabled} onChange={event => { setEnabled(event.target.checked); setNotice(''); }} />
        <span>Gehalt für den Folgemonat verwenden</span>
      </label>
      <div>
        <label htmlFor={dayId} className="block font-medium">Gehalt ab Tag</label>
        <select id={dayId} value={startDay} disabled={!enabled || !salary} onChange={event => { setStartDay(Number(event.target.value)); setNotice(''); }}
          className="mt-1 block min-h-12 min-w-0 w-full max-w-full rounded-xl border border-ios-separator dark:border-ios-darkSeparator bg-white dark:bg-neutral-800 px-3 text-base">
          {Array.from({ length: 31 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}.</option>)}
        </select>
      </div>
      <p className="text-ios-gray">Positive gebuchte Einnahmen in „{salary?.name || 'Gehalt & Einkommen'}“ zählen ab diesem Tag einschließlich zum Budget des Folgemonats. In kürzeren Monaten gilt spätestens der letzte Monatstag.</p>
      {!salary && <p className="text-ios-gray">Die Kategorie „Gehalt & Einkommen“ ist in diesem Profil nicht vorhanden. Die Übersicht bleibt beim Kalendermonat.</p>}
      <p className="text-ios-gray">In der Übersicht kannst du zwischen Kalender- und Budgetmonat wechseln. Buchungsdatum, Kontostand, Buchungsliste und Statistik bleiben nach dem tatsächlichen Zahlungseingang erhalten.</p>
      <p className="text-xs text-ios-gray">Gilt für dieses Profil auf diesem Gerät bzw. in diesem Browser. Wird nicht mit Backups oder iCloud übertragen.</p>
      {error && <p role="alert" className="text-ios-red">{error}</p>}
      {notice && <p role="status" className="text-ios-green">{notice}</p>}
      <button type="submit" className="min-h-12 rounded-xl bg-ios-tint px-4 py-3 font-semibold text-white">Monatsansicht speichern</button>
    </form>
  </SettingsSection>;
}
