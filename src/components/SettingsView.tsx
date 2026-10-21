import type { Account, Category, Profile } from '../types/index.ts';
import React, { useState } from 'react';
import { Download, Upload, Trash2, Shield, Moon, Sun, Database, Sparkles, Fingerprint, KeyRound, Lock, Check, Landmark, Tag, Plus, X } from 'lucide-react';
// db helpers
import { parseGermanAmount } from '../lib/csvParser.ts';
import { updateAccountSettings, exportProfileBackup, importProfileBackup, resetProfileData, batchImportTransactions, createCategory, deleteCategory, updateProfilePin } from '../lib/api.ts';
import { APP_VERSION, BUILD_DATE } from '../version.ts';
import { getSecurityConfig, saveSecurityConfig, registerPasskey, isPasskeySupported, hashPin, type SecurityConfig } from '../lib/passkey.ts';
import { CategoryIcon, AVAILABLE_CATEGORY_ICONS, AVAILABLE_CATEGORY_COLORS } from './CategoryIcon.tsx';

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
    account?.checkpointBalance !== undefined ? account.checkpointBalance.toFixed(2).replace('.', ',') : ''
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
      setProfilePinNotice('Profil-PIN erfolgreich auf dem Server gespeichert! Jedes neue Gerät muss diese PIN eingeben.');
      setShowProfilePinSetup(false);
      setProfilePinInput('');
      onProfilesChanged?.(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Fehler beim Speichern der Server-PIN');
    } finally {
      setIsSavingProfilePin(false);
    }
  };

  const handleRemoveProfilePin = async () => {
    if (confirm('Profil-PIN auf dem Server wirklich entfernen? Jedes Gerät im Netzwerk hat dann wieder direkten Zugriff auf alle Buchungen.')) {
      setIsSavingProfilePin(true);
      try {
        await updateProfilePin(profileId, null);
        setProfilePinNotice('Profil-PIN auf dem Server entfernt.');
        setShowProfilePinSetup(false);
        setProfilePinInput('');
        onProfilesChanged?.(true);
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Fehler beim Entfernen der Server-PIN');
      } finally {
        setIsSavingProfilePin(false);
      }
    }
  };

  const handleToggleSecurity = async () => {
    if (security.enabled) {
      if (confirm('App-Sperre deaktivieren?')) {
        const next: SecurityConfig = { enabled: false, type: 'pin' };
        saveSecurityConfig(next);
        setSecurity(next);
        setSecNotice('App-Sperre deaktiviert.');
      }
      return;
    }

    // Try passkey if supported
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

  const handleExportBackup = async () => {
    setIsExporting(true);
    try {
      const data = await exportProfileBackup(profileId);

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dagobert_backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      // 1. Strict Deep Validation:
      if (!data || typeof data !== 'object') {
        throw new Error('Ungültiges Dateiformat (kein JSON-Objekt).');
      }

      const hasTxs = Array.isArray(data.transactions);
      const hasCats = Array.isArray(data.categories);
      const hasRules = Array.isArray(data.rules);
      const hasTemplates = Array.isArray(data.bankTemplates);
      const hasAccounts = Array.isArray(data.accounts);

      if (!hasTxs && !hasCats && !hasRules && !hasAccounts && !hasTemplates) {
        throw new Error('Die Backup-Datei enthält keine bekannten Dagobert-Daten.');
      }

      // Deep validate every transaction record
      if (hasTxs) {
        for (const t of data.transactions) {
          if (!t || typeof t !== 'object') {
            throw new Error('Backup enthält ungültige Buchungsobjekte.');
          }
          if (typeof t.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(t.date)) {
            throw new Error(`Backup enthält Buchung mit ungültigem Datum: ${t.date}`);
          }
          if (typeof t.amount !== 'number' || !Number.isFinite(t.amount)) {
            throw new Error('Backup enthält Buchung mit ungültigem Betrag.');
          }
          if (typeof t.category !== 'string' || !t.category) {
            throw new Error('Backup enthält Buchung ohne Kategorie.');
          }
          // Ensure payee is a valid string to prevent toLowerCase crashes
          if (typeof t.payee !== 'string') {
            t.payee = 'Unbekannt';
          }
        }
      }

      // Deep validate accounts (strictly check checkpointBalance is number if present)
      if (hasAccounts) {
        for (const a of data.accounts) {
          if (!a || typeof a !== 'object' || !a.id || !a.name || typeof a.initialBalance !== 'number' || !Number.isFinite(a.initialBalance) || typeof a.initialBalanceDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(a.initialBalanceDate)) {
            throw new Error('Backup enthält unvollständige oder beschädigte Kontodatensätze.');
          }
          if (a.checkpointBalance !== undefined && (typeof a.checkpointBalance !== 'number' || !Number.isFinite(a.checkpointBalance))) {
            throw new Error(`Konto ${a.id} hat ungültigen checkpointBalance (muss Zahl sein): ${a.checkpointBalance}`);
          }
          if (a.checkpointDate !== undefined && (typeof a.checkpointDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(a.checkpointDate))) {
            throw new Error(`Konto ${a.id} hat ungültiges checkpointDate (muss YYYY-MM-DD sein): ${a.checkpointDate}`);
          }
        }
      }

      // Deep validate categories
      if (hasCats) {
        for (const c of data.categories) {
          if (!c || !c.id || !c.name) {
            throw new Error('Backup enthält beschädigte Kategoriedaten.');
          }
        }
      }

      // Save directly to central SQLite database on server!
      await importProfileBackup(profileId, data);
      alert('Backup erfolgreich in die zentrale Datenbank übernommen!');
      onDataChanged();
    } catch (err: unknown) {
      alert(`Fehler beim Wiederherstellen: ${err instanceof Error ? err.message : 'Ungültige Datei'}`);
    } finally {
      e.target.value = ''; // Reset input
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
      <div className="bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-500/20 rounded-3xl p-5 flex items-start space-x-3.5">
        <Shield className="w-6 h-6 text-emerald-500 flex-shrink-0 mt-0.5" />
        <div className="text-xs space-y-1">
          <h3 className="font-bold text-sm text-slate-900 dark:text-white">100% Local-First &amp; Privat</h3>
          <p className="text-slate-600 dark:text-slate-300">
            Deine Finanzdaten und Kontoumsätze verlassen niemals dieses Gerät. Die gesamte Verarbeitung, der CSV-Import und die Speicherung laufen ausschließlich lokal in deiner Browser-Datenbank (IndexedDB).
          </p>
        </div>
      </div>

      {/* Profil-PIN (Globaler Server-Schutz) */}
      <div className="glass-surface rounded-3xl p-5 shadow-sm border border-ios-separator dark:border-ios-darkSeparator space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${profile?.hasPin ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'}`}>
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <span>{profile?.hasPin ? 'Profil-PIN aktiv (Server-Schutz)' : 'Kein Server-Schutz aktiv'}</span>
                {profile?.hasPin ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">Gesperrt</span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400">Offen</span>
                )}
              </p>
              <p className="text-xs text-ios-gray">
                {profile?.hasPin
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
            {profile?.hasPin ? 'PIN ändern / löschen' : 'Server-PIN einrichten'}
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
                {profile?.hasPin ? 'Profil-PIN auf dem Server ändern' : 'Neue Server-PIN vergeben (4-6 Ziffern)'}
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
              Diese PIN wird zentral auf dem Server (SQLite) verschlüsselt gespeichert. Jedes neue Gerät, jeder Browser und jede abgelaufene Sitzung muss sie eingeben, bevor überhaupt Kontodaten geladen werden.
            </p>
            <div className="flex space-x-2">
              <input
                type="password"
                maxLength={6}
                placeholder="4-6 Ziffern"
                aria-label="Neue Server-PIN"
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
                {isSavingProfilePin ? 'Speichert…' : 'Auf Server speichern'}
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
                  Server-PIN komplett entfernen
                </button>
              </div>
            )}
          </form>
        )}
      </div>

      {/* Security & App Lock (Passkey / PIN) */}
      <div className="glass-surface rounded-3xl p-5 shadow-sm border border-ios-separator dark:border-ios-darkSeparator space-y-4">
        <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
          <Lock className="w-4 h-4 text-ios-tint" />
          <span>Sicherheit &amp; App-Sperre</span>
        </h3>

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
                {security.enabled ? (security.type === 'passkey' ? 'Passkey aktiv' : 'PIN-Sperre aktiv') : 'App-Sperre inaktiv'}
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
      </div>

            {/* Account & Initial Balance Management */}
      <div className="glass-surface rounded-3xl p-5 shadow-sm border border-ios-separator dark:border-ios-darkSeparator space-y-4">
        <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
          <Landmark className="w-4 h-4 text-ios-tint" />
          <span>Konto &amp; Startsaldo</span>
        </h3>

        <form onSubmit={handleSaveAccount} className="space-y-4 text-xs">
          {/* Stichtags-Saldo (comdirect Checkpoint) */}
          <div className="p-3.5 bg-slate-50 dark:bg-neutral-800/40 border border-slate-200 dark:border-neutral-700/60 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                comdirect-Stichtag &amp; Kontostand
              </span>
              <span className="text-[11px] text-ios-gray">
                Wird automatisch per CSV gesetzt
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="font-semibold text-ios-gray block mb-1">Kontostand laut Auszug</label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="z.B. -215,30"
                    value={checkpointBalInput}
                    onChange={(e) => setCheckpointBalInput(e.target.value)}
                    className="w-full px-3 py-2 bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 rounded-xl outline-none font-mono text-sm"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ios-gray font-semibold">€</span>
                </div>
              </div>
              <div>
                <label className="font-semibold text-ios-gray block mb-1">Stichtagsdatum</label>
                <input
                  type="date"
                  value={checkpointDateInput}
                  onChange={(e) => setCheckpointDateInput(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 rounded-xl outline-none"
                />
              </div>
            </div>
          </div>

          {/* Startsaldo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div>
              <label className="font-semibold text-ios-gray block mb-1">Startsaldo (vor erstem Stichtag)</label>
              <div className="relative">
                <input
                  type="text"
                  value={initBalInput}
                  onChange={(e) => setInitBalInput(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-100 dark:bg-neutral-800 rounded-xl outline-none font-mono text-sm"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ios-gray font-semibold">€</span>
              </div>
            </div>

            <div>
              <label className="font-semibold text-ios-gray block mb-1">Stichtag für Startsaldo</label>
              <input
                type="date"
                value={initDateInput}
                onChange={(e) => setInitDateInput(e.target.value)}
                className="w-full px-3 py-2 bg-slate-100 dark:bg-neutral-800 rounded-xl outline-none"
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
      </div>

      {/* Categories Management */}
      <div className="glass-surface rounded-3xl p-5 shadow-sm border border-ios-separator dark:border-ios-darkSeparator space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Tag className="w-4 h-4 text-ios-tint" />
            <h3 className="font-bold text-sm text-slate-900 dark:text-white">Kategorien ({categories.length})</h3>
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
      </div>

      {/* Theme & Display */}
      <div className="glass-surface rounded-3xl p-5 shadow-sm border border-ios-separator dark:border-ios-darkSeparator space-y-4">
        <h3 className="font-bold text-sm text-slate-900 dark:text-white">Darstellung</h3>
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
      </div>

      {/* Backup & Data Management */}
      <div className="glass-surface rounded-3xl p-5 shadow-sm border border-ios-separator dark:border-ios-darkSeparator space-y-4">
        <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
          <Database className="w-4 h-4 text-ios-tint" />
          <span>Daten &amp; Backup</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={handleExportBackup}
            disabled={isExporting}
            className="flex items-center justify-center space-x-2 p-3.5 rounded-2xl bg-slate-100 dark:bg-neutral-800 hover:bg-slate-200 dark:hover:bg-neutral-700 text-slate-800 dark:text-slate-200 text-xs font-semibold transition-colors"
          >
            <Download className="w-4 h-4 text-ios-tint" />
            <span>JSON Backup exportieren</span>
          </button>

          <label className="flex items-center justify-center space-x-2 p-3.5 rounded-2xl bg-slate-100 dark:bg-neutral-800 hover:bg-slate-200 dark:hover:bg-neutral-700 text-slate-800 dark:text-slate-200 text-xs font-semibold cursor-pointer transition-colors">
            <Upload className="w-4 h-4 text-ios-tint" />
            <span>Backup wiederherstellen</span>
            <input type="file" accept=".json" onChange={handleImportBackup} className="hidden" />
          </label>
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
      </div>
    
      {/* App Version & Build Info */}
      <div className="text-center py-4 text-xs text-ios-gray space-y-1">
        <p className="font-semibold text-slate-700 dark:text-slate-300">
          Dagobert v{APP_VERSION}
        </p>
        <p className="text-[11px]">
          Build {BUILD_DATE} · Precision Multi-Profile &amp; SQLite Sync aktiv
        </p>
      </div>
    </div>
  );};
