import React, { useState, useEffect } from 'react';
import { X, Trash2, Sparkles, Check } from 'lucide-react';
import type { Transaction, Category, CategoryRule } from '../types/index.ts';
import { parseGermanAmount } from '../lib/csvParser.ts';
import { createCategoryRule } from '../lib/api.ts';
import { CategoryIcon } from './CategoryIcon.tsx';

interface TransactionDetailModalProps {
  profileId?: string;
  transaction: Transaction | null;
  categories: Category[];
  onClose: () => void;
  onSave: (transaction: Transaction) => void | Promise<void>;
  onDelete?: (id: number) => void | Promise<void>;
}

export const TransactionDetailModal: React.FC<TransactionDetailModalProps> = props => {
  return props.transaction ? <TransactionEditor {...props} transaction={props.transaction} /> : null;
};

const TransactionEditor: React.FC<TransactionDetailModalProps & { transaction: Transaction }> = ({
  profileId = 'privat',
  transaction,
  categories,
  onClose,
  onSave,
  onDelete,
}) => {
  const isNew = transaction.id === undefined;

  const [date, setDate] = useState(transaction.date);
  const [amountInput, setAmountInput] = useState(transaction.amount ? Math.abs(transaction.amount).toFixed(2).replace('.', ',') : '0,00');
  const [isExpense, setIsExpense] = useState(transaction.amount <= 0);
  const [selectedCat, setSelectedCat] = useState(transaction.category);
  const [createRule, setCreateRule] = useState(false);
  const [payee, setPayee] = useState(transaction.payee);
  const [purpose, setPurpose] = useState(transaction.purpose);
  const [ruleField, setRuleField] = useState<'payee' | 'purpose' | 'rawText'>('payee');
  const [ruleValue, setRuleValue] = useState(transaction.payee || '');
  const [ruleOperator, setRuleOperator] = useState<'contains' | 'equals'>('contains');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDate(transaction.date);
    setAmountInput(transaction.amount ? Math.abs(transaction.amount).toFixed(2).replace('.', ',') : '0,00');
    setIsExpense(transaction.amount <= 0);
    setSelectedCat(transaction.category);
    setPayee(transaction.payee);
    setPurpose(transaction.purpose);
    setCreateRule(false);
    const initialField = transaction.payee && transaction.payee !== 'Unbekannt' ? 'payee' : 'rawText';
    setRuleField(initialField);
    setRuleValue((initialField === 'payee' ? transaction.payee : transaction.rawText.slice(0, 30)) || '');
    setRuleOperator('contains');
  }, [transaction]);

  const handleSave = async () => {
    if (isSaving) return;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      alert('Bitte ein gültiges Datum auswählen.');
      return;
    }

    const parsedAmount = parseGermanAmount(amountInput);
    if (parsedAmount === null || parsedAmount <= 0) {
      alert('Bitte einen gültigen Betrag eingeben (z. B. 45,50 oder 1.250,00).');
      return;
    }

    const finalAmount = isExpense ? -Math.abs(parsedAmount) : Math.abs(parsedAmount);

    const updated: Transaction = {
      ...transaction,
      date,
      amount: finalAmount,
      category: selectedCat,
      payee: payee.trim() || 'Unbekannt',
      purpose: purpose.trim(),
    };

    setIsSaving(true);
    setError(null);
    try {
      if (createRule && selectedCat !== transaction.category && ruleValue.trim()) {
        const newRule: CategoryRule = {
          id: 'rule_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          name: `${ruleValue.trim()} → ${selectedCat}`,
          priority: 5,
          conditions: [
            {
              field: ruleField,
              operator: ruleOperator,
              value: ruleValue.trim()
            }
          ],
          applyCategory: selectedCat,
          enabled: true
        };
        await createCategoryRule(profileId, newRule);
      }
      await onSave(updated);
      onClose();
    } catch {
      setError('Buchung konnte nicht gespeichert werden. Deine Eingaben bleiben erhalten. Bitte erneut versuchen.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-ios-darkCard w-full max-w-lg rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl max-h-[90dvh] overflow-y-auto space-y-4 border border-ios-separator dark:border-ios-darkSeparator">
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-ios-gray uppercase tracking-wider">
            {isNew ? 'Neue Buchung erfassen' : 'Buchungsdetails bearbeiten'}
          </span>
          <button
            onClick={onClose}
            disabled={isSaving}
            aria-label="Schließen"
            className="w-9 h-9 rounded-full bg-slate-100 dark:bg-neutral-800 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Amount & Type Input */}
        <div className="bg-slate-50 dark:bg-neutral-800/60 p-4 rounded-2xl space-y-3">
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setIsExpense(true)}
              className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${
                isExpense ? 'bg-ios-red text-white shadow-sm' : 'text-ios-gray hover:text-slate-900'
              }`}
            >
              Ausgabe (−)
            </button>
            <button
              type="button"
              onClick={() => setIsExpense(false)}
              className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${
                !isExpense ? 'bg-ios-green text-white shadow-sm' : 'text-ios-gray hover:text-slate-900'
              }`}
            >
              Einnahme (+)
            </button>
          </div>

          <div className="flex items-center justify-center space-x-2">
            <span className={`text-2xl font-extrabold ${isExpense ? 'text-ios-red' : 'text-ios-green'}`}>
              {isExpense ? '−' : '+'}
            </span>
            <input
              type="text"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              placeholder="0,00"
              className="text-3xl font-extrabold bg-transparent text-center text-slate-900 dark:text-white outline-none max-w-[180px] font-mono"
            />
            <span className="text-2xl font-extrabold text-slate-400">€</span>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-ios-gray block mb-1">Buchungsdatum</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-1.5 bg-white dark:bg-neutral-700 rounded-xl text-xs outline-none text-center font-medium"
            />
          </div>
        </div>

        {/* Editable Fields */}
        <div className="space-y-3 text-xs">
          <div>
            <label className="font-semibold text-ios-gray block mb-1">Empfänger / Auftraggeber</label>
            <input
              type="text"
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              placeholder="z.B. Supermarkt oder Gehalt"
              className="w-full px-3.5 py-2.5 bg-slate-100 dark:bg-neutral-800 rounded-xl text-sm outline-none focus:ring-2 focus:ring-ios-tint"
            />
          </div>

          <div>
            <label className="font-semibold text-ios-gray block mb-1">Verwendungszweck / Notiz</label>
            <textarea
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              rows={2}
              placeholder="Optionale Notiz..."
              className="w-full px-3.5 py-2.5 bg-slate-100 dark:bg-neutral-800 rounded-xl text-sm outline-none focus:ring-2 focus:ring-ios-tint resize-none"
            />
          </div>
        </div>

        {/* Category Selection Grid */}
        <div>
          <label className="text-xs font-semibold text-ios-gray block mb-2">Kategorie wählen</label>
          <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto pr-1">
            {categories.map((c) => {
              const isSelected = selectedCat === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => {
                    setSelectedCat(c.id);
                    if (!isNew && c.id !== transaction.category) {
                      setCreateRule(true);
                    }
                  }}
                  className={`flex items-center space-x-2.5 p-2.5 rounded-xl text-left border transition-all ${
                    isSelected
                      ? 'border-ios-tint bg-ios-tint/10 text-ios-tint font-bold shadow-sm'
                      : 'border-transparent bg-slate-100 dark:bg-neutral-800 text-slate-800 dark:text-slate-200 hover:bg-slate-200/60'
                  }`}
                >
                  <CategoryIcon name={c.icon} className="w-5 h-5 flex-shrink-0" />
                  <span className="text-xs truncate flex-1">{c.name}</span>
                  {isSelected && <Check className="w-4 h-4 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Smart Rule Learning Toggle (only on edit) */}
        {!isNew && selectedCat !== transaction.category && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3.5 space-y-2.5">
            <div className="flex items-start space-x-3">
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
                    Intelligente Erkennungsregel anlegen
                  </span>
                </label>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">
                  Zukünftige Buchungen automatisch dieser Kategorie zuordnen.
                </p>
              </div>
            </div>

            {createRule && (
              <div className="pt-2 border-t border-amber-500/20 space-y-2 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                      Zu prüfendes Feld
                    </label>
                    <select
                      value={ruleField}
                      aria-label="Zu prüfendes Feld"
                      onChange={(e) => {
                        const f = e.target.value as 'payee' | 'purpose' | 'rawText';
                        setRuleField(f);
                        if (f === 'payee') setRuleValue(payee.trim());
                        else if (f === 'purpose') setRuleValue(purpose.trim());
                        else setRuleValue(transaction.rawText.slice(0, 35).trim());
                      }}
                      className="w-full px-2.5 py-1.5 bg-white dark:bg-neutral-800 rounded-xl outline-none border border-amber-500/30 font-medium text-slate-900 dark:text-white"
                    >
                      <option value="payee">Nur Empfänger ({payee || 'Unbekannt'})</option>
                      <option value="purpose">Verwendungszweck ({purpose ? purpose.slice(0, 20) + '…' : 'Leer'})</option>
                      <option value="rawText">Buchungstext (Gesamt)</option>
                    </select>
                  </div>

                  <div>
                    <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                      Bedingung
                    </label>
                    <select
                      value={ruleOperator}
                      aria-label="Regel Bedingung"
                      onChange={(e) => setRuleOperator(e.target.value as any)}
                      className="w-full px-2.5 py-1.5 bg-white dark:bg-neutral-800 rounded-xl outline-none border border-amber-500/30 font-medium text-slate-900 dark:text-white"
                    >
                      <option value="contains">enthält</option>
                      <option value="equals">ist exakt</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Suchwert anpassen (Filterbegriff)
                  </label>
                  <input
                    type="text"
                    value={ruleValue}
                    onChange={(e) => setRuleValue(e.target.value)}
                    placeholder="Suchbegriff eingeben..."
                    className="w-full px-2.5 py-1.5 bg-white dark:bg-neutral-800 rounded-xl outline-none border border-amber-500/30 text-xs text-slate-900 dark:text-white"
                  />
                  <span className="text-[10px] text-ios-gray mt-0.5 block">
                    Tipp: Du kannst den Text kürzen (z. B. nur „REWE“ statt des ganzen Filialnamens), damit alle künftigen Buchungen greifen.
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        {error && <p role="alert" className="text-sm text-ios-red">{error}</p>}
        <div className="flex items-center space-x-3 pt-2">
          {!isNew && onDelete && transaction.id !== undefined && (
            <button
              disabled={isSaving}
              onClick={async () => {
                if (isSaving || !confirm('Buchung wirklich löschen?')) return;
                setIsSaving(true);
                setError(null);
                try {
                  await onDelete(transaction.id!);
                  onClose();
                } catch {
                  setError('Buchung konnte nicht gelöscht werden. Bitte erneut versuchen.');
                } finally {
                  setIsSaving(false);
                }
              }}
              aria-label="Buchung löschen"
              className="p-3 rounded-2xl text-ios-red hover:bg-ios-red/10 transition-colors"
              title="Löschen"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          )}

          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex-1 py-3 px-4 rounded-2xl bg-ios-tint text-white font-semibold shadow-md hover:brightness-110 active:scale-95 transition-all text-sm"
          >
            {isSaving ? 'Wird gespeichert…' : isNew ? 'Buchung anlegen' : 'Änderungen speichern'}
          </button>
        </div>
      </div>
    </div>
  );
};
