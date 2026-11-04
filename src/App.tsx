import { useState, useEffect, useCallback, useRef } from 'react';
import type { Transaction, Category, CategoryRule, BankTemplate, Account, Profile } from './types/index.ts';
import {
  fetchProfiles,
  fetchProfileData,
  createManualTransaction,
  updateExistingTransaction,
  deleteExistingTransaction,
  ProfileLockedError
} from './lib/api.ts';
import { Navbar } from './components/Navbar.tsx';
import { useSavedBankAccess } from './lib/useSavedBankAccess.ts';
import { BottomNav, type NavTab } from './components/BottomNav.tsx';
import { Dashboard } from './components/Dashboard.tsx';
import { TransactionsView } from './components/TransactionsView.tsx';
import { StatisticsView } from './components/StatisticsView.tsx';
import { RulesView } from './components/RulesView.tsx';
import { SettingsView } from './components/SettingsView.tsx';
import { ImportModal } from './components/ImportModal.tsx';
import { TransactionDetailModal } from './components/TransactionDetailModal.tsx';
import { ProfileModal } from './components/ProfileModal.tsx';
import { LockScreen } from './components/LockScreen.tsx';
import { ProfileUnlock } from './components/ProfileUnlock.tsx';
import { IncomingDocuments } from './components/IncomingDocuments.tsx';
import { getSecurityConfig } from './lib/passkey.ts';

import { StatusBar, Style } from '@capacitor/status-bar';
import { detectPlatform } from './platform/capabilities.ts';
import { getRepository } from './data/repository.ts';
import { APP_LOCKED_EVENT, APP_UNLOCKED_EVENT, isAppLockedError } from './platform/appAccess.ts';

export function App() {
  const [isUnlocked, setIsUnlocked] = useState(() => detectPlatform().isNative || !getSecurityConfig().enabled);
  return isUnlocked ? <UnlockedApp /> : <LockScreen onUnlock={() => setIsUnlocked(true)} />;
}

