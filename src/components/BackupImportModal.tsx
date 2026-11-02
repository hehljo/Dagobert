import React, { useState } from 'react';
import { X, AlertTriangle, CheckCircle, Database, FileText, ArrowRight } from 'lucide-react';
import type { BackupPayload, BackupValidationResult, BackupImportMode } from '../data/interfaces.ts';
import { validateBackupPayload, normalizeBackupPayload } from '../data/backupSchema.ts';
import { importProfileBackup } from '../lib/api.ts';

interface BackupImportModalProps {
  isOpen: boolean;
  profileId: string;
  onClose: () => void;
  onImportComplete: () => void;
}

export const BackupImportModal: React.FC<BackupImportModalProps> = ({
  isOpen,
  profileId,
  onClose,
  onImportComplete
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [validation, setValidation] = useState<BackupValidationResult | null>(null);
  const [payload, setPayload] = useState<BackupPayload | null>(null);
  const [importMode, setImportMode] = useState<BackupImportMode>('replace');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    setError(null);
    setIsLoading(true);

    try {
      const text = await selected.text();
      const json = JSON.parse(text);
      const res = validateBackupPayload(json);
      setValidation(res);

      if (res.valid) {
        const norm = normalizeBackupPayload(json, profileId);
        setPayload(norm);
      } else {
        setPayload(null);
        setError(res.error || 'Ungültiges Dateiformat');
      }
    } catch (err) {
      setValidation({ valid: false, error: 'JSON-Datei konnte nicht gelesen werden (Syntaxfehler).' });
      setPayload(null);
      setError('JSON-Datei konnte nicht gelesen werden (Syntaxfehler).');
    } finally {
      setIsLoading(false);
    }
  };

  const handleExecuteImport = async () => {
    if (!payload) return;
    setIsLoading(true);
    setError(null);

    try {
      await importProfileBackup(profileId, payload, importMode);
      onImportComplete();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Fehler beim Wiederherstellen des Backups.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="glass-surface w-full max-w-lg rounded-3xl p-6 shadow-2xl border border-ios-separator dark:border-ios-darkSeparator max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-ios-separator dark:border-ios-darkSeparator">
          <div className="flex items-center space-x-2">
            <Database className="w-5 h-5 text-ios-tint" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Backup prüfen &amp; importieren</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-slate-200 dark:hover:bg-neutral-800 text-ios-gray transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto py-4 space-y-4">
          {!file && (
            <div className="border-2 border-dashed border-ios-separator dark:border-ios-darkSeparator rounded-2xl p-8 text-center space-y-3">
              <FileText className="w-10 h-10 text-ios-gray mx-auto" />
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  JSON-Backup auswählen
                </p>
                <p className="text-xs text-ios-gray mt-1">
                  Unterstützt alle Dagobert Docker-, Web- und iOS-Sicherungen.
                </p>
              </div>
              <label className="inline-block px-5 py-2.5 rounded-xl bg-ios-tint text-white font-semibold text-xs cursor-pointer shadow-sm active:scale-95 transition-transform">
                <span>Datei wählen</span>
                <input type="file" accept=".json" onChange={handleFileChange} className="hidden" />
              </label>
            </div>
          )}

          {error && (
            <div className="rounded-2xl bg-ios-red/10 border border-ios-red/20 p-4 flex items-start space-x-3 text-xs text-ios-red">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Validierungsfehler</p>
                <p className="mt-1">{error}</p>
              </div>
            </div>
          )}

          {validation?.valid && payload && (
            <div className="space-y-4">
              <div className="rounded-2xl bg-ios-green/10 border border-ios-green/20 p-4 flex items-start space-x-3 text-xs text-ios-green">
                <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Backup erfolgreich validiert</p>
                  <p className="mt-0.5 opacity-90">
                    Quelle: <span className="font-mono">{payload.sourcePlatform.toUpperCase()}</span> · Exportiert: {new Date(payload.exportedAt).toLocaleString('de-DE')}
                  </p>
                </div>
              </div>

              {/* Summary Card */}
              <div className="bg-slate-50 dark:bg-neutral-800/60 rounded-2xl p-4 border border-ios-separator dark:border-ios-darkSeparator space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-ios-gray">Zusammenfassung</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                  <div className="p-2.5 rounded-xl bg-white dark:bg-neutral-900 border border-ios-separator/50 dark:border-ios-darkSeparator/50">
                    <span className="text-ios-gray block text-[10px]">Buchungen</span>
                    <span className="font-bold text-slate-900 dark:text-white text-sm">{payload.transactions.length}</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white dark:bg-neutral-900 border border-ios-separator/50 dark:border-ios-darkSeparator/50">
                    <span className="text-ios-gray block text-[10px]">Konten</span>
                    <span className="font-bold text-slate-900 dark:text-white text-sm">{payload.accounts.length}</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white dark:bg-neutral-900 border border-ios-separator/50 dark:border-ios-darkSeparator/50">
                    <span className="text-ios-gray block text-[10px]">Kategorien</span>
                    <span className="font-bold text-slate-900 dark:text-white text-sm">{payload.categories.length}</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white dark:bg-neutral-900 border border-ios-separator/50 dark:border-ios-darkSeparator/50">
                    <span className="text-ios-gray block text-[10px]">Regeln</span>
                    <span className="font-bold text-slate-900 dark:text-white text-sm">{payload.rules.length}</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white dark:bg-neutral-900 border border-ios-separator/50 dark:border-ios-darkSeparator/50">
                    <span className="text-ios-gray block text-[10px]">Bankvorlagen</span>
                    <span className="font-bold text-slate-900 dark:text-white text-sm">{payload.bankTemplates.length}</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white dark:bg-neutral-900 border border-ios-separator/50 dark:border-ios-darkSeparator/50">
                    <span className="text-ios-gray block text-[10px]">Profile</span>
                    <span className="font-bold text-slate-900 dark:text-white text-sm">{payload.profiles?.length || 1}</span>
                  </div>
                </div>

                {validation.summary?.dateRange && (
                  <p className="text-[11px] text-ios-gray pt-1">
                    Zeitraum der Umsätze: {validation.summary.dateRange.min} bis {validation.summary.dateRange.max}
                  </p>
                )}
              </div>

              {/* Import Mode Selection */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-ios-gray block">
                  Importmodus wählen
                </label>
                <div className="space-y-2">
                  <label className={`flex items-start p-3 rounded-2xl border cursor-pointer transition-colors ${importMode === 'replace' ? 'border-ios-tint bg-ios-tint/5' : 'border-ios-separator dark:border-ios-darkSeparator'}`}>
                    <input
                      type="radio"
                      name="importMode"
                      value="replace"
                      checked={importMode === 'replace'}
                      onChange={() => setImportMode('replace')}
                      className="mt-0.5 text-ios-tint focus:ring-0 mr-3"
                    />
                    <div>
                      <p className="text-xs font-semibold text-slate-900 dark:text-white">Bestehende Daten ersetzen</p>
                      <p className="text-[11px] text-ios-gray">Setzt Buchungen und Kategorien des aktuellen Profils auf diesen Stand zurück.</p>
                    </div>
                  </label>

                  <label className={`flex items-start p-3 rounded-2xl border cursor-pointer transition-colors ${importMode === 'merge' ? 'border-ios-tint bg-ios-tint/5' : 'border-ios-separator dark:border-ios-darkSeparator'}`}>
                    <input
                      type="radio"
                      name="importMode"
                      value="merge"
                      checked={importMode === 'merge'}
                      onChange={() => setImportMode('merge')}
                      className="mt-0.5 text-ios-tint focus:ring-0 mr-3"
                    />
                    <div>
                      <p className="text-xs font-semibold text-slate-900 dark:text-white">Kontrolliert zusammenführen (Merge)</p>
                      <p className="text-[11px] text-ios-gray">Übernimmt nur neue Umsätze ohne doppelte Buchungen. Bestehende Einträge bleiben erhalten.</p>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-ios-separator dark:border-ios-darkSeparator flex items-center justify-between gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-ios-separator dark:border-ios-darkSeparator text-xs font-semibold text-slate-700 dark:text-slate-300"
          >
            Abbrechen
          </button>

          {payload && (
            <button
              onClick={handleExecuteImport}
              disabled={isLoading}
              className="flex items-center space-x-1.5 px-5 py-2.5 rounded-xl bg-ios-tint text-white font-semibold text-xs shadow-md active:scale-95 transition-transform disabled:opacity-50"
            >
              <span>{isLoading ? 'Importiert...' : 'Jetzt importieren'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
