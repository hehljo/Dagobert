import React, { useRef, useState } from 'react';
import { Plus, Sparkles, Trash2, Play, Check, Download, Pencil, X } from 'lucide-react';
import type { CategoryRule, Category, Transaction, RuleCondition } from '../types/index.ts';
import { evaluateRules, matchesCondition } from '../lib/rulesEngine.ts';
import { createCategoryRule, deleteCategoryRuleScoped, loadStandardCategoryRules, updateExistingTransaction } from '../lib/api.ts';
import { CategoryIcon } from './CategoryIcon.tsx';

interface RulesViewProps {
  profileId?: string;
  rules: CategoryRule[];
  categories: Category[];
  transactions: Transaction[];
  onRulesUpdated: () => void | Promise<void>;
}

interface EditingRule {
  id: string;
  name: string;
  priority: number;
  applyCategory: string;
  conditions: RuleCondition[];
  enabled: boolean;
  isNew: boolean;
}

const FIELD_LABELS: Record<RuleCondition['field'], string> = {
  payee: 'Empfänger / Name',
  purpose: 'Verwendungszweck',
  rawText: 'Buchungstext (Gesamt)',
  type: 'Vorgang / Buchungsart',
  amount: 'Betrag (€)'
};

const OPERATOR_LABELS: Record<RuleCondition['operator'], string> = {
  contains: 'enthält',
  equals: 'ist exakt',
  startsWith: 'beginnt mit',
  regex: 'Regex-Muster',
  greaterThan: 'größer als',
  lessThan: 'kleiner als'
};