function UnlockedApp() {
  const [appReady, setAppReady] = useState(() => !detectPlatform().isNative);
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [isDark, setIsDark] = useState<boolean>(() => {
    return localStorage.getItem('dagobert_theme') === 'dark' ||
      (!localStorage.getItem('dagobert_theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
  });

  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string | null>(null);
  const [transactionRange, setTransactionRange] = useState<{ start: string; end: string } | null>(null);

  // Month navigation (YYYY-MM)
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  // Server state
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfile, setActiveProfile] = useState<Profile | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [bankTemplates, setBankTemplates] = useState<BankTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profileLocked, setProfileLocked] = useState(false);
  const activeLoadIdRef = useRef(0);
  const loadedProfileIdRef = useRef<string | null>(null);
  const pendingDataLoadRef = useRef(false);
  const nativeReadyRef = useRef(!detectPlatform().isNative);
  useEffect(() => {
    if (!detectPlatform().isNative) return;
    let active = true;
    let epoch = 0;
    const unlocked = () => { ++epoch; nativeReadyRef.current = true; if (active) setAppReady(true); };
    const locked = () => {
      ++epoch;
      nativeReadyRef.current = false;
      ++activeLoadIdRef.current;
      pendingDataLoadRef.current = false;
      setAppReady(false); setLoadError(null);
    };
    window.addEventListener(APP_UNLOCKED_EVENT, unlocked);
    window.addEventListener(APP_LOCKED_EVENT, locked);
    const requestedAt = epoch;
    getRepository().getAppLockState?.().then(state => { if (active && epoch === requestedAt) { nativeReadyRef.current = state.unlocked; setAppReady(state.unlocked); } }).catch(() => {});
    return () => { active = false; window.removeEventListener(APP_UNLOCKED_EVENT, unlocked); window.removeEventListener(APP_LOCKED_EVENT, locked); };
  }, []);

  // Load profiles
  const loadProfiles = useCallback(async (silent = false) => {
    if (!nativeReadyRef.current) return;
    if (!silent) setIsLoading(true);
    setLoadError(null);
    try {
      const list = await fetchProfiles();
      setProfiles(list);
      const savedId = localStorage.getItem('dagobert_active_profile_id');
      const matched = list.find(p => p.id === savedId) || list.find(p => p.isDefault) || list[0];
      if (!matched) throw new Error('Keine Profile vorhanden');
      setActiveProfile(matched);
    } catch (error) {
      if (isAppLockedError(error)) { nativeReadyRef.current = false; setAppReady(false); setLoadError(null); return; }
      setLoadError('Profile konnten nicht geladen werden. Bitte die Verbindung zum Server prüfen.');
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []);

  // Load data for active profile with race-condition prevention and silent background sync
  const loadData = useCallback(async (profileId: string, mode: 'initial' | 'background' | 'mutation' = 'initial') => {
    if (!nativeReadyRef.current) return;
    const isSilent = mode !== 'initial';
    // Background sync must not interrupt the first load of a profile.
    if (isSilent && loadedProfileIdRef.current !== profileId) return;
    if (mode === 'background' && pendingDataLoadRef.current) return;
    const loadId = ++activeLoadIdRef.current;
    pendingDataLoadRef.current = true;
    if (!isSilent) {
      setIsLoading(true);
      setLoadError(null);
    }
    try {
      const data = await fetchProfileData(profileId);
      // Discard stale responses if user switched profiles in between!
      if (loadId !== activeLoadIdRef.current) return;

      setAccounts(data.accounts);
      setCategories(data.categories);
      setRules(data.rules);
      setTransactions(data.transactions);
      setBankTemplates(data.bankTemplates);
      loadedProfileIdRef.current = profileId;
      setProfileLocked(false);
      setLoadError(null);
    } catch (err) {
      if (loadId === activeLoadIdRef.current) {
        if (isAppLockedError(err)) { nativeReadyRef.current = false; setAppReady(false); setLoadError(null); return; }
        if (err instanceof ProfileLockedError) {
          loadedProfileIdRef.current = null;
          setAccounts([]);
          setTransactions([]);
          setCategories([]);
          setRules([]);
          setBankTemplates([]);
          setSelectedTx(null);
          setIsImportOpen(false);
          setProfileLocked(true);
          setLoadError(null);
          return;
        }
        setLoadError(loadedProfileIdRef.current === profileId
          ? 'Aktualisierung fehlgeschlagen. Du siehst die zuletzt geladenen Daten.'
          : 'Kontodaten konnten nicht geladen werden. Bitte die Verbindung zum Server prüfen.');
      }
    } finally {
      if (loadId === activeLoadIdRef.current) {
        pendingDataLoadRef.current = false;
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (appReady) void loadProfiles(loadedProfileIdRef.current !== null);
  }, [loadProfiles, appReady]);

  useEffect(() => {
    if (activeProfile && appReady) {
      localStorage.setItem('dagobert_active_profile_id', activeProfile.id);
      loadData(activeProfile.id, loadedProfileIdRef.current === activeProfile.id ? 'background' : 'initial');
    }
  }, [activeProfile?.id, loadData, appReady]);

  // Dark mode effect
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('dagobert_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('dagobert_theme', 'light');
    }

    if (detectPlatform().isNative) {
      StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light }).catch(() => {});
    }
  }, [isDark]);

  const toggleDarkMode = () => setIsDark(prev => !prev);

  // Multi-device live sync: auto-refresh when tab is focused, becomes visible, or on 15s interval
  useEffect(() => {
    if (!activeProfile || !appReady) return;

    const handleSync = () => {
      if (!document.hidden && activeProfile) {
        loadData(activeProfile.id, 'background');
      }
    };

    window.addEventListener('focus', handleSync);
    document.addEventListener('visibilitychange', handleSync);

    const interval = setInterval(handleSync, 15000);

    return () => {
      window.removeEventListener('focus', handleSync);
      document.removeEventListener('visibilitychange', handleSync);
      clearInterval(interval);
    };
  }, [activeProfile, loadData, appReady]);


  // Switch profile handler
  const handleSelectProfile = (profile: Profile) => {
    if (profile.id !== activeProfile?.id) {
      // Invalidate pending responses and remove the previous profile immediately.
      ++activeLoadIdRef.current;
      loadedProfileIdRef.current = null;
      setAccounts([]);
      setCategories([]);
      setRules([]);
      setTransactions([]);
      setBankTemplates([]);
      setIsLoading(true);
      setLoadError(null);
      setProfileLocked(false);
      setSelectedTx(null);
      setIsImportOpen(false);
    }
    setActiveProfile(profile);
    setSelectedCategoryFilter(null); setTransactionRange(null);
  };

  // Open draft for new manual entry
  const handleOpenNewManual = () => {
    const draftTx: Transaction = {
      date: new Date().toISOString().slice(0, 10),
      amount: -10.00,
      currency: 'EUR',
      payee: '',
      purpose: '',
      rawText: 'Manuelle Buchung',
      type: 'Barzahlung',
      category: 'sonstiges',
      account: accounts[0]?.name || 'Girokonto',
      importedAt: new Date().toISOString(),
      sourceHash: 'man_' + Date.now(),
      isManual: true,
      status: 'booked'
    };
    setSelectedTx(draftTx);
  };

  const activeAccount = accounts[0];
  const hasProfileData = !!activeProfile && loadedProfileIdRef.current === activeProfile.id;
  const syncAvailable = useSavedBankAccess(activeProfile?.id, hasProfileData && !profileLocked, isImportOpen);

  return (
    <div className="dagobert-app h-full h-[var(--app-height,100%)] flex flex-col overflow-hidden select-none">
      {/* Top Header Navbar */}
      <Navbar
        activeProfile={activeProfile || undefined}
        onOpenImport={() => setIsImportOpen(true)}
        onOpenNewManual={handleOpenNewManual}
        onOpenProfiles={() => setIsProfileModalOpen(true)}
        actionsDisabled={isLoading || !hasProfileData || profileLocked}
        syncAvailable={syncAvailable}
      />

      {/* Main Content Area */}
      <main className="glass-main flex-1 min-h-0 overflow-y-auto overscroll-contain pb-6 touch-pan-y">
        {hasProfileData && !profileLocked && activeProfile && <IncomingDocuments key={activeProfile.id}
          profileId={activeProfile.id} profileName={activeProfile.name} transactions={transactions}
          accounts={accounts}
          bankTemplates={bankTemplates} categories={categories} rules={rules} onImported={() => {
            void loadProfiles(true); void loadData(activeProfile.id, 'mutation');
          }} />}
        {isLoading && (
          <div className="text-center py-12 text-xs text-ios-gray">
            Daten werden geladen...
          </div>
        )}

        {loadError && (
          <div role="alert" className="max-w-5xl mx-auto p-4">
            <div className="rounded-2xl border border-amber-500/40 bg-amber-50 dark:bg-amber-950 p-4 text-sm text-amber-950 dark:text-amber-100 space-y-3">
              <p>{loadError}</p>
              <button
                onClick={() => activeProfile ? loadData(activeProfile.id) : loadProfiles()}
                disabled={isLoading}
                className="min-h-[48px] px-4 rounded-xl bg-ios-tint text-white font-semibold disabled:opacity-50"
              >
                Erneut versuchen
              </button>
            </div>
          </div>
        )}

        {!isLoading && profileLocked && activeProfile && (
          <ProfileUnlock
            key={activeProfile.id}
            profile={activeProfile}
            onUnlocked={() => {
              setProfileLocked(false);
              loadData(activeProfile.id);
            }}
          />
        )}

        {!isLoading && hasProfileData && activeTab === 'dashboard' && (
          <Dashboard
            key={activeProfile?.id}
            profileId={activeProfile?.id || 'privat'}
            transactions={transactions}
            categories={categories}
            account={activeAccount}
            selectedMonth={selectedMonth}
            onMonthChange={month => { setSelectedMonth(month); setTransactionRange(null); }}
            onOpenImport={() => setIsImportOpen(true)}
            onSelectCategoryFilter={(catId, range) => {
              setSelectedCategoryFilter(catId);
              setTransactionRange(range ?? null);
              setActiveTab('transactions');
            }}
          />
        )}

        {!isLoading && hasProfileData && activeTab === 'transactions' && (
          <TransactionsView
            transactions={transactions}
            categories={categories}
            selectedCategoryFilter={selectedCategoryFilter}
            onClearCategoryFilter={() => { setSelectedCategoryFilter(null); setTransactionRange(null); }}
            dateRange={transactionRange}
            onSelectTransaction={(tx) => setSelectedTx(tx)}
            selectedMonth={selectedMonth}
          />
        )}

        {!isLoading && hasProfileData && activeTab === 'statistics' && (
          <StatisticsView
            key={activeProfile?.id}
            transactions={transactions}
            categories={categories}
            account={activeAccount}
            onSelectTransaction={setSelectedTx}
          />
        )}

        {!isLoading && hasProfileData && activeTab === 'rules' && (
          <RulesView
            profileId={activeProfile?.id || 'privat'}
            rules={rules}
            categories={categories}
            transactions={transactions}
            onRulesUpdated={() => {
              if (activeProfile) return loadData(activeProfile.id, 'mutation');
            }}
          />
        )}

        {!isLoading && hasProfileData && activeTab === 'settings' && (
          <SettingsView
            profile={activeProfile || undefined}
            profileId={activeProfile?.id || 'privat'}
            account={activeAccount}
            categories={categories}
            isDark={isDark}
            onToggleDark={toggleDarkMode}
            onDataChanged={() => {
              if (activeProfile) loadData(activeProfile.id);
            }}
            onProfilesChanged={loadProfiles}
          />
        )}
      </main>

      {/* Fixed Ergonomic Bottom Navigation Bar */}
      <BottomNav
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {/* Profile Management Modal */}
      {isProfileModalOpen && <ProfileModal
        key={activeProfile?.id}
        isOpen={isProfileModalOpen}
        profiles={profiles}
        activeProfileId={activeProfile?.id || 'privat'}
        onClose={() => setIsProfileModalOpen(false)}
        onSelectProfile={handleSelectProfile}
        onProfilesChanged={() => loadProfiles(true)}
      />}

      {/* comdirect CSV Import Modal */}
      {isImportOpen && <ImportModal
        key={activeProfile?.id}
        isOpen={isImportOpen}
        profileId={activeProfile?.id || 'privat'}
        accounts={accounts}
        existingTransactions={transactions}
        initialDirect={syncAvailable}
        onClose={() => setIsImportOpen(false)}
        bankTemplates={bankTemplates}
        categories={categories}
        rules={rules}
        onImportComplete={(count) => {
          alert(`Erfolgreich! ${count} Buchungen synchronisiert.`);
          if (activeProfile) loadData(activeProfile.id);
          setActiveTab('dashboard');
        }}
      />}

      {/* Transaction Detail & Edit Modal */}
      {selectedTx && <TransactionDetailModal
        key={selectedTx?.id ?? selectedTx?.sourceHash ?? 'closed'}
        profileId={activeProfile?.id || 'privat'}
        transaction={selectedTx}
        categories={categories}
        existingTransactions={transactions}
        onCategoryCreated={(newCat) => {
          setCategories(prev => [...prev.filter(c => c.id !== newCat.id), newCat]);
          if (activeProfile) loadData(activeProfile.id, 'background');
        }}
        onClose={() => setSelectedTx(null)}
        onSave={async (tx) => {
          if (!activeProfile) return;
          if (tx.id !== undefined) {
            await updateExistingTransaction(tx.id, tx);
          } else {
            await createManualTransaction(activeProfile.id, tx);
          }
          await loadData(activeProfile.id, 'mutation');
        }}
        onDelete={async (id) => {
          if (!activeProfile) return;
          await deleteExistingTransaction(id);
          await loadData(activeProfile.id, 'mutation');
        }}
      />}
    </div>
  );
}
