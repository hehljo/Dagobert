import type { Category, CategoryRule } from '../types/index.ts';
import { normalizeBackupPayload } from './backupSchema.ts';
import { stableIdentity } from './identity.ts';

export interface RulesPackage {
  format: 'dagobert_rules'; schemaVersion: 1; exportedAt: string;
  categories: Category[]; rules: CategoryRule[];
}
export interface RulesImportResult { categoriesAdded: number; rulesAdded: number; unchanged: number }
export interface RulesImportPlan extends RulesImportResult { categories: Category[]; rules: CategoryRule[] }

function canonical(value: unknown): string {
  const order = (value: unknown): unknown => Array.isArray(value) ? value.map(order) :
    value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, order(v)])) : value;
  return JSON.stringify(order(value));
}
function content(value: Category | CategoryRule): string {
  const fields = 'conditions' in value ? ['name', 'priority', 'enabled', 'conditions', 'applyCategory', 'applySubcategory', 'applyTags'] : ['name', 'icon', 'color', 'type', 'budget'];
  return canonical(Object.fromEntries(fields.map(key => [key, (value as unknown as Record<string, unknown>)[key]])
    .filter(([, v]) => v !== undefined && v !== null)));
}
export function normalizeRulesPackage(raw: unknown): RulesPackage {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Bitte eine Regeln-Datei auswählen.');
  const value = raw as Record<string, unknown>;
  if (value.format !== 'dagobert_rules' || value.schemaVersion !== 1 || !Array.isArray(value.categories) || !Array.isArray(value.rules)) {
    throw new Error('Das ist keine unterstützte Regeln-Datei. Bitte „Regeln und Kategorien exportieren“ verwenden.');
  }
  if (value.categories.length > 10000 || value.rules.length > 10000) throw new Error('Die Regeln-Datei enthält zu viele Einträge.');
  const normalized = normalizeBackupPayload({ format: 'dagobert_backup', schemaVersion: 2, profileId: 'rules-transfer',
    exportedAt: value.exportedAt, categories: value.categories, rules: value.rules });
  // Deliberately select only definition fields. No accounts, transactions, profiles or credentials.
  const categories: Category[] = normalized.categories.map(c => ({ id: c.id, name: c.name, icon: c.icon, color: c.color, type: c.type,
    ...(c.budget !== undefined && c.budget !== null ? { budget: c.budget } : {}) }));
  const ids = new Set(categories.map(c => c.id));
  const rules: CategoryRule[] = normalized.rules.map(r => {
    if (!ids.has(r.applyCategory)) throw new Error(`Die Kategorie für „${r.name}“ fehlt in der Datei.`);
    if (!r.conditions.length || r.conditions.length > 100) throw new Error('Eine Regel benötigt zwischen einer und 100 Bedingungen.');
    return { id: r.id, name: r.name, priority: r.priority, enabled: r.enabled,
      conditions: r.conditions.map(c => ({ field: c.field, operator: c.operator, value: c.value })),
      applyCategory: r.applyCategory,
      ...(typeof r.applySubcategory === 'string' ? { applySubcategory: r.applySubcategory } : {}),
      ...(r.applyTags !== undefined && r.applyTags !== null ? { applyTags: r.applyTags } : {}) };
  });
  return { format: 'dagobert_rules', schemaVersion: 1, exportedAt: normalized.exportedAt, categories, rules };
}
export function createRulesPackage(categories: Category[], rules: CategoryRule[]): RulesPackage {
  return normalizeRulesPackage({ format: 'dagobert_rules', schemaVersion: 1, exportedAt: new Date().toISOString(), categories, rules });
}
export function planRulesImport(raw: unknown, currentCategories: Category[], currentRules: CategoryRule[]): RulesImportPlan {
  const source = normalizeRulesPackage(raw);
  const result: RulesImportPlan = { categories: [], rules: [], categoriesAdded: 0, rulesAdded: 0, unchanged: 0 };
  const categoryMap = new Map<string, string>();
  const choose = <T extends Category | CategoryRule>(value: T, current: T[], added: T[], kind: string): string => {
    const all = [...current, ...added];
    const equal = all.find(item => content(item) === content(value));
    if (equal) { result.unchanged++; return equal.id; }
    const occupied = all.some(item => item.id === value.id);
    const id = occupied ? `transfer-${stableIdentity(kind, content(value))}` : value.id;
    if (all.some(item => item.id === id)) throw new Error('Eine abweichende Importkopie existiert bereits. Bitte die Einträge prüfen.');
    added.push({ ...value, id });
    return id;
  };
  for (const category of source.categories) categoryMap.set(category.id, choose(category, currentCategories, result.categories, 'rules-category'));
  for (const rule of source.rules) choose({ ...rule, applyCategory: categoryMap.get(rule.applyCategory)! }, currentRules, result.rules, 'rules-definition');
  result.categoriesAdded = result.categories.length; result.rulesAdded = result.rules.length;
  return result;
}
