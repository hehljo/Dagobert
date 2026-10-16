import React, { useState } from 'react';
import { X, Upload, FileText, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';
import type { BankTemplate, Category, CategoryRule, ImportPreviewRow, Transaction } from '../types/index.ts';
import { parseBankCsv, decodeFileWithEncoding, extractComdirectMetadata } from '../lib/csvParser.ts';
import type { CsvMetadata } from '../types/index.ts';
import { autoCategorizePreview } from '../lib/rulesEngine.ts';
import { db } from '../lib/db.ts';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  bankTemplates: BankTemplate[];
  categories: Category[];
  rules: CategoryRule[];
  onImportComplete: (count: number) => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({
  isOpen,
  onClose,
  bankTemplates,
  categories,
  rules,
  onImportComplete,
}) => {
  if (!isOpen) return null;

  const [selectedTemplateId, setSelectedTemplateId] = useState(bankTemplates[0]?.id || 'comdirect');
  const [encoding, setEncoding] = useState<'windows-1252' | 'utf-8'>('windows-1252');
  const [fileName, setFileName] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<ImportPreviewRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [csvMetadata, setCsvMetadata] = useState<CsvMetadata | null>(null);

  const selectedTemplate = bankTemplates.find(t => t.id === selectedTemplateId) || bankTemplates[0];

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setIsLoading(true);
    setErrorMsg(null);

    try {
      // 1. Decode with Windows-1252
      const text = await decodeFileWithEncoding(file, encoding);

      // 2. Fetch existing hashes to prevent duplicates
      const existingTxs = await db.transactions.toArray();
      const existingHashes = new Set(existingTxs.map(t => t.sourceHash));

      // 3. Extract balance metadata
      const meta = extractComdirectMetadata(text);
      setCsvMetadata(meta);

      // 4. Parse CSV
      const rawParsed = parseBankCsv(text, selectedTemplate, existingHashes);

      // 5. Detect pending promotions (Vorgemerkt in DB -> Jetzt Gebucht in CSV)
      const pendingTxs = existingTxs.filter(t => t.status === 'pending');
      for (const row of rawParsed) {
        if (row.status === 'booked') {
          const matchPending = pendingTxs.find(t =>
            t.date === row.date &&
            Math.abs(t.amount - row.amount) < 0.001 &&
            t.payee.trim().toLowerCase() === row.payee.trim().toLowerCase()
          );
          if (matchPending) {
            row.isPendingPromotion = true;
            row.isDuplicate = false; // NOT a duplicate, it's an update!
          }
        }
      }

      // 6. Auto-categorize via rules
      const categorized = autoCategorizePreview(rawParsed, rules);

      setPreviewRows(categorized);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Fehler beim Parsen der CSV');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCommitImport = async () => {
    if (isCommitting) return; // Prevent double-click
    setIsCommitting(true);

    try {
      const toImport = previewRows.filter(r => !r.isDuplicate || r.isPendingPromotion);
      if (toImport.length === 0 && csvMetadata?.newBalance === undefined) {
        alert('Keine neuen Buchungen oder Kontostände zum Aktualisieren vorhanden.');
        return;
      }

      const now = new Date().toISOString();
      const txs: Transaction[] = toImport.map(row => ({
        date: row.date,
        valutaDate: row.valutaDate,
        amount: row.amount,
        currency: 'EUR',
        payee: row.payee,
        purpose: row.purpose,
        rawText: row.rawText,
        type: row.type,
        category: row.category,
        account: selectedTemplate.name,
        importedAt: now,
        sourceHash: row.sourceHash,
        status: row.status // PRESERVE STATUS!
      }));

      // Atomic write inside Dexie transaction checking existing hashes, upgrading pending, and updating account balance
      await db.transaction('rw', [db.transactions, db.accounts], async () => {
        // 1. Update Account checkpoint if newer
        if (csvMetadata?.newBalance !== undefined && csvMetadata?.endDate) {
          const acc = await db.accounts.get('comdirect');
          if (acc) {
            if (!acc.checkpointDate || csvMetadata.endDate >= acc.checkpointDate) {
              await db.accounts.update('comdirect', {
                checkpointBalance: csvMetadata.newBalance,
                checkpointDate: csvMetadata.endDate,
                iban: csvMetadata.iban || acc.iban
              });
            }
          }
        }

        // 2. Check existing transactions: promote pending to booked if newly booked!
        const existing = await db.transactions.toArray();
        const pendingMap = new Map<string, Transaction>();
        existing.forEach(t => {
          if (t.status === 'pending') {
            pendingMap.set(`${t.date}|${t.amount.toFixed(2)}|${t.payee.toLowerCase()}`, t);
          }
        });

        const existingHashes = new Set(existing.map(t => t.sourceHash));
        const deduplicated: Transaction[] = [];

        for (const t of txs) {
          const pendingKey = `${t.date}|${t.amount.toFixed(2)}|${t.payee.toLowerCase()}`;
          const existingPending = pendingMap.get(pendingKey);

          if (existingPending && existingPending.id !== undefined && t.status === 'booked') {
            // Promote existing pending transaction to booked!
            await db.transactions.update(existingPending.id, {
              status: 'booked',
              rawText: t.rawText,
              type: t.type,
              sourceHash: t.sourceHash
            });
            existingHashes.add(t.sourceHash);
          } else if (!existingHashes.has(t.sourceHash)) {
            deduplicated.push(t);
            existingHashes.add(t.sourceHash);
          }
        }

        if (deduplicated.length > 0) {
          await db.transactions.bulkAdd(deduplicated);
        }
      });

      onImportComplete(txs.length);
      onClose();
    } finally {
      setIsCommitting(false);
    }
  };

  const newCount = previewRows.filter(r => !r.isDuplicate && !r.isPendingPromotion).length;
  const promotionCount = previewRows.filter(r => r.isPendingPromotion).length;
  const dupCount = previewRows.filter(r => r.isDuplicate).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-ios-darkCard w-full max-w-2xl rounded-3xl p-6 shadow-2xl max-h-[90dvh] overflow-y-auto space-y-5 border border-ios-separator dark:border-ios-darkSeparator">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-ios-tint/10 text-ios-tint flex items-center justify-center">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-base text-slate-900 dark:text-white">Bank-CSV importieren</h2>
              <p className="text-xs text-ios-gray">comdirect &amp; weitere Banken mit Encoding-Schutz</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-slate-100 dark:bg-neutral-800 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Configuration Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-slate-50 dark:bg-neutral-800/60 rounded-2xl text-xs">
          <div>
            <label className="font-semibold text-ios-gray block mb-1">Bank-Vorlage</label>
            <select
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              className="w-full p-2 bg-white dark:bg-neutral-700 rounded-xl outline-none font-medium text-slate-800 dark:text-slate-100"
            >
              {bankTemplates.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="font-semibold text-ios-gray block mb-1">Text-Codierung</label>
            <select
              value={encoding}
              onChange={(e) => setEncoding(e.target.value as 'windows-1252' | 'utf-8')}
              className="w-full p-2 bg-white dark:bg-neutral-700 rounded-xl outline-none font-medium text-slate-800 dark:text-slate-100"
            >
              <option value="windows-1252">Windows-1252 / ANSI (comdirect Standard)</option>
              <option value="utf-8">UTF-8</option>
            </select>
          </div>
        </div>

        {/* Upload Dropzone */}
        {previewRows.length === 0 && (
          <label className="border-2 border-dashed border-slate-300 dark:border-neutral-700 hover:border-ios-tint dark:hover:border-ios-tint rounded-3xl p-8 flex flex-col items-center justify-center cursor-pointer transition-colors bg-slate-50/50 dark:bg-neutral-900/40 min-h-[160px]">
            <input
              type="file"
              accept=".csv,.txt"
              onChange={handleFileChange}
              className="hidden"
            />
            <FileText className="w-10 h-10 text-ios-tint mb-3" />
            <span className="font-semibold text-sm text-slate-800 dark:text-slate-200">
              CSV-Datei hier ablegen oder auswählen
            </span>
            <span className="text-xs text-ios-gray mt-1">
              comdirect Exportdatei (.csv) direkt vom Online-Banking
            </span>
          </label>
        )}

        {isLoading && (
          <div className="py-8 text-center text-ios-gray text-sm font-medium animate-pulse">
            CSV wird gelesen und analysiert...
          </div>
        )}

        {errorMsg && (
          <div className="p-4 bg-ios-red/10 border border-ios-red/20 rounded-2xl flex items-center space-x-3 text-ios-red text-xs font-medium">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Preview Results Table */}
        {previewRows.length > 0 && (
          <div className="space-y-3">
            {csvMetadata?.newBalance !== undefined && (
              <div className="p-3 bg-ios-green/10 border border-ios-green/20 rounded-2xl flex items-center justify-between text-xs text-ios-green">
                <span className="font-semibold">
                  Echter Kontostand erkannt (per {csvMetadata.endDate || 'Stichtag'}):
                </span>
                <span className="font-mono font-bold text-sm">
                  {csvMetadata.newBalance.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €
                </span>
              </div>
            )}

            <div className="flex items-center justify-between text-xs font-semibold px-1">
              <span className="text-slate-700 dark:text-slate-300">
                Gefundene Buchungen ({fileName})
              </span>
              <div className="flex items-center space-x-2">
                <span className="text-ios-green flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> {newCount} neu
                </span>
                {promotionCount > 0 && (
                  <span className="text-amber-500 font-semibold">
                    ({promotionCount} Status-Updates)
                  </span>
                )}
                {dupCount > 0 && (
                  <span className="text-ios-gray">
                    ({dupCount} bereits vorhanden)
                  </span>
                )}
              </div>
            </div>

            <div className="max-h-60 overflow-y-auto rounded-2xl border border-ios-separator dark:border-ios-darkSeparator divide-y divide-ios-separator/50 dark:divide-ios-darkSeparator/50 text-xs">
              {previewRows.map((row, idx) => (
                <div
                  key={idx}
                  className={`p-3 flex items-center justify-between ${row.isDuplicate ? 'opacity-40 bg-slate-50 dark:bg-neutral-900' : ''}`}
                >
                  <div className="min-w-0 pr-3">
                    <p className="font-semibold truncate text-slate-900 dark:text-white">
                      {row.payee}
                    </p>
                    <p className="text-[11px] text-ios-gray truncate">
                      {row.date} · {row.purpose}
                    </p>
                  </div>

                  <div className="text-right flex-shrink-0">
                    <span className={`font-bold font-mono ${row.amount > 0 ? 'text-ios-green' : 'text-slate-900 dark:text-white'}`}>
                      {row.amount > 0 ? '+' : ''}{row.amount.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €
                    </span>
                    <div className="flex items-center justify-end gap-1.5 mt-0.5">
                      {row.isPendingPromotion && (
                        <span className="text-[10px] bg-amber-500/20 text-amber-500 px-1.5 py-0.5 rounded font-bold">
                          Update (Gebucht)
                        </span>
                      )}
                      <select
                        value={row.category}
                        disabled={row.isDuplicate}
                        onChange={(e) => {
                          const updated = [...previewRows];
                          updated[idx].category = e.target.value;
                          setPreviewRows(updated);
                        }}
                        className="text-[10px] bg-slate-100 dark:bg-neutral-800 rounded px-1.5 py-0.5 mt-0.5 outline-none font-medium"
                      >
                        {categories.map(c => (
                          <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center space-x-3 pt-2">
              <button
                onClick={() => setPreviewRows([])}
                className="py-3 px-4 rounded-2xl bg-slate-100 dark:bg-neutral-800 text-slate-700 dark:text-slate-300 text-xs font-semibold hover:bg-slate-200"
              >
                Andere Datei
              </button>

              <button
                onClick={handleCommitImport}
                disabled={(newCount === 0 && promotionCount === 0 && csvMetadata?.newBalance === undefined) || isCommitting}
                className="flex-1 py-3 px-4 rounded-2xl bg-ios-tint text-white font-semibold text-sm shadow-md hover:brightness-110 active:scale-95 disabled:opacity-50 transition-all flex items-center justify-center space-x-2"
              >
                <span>
                  {isCommitting
                    ? 'Wird gespeichert...'
                    : newCount > 0
                    ? `${newCount} Buchungen speichern`
                    : 'Kontostand aktualisieren'}
                </span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
