import { useState, useEffect, useCallback, useRef } from 'react';
import type { Transaction, Category, CategoryRule, BankTemplate, Account, Profile } from './types/index.ts';
import {
  fetchProfiles,
  fetchProfileData,
  createManualTransaction,
  updateExistingTransaction,
  deleteExistingTransaction
} from './lib/api.ts';
import { Navbar } from './components/Navbar.tsx';
import { BottomNav, type NavTab } from './components/BottomNav.tsx';
import { Dashboard } from './components/Dashboard.tsx';
import { TransactionsView } from './components/TransactionsView.tsx';
import { StatisticsView } from './components/StatisticsView.tsx';
import { RulesView } from './components/RulesView.tsx';
import { SettingsView } from './components/SettingsView.tsx';
import { ImportModal } from './components/ImportModal.tsx';
import { TransactionDetailModal } from './components/TransactionDetailModal.tsx';
import { ProfileModal } from './components/ProfileModal.tsx';

export function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [isDark, setIsDark] = useState<boolean>(() => {
    return localStorage.getItem('dagobert_theme') === 'dark' ||
      (!localStorage.getItem('dagobert_theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
  });

  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string | null>(null);

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
  const activeLoadIdRef = useRef(0);

  // Load profiles
  const loadProfiles = useCallback(async () => {
    try {
      const list = await fetchProfiles();
      setProfiles(list);
      const savedId = localStorage.getItem('dagobert_active_profile_id');
      const matched = list.find(p => p.id === savedId) || list.find(p => p.isDefault) || list[0];
      if (matched) {
        setActiveProfile(matched);
      }
    } catch {
      // Fallback
    }
  }, []);

  // Load data for active profile with race-condition prevention and silent background sync
  const loadData = useCallback(async (profileId: string, isSilent = false) => {
    const loadId = ++activeLoadIdRef.current;
    if (!isSilent) {
      setIsLoading(true);
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
    } catch (err) {
      console.error('Error fetching data:', err);
      // Clean state on failure so stale profile data is never shown!
      if (loadId === activeLoadIdRef.current) {
        setAccounts([]);
        setTransactions([]);
        setRules([]);
        setCategories([]);
      }
    } finally {
      if (loadId === activeLoadIdRef.current && !isSilent) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    if (activeProfile) {
      localStorage.setItem('dagobert_active_profile_id', activeProfile.id);
      loadData(activeProfile.id);
    }
  }, [activeProfile, loadData]);

  // Dark mode effect
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('dagobert_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('dagobert_theme', 'light');
    }
  }, [isDark]);

  const toggleDarkMode = () => setIsDark(prev => !prev);

  // Multi-device live sync: auto-refresh when tab is focused, becomes visible, or on 15s interval
  useEffect(() => {
    if (!activeProfile) return;

    const handleSync = () => {
      if (!document.hidden && activeProfile) {
        loadData(activeProfile.id, true); // silent background sync!
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
  }, [activeProfile, loadData]);


  // Switch profile handler
  const handleSelectProfile = (profile: Profile) => {
    setActiveProfile(profile);
    setSelectedCategoryFilter(null);
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

  return (
    <div className="h-[100dvh] flex flex-col bg-slate-50 dark:bg-black text-slate-900 dark:text-white transition-colors duration-200 overflow-hidden select-none">
      {/* Top Header Navbar */}
      <Navbar
        activeProfile={activeProfile || undefined}
        onOpenImport={() => setIsImportOpen(true)}
        onOpenNewManual={handleOpenNewManual}
        onOpenProfiles={() => setIsProfileModalOpen(true)}
      />

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto overscroll-contain pb-24 touch-pan-y">
        {isLoading && (
          <div className="text-center py-12 text-xs text-ios-gray">
            Daten werden geladen...
          </div>
        )}

        {!isLoading && activeTab === 'dashboard' && (
          <Dashboard
            transactions={transactions}
            categories={categories}
            account={activeAccount}
            selectedMonth={selectedMonth}
            onMonthChange={setSelectedMonth}
            onOpenImport={() => setIsImportOpen(true)}
            onSelectCategoryFilter={(catId) => {
              setSelectedCategoryFilter(catId);
              setActiveTab('transactions');
            }}
          />
        )}

        {!isLoading && activeTab === 'transactions' && (
          <TransactionsView
            transactions={transactions}
            categories={categories}
            selectedCategoryFilter={selectedCategoryFilter}
            onClearCategoryFilter={() => setSelectedCategoryFilter(null)}
            onSelectTransaction={(tx) => setSelectedTx(tx)}
            selectedMonth={selectedMonth}
          />
        )}

        {!isLoading && activeTab === 'statistics' && (
          <StatisticsView
            key={activeProfile?.id}
            transactions={transactions}
            categories={categories}
            onSelectTransaction={setSelectedTx}
          />
        )}

        {!isLoading && activeTab === 'rules' && (
          <RulesView
            profileId={activeProfile?.id || 'privat'}
            rules={rules}
            categories={categories}
            transactions={transactions}
            onRulesUpdated={() => {
              if (activeProfile) loadData(activeProfile.id);
            }}
          />
        )}

        {!isLoading && activeTab === 'settings' && (
          <SettingsView
            profileId={activeProfile?.id || 'privat'}
            account={activeAccount}
            isDark={isDark}
            onToggleDark={toggleDarkMode}
            onDataChanged={() => {
              if (activeProfile) loadData(activeProfile.id);
            }}
          />
        )}
      </main>

      {/* Fixed Ergonomic Bottom Navigation Bar */}
      <BottomNav
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {/* Profile Management Modal */}
      <ProfileModal
        isOpen={isProfileModalOpen}
        profiles={profiles}
        activeProfileId={activeProfile?.id || 'privat'}
        onClose={() => setIsProfileModalOpen(false)}
        onSelectProfile={handleSelectProfile}
        onProfilesChanged={loadProfiles}
      />

      {/* comdirect CSV Import Modal */}
      <ImportModal
        isOpen={isImportOpen}
        profileId={activeProfile?.id || 'privat'}
        existingTransactions={transactions}
        onClose={() => setIsImportOpen(false)}
        bankTemplates={bankTemplates}
        categories={categories}
        rules={rules}
        onImportComplete={(count) => {
          alert(`Erfolgreich! ${count} Buchungen synchronisiert.`);
          if (activeProfile) loadData(activeProfile.id);
          setActiveTab('dashboard');
        }}
      />

      {/* Transaction Detail & Edit Modal */}
      <TransactionDetailModal
        profileId={activeProfile?.id || 'privat'}
        transaction={selectedTx}
        categories={categories}
        onClose={() => setSelectedTx(null)}
        onSave={async (tx) => {
          if (!activeProfile) return;
          if (tx.id !== undefined) {
            await updateExistingTransaction(tx.id, tx);
          } else {
            await createManualTransaction(activeProfile.id, tx);
          }
          await loadData(activeProfile.id);
        }}
        onDelete={async (id) => {
          if (!activeProfile) return;
          await deleteExistingTransaction(id);
          await loadData(activeProfile.id);
        }}
      />
    </div>
  );
}
