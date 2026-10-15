import React, { useState } from 'react';
import { Download, Upload, Trash2, Shield, Moon, Sun, Database, Sparkles } from 'lucide-react';
import { db, initDatabaseDefaults } from '../lib/db.ts';

interface SettingsViewProps {
  isDark: boolean;
  onToggleDark: () => void;
  onDataChanged: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ isDark, onToggleDark, onDataChanged }) => {
  const [isExporting, setIsExporting] = useState(false);

  const handleExportBackup = async () => {
    setIsExporting(true);
    try {
      const data = {
        exportedAt: new Date().toISOString(),
        transactions: await db.transactions.toArray(),
        categories: await db.categories.toArray(),
        rules: await db.rules.toArray(),
        bankTemplates: await db.bankTemplates.toArray(),
      };

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

      if (data.transactions) {
        await db.transactions.clear();
        await db.transactions.bulkAdd(data.transactions);
      }
      if (data.categories) {
        await db.categories.clear();
        await db.categories.bulkAdd(data.categories);
      }
      if (data.rules) {
        await db.rules.clear();
        await db.rules.bulkAdd(data.rules);
      }

      alert('Backup erfolgreich wiederhergestellt!');
      onDataChanged();
    } catch {
      alert('Ungültige Backup-Datei.');
    }
  };

  const handleLoadDemoData = async () => {
    if (!confirm('Demo-Daten für comdirect laden? (Fügt realistische Testbuchungen mit Umlauten ein)')) return;

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

    await db.transactions.bulkAdd(sampleTxs);
    onDataChanged();
    alert('Demo-Daten erfolgreich eingefügt!');
  };

  const handleResetDatabase = async () => {
    if (confirm('Wirklich ALLE Buchungen, Kategorien und Regeln löschen und zurücksetzen?')) {
      await db.transactions.clear();
      await db.categories.clear();
      await db.rules.clear();
      await db.bankTemplates.clear();
      await initDatabaseDefaults();
      onDataChanged();
      alert('Datenbank auf Werkseinstellungen zurückgesetzt.');
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

      {/* Theme & Display */}
      <div className="bg-white dark:bg-ios-darkCard rounded-3xl p-5 shadow-sm border border-ios-separator dark:border-ios-darkSeparator space-y-4">
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
            onClick={onToggleDark}
            className={`w-12 h-7 rounded-full p-1 transition-colors ${isDark ? 'bg-ios-green' : 'bg-slate-300'}`}
          >
            <div className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-transform ${isDark ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
      </div>

      {/* Backup & Data Management */}
      <div className="bg-white dark:bg-ios-darkCard rounded-3xl p-5 shadow-sm border border-ios-separator dark:border-ios-darkSeparator space-y-4">
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
    </div>
  );
};
