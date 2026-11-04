import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, AlertTriangle, CheckCircle, Database, FileText, ArrowRight } from 'lucide-react';
import type { BackupPayload, BackupValidationResult, BackupImportMode } from '../data/interfaces.ts';
import { validateBackupPayload, normalizeBackupPayload } from '../data/backupSchema.ts';
import { importProfileBackup } from '../lib/api.ts';

interface BackupImportModalProps {
  isOpen: boolean;
  profileId: string;
  onClose: () => void;
  onImportComplete: () => void;
  initialFile?: File;
}

export const BackupImportModal: React.FC<BackupImportModalProps> = ({
  isOpen,
  profileId,
  onClose,
  onImportComplete,
  initialFile,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [validation, setValidation] = useState<BackupValidationResult | null>(null);
  const [payload, setPayload] = useState<BackupPayload | null>(null);
  const [importMode, setImportMode] = useState<BackupImportMode>('merge');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const fileVersion = useRef(0);
  const readFile = useCallback(async (selected: File) => {
    const version = ++fileVersion.current;
    setFile(selected);
    setPayload(null); setValidation(null); setReplaceConfirmed(false);
    setError(null);
    setIsLoading(true);

    try {
      if (selected.size > 50 * 1024 * 1024) throw new Error('Die Datei ist größer als 50 MB. Bitte einzelne Profile exportieren.');
      const text = await selected.text();
      if (version !== fileVersion.current) return;
      const json = JSON.parse(text);
      const res = validateBackupPayload(json);
      setValidation(res);

      if (res.valid) {
        const norm = normalizeBackupPayload(json);
        setPayload(norm);
      } else {
        setPayload(null);
        setError(res.error || 'Ungültiges Dateiformat');
      }
    } catch (err) {
      if (version !== fileVersion.current) return;
      const message = err instanceof Error ? err.message : 'JSON-Datei konnte nicht gelesen werden.';
      setValidation({ valid: false, error: message }); setPayload(null); setError(message);
    } finally {
      if (version === fileVersion.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fileVersion.current++;
    setFile(null); setPayload(null); setValidation(null); setError(null);
    setReplaceConfirmed(false); setIsLoading(false); setImportMode('merge');
    if (isOpen && initialFile) void readFile(initialFile);
    return () => { fileVersion.current++; };
  }, [isOpen, profileId, initialFile, readFile]);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) void readFile(selected);
  };

  const handleExecuteImport = async () => {
    if (!payload || isLoading || (importMode === 'replace' && !replaceConfirmed)) return;
    setIsLoading(true);
    setError(null);

    try {
      await importProfileBackup(profileId, payload, importMode);
      onImportComplete();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Fehler beim Wiederherstellen des Backups.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div role="dialog" aria-modal="true" aria-label="Backup importieren" className="glass-surface w-full max-w-lg rounded-3xl p-6 shadow-2xl border border-ios-separator dark:border-ios-darkSeparator max-h-[90dvh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-ios-separator dark:border-ios-darkSeparator">
          <div className="flex items-center space-x-2">
            <Database className="w-5 h-5 text-ios-tint" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Backup prüfen &amp; importieren</h2>
          </div>
          <button
            onClick={onClose}
            disabled={isLoading}
            aria-label="Schließen"
            className="min-w-11 min-h-11 p-1.5 rounded-full hover:bg-slate-200 dark:hover:bg-neutral-800 text-ios-gray transition-colors"
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
                    <span className="font-bold text-slate-900 dark:text-white text-sm">{validation.summary?.transactionsCount}</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white dark:bg-neutral-900 border border-ios-separator/50 dark:border-ios-darkSeparator/50">
                    <span className="text-ios-gray block text-[10px]">Konten</span>
                    <span className="font-bold text-slate-900 dark:text-white text-sm">{validation.summary?.accountsCount}</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white dark:bg-neutral-900 border border-ios-separator/50 dark:border-ios-darkSeparator/50">
                    <span className="text-ios-gray block text-[10px]">Kategorien</span>
                    <span className="font-bold text-slate-900 dark:text-white text-sm">{validation.summary?.categoriesCount}</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white dark:bg-neutral-900 border border-ios-separator/50 dark:border-ios-darkSeparator/50">
                    <span className="text-ios-gray block text-[10px]">Regeln</span>
                    <span className="font-bold text-slate-900 dark:text-white text-sm">{validation.summary?.rulesCount}</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white dark:bg-neutral-900 border border-ios-separator/50 dark:border-ios-darkSeparator/50">
                    <span className="text-ios-gray block text-[10px]">Bankvorlagen</span>
                    <span className="font-bold text-slate-900 dark:text-white text-sm">{validation.summary?.templatesCount}</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-white dark:bg-neutral-900 border border-ios-separator/50 dark:border-ios-darkSeparator/50">
                    <span className="text-ios-gray block text-[10px]">Profile</span>
                    <span className="font-bold text-slate-900 dark:text-white text-sm">{validation.summary?.profilesCount || 1}</span>
                  </div>
                </div>

                {validation.summary?.dateRange && (
                  <p className="text-[11px] text-ios-gray pt-1">
                    Zeitraum der Umsätze: {validation.summary.dateRange.min} bis {validation.summary.dateRange.max}
                  </p>
                )}
              </div>

              <p className="text-xs text-ios-gray">Ziel für das erste Profil: aktuelles Profil. Weitere Profile werden anhand ihrer IDs zugeordnet. Profil-PINs und App-Sperren werden nicht aus der Datei übernommen.</p>
              <p className="text-xs text-ios-gray">Wenn iCloud aktiviert ist, werden importierte Änderungen auch an deine anderen Apple-Geräte übertragen. Ein Backup ersetzt keine laufende Synchronisierung mit Docker.</p>
              {importMode === 'replace' && <label className="flex items-start gap-3 p-3 rounded-xl bg-ios-red/10 text-xs">
                <input type="checkbox" checked={replaceConfirmed} onChange={event => setReplaceConfirmed(event.target.checked)} className="mt-1" />
                <span>Ich möchte die enthaltenen Datenbereiche ersetzen. Löschungen und Änderungen können anschließend auch andere iCloud-Geräte betreffen.</span>
              </label>}
              {/* Import Mode Selection */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-ios-gray block">
                  Importmodus wählen
                </label>
                <div className="space-y-2">
                  <label className={`flex items-start p-3 rounded-2xl border cursor-pointer ${importMode === 'new_profile' ? 'border-ios-tint bg-ios-tint/5' : 'border-ios-separator dark:border-ios-darkSeparator'}`}>
                    <input type="radio" name="importMode" checked={importMode === 'new_profile'} onChange={() => setImportMode('new_profile')} className="mt-0.5 mr-3" />
                    <div><p className="text-xs font-semibold">Als neue Profile importieren</p><p className="text-[11px] text-ios-gray">Für jedes gesicherte Profil wird ein getrenntes neues Profil angelegt. Bestehende Profile bleiben erhalten.</p></div>
                  </label>
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
                      <p className="text-[11px] text-ios-gray">Ersetzt die enthaltenen Datenbereiche der zugeordneten Profile. Vorher wird automatisch eine Wiederherstellungssicherung gespeichert.</p>
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
                      <p className="text-[11px] text-ios-gray">Übernimmt neue Buchungen, Konten, Kategorien, Regeln und Bankvorlagen. Bei abweichenden vorhandenen Einträgen wird der gesamte Import abgebrochen.</p>
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
            disabled={isLoading}
            className="min-h-11 px-4 py-2.5 rounded-xl border border-ios-separator dark:border-ios-darkSeparator text-xs font-semibold text-slate-700 dark:text-slate-300"
          >
            Abbrechen
          </button>

          {payload && (
            <button
              onClick={handleExecuteImport}
              disabled={isLoading || (importMode === 'replace' && !replaceConfirmed)}
              className="min-h-11 flex items-center space-x-1.5 px-5 py-2.5 rounded-xl bg-ios-tint text-white font-semibold text-xs shadow-md active:scale-95 transition-transform disabled:opacity-50"
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