export const RulesView: React.FC<RulesViewProps> = ({ profileId = 'privat', rules, categories, transactions, onRulesUpdated }) => {
  const [editingRule, setEditingRule] = useState<EditingRule | null>(null);
  const [applyToExistingOnSave, setApplyToExistingOnSave] = useState(true);
  const [isApplying, setIsApplying] = useState(false);
  const [isLoadingDefaults, setIsLoadingDefaults] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);
  const operationPending = useRef(false);

  const catMap = new Map(categories.map(c => [c.id, c]));

  const handleStartNewRule = () => {
    setApplyToExistingOnSave(true);
    setEditingRule({
      id: 'rule_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: '',
      priority: 5,
      applyCategory: categories[0]?.id || 'lebensmittel',
      conditions: [{ field: 'payee', operator: 'contains', value: '' }],
      enabled: true,
      isNew: true
    });
  };

  const handleStartEditRule = (rule: CategoryRule) => {
    setApplyToExistingOnSave(true);
    let conds: RuleCondition[] = [];
    if (Array.isArray(rule.conditions) && rule.conditions.length > 0) {
      conds = rule.conditions.map(c => ({ ...c }));
    } else if (typeof rule.conditions === 'string') {
      try {
        const parsed = JSON.parse(rule.conditions);
        if (Array.isArray(parsed) && parsed.length > 0) conds = parsed;
      } catch (e) { console.warn('Regel-Bedingungen JSON ungültig:', e); }
    }
    if (conds.length === 0) {
      conds = [{ field: 'payee', operator: 'contains', value: '' }];
    }
    setEditingRule({
      id: rule.id,
      name: rule.name,
      priority: rule.priority ?? 5,
      applyCategory: rule.applyCategory,
      conditions: conds,
      enabled: rule.enabled,
      isNew: false
    });
  };

  const handleAddCondition = () => {
    if (!editingRule) return;
    setEditingRule({
      ...editingRule,
      conditions: [...editingRule.conditions, { field: 'purpose', operator: 'contains', value: '' }]
    });
  };

  const handleRemoveCondition = (index: number) => {
    if (!editingRule || editingRule.conditions.length <= 1) return;
    setEditingRule({
      ...editingRule,
      conditions: editingRule.conditions.filter((_, i) => i !== index)
    });
  };

  const handleUpdateCondition = (index: number, patch: Partial<RuleCondition>) => {
    if (!editingRule) return;
    const nextConds = [...editingRule.conditions];
    const current = nextConds[index];
    const updated = { ...current, ...patch };

    // Adjust operator if switching between amount and text fields
    if (patch.field === 'amount' && (updated.operator === 'contains' || updated.operator === 'startsWith' || updated.operator === 'regex')) {
      updated.operator = 'greaterThan';
    } else if (patch.field && patch.field !== 'amount' && (updated.operator === 'greaterThan' || updated.operator === 'lessThan')) {
      updated.operator = 'contains';
    }

    nextConds[index] = updated;
    setEditingRule({ ...editingRule, conditions: nextConds });
  };

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRule) return;

    if (!editingRule.name.trim()) {
      alert('Bitte einen Regelnamen eingeben.');
      return;
    }

    const validConditions = editingRule.conditions.filter(c => c.value.trim().length > 0);
    if (validConditions.length === 0) {
      alert('Mindestens eine Bedingung mit Suchwert ist erforderlich.');
      return;
    }

    const ruleToSave: CategoryRule = {
      id: editingRule.id,
      name: editingRule.name.trim(),
      priority: editingRule.priority,
      applyCategory: editingRule.applyCategory,
      conditions: validConditions,
      enabled: editingRule.enabled
    };

    try {
      await createCategoryRule(profileId, ruleToSave);
      let retroCount = 0;
      if (applyToExistingOnSave && transactions.length > 0) {
        for (const tx of transactions) {
          if (tx.id !== undefined && tx.category !== ruleToSave.applyCategory) {
            const allMatch = ruleToSave.conditions.every(cond => matchesCondition(tx, cond));
            if (allMatch) {
              try {
                await updateExistingTransaction(tx.id, { category: ruleToSave.applyCategory });
                retroCount++;
              } catch (e) {
                console.warn('Fehler beim Aktualisieren der Buchung:', tx.id, e);
              }
            }
          }
        }
      }
      setEditingRule(null);
      if (retroCount > 0) {
        setFeedback({
          text: `Regel gespeichert und ${retroCount.toLocaleString('de-DE')} bestehende Buchungen aktualisiert.`,
          error: false
        });
      }
      await onRulesUpdated();
    } catch (err: any) {
      alert(err.message || 'Fehler beim Speichern der Regel.');
    }
  };

  const handleToggleRule = async (rule: CategoryRule) => {
    await createCategoryRule(profileId, { ...rule, enabled: !rule.enabled });
    onRulesUpdated();
  };

  const handleDeleteRule = async (id: string, name: string) => {
    if (confirm(`Regel "${name}" wirklich löschen?`)) {
      await deleteCategoryRuleScoped(profileId, id);
      onRulesUpdated();
    }
  };

  const handleApplyRulesToExisting = async () => {
    if (operationPending.current) return;
    operationPending.current = true;
    setIsApplying(true);
    setFeedback(null);
    let updatedCount = 0;
    try {
      for (const tx of transactions) {
        if (tx.category !== 'sonstiges') continue;
        const { category, matchedRule } = evaluateRules(tx, rules);
        if (matchedRule && category !== 'sonstiges' && tx.id !== undefined) {
          await updateExistingTransaction(tx.id, { category });
          updatedCount++;
        }
      }

      setFeedback({ text: `${updatedCount.toLocaleString('de-DE')} Buchungen neu kategorisiert.`, error: false });
    } catch {
      setFeedback({ text: `Anwenden abgebrochen. ${updatedCount.toLocaleString('de-DE')} Buchungen neu kategorisiert. Bitte erneut versuchen.`, error: true });
    } finally {
      await onRulesUpdated();
      setIsApplying(false);
      operationPending.current = false;
    }
  };

  const handleLoadDefaults = async () => {
    if (operationPending.current) return;
    operationPending.current = true;
    setIsLoadingDefaults(true);
    setFeedback(null);
    try {
      const { inserted, updated } = await loadStandardCategoryRules(profileId);
      setFeedback({
        text: inserted || updated
          ? `${inserted.toLocaleString('de-DE')} Standard-Regeln ergänzt, ${updated.toLocaleString('de-DE')} aktualisiert.`
          : 'Standard-Regeln sind aktuell. Eigene Anpassungen bleiben erhalten.',
        error: false
      });
      await onRulesUpdated();
    } catch {
      setFeedback({ text: 'Standard-Regeln konnten nicht geladen werden. Bitte erneut versuchen.', error: true });
    } finally {
      setIsLoadingDefaults(false);
      operationPending.current = false;
    }
  };

  return (
    <div className="space-y-5 pb-24 max-w-5xl mx-auto px-4 pt-4">
      {/* Header card */}
      <div className="glass-surface p-5 rounded-3xl shadow-sm border border-ios-separator dark:border-ios-darkSeparator flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-bold text-lg text-slate-900 dark:text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-500" />
            <span>Intelligente Kategorisierung</span>
          </h2>
          <p className="text-xs text-ios-gray mt-1">
            Regeln erkennen Empfänger und Buchungstexte beim CSV-Import automatisch.
            Du kannst Regeln frei bearbeiten und Felder wie Empfänger oder Verwendungszweck gezielt filtern.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:max-w-md">
          <button
            onClick={handleLoadDefaults}
            aria-label={isLoadingDefaults ? 'Standard-Regeln werden geladen…' : 'Standard-Regeln laden / aktualisieren'}
            disabled={isLoadingDefaults || isApplying}
            className="flex items-center gap-1.5 min-h-[48px] px-3.5 py-2 rounded-2xl text-xs font-semibold bg-slate-100 dark:bg-neutral-800 hover:bg-slate-200 dark:hover:bg-neutral-700 text-slate-800 dark:text-slate-200 transition-colors disabled:opacity-50"
          >
            <Download className="w-4 h-4 shrink-0" />
            <span>{isLoadingDefaults ? 'Lädt…' : 'Standard-Regeln'}</span>
          </button>
          <button
            onClick={handleApplyRulesToExisting}
            aria-label={isApplying ? 'Wird angewendet…' : 'Regeln anwenden'}
            disabled={isApplying || isLoadingDefaults}
            className="flex items-center space-x-1.5 min-h-[48px] px-3.5 py-2 rounded-2xl text-xs font-semibold bg-slate-100 dark:bg-neutral-800 hover:bg-slate-200 dark:hover:bg-neutral-700 text-slate-800 dark:text-slate-200 transition-colors disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5 text-ios-tint" />
            <span>{isApplying ? 'Wird angewendet…' : 'Regeln anwenden'}</span>
          </button>

          <button
            onClick={handleStartNewRule}
            disabled={isApplying || isLoadingDefaults}
            aria-label="Neue Regel anlegen"
            className="flex items-center space-x-1.5 min-h-[48px] px-4 py-2 rounded-2xl text-xs font-semibold bg-ios-tint text-white shadow-sm hover:brightness-110 active:scale-95 transition-all disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            <span>Neue Regel</span>
          </button>
        </div>
      </div>

      {feedback && (
        <p role={feedback.error ? 'alert' : 'status'} className={`rounded-2xl p-4 text-sm ${feedback.error ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200' : 'bg-slate-100 text-slate-800 dark:bg-neutral-800 dark:text-slate-200'}`}>
          {feedback.text}
        </p>
      )}

      {/* Create / Edit Rule Modal */}
      {editingRule && (
        <div
          className="glass-overlay fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditingRule(null);
          }}
        >
          <form
            onSubmit={handleSaveRule}
            className="glass-surface w-full max-w-2xl rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl max-h-[90dvh] overflow-y-auto space-y-4 border border-ios-separator dark:border-ios-darkSeparator text-xs"
          >
          <div className="flex items-center justify-between pb-2 border-b border-ios-separator dark:border-ios-darkSeparator">
            <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
              {editingRule.isNew ? <Plus className="w-4 h-4 text-ios-tint" /> : <Pencil className="w-4 h-4 text-ios-tint" />}
              <span>{editingRule.isNew ? 'Neue Erkennungsregel anlegen' : 'Erkennungsregel bearbeiten'}</span>
            </h3>
            <button
              type="button"
              onClick={() => setEditingRule(null)}
              className="p-1 rounded-lg text-ios-gray hover:text-slate-900 dark:hover:text-white"
              aria-label="Editor schließen"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-1">
              <label className="font-semibold text-ios-gray block mb-1">Regelname</label>
              <input
                type="text"
                placeholder="z.B. Supermarkt REWE"
                value={editingRule.name}
                onChange={(e) => setEditingRule({ ...editingRule, name: e.target.value })}
                className="w-full px-3 py-2 bg-slate-100 dark:bg-neutral-800 rounded-xl outline-none text-slate-900 dark:text-white font-medium"
              />
            </div>

            <div className="sm:col-span-1">
              <label className="font-semibold text-ios-gray block mb-1">Zielkategorie</label>
              <select
                value={editingRule.applyCategory}
                onChange={(e) => setEditingRule({ ...editingRule, applyCategory: e.target.value })}
                className="w-full px-3 py-2 bg-slate-100 dark:bg-neutral-800 rounded-xl outline-none font-medium text-slate-900 dark:text-white"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-1">
              <label className="font-semibold text-ios-gray block mb-1">Priorität (1–99)</label>
              <input
                type="number"
                min={1}
                max={99}
                value={editingRule.priority}
                onChange={(e) => setEditingRule({ ...editingRule, priority: parseInt(e.target.value) || 5 })}
                className="w-full px-3 py-2 bg-slate-100 dark:bg-neutral-800 rounded-xl outline-none text-slate-900 dark:text-white font-mono"
              />
              <span className="text-[10px] text-ios-gray mt-0.5 block">Kleine Zahl = wird zuerst geprüft</span>
            </div>
          </div>

          {/* Conditions Section */}
          <div className="space-y-2 pt-2 border-t border-ios-separator dark:border-ios-darkSeparator">
            <div className="flex items-center justify-between">
              <label className="font-bold text-slate-900 dark:text-white block">
                Bedingungen (alle müssen zutreffen)
              </label>
              <button
                type="button"
                onClick={handleAddCondition}
                aria-label="Weitere Bedingung hinzufügen"
                className="flex items-center space-x-1 text-ios-tint font-semibold hover:underline"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Bedingung hinzufügen</span>
              </button>
            </div>

            <div className="space-y-2.5">
              {editingRule.conditions.map((cond, idx) => {
                const isAmount = cond.field === 'amount';
                return (
                  <div key={idx} className="p-3 bg-slate-50 dark:bg-neutral-800/60 rounded-2xl border border-ios-separator dark:border-ios-darkSeparator flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <span className="text-[10px] font-bold text-ios-gray sm:w-16">
                      {idx === 0 ? 'WENN' : 'UND'}
                    </span>

                    {/* Field select */}
                    <select
                      value={cond.field}
                      onChange={(e) => handleUpdateCondition(idx, { field: e.target.value as any })}
                      className="px-2.5 py-1.5 bg-white dark:bg-neutral-700 rounded-xl outline-none font-medium text-slate-900 dark:text-white sm:w-44"
                    >
                      <option value="payee">Empfänger / Name</option>
                      <option value="purpose">Verwendungszweck</option>
                      <option value="rawText">Buchungstext (Gesamt)</option>
                      <option value="type">Vorgang</option>
                      <option value="amount">Betrag (€)</option>
                    </select>

                    {/* Operator select */}
                    <select
                      value={cond.operator}
                      onChange={(e) => handleUpdateCondition(idx, { operator: e.target.value as any })}
                      className="px-2.5 py-1.5 bg-white dark:bg-neutral-700 rounded-xl outline-none font-medium text-slate-900 dark:text-white sm:w-36"
                    >
                      {isAmount ? (
                        <>
                          <option value="greaterThan">größer als (&gt;)</option>
                          <option value="lessThan">kleiner als (&lt;)</option>
                          <option value="equals">ist genau gleich</option>
                        </>
                      ) : (
                        <>
                          <option value="contains">enthält</option>
                          <option value="equals">ist exakt</option>
                          <option value="startsWith">beginnt mit</option>
                          <option value="regex">Regex-Muster</option>
                        </>
                      )}
                    </select>

                    {/* Value input */}
                    <input
                      type={isAmount ? 'number' : 'text'}
                      step={isAmount ? '0.01' : undefined}
                      placeholder={isAmount ? 'z. B. 50.00' : 'Suchwert, z. B. REWE oder PayPal'}
                      value={cond.value}
                      onChange={(e) => handleUpdateCondition(idx, { value: e.target.value })}
                      className="flex-1 px-3 py-1.5 bg-white dark:bg-neutral-700 rounded-xl outline-none text-slate-900 dark:text-white"
                    />

                    {/* Remove button */}
                    {editingRule.conditions.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveCondition(idx)}
                        className="p-1.5 text-ios-gray hover:text-ios-red rounded-lg transition-colors shrink-0 self-end sm:self-center"
                        title="Bedingung entfernen"
                        aria-label="Bedingung entfernen"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Option: Auf vergangene Buchungen anwenden */}
          <div className="flex items-start space-x-2.5 pt-2 border-t border-ios-separator dark:border-ios-darkSeparator">
            <input
              type="checkbox"
              id="applyRuleToPastInRulesView"
              checked={applyToExistingOnSave}
              onChange={(e) => setApplyToExistingOnSave(e.target.checked)}
              className="rounded text-ios-tint focus:ring-ios-tint mt-0.5 w-4 h-4 cursor-pointer"
            />
            <label htmlFor="applyRuleToPastInRulesView" className="text-xs text-slate-800 dark:text-slate-200 cursor-pointer select-none">
              <span className="font-semibold">Regel auch sofort auf bestehende Buchungen anwenden</span>
              <span className="block text-[11px] text-ios-gray mt-0.5">
                Kategorisiert alle bisherigen passenden Buchungen direkt rückwirkend um.
              </span>
            </label>
          </div>

          <div className="flex justify-end space-x-2 pt-2 border-t border-ios-separator dark:border-ios-darkSeparator">
            <button
              type="button"
              onClick={() => setEditingRule(null)}
              className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-neutral-800 font-semibold"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-ios-tint text-white rounded-xl font-semibold shadow-sm hover:brightness-110 active:scale-95"
            >
              {editingRule.isNew ? 'Regel speichern' : 'Änderungen übernehmen'}
            </button>
          </div>
        </form>
        </div>
      )}

      {/* Rules List */}
      <div className="space-y-2">
        {rules.map((rule) => {
          const cat = catMap.get(rule.applyCategory);

          return (
            <div
              key={rule.id}
              className={`p-4 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                rule.enabled
                  ? 'glass-surface border-ios-separator dark:border-ios-darkSeparator shadow-sm'
                  : 'bg-slate-50 dark:bg-neutral-900 border-transparent opacity-60'
              }`}
            >
              <div className="min-w-0 flex items-start sm:items-center space-x-3">
                <button
                  onClick={() => handleToggleRule(rule)}
                  disabled={isApplying || isLoadingDefaults}
                  className={`w-6 h-6 rounded-lg flex items-center justify-center transition-colors flex-shrink-0 mt-0.5 sm:mt-0 ${
                    rule.enabled ? 'bg-ios-tint text-white' : 'border border-slate-300 dark:border-neutral-700'
                  }`}
                  aria-label="Regel aktivieren oder deaktivieren"
                >
                  {rule.enabled && <Check className="w-4 h-4 stroke-[3]" />}
                </button>

                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                      {rule.name}
                    </p>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-slate-100 dark:bg-neutral-800 text-ios-gray">
                      Prio {rule.priority ?? 5}
                    </span>
                  </div>

                  <div className="text-xs text-ios-gray space-y-0.5">
                    {rule.conditions && rule.conditions.length > 0 ? (
                      rule.conditions.map((cond, i) => (
                        <p key={i} className="truncate">
                          {i === 0 ? 'Wenn ' : 'UND '}
                          <span className="font-semibold text-slate-700 dark:text-slate-300">{FIELD_LABELS[cond.field] || cond.field}</span>
                          {' '}{OPERATOR_LABELS[cond.operator] || cond.operator}{' '}
                          &bdquo;<span className="font-semibold text-slate-900 dark:text-white">{cond.value}</span>&ldquo;
                        </p>
                      ))
                    ) : (
                      <p className="italic text-ios-gray">Keine Bedingungen</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between sm:justify-end space-x-3 flex-shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-ios-separator dark:border-ios-darkSeparator">
                <span
                  className="px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5"
                  style={{
                    backgroundColor: `${cat?.color || '#8E8E93'}20`,
                    color: cat?.color || '#8E8E93'
                  }}
                >
                  {cat?.icon && <CategoryIcon name={cat.icon} className="w-3.5 h-3.5" />}
                  <span>{cat?.name || rule.applyCategory}</span>
                </span>

                <div className="flex items-center space-x-1">
                  <button
                    onClick={() => handleStartEditRule(rule)}
                    disabled={isApplying || isLoadingDefaults}
                    className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-400 hover:text-ios-tint transition-colors rounded-xl hover:bg-slate-100 dark:hover:bg-neutral-800"
                    title="Regel bearbeiten"
                    aria-label={`Regel ${rule.name} bearbeiten`}
                  >
                    <Pencil className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => handleDeleteRule(rule.id, rule.name)}
                    disabled={isApplying || isLoadingDefaults}
                    className="p-2 text-slate-400 hover:text-ios-red transition-colors rounded-lg hover:bg-slate-100 dark:hover:bg-neutral-800"
                    title="Regel löschen"
                    aria-label={`Regel ${rule.name} löschen`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
