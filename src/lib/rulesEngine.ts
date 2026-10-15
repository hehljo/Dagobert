import type { CategoryRule, ImportPreviewRow, Transaction } from '../types/index.ts';

export function matchesCondition(
  item: { payee: string; purpose: string; rawText: string; type: string; amount: number },
  condition: CategoryRule['conditions'][0]
): boolean {
  const { field, operator, value } = condition;
  const rawTarget = item[field];

  if (field === 'amount') {
    const numTarget = typeof rawTarget === 'number' ? rawTarget : parseFloat(String(rawTarget));
    const numVal = parseFloat(value);
    if (isNaN(numTarget) || isNaN(numVal)) return false;

    if (operator === 'greaterThan') return numTarget > numVal;
    if (operator === 'lessThan') return numTarget < numVal;
    if (operator === 'equals') return Math.abs(numTarget - numVal) < 0.001;
    return false;
  }

  const strTarget = (String(rawTarget || '')).toLowerCase();
  const strVal = value.toLowerCase();

  switch (operator) {
    case 'contains':
      return strTarget.includes(strVal);
    case 'equals':
      return strTarget === strVal;
    case 'startsWith':
      return strTarget.startsWith(strVal);
    case 'regex':
      try {
        const reg = new RegExp(value, 'i');
        return reg.test(String(rawTarget || ''));
      } catch {
        return false;
      }
    default:
      return false;
  }
}

export function evaluateRules(
  item: { payee: string; purpose: string; rawText: string; type: string; amount: number },
  rules: CategoryRule[]
): { category: string; matchedRule?: CategoryRule } {
  // Sort by priority ascending (lower number = higher priority)
  const activeRules = rules
    .filter(r => r.enabled)
    .sort((a, b) => a.priority - b.priority);

  for (const rule of activeRules) {
    if (rule.conditions.length === 0) continue;
    const allMatch = rule.conditions.every(cond => matchesCondition(item, cond));
    if (allMatch) {
      return { category: rule.applyCategory, matchedRule: rule };
    }
  }

  return { category: 'sonstiges' };
}

export function autoCategorizePreview(
  rows: ImportPreviewRow[],
  rules: CategoryRule[]
): ImportPreviewRow[] {
  return rows.map(row => {
    const { category } = evaluateRules(row, rules);
    return {
      ...row,
      category
    };
  });
}

/**
 * Generates a clean rule proposal based on a user manual categorization
 */
export function createSuggestedRule(
  tx: Transaction,
  newCategory: string
): CategoryRule {
  const cleanPayee = tx.payee.trim();
  const conditionField = cleanPayee.length >= 3 && cleanPayee !== 'Unbekannt' ? 'payee' : 'rawText';
  const conditionValue = conditionField === 'payee' ? cleanPayee : cleanPayee.slice(0, 20);

  return {
    id: 'rule_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: `Auto: ${cleanPayee} → ${newCategory}`,
    priority: 50,
    conditions: [
      {
        field: conditionField,
        operator: 'contains',
        value: conditionValue
      }
    ],
    applyCategory: newCategory,
    enabled: true
  };
}
