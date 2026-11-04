import type { Account, Category, Profile } from '../types/index.ts';
import React, { useState, useEffect, useCallback } from 'react';
import { Download, Upload, Trash2, Shield, Moon, Sun, Sparkles, Fingerprint, KeyRound, Check, Tag, Plus, X, Cloud, CloudOff, RefreshCw, Share2 } from 'lucide-react';
// db helpers
import { parseGermanAmount } from '../lib/csvParser.ts';
import { updateAccountSettings, exportProfileBackup, resetProfileData, batchImportTransactions, createCategory, deleteCategory, updateProfilePin } from '../lib/api.ts';
import { APP_VERSION, BUILD_DATE } from '../version.ts';
import { getSecurityConfig, saveSecurityConfig, registerPasskey, isPasskeySupported, hashPin, type SecurityConfig } from '../lib/passkey.ts';
import { CategoryIcon, AVAILABLE_CATEGORY_ICONS, AVAILABLE_CATEGORY_COLORS } from './CategoryIcon.tsx';
import { BackupImportModal } from './BackupImportModal.tsx';
import { getRepository } from '../data/repository.ts';
import { detectPlatform } from '../platform/capabilities.ts';
import type { CloudKitSyncStatus, SyncConflict, RecoveryBackup } from '../data/interfaces.ts';
import { syncStatusLabel } from '../lib/syncStatus.ts';
import { SettingsSection } from './SettingsSection.tsx';
import { SalaryBudgetSettings } from './SalaryBudgetSettings.tsx';
import { APP_UNLOCKED_EVENT, isAppLockedError } from '../platform/appAccess.ts';

