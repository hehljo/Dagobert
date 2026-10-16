import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, initDatabaseDefaults } from './lib/db.ts';
import type { Transaction } from './types/index.ts';
import { Navbar } from './components/Navbar.tsx';
import { BottomNav, type NavTab } from './components/BottomNav.tsx';
import { Dashboard } from './components/Dashboard.tsx';
import { TransactionsView } from './components/TransactionsView.tsx';
import { RulesView } from './components/RulesView.tsx';
import { SettingsView } from './components/SettingsView.tsx';
import { ImportModal } from './components/ImportModal.tsx';
import { TransactionDetailModal } from './components/TransactionDetailModal.tsx';
import { LockScreen } from './components/LockScreen.tsx';
import { getSecurityConfig } from './lib/passkey.ts';

export function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [isDark, setIsDark] = useState(true);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string | null>(null);

  // App Lock State
  const [isLocked, setIsLocked] = useState(() => {
    const sec = getSecurityConfig();
    return sec.enabled;
  });

  // Initialize selected month to current (e.g. 2026-10)
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  });

  // Dark mode effect
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  // Init DB defaults once
  useEffect(() => {
    initDatabaseDefaults();
  }, []);

  // Live query data from IndexedDB
  const transactions = useLiveQuery(() => db.transactions.toArray()) || [];
  const categories = useLiveQuery(() => db.categories.toArray()) || [];
  const rules = useLiveQuery(() => db.rules.toArray()) || [];
  const bankTemplates = useLiveQuery(() => db.bankTemplates.toArray()) || [];
  const account = useLiveQuery(() => db.accounts.get('comdirect'));

  const handleOpenCategoryFilter = (catId: string) => {
    setSelectedCategoryFilter(catId);
    setActiveTab('transactions');
  };

  const handleOpenNewManual = () => {
    // Uncommitted in-memory draft - NOT added to DB until user confirms!
    const draftTx: Transaction = {
      date: new Date().toISOString().slice(0, 10),
      amount: -10.00,
      currency: 'EUR',
      payee: '',
      purpose: '',
      rawText: 'Manuelle Buchung',
      type: 'Barzahlung',
      category: 'sonstiges',
      account: 'Manuell',
      importedAt: new Date().toISOString(),
      sourceHash: 'man_' + Date.now(),
      isManual: true,
    };
    setSelectedTx(draftTx);
  };

  // Render LockScreen if app is locked
  if (isLocked) {
    return <LockScreen onUnlock={() => setIsLocked(false)} />;
  }

  return (
    <div className="h-[100dvh] max-h-[100dvh] w-full flex flex-col overflow-hidden bg-ios-bg dark:bg-ios-darkBg transition-colors select-none">
      {/* Top Bar (Docked at top, covers Notch) */}
      <div className="flex-shrink-0">
        <Navbar
          onOpenImport={() => setIsImportOpen(true)}
          onOpenNewManual={handleOpenNewManual}
          isDark={isDark}
          onToggleDark={() => setIsDark(!isDark)}
        />
      </div>

      {/* Main Content Area (Independent scroll container with iOS momentum) */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain pb-6">
        {activeTab === 'dashboard' && (
          <Dashboard
            transactions={transactions}
            categories={categories}
            account={account}
            selectedMonth={selectedMonth}
            onMonthChange={setSelectedMonth}
            onOpenImport={() => setIsImportOpen(true)}
            onSelectCategoryFilter={handleOpenCategoryFilter}
          />
        )}

        {activeTab === 'transactions' && (
          <TransactionsView
            transactions={transactions}
            categories={categories}
            selectedCategoryFilter={selectedCategoryFilter}
            onClearCategoryFilter={() => setSelectedCategoryFilter(null)}
            onSelectTransaction={(tx) => setSelectedTx(tx)}
            selectedMonth={selectedMonth}
          />
        )}

        {activeTab === 'rules' && (
          <RulesView
            rules={rules}
            categories={categories}
            onRulesUpdated={() => {}}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsView
            account={account}
            isDark={isDark}
            onToggleDark={() => setIsDark(!isDark)}
            onDataChanged={() => {}}
          />
        )}
      </main>

      {/* iOS Bottom Bar (Docked firmly at bottom, immune to page scrolling) */}
      <BottomNav
        activeTab={activeTab}
        onTabChange={setActiveTab}
        txCount={transactions.length}
      />

      {/* Import Modal */}
      <ImportModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        bankTemplates={bankTemplates}
        categories={categories}
        rules={rules}
        onImportComplete={(count) => {
          alert(`Erfolgreich! ${count} neue Buchungen importiert.`);
          setActiveTab('dashboard');
        }}
      />

      {/* Transaction Detail & Edit Modal */}
      <TransactionDetailModal
        transaction={selectedTx}
        categories={categories}
        onClose={() => setSelectedTx(null)}
        onSave={async (tx) => {
          if (tx.id !== undefined) {
            await db.transactions.put(tx);
          } else {
            await db.transactions.add(tx);
          }
        }}
        onDelete={async (id) => {
          await db.transactions.delete(id);
        }}
      />
    </div>
  );
}
