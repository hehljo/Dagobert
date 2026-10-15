import React, { useState } from 'react';
import { X, Trash2, Sparkles, Check } from 'lucide-react';
import type { Transaction, Category } from '../types/index.ts';
import { createSuggestedRule } from '../lib/rulesEngine.ts';
import { db } from '../lib/db.ts';

interface TransactionDetailModalProps {
  transaction: Transaction | null;
  categories: Category[];
  onClose: () => void;
  onUpdate: (updated: Transaction) => void;
  onDelete: (id: number) => void;
}

export const TransactionDetailModal: React.FC<TransactionDetailModalProps> = ({
  transaction,
  categories,
  onClose,
  onUpdate,
  onDelete,
}) => {
  if (!transaction) return null;

  const [selectedCat, setSelectedCat] = useState(transaction.category);
  const [createRule, setCreateRule] = useState(false);
  const [payee, setPayee] = useState(transaction.payee);
  const [purpose, setPurpose] = useState(transaction.purpose);

  const isPositive = transaction.amount > 0;

  const handleSave = async () => {
    const updated: Transaction = {
      ...transaction,
      category: selectedCat,
      payee,
      purpose,
    };

    // If user wants to learn a smart rule
    if (createRule && selectedCat !== transaction.category) {
      const newRule = createSuggestedRule(updated, selectedCat);
      await db.rules.add(newRule);
    }

    onUpdate(updated);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-ios-darkCard w-full max-w-lg rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto space-y-5 border border-ios-separator dark:border-ios-darkSeparator">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-semibold text-ios-gray uppercase tracking-wider">
              Buchungsdetails
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-slate-100 dark:bg-neutral-800 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Amount Display */}
        <div className="text-center py-2">
          <div className={`text-3xl font-extrabold ${isPositive ? 'text-ios-green' : 'text-slate-900 dark:text-white'}`}>
            {isPositive ? '+' : ''}{transaction.amount.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €
          </div>
          <p className="text-xs text-ios-gray mt-1">
            {transaction.date} · {transaction.type || 'Buchung'}
          </p>
        </div>

        {/* Editable Fields */}
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-ios-gray block mb-1">Empfänger / Auftraggeber</label>
            <input
              type="text"
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-100 dark:bg-neutral-800 rounded-xl text-sm outline-none focus:ring-2 focus:ring-ios-tint"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-ios-gray block mb-1">Verwendungszweck</label>
            <textarea
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              rows={2}
              className="w-full px-3.5 py-2.5 bg-slate-100 dark:bg-neutral-800 rounded-xl text-sm outline-none focus:ring-2 focus:ring-ios-tint resize-none"
            />
          </div>
        </div>

        {/* Category Selection Grid */}
        <div>
          <label className="text-xs font-semibold text-ios-gray block mb-2">Kategorie wählen</label>
          <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
            {categories.map((c) => {
              const isSelected = selectedCat === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => {
                    setSelectedCat(c.id);
                    if (c.id !== transaction.category) {
                      setCreateRule(true);
                    }
                  }}
                  className={`flex items-center space-x-2.5 p-2.5 rounded-xl text-left border transition-all ${
                    isSelected
                      ? 'border-ios-tint bg-ios-tint/10 text-ios-tint font-bold shadow-sm'
                      : 'border-transparent bg-slate-100 dark:bg-neutral-800 text-slate-800 dark:text-slate-200 hover:bg-slate-200/60'
                  }`}
                >
                  <span className="text-lg">{c.icon}</span>
                  <span className="text-xs truncate flex-1">{c.name}</span>
                  {isSelected && <Check className="w-4 h-4 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Smart Rule Learning Toggle */}
        {selectedCat !== transaction.category && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3.5 flex items-start space-x-3">
            <Sparkles className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <label className="flex items-center cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={createRule}
                  onChange={(e) => setCreateRule(e.target.checked)}
                  className="rounded text-amber-500 focus:ring-amber-500 mr-2.5 w-4 h-4"
                />
                <span className="text-xs font-semibold text-slate-900 dark:text-white">
                  Intelligente Regel anlegen
                </span>
              </label>
              <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">
                Zukünftige Buchungen mit &bdquo;{payee}&ldquo; automatisch dieser Kategorie zuordnen.
              </p>
            </div>
          </div>
        )}

        {/* Raw Text Details Collapse */}
        <details className="text-xs text-ios-gray">
          <summary className="cursor-pointer hover:underline">Originaler Bank-Buchungstext</summary>
          <p className="p-3 bg-slate-100 dark:bg-neutral-800 rounded-xl mt-1.5 font-mono text-[11px] break-all">
            {transaction.rawText}
          </p>
        </details>

        {/* Action Buttons */}
        <div className="flex items-center space-x-3 pt-2">
          {transaction.id && (
            <button
              onClick={() => {
                if (confirm('Buchung wirklich löschen?')) {
                  onDelete(transaction.id!);
                  onClose();
                }
              }}
              className="p-3 rounded-2xl text-ios-red hover:bg-ios-red/10 transition-colors"
              title="Löschen"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          )}

          <button
            onClick={handleSave}
            className="flex-1 py-3 px-4 rounded-2xl bg-ios-tint text-white font-semibold shadow-md hover:brightness-110 active:scale-95 transition-all text-sm"
          >
            Änderungen speichern
          </button>
        </div>
      </div>
    </div>
  );
};
