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

export function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [isDark, setIsDark] = useState(true);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string | null>(null);

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

  const handleOpenCategoryFilter = (catId: string) => {
    setSelectedCategoryFilter(catId);
    setActiveTab('transactions');
  };

  const handleOpenNewManual = async () => {
    const newTx: Transaction = {
      date: new Date().toISOString().slice(0, 10),
      amount: -10.00,
      currency: 'EUR',
      payee: 'Neue Ausgabe',
      purpose: '',
      rawText: 'Manuelle Buchung',
      type: 'Barzahlung',
      category: 'sonstiges',
      account: 'Manuell',
      importedAt: new Date().toISOString(),
      sourceHash: 'man_' + Date.now(),
      isManual: true,
    };
    const id = await db.transactions.add(newTx);
    setSelectedTx({ ...newTx, id });
  };

  return (
    <div className="min-h-screen flex flex-col bg-ios-bg dark:bg-ios-darkBg transition-colors">
      {/* Top Bar */}
      <Navbar
        onOpenImport={() => setIsImportOpen(true)}
        onOpenNewManual={handleOpenNewManual}
        isDark={isDark}
        onToggleDark={() => setIsDark(!isDark)}
      />

      {/* Main Content Area */}
      <main className="flex-1">
        {activeTab === 'dashboard' && (
          <Dashboard
            transactions={transactions}
            categories={categories}
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
            onSelectCategoryFilter={(catId) => setSelectedCategoryFilter(catId)}
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
            isDark={isDark}
            onToggleDark={() => setIsDark(!isDark)}
            onDataChanged={() => {}}
          />
        )}
      </main>

      {/* iOS Floating Bottom Bar */}
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
        onUpdate={async (updated) => {
          if (updated.id) {
            await db.transactions.put(updated);
          }
        }}
        onDelete={async (id) => {
          await db.transactions.delete(id);
        }}
      />
    </div>
  );
}
