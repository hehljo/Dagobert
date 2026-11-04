import { describe, it, expect } from 'vitest';
import { createRulesPackage, normalizeRulesPackage, planRulesImport } from '../data/rulesPackage.ts';
import type { Category, CategoryRule } from '../types/index.ts';

const category: Category = { id: 'custom', name: 'Mein Hobby', icon: 'Tag', color: '#123456', type: 'expense', budget: 12.34 };
const rule: CategoryRule = { id: 'my-rule', name: 'Hobbybedarf', priority: 5, conditions: [{ field: 'payee', operator: 'contains', value: 'Hobby' }], applyCategory: category.id, enabled: false, applyTags: ['privat'], applySubcategory: 'Modelle' };
describe('Rules-only transfer', () => {
  it('includes manual categories without rules and exports only definition fields', () => {
    const file = createRulesPackage([Object.assign({}, category, { clientSecret: 'synthetic-secret' }), { ...category, id: 'unused', name: 'Ohne Regel' }], [rule]);
    expect(Object.keys(file).sort()).toEqual(['categories', 'exportedAt', 'format', 'rules', 'schemaVersion']);
    expect(file.categories.length).toBe(2); expect(file.rules[0]).toEqual(rule);
    expect(JSON.stringify(file)).not.toContain('synthetic-secret');
  });
  it('remaps conflicting category IDs and rule references without editing existing data', () => {
    const current = [{ ...category, name: 'Vorhandene Kategorie' }];
    const before = JSON.stringify(current);
    const file = createRulesPackage([category], [rule]);
    const plan = planRulesImport(file, current, [{ ...rule, name: 'Vorhandene Regel' }]);
    expect(plan.categories[0].id).not.toBe(category.id);
    expect(plan.rules[0].applyCategory).toBe(plan.categories[0].id);
    expect(plan.rules[0].id).not.toBe(rule.id); expect(JSON.stringify(current)).toBe(before);
    const repeated = planRulesImport(file, [...current, ...plan.categories], [{ ...rule, name: 'Vorhandene Regel' }, ...plan.rules]);
    expect(repeated.categoriesAdded).toBe(0); expect(repeated.rulesAdded).toBe(0);
  });
  it('reuses identical definitions across different IDs and preserves disabled rules', () => {
    const plan = planRulesImport(createRulesPackage([category], [rule]), [{ ...category, id: 'target-category' }], []);
    expect(plan.categoriesAdded).toBe(0); expect(plan.rules[0].applyCategory).toBe('target-category'); expect(plan.rules[0].enabled).toBe(false);
  });
  it('rejects bad formats, dangling references and empty conditions before import', () => {
    const valid = createRulesPackage([category], [rule]);
    for (const bad of [{ ...valid, schemaVersion: 99 }, { ...valid, format: 'dagobert_backup' },
      { ...valid, categories: [] }, { ...valid, rules: [{ ...rule, conditions: [] }] },
      { ...valid, categories: [category, category] }]) expect(() => normalizeRulesPackage(bad)).toThrow();
  });
});
