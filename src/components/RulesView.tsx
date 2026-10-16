import React, { useState } from 'react';
import { Plus, Sparkles, Trash2, Play, Check } from 'lucide-react';
import type { CategoryRule, Category, Transaction } from '../types/index.ts';
import { evaluateRules } from '../lib/rulesEngine.ts';
import { createCategoryRule, deleteCategoryRuleScoped, updateExistingTransaction } from '../lib/api.ts';
import { CategoryIcon } from './CategoryIcon.tsx';

interface RulesViewProps {
  profileId?: string;
  rules: CategoryRule[];
  categories: Category[];
  transactions: Transaction[];
  onRulesUpdated: () => void;
}

export const RulesView: React.FC<RulesViewProps> = ({ profileId = 'privat', rules, categories, transactions, onRulesUpdated }) => {
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState('');
  const [field, setField] = useState<'payee' | 'purpose' | 'rawText' | 'type'>('rawText');
  const [operator, setOperator] = useState<'contains' | 'equals' | 'regex'>('contains');
  const [value, setValue] = useState('');
  const [targetCategory, setTargetCategory] = useState(categories[0]?.id || 'lebensmittel');
  const [isApplying, setIsApplying] = useState(false);

  const catMap = new Map(categories.map(c => [c.id, c]));

  const handleAddRule = async () => {
    if (!name.trim() || !value.trim()) {
      alert('Bitte Namen und Suchwert eingeben.');
      return;
    }

    const newRule: CategoryRule = {
      id: 'rule_' + Date.now().toString(36),
      name,
      priority: 50,
      conditions: [{ field, operator, value }],
      applyCategory: targetCategory,
      enabled: true
    };

    await createCategoryRule(profileId, newRule);
    setIsCreating(false);
    setName('');
    setValue('');
    onRulesUpdated();
  };

  const handleToggleRule = async (rule: CategoryRule) => {
    await createCategoryRule(profileId, { ...rule, enabled: !rule.enabled });
    onRulesUpdated();
  };

  const handleDeleteRule = async (id: string) => {
    if (confirm('Regel wirklich löschen?')) {
      await deleteCategoryRuleScoped(profileId, id);
      onRulesUpdated();
    }
  };

  const handleApplyRulesToExisting = async () => {
    setIsApplying(true);
    try {
      let updatedCount = 0;
      for (const tx of transactions) {
        const { category } = evaluateRules(tx, rules);
        if (category && category !== tx.category && tx.id !== undefined) {
          await updateExistingTransaction(tx.id, { category });
          updatedCount++;
        }
      }

      alert(`Erfolgreich ausgeführt! ${updatedCount} Buchungen neu kategorisiert.`);
      onRulesUpdated();
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="space-y-5 pb-24 max-w-5xl mx-auto px-4 pt-4">
      {/* Header card */}
      <div className="bg-white dark:bg-ios-darkCard p-5 rounded-3xl shadow-sm border border-ios-separator dark:border-ios-darkSeparator flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-bold text-lg text-slate-900 dark:text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-500" />
            <span>Intelligente Kategorisierung</span>
          </h2>
          <p className="text-xs text-ios-gray mt-1">
            Regeln erkennen Empfänger und Buchungstexte beim CSV-Import automatisch.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={handleApplyRulesToExisting}
            disabled={isApplying}
            className="flex items-center space-x-1.5 px-3.5 py-2.5 rounded-2xl text-xs font-semibold bg-slate-100 dark:bg-neutral-800 hover:bg-slate-200 dark:hover:bg-neutral-700 text-slate-800 dark:text-slate-200 transition-colors"
          >
            <Play className="w-3.5 h-3.5 text-ios-tint" />
            <span>{isApplying ? 'Wird angewendet...' : 'Auf alle anwenden'}</span>
          </button>

          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center space-x-1.5 px-4 py-2.5 rounded-2xl text-xs font-semibold bg-ios-tint text-white shadow-sm hover:brightness-110 active:scale-95 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Neue Regel</span>
          </button>
        </div>
      </div>

      {/* Create Rule Modal / Form */}
      {isCreating && (
        <div className="bg-white dark:bg-ios-darkCard p-5 rounded-3xl shadow-md border-2 border-ios-tint/30 space-y-4 animate-fade-in">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-slate-900 dark:text-white">Neue Erkennungsregel anlegen</h3>
            <button
              onClick={() => setIsCreating(false)}
              className="text-xs text-ios-gray hover:text-slate-900"
            >
              Abbrechen
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="font-semibold text-ios-gray block mb-1">Regelname</label>
              <input
                type="text"
                placeholder="z.B. Supermarkt REWE"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-100 dark:bg-neutral-800 rounded-xl outline-none"
              />
            </div>

            <div>
              <label className="font-semibold text-ios-gray block mb-1">Zielkategorie</label>
              <select
                value={targetCategory}
                onChange={(e) => setTargetCategory(e.target.value)}
                className="w-full px-3 py-2 bg-slate-100 dark:bg-neutral-800 rounded-xl outline-none font-medium"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="font-semibold text-ios-gray block mb-1">Bedingungsfeld &amp; Logik</label>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={field}
                  onChange={(e) => setField(e.target.value as any)}
                  className="w-full px-2 py-2 bg-slate-100 dark:bg-neutral-800 rounded-xl outline-none"
                >
                  <option value="rawText">Gesamter Text</option>
                  <option value="payee">Empfänger / Name</option>
                  <option value="purpose">Verwendungszweck</option>
                  <option value="type">Vorgang</option>
                </select>

                <select
                  value={operator}
                  onChange={(e) => setOperator(e.target.value as any)}
                  className="w-full px-2 py-2 bg-slate-100 dark:bg-neutral-800 rounded-xl outline-none"
                >
                  <option value="contains">enthält</option>
                  <option value="equals">ist exakt</option>
                  <option value="regex">Regex-Muster</option>
                </select>
              </div>
            </div>

            <div>
              <label className="font-semibold text-ios-gray block mb-1">Suchwert (Wort oder Muster)</label>
              <input
                type="text"
                placeholder="z.B. REWE oder (EDEKA|ALDI)"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="w-full px-3 py-2 bg-slate-100 dark:bg-neutral-800 rounded-xl outline-none"
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              onClick={handleAddRule}
              className="px-5 py-2.5 rounded-xl bg-ios-tint text-white font-semibold text-xs shadow-sm hover:brightness-110 active:scale-95"
            >
              Regel speichern
            </button>
          </div>
        </div>
      )}

      {/* Rules List */}
      <div className="space-y-2">
        {rules.map((rule) => {
          const cat = catMap.get(rule.applyCategory);
          const firstCond = rule.conditions[0];

          return (
            <div
              key={rule.id}
              className={`p-4 rounded-2xl border transition-all flex items-center justify-between gap-4 ${
                rule.enabled
                  ? 'bg-white dark:bg-ios-darkCard border-ios-separator dark:border-ios-darkSeparator shadow-sm'
                  : 'bg-slate-50 dark:bg-neutral-900 border-transparent opacity-60'
              }`}
            >
              <div className="min-w-0 flex items-center space-x-3">
                <button
                  onClick={() => handleToggleRule(rule)}
                  className={`w-6 h-6 rounded-lg flex items-center justify-center transition-colors flex-shrink-0 ${
                    rule.enabled ? 'bg-ios-tint text-white' : 'border border-slate-300 dark:border-neutral-700'
                  }`}
                  aria-label="Regel aktivieren oder deaktivieren"
                >
                  {rule.enabled && <Check className="w-4 h-4 stroke-[3]" />}
                </button>

                <div className="min-w-0">
                  <p className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                    {rule.name}
                  </p>
                  <p className="text-xs text-ios-gray truncate">
                    Wenn <span className="font-mono text-slate-700 dark:text-slate-300">{firstCond?.field}</span> {firstCond?.operator} &bdquo;<span className="font-semibold text-slate-800 dark:text-slate-200">{firstCond?.value}</span>&ldquo;
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-3 flex-shrink-0">
                <span
                  className="px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5"
                  style={{
                    backgroundColor: `${cat?.color || '#8E8E93'}20`,
                    color: cat?.color || '#8E8E93'
                  }}
                >
                  {cat?.icon && <CategoryIcon name={cat.icon} className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline">{cat?.name}</span>
                </span>

                <button
                  onClick={() => handleDeleteRule(rule.id)}
                  className="p-2 text-slate-400 hover:text-ios-red transition-colors"
                  title="Regel löschen"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