interface SettingsViewProps {
  profile?: Profile;
  profileId?: string;
  account?: Account;
  categories?: Category[];
  isDark: boolean;
  onToggleDark: () => void;
  onDataChanged: () => void;
  onProfilesChanged?: (silent?: boolean) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ isDark, onToggleDark, onDataChanged, onProfilesChanged, account, categories = [], profile, profileId = 'privat' }) => {
  const [isExporting, setIsExporting] = useState(false);
  const [security, setSecurity] = useState<SecurityConfig>(getSecurityConfig());
  const [pinInput, setPinInput] = useState('');
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [secNotice, setSecNotice] = useState<string | null>(null);
  const [showProfilePinSetup, setShowProfilePinSetup] = useState(false);
  const [profilePinInput, setProfilePinInput] = useState('');
  const [profilePinNotice, setProfilePinNotice] = useState<string | null>(null);
  const [isSavingProfilePin, setIsSavingProfilePin] = useState(false);
  const [initBalInput, setInitBalInput] = useState(account ? account.initialBalance.toFixed(2).replace('.', ',') : '0,00');
  const [initDateInput, setInitDateInput] = useState(account?.initialBalanceDate || '2026-01-01');
  const [checkpointBalInput, setCheckpointBalInput] = useState(
    typeof account?.checkpointBalance === 'number' ? account.checkpointBalance.toFixed(2).replace('.', ',') : ''
  );
  const [checkpointDateInput, setCheckpointDateInput] = useState(account?.checkpointDate || '');

  // Category management state
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatType, setNewCatType] = useState<'expense' | 'income' | 'transfer'>('expense');
  const [newCatColor, setNewCatColor] = useState(AVAILABLE_CATEGORY_COLORS[0]);
  const [newCatIcon, setNewCatIcon] = useState(AVAILABLE_CATEGORY_ICONS[0]);
  const [isSavingCategory, setIsSavingCategory] = useState(false);

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) {
      alert('Bitte einen Kategorienamen eingeben.');
      return;
    }
    setIsSavingCategory(true);
    try {
      await createCategory(profileId, {
        name: newCatName.trim(),
        type: newCatType,
        color: newCatColor,
        icon: newCatIcon
      });
      setNewCatName('');
      setShowAddCategory(false);
      onDataChanged();
    } catch (err: any) {
      alert(err.message || 'Fehler beim Speichern der Kategorie');
    } finally {
      setIsSavingCategory(false);
    }
  };

  const handleDeleteCategory = async (catId: string, catName: string) => {
    if (confirm(`Kategorie "${catName}" wirklich löschen? Alle zugeordneten Buchungen werden auf "Sonstiges" umgestellt.`)) {
      try {
        await deleteCategory(profileId, catId);
        onDataChanged();
      } catch (err: any) {
        alert(err.message || 'Fehler beim Löschen');
      }
    }
  };

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseGermanAmount(initBalInput);
    if (val === null) {
      alert('Bitte einen gültigen Betrag für den Startsaldo eingeben (z. B. 0,00).');
      return;
    }
    const cpVal = checkpointBalInput.trim() ? parseGermanAmount(checkpointBalInput) : null;
    if (checkpointBalInput.trim() && cpVal === null) {
      alert('Bitte einen gültigen Betrag für den comdirect-Stichtagssaldo eingeben.');
      return;
    }
    const cpDate = checkpointDateInput.trim() ? checkpointDateInput : null;

    await updateAccountSettings(profileId, 'comdirect', val, initDateInput, cpVal, cpDate);
    alert('Kontoeinstellungen erfolgreich gespeichert!');
    onDataChanged();
  };

  const handleSaveProfilePin = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = profilePinInput.trim();
    if (!/^\d{4,6}$/.test(clean)) {
      alert('Die Profil-PIN muss 4 bis 6 Ziffern enthalten.');
      return;
    }
    setIsSavingProfilePin(true);
    try {
      await updateProfilePin(profileId, clean);
      setProfilePinNotice(platform.isNative ? 'Profil-PIN auf diesem Gerät gespeichert. Andere Geräte benötigen eine eigene PIN-Einrichtung.' : 'Profil-PIN erfolgreich auf dem Server gespeichert! Jedes neue Gerät muss diese PIN eingeben.');
      setShowProfilePinSetup(false);
      setProfilePinInput('');
      onProfilesChanged?.(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Fehler beim Speichern der Profil-PIN');
    } finally {
      setIsSavingProfilePin(false);
    }
  };

  const handleRemoveProfilePin = async () => {
    if (confirm(platform.isNative ? 'Profil-PIN auf diesem Gerät entfernen? Dieses Profil lässt sich danach ohne eigene PIN öffnen.' : 'Profil-PIN auf dem Server wirklich entfernen? Der gespeicherte Bankzugang wird dabei entfernt. Jedes Gerät im Netzwerk hat dann wieder direkten Zugriff auf alle Buchungen.')) {
      setIsSavingProfilePin(true);
      try {
        await updateProfilePin(profileId, null);
        setProfilePinNotice(platform.isNative ? 'Profil-PIN auf diesem Gerät entfernt.' : 'Profil-PIN auf dem Server entfernt.');
        setShowProfilePinSetup(false);
        setProfilePinInput('');
        onProfilesChanged?.(true);
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Fehler beim Entfernen der Profil-PIN');
      } finally {
        setIsSavingProfilePin(false);
      }
    }
  };

  const handleToggleSecurity = async () => {
    if (detectPlatform().isNative) {
      const repo = getRepository();
      if (!repo.setAppLockEnabled) return;
      try {
        await repo.setAppLockEnabled(!security.enabled);
        setSecurity({ enabled: !security.enabled, type: 'passkey' });
        setSecNotice(!security.enabled ? 'App-Sperre aktiviert. Beim Wiederöffnen wird der Gerätecode, Face ID oder Touch ID benötigt.' : 'App-Sperre deaktiviert.');
      } catch (error) { setSecNotice(error instanceof Error ? error.message : 'App-Sperre wurde nicht geändert.'); }
      return;
    }

    if (security.enabled) {
      if (confirm('App-Sperre deaktivieren?')) {
        const next: SecurityConfig = { enabled: false, type: 'pin' };
        saveSecurityConfig(next);
        setSecurity(next);
        setSecNotice('App-Sperre deaktiviert.');
      }
      return;
    }

    // 2. Try WebAuthn passkey if supported
    if (isPasskeySupported()) {
      try {
        const credId = await registerPasskey('Johannes Hehl');
        const next: SecurityConfig = { enabled: true, type: 'passkey', credentialId: credId };
        saveSecurityConfig(next);
        setSecurity(next);
        setSecNotice('Passkey (Face ID / Touch ID) erfolgreich eingerichtet!');
        return;
      } catch (err: unknown) {
        console.warn('Passkey registration not completed:', err);
      }
    }

    // Fallback to PIN setup
    setShowPinSetup(true);
  };

  const handleSavePin = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPin = pinInput.trim();
    if (!/^\d{4,6}$/.test(cleanPin)) {
      alert('Die PIN muss 4 bis 6 Ziffern enthalten.');
      return;
    }

    const hashed = await hashPin(cleanPin);
    const next: SecurityConfig = { enabled: true, type: 'pin', pinHash: hashed };
    saveSecurityConfig(next);
    setSecurity(next);
    setShowPinSetup(false);
    setPinInput('');
    setSecNotice('PIN-Sperre erfolgreich aktiviert!');
  };

  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState<CloudKitSyncStatus | null>(null);
  const [isSyncingNow, setIsSyncingNow] = useState(false);
  const [isChangingSync, setIsChangingSync] = useState(false);
  const [syncReadError, setSyncReadError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [recoveries, setRecoveries] = useState<RecoveryBackup[]>([]);
  const [isReviewingConflicts, setIsReviewingConflicts] = useState(false);
  const platform = detectPlatform();

  const refreshSyncStatus = useCallback(async () => {
    const repo = getRepository();
    if (!repo.getSyncStatus) return;
    try {
      setSyncStatus(await repo.getSyncStatus());
      setSyncReadError(null);
    } catch (error) {
      if (isAppLockedError(error)) { setSyncReadError(null); return; }
      setSyncStatus(null);
      setSyncReadError('iCloud-Status konnte nicht gelesen werden. Bitte erneut versuchen.');
    }
  }, []);

  useEffect(() => {
    if (!platform.hasCloudKit) return;
    let pending = false;
    const refresh = async () => {
      if (document.hidden || pending) return;
      pending = true;
      try { await refreshSyncStatus(); } finally { pending = false; }
    };
    void refresh();
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    window.addEventListener(APP_UNLOCKED_EVENT, refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener(APP_UNLOCKED_EVENT, refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [platform.hasCloudKit, refreshSyncStatus]);

  // Device security and recovery metadata are independent of CloudKit availability.
  useEffect(() => {
    const repo = getRepository();
    if (repo.getDeviceSecurity) repo.getDeviceSecurity().then(config => setSecurity({ enabled: config.enabled, type: 'passkey' })).catch(() => setSecNotice('Gerätesicherheit konnte nicht gelesen werden.'));
    if (repo.getRecoveryBackups) repo.getRecoveryBackups(profileId).then(setRecoveries).catch(() => {});
  }, [profileId]);

  const handleToggleSync = async () => {
    const repo = getRepository();
    if (!repo.setSyncEnabled || !syncStatus || isChangingSync || isSyncingNow) return;
    const next = !syncStatus?.enabled;
    if (next && !confirm('iCloud für diesen Apple-Account aktivieren? Lokale und vorhandene iCloud-Daten werden zusammengeführt. Spätere Änderungen wirken auch auf deine anderen iPhones und iPads.')) return;
    setIsChangingSync(true);
    try {
      await repo.setSyncEnabled(next);
    } catch (err: any) {
      alert(err.message || 'Fehler beim Ändern des iCloud-Status.');
    } finally {
      await refreshSyncStatus();
      setIsChangingSync(false);
    }
  };

  const handleTriggerSync = async () => {
    const repo = getRepository();
    if (!repo.triggerSync || isChangingSync || isSyncingNow) return;
    setIsSyncingNow(true);
    try {
      await repo.triggerSync();
      onDataChanged();
    } catch (err: any) {
      alert(err.message || 'Synchronisierung fehlgeschlagen.');
    } finally {
      await refreshSyncStatus();
      setIsSyncingNow(false);
    }
  };

  const handleExportBackup = async (allProfiles = false) => {
    setIsExporting(true);
    try {
      const data = await exportProfileBackup(profileId, allProfiles);
      const jsonStr = JSON.stringify(data, null, 2);
      const filename = `dagobert_${allProfiles ? 'gesamtbackup' : 'backup'}_${new Date().toISOString().slice(0, 10)}.json`;

      if (platform.isNative) {
        const share = getRepository().shareBackup;
        if (!share) throw new Error('Die native Dateifreigabe fehlt.');
        await share.call(getRepository(), data);
        return;
      }

      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Backup konnte nicht exportiert werden.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleLoadDemoData = async () => {
    if (!confirm('Demo-Daten für comdirect laden? (Fügt Testbuchungen mit Umlauten ein)')) return;

    const sampleTxs = [
      {
        date: '2026-10-01',
        amount: 3250.00,
        currency: 'EUR',
        payee: 'Arbeitgeber GmbH',
        purpose: 'Gehalt Oktober 2026',
        rawText: 'Auftraggeber: Arbeitgeber GmbH Buchungstext: Gehalt Oktober 2026 Ref. 99281',
        type: 'Übertrag / Überweisung',
        category: 'gehalt',
        account: 'comdirect Girokonto',
        importedAt: new Date().toISOString(),
        sourceHash: 'demo_1'
      },
      {
        date: '2026-10-02',
        amount: -850.00,
        currency: 'EUR',
        payee: 'Hausverwaltung Becker',
        purpose: 'Miete & Nebenkosten 10/2026',
        rawText: 'Empfänger: Hausverwaltung Becker Buchungstext: Miete & Nebenkosten 10/2026',
        type: 'Dauerauftrag / Lastschrift',
        category: 'wohnen',
        account: 'comdirect Girokonto',
        importedAt: new Date().toISOString(),
        sourceHash: 'demo_2'
      },
      {
        date: '2026-10-04',
        amount: -64.80,
        currency: 'EUR',
        payee: 'REWE Markt Augsburg',
        purpose: 'Kartenzahlung 04.10.',
        rawText: 'Kartenverfügung REWE Markt Augsburg',
        type: 'Kartenverfügung',
        category: 'lebensmittel',
        account: 'comdirect Girokonto',
        importedAt: new Date().toISOString(),
        sourceHash: 'demo_3'
      },
      {
        date: '2026-10-07',
        amount: -71.20,
        currency: 'EUR',
        payee: 'ARAL Tankstelle',
        purpose: 'Tanken Super E10',
        rawText: 'Kartenverfügung ARAL Tankstelle Augsburg',
        type: 'Kartenverfügung',
        category: 'mobilitaet',
        account: 'comdirect Girokonto',
        importedAt: new Date().toISOString(),
        sourceHash: 'demo_4'
      },
      {
        date: '2026-10-09',
        amount: -17.99,
        currency: 'EUR',
        payee: 'Netflix International',
        purpose: 'Monatsbeitrag',
        rawText: 'Empfänger: Netflix International Buchungstext: Monatsbeitrag',
        type: 'Lastschrift / Belastung',
        category: 'abos',
        account: 'comdirect Girokonto',
        importedAt: new Date().toISOString(),
        sourceHash: 'demo_5'
      },
      {
        date: '2026-10-12',
        amount: -45.00,
        currency: 'EUR',
        payee: 'Pizzeria Da Salvatore',
        purpose: 'Abendessen mit Freunden',
        rawText: 'Kartenverfügung Pizzeria Da Salvatore',
        type: 'Kartenverfügung',
        category: 'freizeit',
        account: 'comdirect Girokonto',
        importedAt: new Date().toISOString(),
        sourceHash: 'demo_6'
      }
    ];

    await batchImportTransactions(profileId, sampleTxs);
    onDataChanged();
    alert('Demo-Daten erfolgreich hinzugefügt!');
  };

  const handleResetDatabase = async () => {
    if (confirm('Wirklich ALLE Buchungen, Kategorien und Regeln in diesem Profil zurücksetzen?')) {
      await resetProfileData(profileId);
      onDataChanged();
      alert('Profil auf Werkseinstellungen zurückgesetzt.');
    }
  };

  return (
    <div className="space-y-5 pb-24 max-w-5xl mx-auto px-4 pt-4">
      {/* Privacy Notice Banner */}
      <SettingsSection id="privacy" title={platform.isNative ? 'Lokal gespeichert, iCloud optional' : 'Speicherung auf deinem Server'} profileId={profileId}>
        <Shield className="w-6 h-6 text-emerald-500 flex-shrink-0 mt-0.5" />
        <div className="text-xs space-y-1">
          <p className="text-slate-600 dark:text-slate-300">
            {platform.isNative
              ? 'Deine Kontodaten liegen auf diesem iPhone oder iPad. Ohne aktivierte iCloud-Synchronisierung braucht Dagobert keinen Server. JSON-Exporte kannst du selbst übertragen.'
              : 'Deine Kontodaten liegen in der SQLite-Datenbank deiner Dagobert-Installation. Der Browser greift auf diesen Server zu. JSON-Exporte kannst du selbst übertragen.'}
          </p>
        </div>
      </SettingsSection>

      {/* Profil-PIN (Globaler Server-Schutz) */}
      <SalaryBudgetSettings key={profileId} profileId={profileId} categories={categories} />

      {!platform.isNative && <SettingsSection id="profile-pin" title="Profil-PIN" profileId={profileId}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${profile?.hasPin ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'}`}>
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <span>{platform.isNative ? (profile?.hasPin ? 'Profil-PIN auf diesem Gerät aktiv' : 'Keine Profil-PIN auf diesem Gerät') : (profile?.hasPin ? 'Profil-PIN aktiv (Server-Schutz)' : 'Kein Server-Schutz aktiv')}</span>
                {profile?.hasPin ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">Gesperrt</span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400">Offen</span>
                )}
              </p>
              <p className="text-xs text-ios-gray">
                {platform.isNative ? 'Die Profil-PIN gilt für dieses Gerät und wird nicht per Backup oder iCloud übertragen.' : profile?.hasPin
                  ? 'Alle neuen Geräte und Browser müssen diese PIN eingeben'
                  : 'Achtung: Jedes Gerät im Netzwerk kann deine Umsätze ohne Abfrage laden!'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowProfilePinSetup(!showProfilePinSetup)}
            className="px-3.5 py-2 bg-ios-tint/10 hover:bg-ios-tint/20 text-ios-tint rounded-xl text-xs font-semibold transition-colors min-h-[44px]"
          >
            {profile?.hasPin ? 'PIN ändern / löschen' : platform.isNative ? 'Profil-PIN einrichten' : 'Server-PIN einrichten'}
          </button>
        </div>

        {profilePinNotice && (
          <div className="p-3 bg-ios-green/10 border border-ios-green/20 rounded-2xl flex items-center space-x-2 text-ios-green text-xs font-medium">
            <Check className="w-4 h-4 flex-shrink-0" />
            <span>{profilePinNotice}</span>
          </div>
        )}

        {showProfilePinSetup && (
          <form onSubmit={handleSaveProfilePin} className="p-4 bg-slate-50 dark:bg-neutral-800/60 rounded-2xl space-y-3 animate-fade-in text-xs border border-ios-separator dark:border-ios-darkSeparator">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {platform.isNative ? 'Profil-PIN für dieses Gerät (4–6 Ziffern)' : profile?.hasPin ? 'Profil-PIN auf dem Server ändern' : 'Neue Server-PIN vergeben (4-6 Ziffern)'}
              </span>
              <button
                type="button"
                onClick={() => setShowProfilePinSetup(false)}
                className="text-ios-gray hover:text-slate-900"
              >
                Abbrechen
              </button>
            </div>
            <p className="text-[11px] text-ios-gray">
              {platform.isNative ? 'Die PIN wird auf diesem Gerät geschützt gespeichert. Sie muss nach dem erneuten Öffnen für dieses Profil eingegeben werden.' : 'Die PIN wird auf deinem Server geschützt gespeichert. Neue Geräte, Browser und abgelaufene Sitzungen benötigen sie vor dem Laden der Kontodaten.'}
            </p>
            <div className="flex space-x-2">
              <input
                type="password"
                maxLength={6}
                placeholder="4-6 Ziffern"
                aria-label={platform.isNative ? 'Neue Profil-PIN' : 'Neue Server-PIN'}
                inputMode="numeric"
                value={profilePinInput}
                onChange={(e) => setProfilePinInput(e.target.value)}
                className="flex-1 px-3 py-2 bg-white dark:bg-neutral-700 rounded-xl outline-none font-mono text-center tracking-widest text-sm"
              />
              <button
                type="submit"
                disabled={profilePinInput.length < 4 || isSavingProfilePin}
                className="px-4 py-2 bg-ios-tint text-white rounded-xl font-semibold disabled:opacity-50"
              >
                {isSavingProfilePin ? 'Speichert…' : platform.isNative ? 'Auf Gerät speichern' : 'Auf Server speichern'}
              </button>
            </div>
            {profile?.hasPin && (
              <div className="pt-2 border-t border-ios-separator dark:border-ios-darkSeparator flex justify-end">
                <button
                  type="button"
                  disabled={isSavingProfilePin}
                  onClick={handleRemoveProfilePin}
                  className="text-ios-red text-xs font-medium hover:underline"
                >
                  {platform.isNative ? 'Profil-PIN auf diesem Gerät entfernen' : 'Server-PIN komplett entfernen'}
                </button>
              </div>
            )}
          </form>
        )}
      </SettingsSection>}

      {/* Security & App Lock (Passkey / PIN) */}
      <SettingsSection id="security" title="Sicherheit & App-Sperre" profileId={profileId}>

        {platform.isNative ? <div className="flex items-start gap-3">
          <Fingerprint className="w-6 h-6 text-ios-tint shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Face ID, Touch ID oder Gerätecode</p>
            <p className="text-xs text-ios-gray">Schützt die gesamte App beim Öffnen und nach der Rückkehr. Du brauchst keine zusätzliche App- oder Profil-PIN.</p>
          </div>
        </div> : <>
        {secNotice && (
          <div className="p-3 bg-ios-green/10 border border-ios-green/20 rounded-2xl flex items-center space-x-2 text-ios-green text-xs font-medium">
            <Check className="w-4 h-4" />
            <span>{secNotice}</span>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-neutral-800 flex items-center justify-center">
              {security.type === 'passkey' ? (
                <Fingerprint className="w-5 h-5 text-ios-tint" />
              ) : (
                <KeyRound className="w-5 h-5 text-ios-tint" />
              )}
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                {security.enabled ? (platform.isNative ? 'Gerätesperre aktiv' : security.type === 'passkey' ? 'Passkey aktiv' : 'PIN-Sperre aktiv') : 'App-Sperre inaktiv'}
              </p>
              <p className="text-xs text-ios-gray">
                {security.enabled
                  ? 'Beim Öffnen der App ist eine Entsperrung erforderlich'
                  : 'Schütze deine Finanzdaten vor neugierigen Blicken'}
              </p>
            </div>
          </div>

          <button
            onClick={handleToggleSecurity}
            aria-label={security.enabled ? 'App-Sperre deaktivieren' : 'App-Sperre aktivieren'}
            aria-pressed={security.enabled}
            className={`w-12 h-7 rounded-full p-1 transition-colors ${security.enabled ? 'bg-ios-green' : 'bg-slate-300'}`}
          >
            <div className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-transform ${security.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>

        {/* PIN Setup Form */}
        {showPinSetup && (
          <form onSubmit={handleSavePin} className="p-4 bg-slate-50 dark:bg-neutral-800/60 rounded-2xl space-y-3 animate-fade-in text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-800 dark:text-slate-200">Sicherheits-PIN festlegen</span>
              <button
                type="button"
                onClick={() => setShowPinSetup(false)}
                className="text-ios-gray hover:text-slate-900"
              >
                Abbrechen
              </button>
            </div>
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl space-y-1 text-amber-700 dark:text-amber-300 text-[11px]">
              <p className="font-semibold">
                {isPasskeySupported()
                  ? 'Passkey abgebrochen'
                  : 'Hinweis zu Passkeys (WebAuthn):'}
              </p>
              <p>
                {isPasskeySupported()
                  ? 'Du kannst stattdessen eine 4-6 stellige PIN verwenden.'
                  : 'Browser erlauben Biometrie / Passkeys aus Sicherheitsgründen nur über verschlüsselte HTTPS-Verbindungen (z. B. Tailscale HTTPS oder Synology Reverse Proxy). Im lokalen HTTP-Netzwerk steht dir die PIN-Sperre zur Verfügung.'}
              </p>
            </div>
            <div className="flex space-x-2">
              <input
                type="password"
                maxLength={6}
                placeholder="4-6 Ziffern"
                aria-label="Neue App-PIN"
                inputMode="numeric"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                className="flex-1 px-3 py-2 bg-white dark:bg-neutral-700 rounded-xl outline-none font-mono text-center tracking-widest text-sm"
              />
              <button
                type="submit"
                disabled={pinInput.length < 4}
                className="px-4 py-2 bg-ios-tint text-white rounded-xl font-semibold disabled:opacity-50"
              >
                PIN speichern
              </button>
            </div>
          </form>
        )}
        </>}
      </SettingsSection>

            {/* Account & Initial Balance Management */}
      <SettingsSection id="account" title="Konto & Startsaldo" profileId={profileId} defaultOpen>

        <form onSubmit={handleSaveAccount} className="space-y-4 text-xs">
          {/* Stichtags-Saldo (comdirect Checkpoint) */}
          <div className="p-3.5 bg-slate-50 dark:bg-neutral-800/40 border border-slate-200 dark:border-neutral-700/60 rounded-2xl space-y-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                comdirect-Stichtag &amp; Kontostand
              </span>
              <span className="text-[11px] text-ios-gray">
                Wird automatisch per CSV gesetzt
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="min-w-0">
                <label className="font-semibold text-ios-gray block mb-1" htmlFor="checkpointBalInput">Kontostand laut Auszug</label>
                <div className="relative min-w-0">
                  <input
                    type="text"
                    placeholder="z.B. -215,30"
                    id="checkpointBalInput" value={checkpointBalInput}
                    onChange={(e) => setCheckpointBalInput(e.target.value)}
                    className="w-full min-w-0 max-w-full min-h-12 px-3 py-2 bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 rounded-xl outline-none font-mono text-base pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ios-gray font-semibold">€</span>
                </div>
              </div>
              <div className="min-w-0">
                <label className="font-semibold text-ios-gray block mb-1" htmlFor="checkpointDateInput">Stichtagsdatum</label>
                <input
                  type="date"
                  id="checkpointDateInput" value={checkpointDateInput}
                  onChange={(e) => setCheckpointDateInput(e.target.value)}
                  className="w-full min-w-0 max-w-full min-h-12 px-3 py-2 bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 rounded-xl outline-none"
                />
              </div>
            </div>
          </div>

          {/* Startsaldo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div className="min-w-0">
              <label className="font-semibold text-ios-gray block mb-1" htmlFor="initBalInput">Startsaldo (vor erstem Stichtag)</label>
              <div className="relative min-w-0">
                <input
                  type="text"
                  id="initBalInput" value={initBalInput}
                  onChange={(e) => setInitBalInput(e.target.value)}
                  className="w-full min-w-0 max-w-full min-h-12 px-3 py-2 bg-slate-100 dark:bg-neutral-800 rounded-xl outline-none font-mono text-base pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ios-gray font-semibold">€</span>
              </div>
            </div>

            <div className="min-w-0">
              <label className="font-semibold text-ios-gray block mb-1" htmlFor="initDateInput">Stichtag für Startsaldo</label>
              <input
                type="date"
                id="initDateInput" value={initDateInput}
                onChange={(e) => setInitDateInput(e.target.value)}
                className="w-full min-w-0 max-w-full min-h-12 px-3 py-2 bg-slate-100 dark:bg-neutral-800 rounded-xl outline-none"
              />
            </div>
          </div>

          <button
            type="submit"
            className="px-4 py-2.5 bg-ios-tint text-white font-semibold rounded-xl text-xs shadow-sm hover:brightness-110 active:scale-95"
          >
            Kontoeinstellungen speichern
          </button>
        </form>
      </SettingsSection>

      {/* Categories Management */}
      <SettingsSection id="categories" title={`Kategorien (${categories.length})`} profileId={profileId}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Tag className="w-4 h-4 text-ios-tint" />
          </div>
          <button
            onClick={() => setShowAddCategory(!showAddCategory)}
            className="flex items-center space-x-1 px-3 py-1.5 bg-ios-tint/10 hover:bg-ios-tint/20 text-ios-tint rounded-xl text-xs font-semibold transition-colors active:scale-95"
          >
            {showAddCategory ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            <span>{showAddCategory ? 'Abbrechen' : 'Neue Kategorie'}</span>
          </button>
        </div>

        {/* Add Category Form */}
        {showAddCategory && (
          <form onSubmit={handleCreateCategory} className="p-4 bg-slate-50 dark:bg-neutral-800/60 rounded-2xl space-y-4 border border-ios-separator dark:border-ios-darkSeparator animate-fade-in text-xs">
            <h4 className="font-semibold text-slate-900 dark:text-white">Neue Kategorie erstellen</h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="font-semibold text-ios-gray block mb-1">Name</label>
                <input
                  type="text"
                  placeholder="z. B. Haustier, Garten, Hobby..."
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-neutral-700 rounded-xl outline-none text-sm text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="font-semibold text-ios-gray block mb-1">Kategorie-Typ</label>
                <select
                  value={newCatType}
                  onChange={(e) => setNewCatType(e.target.value as any)}
                  className="w-full px-3 py-2 bg-white dark:bg-neutral-700 rounded-xl outline-none text-sm text-slate-900 dark:text-white"
                >
                  <option value="expense">Ausgabe</option>
                  <option value="income">Einnahme</option>
                  <option value="transfer">Umbuchung / Investieren</option>
                </select>
              </div>
            </div>

            {/* Color Palette */}
            <div>
              <label className="font-semibold text-ios-gray block mb-1.5">Farbe</label>
              <div className="flex flex-wrap gap-2">
                {AVAILABLE_CATEGORY_COLORS.map((col) => (
                  <button
                    key={col}
                    type="button"
                    aria-label={`Farbe ${col}`}
                    onClick={() => setNewCatColor(col)}
                    className={`w-7 h-7 rounded-full transition-transform ${newCatColor === col ? 'scale-125 ring-2 ring-ios-tint ring-offset-2 dark:ring-offset-neutral-800' : 'hover:scale-110'}`}
                    style={{ backgroundColor: col }}
                  />
                ))}
              </div>
            </div>

            {/* Icon Picker */}
            <div>
              <label className="font-semibold text-ios-gray block mb-1.5">Symbol</label>
              <div className="grid grid-cols-6 sm:grid-cols-11 gap-1.5 max-h-36 overflow-y-auto p-1.5 bg-white dark:bg-neutral-700 rounded-xl border border-ios-separator dark:border-ios-darkSeparator">
                {AVAILABLE_CATEGORY_ICONS.map((ic) => (
                  <button
                    key={ic}
                    type="button"
                    aria-label={`Symbol ${ic}`}
                    onClick={() => setNewCatIcon(ic)}
                    className={`p-2 rounded-lg flex items-center justify-center transition-colors ${
                      newCatIcon === ic
                        ? 'bg-ios-tint text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-neutral-600'
                    }`}
                  >
                    <CategoryIcon name={ic} className="w-4 h-4" />
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddCategory(false)}
                className="px-3 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-neutral-700 font-semibold"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                disabled={isSavingCategory || !newCatName.trim()}
                className="px-4 py-2 bg-ios-tint text-white rounded-xl font-semibold disabled:opacity-50 hover:brightness-110 active:scale-95"
              >
                {isSavingCategory ? 'Wird gespeichert...' : 'Kategorie anlegen'}
              </button>
            </div>
          </form>
        )}

        {/* Existing Categories Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
          {categories.map((cat) => (
            <div
              key={cat.id}
              className="flex items-center justify-between p-2.5 rounded-2xl bg-slate-50 dark:bg-neutral-800/40 border border-ios-separator dark:border-ios-darkSeparator"
            >
              <div className="flex items-center space-x-2.5 min-w-0">
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-white flex-shrink-0"
                  style={{ backgroundColor: cat.color }}
                >
                  <CategoryIcon name={cat.icon} className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">{cat.name}</p>
                  <span className="text-[10px] text-ios-gray">
                    {cat.type === 'income' ? 'Einnahme' : cat.type === 'transfer' ? 'Umbuchung' : 'Ausgabe'}
                  </span>
                </div>
              </div>

              {cat.id !== 'sonstiges' && (
                <button
                  type="button"
                  onClick={() => handleDeleteCategory(cat.id, cat.name)}
                  aria-label={`Kategorie ${cat.name} löschen`}
                  className="p-1.5 text-ios-gray hover:text-ios-red rounded-lg transition-colors ml-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </SettingsSection>

      {/* Theme & Display */}
      <SettingsSection id="appearance" title="Darstellung" profileId={profileId}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-neutral-800 flex items-center justify-center">
              {isDark ? <Moon className="w-5 h-5 text-amber-400" /> : <Sun className="w-5 h-5 text-amber-500" />}
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">Dark Mode</p>
              <p className="text-xs text-ios-gray">Dunkles OLED-Design aktivieren</p>
            </div>
          </div>

          <button
            onClick={onToggleDark} aria-label={isDark ? "Dark Mode deaktivieren" : "Dark Mode aktivieren"}
            className={`w-12 h-7 rounded-full p-1 transition-colors ${isDark ? 'bg-ios-green' : 'bg-slate-300'}`}
          >
            <div className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-transform ${isDark ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
      </SettingsSection>

      {/* iCloud Synchronization (Native & CloudKit) */}
      {platform.hasCloudKit && <SettingsSection id="icloud" title="iCloud-Synchronisierung" profileId={profileId}>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center">
              {syncStatus?.enabled ? <Cloud className="w-5 h-5 text-ios-tint" /> : <CloudOff className="w-5 h-5 text-ios-gray" />}
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">iCloud-Synchronisierung</p>
              <p className="text-xs text-ios-gray">
                Private CloudKit-Datenbank für iPhone &amp; iPad
              </p>
            </div>
          </div>

          <button
            onClick={handleToggleSync}
            disabled={!platform.hasCloudKit || !syncStatus || isChangingSync || isSyncingNow}
            aria-label={syncStatus?.enabled ? "iCloud-Sync deaktivieren" : "iCloud-Sync aktivieren"}
            className={`w-12 h-7 rounded-full p-1 transition-colors ${syncStatus?.enabled ? 'bg-ios-green' : 'bg-slate-300 dark:bg-neutral-700'} ${!platform.hasCloudKit ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            <div className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-transform ${syncStatus?.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>

        {!platform.hasCloudKit && (
          <p className="text-[11px] text-ios-gray bg-slate-50 dark:bg-neutral-800/50 p-2.5 rounded-xl border border-ios-separator/50 dark:border-ios-darkSeparator/50">
            iCloud-Synchronisierung ist exklusiv in der nativen iOS-App aktiv. Die Web-/Docker-Version nutzt die zentrale SQLite-Datenbank.
          </p>
        )}

        {platform.hasCloudKit && (
          <div className="space-y-3 pt-2 border-t border-ios-separator dark:border-ios-darkSeparator text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-neutral-800/50 border border-ios-separator/50 dark:border-ios-darkSeparator/50">
                <span className="text-ios-gray text-[10px] block">Status</span>
                <span className="font-semibold text-slate-900 dark:text-white capitalize">
                  {syncStatusLabel(syncStatus)}
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-neutral-800/50 border border-ios-separator/50 dark:border-ios-darkSeparator/50">
                <span className="text-ios-gray text-[10px] block">Ausstehende Änderungen</span>
                <span className="font-semibold text-slate-900 dark:text-white">
                  {syncStatus?.pendingChangesCount ?? '–'}
                </span>
              </div>
            </div>

            {syncReadError && <div role="alert" className="text-ios-red">
              <p>{syncReadError}</p>
              <button className="min-h-11 text-ios-tint" onClick={refreshSyncStatus}>Status erneut laden</button>
            </div>}

            {syncStatus?.lastSyncAt && (
              <p className="text-[11px] text-ios-gray">
                Letzter erfolgreicher Sync: {new Date(syncStatus.lastSyncAt).toLocaleString('de-DE')}
              </p>
            )}

            {syncStatus?.errorMessage && (
              <p className="text-[11px] text-ios-red bg-ios-red/10 p-2.5 rounded-xl border border-ios-red/20">
                {syncStatus.errorMessage}
              </p>
            )}

            <button
              onClick={handleTriggerSync}
              disabled={isSyncingNow || isChangingSync || !syncStatus?.enabled}
              className="w-full flex items-center justify-center space-x-2 p-2.5 rounded-xl bg-slate-100 dark:bg-neutral-800 hover:bg-slate-200 dark:hover:bg-neutral-700 text-slate-800 dark:text-slate-200 font-semibold transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-ios-tint ${isSyncingNow ? 'animate-spin' : ''}`} />
              <span>{isSyncingNow ? 'Wird synchronisiert...' : 'Jetzt synchronisieren'}</span>
            </button>
          </div>
        )}
      </div>

      {platform.hasCloudKit && <div className="glass-surface rounded-3xl p-5 border border-ios-separator dark:border-ios-darkSeparator space-y-3">
        <button className="min-h-11 text-sm font-semibold text-ios-tint" onClick={async () => {
          try { const values = await getRepository().getConflicts?.(); setConflicts(values ?? []); setIsReviewingConflicts(true); }
          catch (error) { alert(error instanceof Error ? error.message : 'Änderungen konnten nicht geladen werden.'); }
        }}>Widersprüchliche Änderungen prüfen ({syncStatus?.conflictsCount ?? 0})</button>
        {isReviewingConflicts && <div className="space-y-4">
          {conflicts.length === 0 && <p className="text-sm text-ios-gray">Keine offenen Konflikte.</p>}
          {conflicts.map(conflict => <div key={conflict.id} className="space-y-2">
            <p className="text-sm font-semibold">Beide Versionen sind gesichert. Welcher Stand soll gelten?</p>
            {conflict.versions.map((version, index) => <div key={index} className="rounded-xl border border-ios-separator dark:border-ios-darkSeparator p-3 space-y-2">
              <p className="text-sm font-semibold">Version {index + 1}{version.deletedAt ? ' · gelöscht' : ''}</p>
              <dl className="text-xs space-y-1 break-words">
                {Object.entries(version.data).filter(([key]) => !['id', 'syncId', 'sourceHash', 'importedAt', 'createdAt'].includes(key)).map(([key, value]) =>
                  <div key={key}><dt className="text-ios-gray">{({ date: 'Datum', amount: 'Betrag', payee: 'Empfänger', purpose: 'Verwendungszweck', category: 'Kategorie', name: 'Name', enabled: 'Aktiv', account: 'Konto', rawText: 'Buchungstext', type: 'Art', currency: 'Währung', status: 'Buchungsstatus', conditions: 'Bedingungen', priority: 'Priorität', applyCategory: 'Zielkategorie' } as Record<string, string>)[key] ?? key}</dt><dd>{typeof value === 'object' ? JSON.stringify(value) : String(value ?? '–')}</dd></div>)}
              </dl>
              <button className="min-h-11 px-4 rounded-xl bg-ios-tint text-white text-sm" onClick={async () => {
                if (!confirm('Diese Version für alle verbundenen iCloud-Geräte übernehmen?')) return;
                try {
                  await getRepository().resolveConflict?.(conflict.id, index);
                  setConflicts(await getRepository().getConflicts?.() ?? []); onDataChanged();
                } catch (error) { alert(error instanceof Error ? error.message : 'Version konnte nicht übernommen werden.'); }
              }}>Version {index + 1} übernehmen</button>
            </div>)}
          </div>)}
          <button className="min-h-11 text-sm text-ios-tint" onClick={() => setIsReviewingConflicts(false)}>Schließen</button>
        </div>}
      </div>}
      </SettingsSection>}

      {/* Backup & Data Management */}
      <SettingsSection id="backup" title="Daten & Backup" profileId={profileId}>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <button
            onClick={() => handleExportBackup(false)}
            disabled={isExporting}
            className="flex items-center justify-center space-x-1.5 p-3 rounded-2xl bg-slate-100 dark:bg-neutral-800 hover:bg-slate-200 dark:hover:bg-neutral-700 text-slate-800 dark:text-slate-200 text-xs font-semibold transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-ios-tint" />
            <span>Profil sichern</span>
          </button>

          <button
            onClick={() => handleExportBackup(true)}
            disabled={isExporting}
            className="flex items-center justify-center space-x-1.5 p-3 rounded-2xl bg-slate-100 dark:bg-neutral-800 hover:bg-slate-200 dark:hover:bg-neutral-700 text-slate-800 dark:text-slate-200 text-xs font-semibold transition-colors"
          >
            <Share2 className="w-3.5 h-3.5 text-ios-tint" />
            <span>Alle Profile</span>
          </button>

          <button
            onClick={() => setIsBackupModalOpen(true)}
            className="flex items-center justify-center space-x-1.5 p-3 rounded-2xl bg-slate-100 dark:bg-neutral-800 hover:bg-slate-200 dark:hover:bg-neutral-700 text-slate-800 dark:text-slate-200 text-xs font-semibold transition-colors"
          >
            <Upload className="w-3.5 h-3.5 text-ios-tint" />
            <span>Wiederherstellen</span>
          </button>
        </div>

        <div className="pt-2 border-t border-ios-separator dark:border-ios-darkSeparator flex flex-col sm:flex-row items-center justify-between gap-3">
          <button
            onClick={handleLoadDemoData}
            className="w-full sm:w-auto flex items-center justify-center space-x-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20"
          >
            <Sparkles className="w-4 h-4" />
            <span>comdirect Demo-Daten laden</span>
          </button>

          <button
            onClick={handleResetDatabase}
            className="w-full sm:w-auto flex items-center justify-center space-x-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold text-ios-red hover:bg-ios-red/10"
          >
            <Trash2 className="w-4 h-4" />
            <span>Datenbank zurücksetzen</span>
          </button>
        </div>


      {recoveries.length > 0 && <div className="glass-surface rounded-3xl p-5 border border-ios-separator dark:border-ios-darkSeparator space-y-3">
        <h3 className="text-sm font-semibold">Sicherungen vor dem Ersetzen</h3>
        <p className="text-xs text-ios-gray">Diese Stände wurden vor einem ersetzenden Import gesichert. Zum Wiederherstellen zuerst exportieren und anschließend über „Backup importieren“ prüfen.</p>
        {recoveries.slice(-5).map(recovery => <button key={recovery.id} className="block min-h-11 text-sm text-ios-tint text-left" onClick={async () => {
          try {
            const data = await getRepository().exportRecoveryBackup?.(recovery.id, profileId);
            if (!data) throw new Error('Sicherung ist nicht verfügbar.');
            if (platform.isNative) await getRepository().shareBackup?.(data);
            else {
              const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
              const link = document.createElement('a'); link.href = url; link.download = `dagobert_backup_wiederherstellung_${recovery.id}.json`; link.click(); URL.revokeObjectURL(url);
            }
          } catch (error) { alert(error instanceof Error ? error.message : 'Export fehlgeschlagen.'); }
        }}>{recovery.profileName} · {new Date(recovery.exportedAt).toLocaleString('de-DE')} exportieren</button>)}
      </div>}
      </SettingsSection>

      <BackupImportModal
        isOpen={isBackupModalOpen}
        profileId={profileId}
        onClose={() => setIsBackupModalOpen(false)}
        onImportComplete={() => {
          onDataChanged();
          onProfilesChanged?.(true);
          getRepository().getRecoveryBackups?.(profileId).then(setRecoveries).catch(() => {});
          alert('Backup erfolgreich übernommen. Neue Profile gegebenenfalls über die Profilauswahl öffnen.');
        }}
      />
    
      {/* App Version & Build Info */}
      <SettingsSection id="about" title="Über Dagobert" profileId={profileId}><div className="text-center text-xs text-ios-gray space-y-1">
        <p className="font-semibold text-slate-700 dark:text-slate-300">
          Dagobert v{APP_VERSION}
        </p>
        <p className="text-[11px]">
          Build {BUILD_DATE} · {platform.isIOS ? 'Lokale Daten auf diesem Gerät' : 'Lokale Server-Datenbank'}
        </p>
      </div></SettingsSection>
    </div>
  );};
