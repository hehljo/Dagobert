import type {
  BackupPayload,
  BackupValidationResult
} from './interfaces.ts';
import type { Transaction, Account, Category, CategoryRule, BankTemplate } from '../types/index.ts';

export const CURRENT_BACKUP_SCHEMA_VERSION = 1;
export const BACKUP_FORMAT_IDENTIFIER = 'dagobert_backup';

/**
 * Normalizes numbers to avoid floating point precision noise (e.g. 19.990000000000002 -> 19.99).
 */
export function roundToCents(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

/**
 * Validates a backup object deeply.
 * Supports both legacy Docker backups and standard version 1 backups.
 */
export function validateBackupPayload(raw: unknown): BackupValidationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, error: 'Ungültiges Dateiformat: JSON muss ein Objekt sein.' };
  }

  const obj = raw as Record<string, unknown>;

  // Check format if present
  if (obj.format !== undefined && obj.format !== BACKUP_FORMAT_IDENTIFIER) {
    return { valid: false, error: `Unbekanntes Format: "${obj.format}". Erwartet: "${BACKUP_FORMAT_IDENTIFIER}".` };
  }

  const hasTxs = Array.isArray(obj.transactions);
  const hasCats = Array.isArray(obj.categories);
  const hasRules = Array.isArray(obj.rules);
  const hasAccounts = Array.isArray(obj.accounts);
  const hasTemplates = Array.isArray(obj.bankTemplates);

  if (!hasTxs && !hasCats && !hasRules && !hasAccounts && !hasTemplates) {
    return { valid: false, error: 'Die Datei enthält keine bekannten Dagobert-Datenstrukturen.' };
  }

  // Validate transactions
  let minDate = '';
  let maxDate = '';

  if (hasTxs) {
    const txs = obj.transactions as unknown[];
    for (let i = 0; i < txs.length; i++) {
      const t = txs[i] as Record<string, unknown> | null;
      if (!t || typeof t !== 'object') {
        return { valid: false, error: `Buchung an Index ${i} ist kein gültiges Objekt.` };
      }
      if (typeof t.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(t.date)) {
        return { valid: false, error: `Buchung #${i + 1} hat ein ungültiges Datum: "${t.date}". Format muss YYYY-MM-DD sein.` };
      }
      if (typeof t.amount !== 'number' || !Number.isFinite(t.amount)) {
        return { valid: false, error: `Buchung #${i + 1} (${t.date}) hat einen ungültigen Betrag: "${t.amount}".` };
      }
      if (!t.category || typeof t.category !== 'string') {
        return { valid: false, error: `Buchung #${i + 1} (${t.date}) besitzt keine gültige Kategorie.` };
      }

      if (!minDate || t.date < minDate) minDate = t.date;
      if (!maxDate || t.date > maxDate) maxDate = t.date;
    }
  }

  // Validate accounts
  if (hasAccounts) {
    const accs = obj.accounts as unknown[];
    for (let i = 0; i < accs.length; i++) {
      const a = accs[i] as Record<string, unknown> | null;
      if (!a || typeof a !== 'object') {
        return { valid: false, error: `Konto an Index ${i} ist ungültig.` };
      }
      if (!a.id || typeof a.id !== 'string') {
        return { valid: false, error: `Konto #${i + 1} hat keine gültige ID.` };
      }
      const initialBalance = a.initialBalance ?? a.initial_balance;
      if (typeof initialBalance !== 'number' || !Number.isFinite(initialBalance)) {
        return { valid: false, error: `Konto "${a.id}" hat einen ungültigen Anfangssaldo.` };
      }
    }
  }

  // Validate categories
  if (hasCats) {
    const cats = obj.categories as unknown[];
    for (let i = 0; i < cats.length; i++) {
      const c = cats[i] as Record<string, unknown> | null;
      if (!c || typeof c !== 'object' || !c.id || typeof c.id !== 'string' || !c.name) {
        return { valid: false, error: `Kategorie an Index ${i} ist ungültig (ID oder Name fehlt).` };
      }
    }
  }

  return {
    valid: true,
    summary: {
      profilesCount: Array.isArray(obj.profiles) ? obj.profiles.length : (obj.profileId ? 1 : 0),
      accountsCount: hasAccounts ? (obj.accounts as unknown[]).length : 0,
      categoriesCount: hasCats ? (obj.categories as unknown[]).length : 0,
      rulesCount: hasRules ? (obj.rules as unknown[]).length : 0,
      transactionsCount: hasTxs ? (obj.transactions as unknown[]).length : 0,
      templatesCount: hasTemplates ? (obj.bankTemplates as unknown[]).length : 0,
      dateRange: minDate && maxDate ? { min: minDate, max: maxDate } : undefined
    }
  };
}

/**
 * Normalizes any legacy or modern payload into a canonical BackupPayload.
 */
export function normalizeBackupPayload(raw: unknown, targetProfileId?: string): BackupPayload {
  const validation = validateBackupPayload(raw);
  if (!validation.valid) {
    throw new Error(validation.error || 'Ungültiges Backup-Format.');
  }

  const obj = raw as Record<string, any>;

  const profileId = (targetProfileId || obj.profileId || 'privat') as string;
  const profileName = (obj.profileName || 'Privat') as string;

  const accounts: Account[] = (Array.isArray(obj.accounts) ? obj.accounts : []).map(a => ({
    id: String(a.id || 'comdirect'),
    name: String(a.name || 'Girokonto'),
    iban: a.iban ? String(a.iban) : undefined,
    initialBalance: roundToCents(Number(a.initialBalance ?? a.initial_balance ?? 0)),
    initialBalanceDate: String(a.initialBalanceDate || a.initial_balance_date || '2026-01-01'),
    checkpointBalance: (a.checkpointBalance !== undefined && a.checkpointBalance !== null)
      ? roundToCents(Number(a.checkpointBalance))
      : ((a.checkpoint_balance !== undefined && a.checkpoint_balance !== null) ? roundToCents(Number(a.checkpoint_balance)) : undefined),
    checkpointDate: a.checkpointDate || a.checkpoint_date || undefined
  }));

  const categories: Category[] = (Array.isArray(obj.categories) ? obj.categories : []).map(c => ({
    id: String(c.id),
    name: String(c.name),
    icon: String(c.icon || 'Package'),
    color: String(c.color || '#8E8E93'),
    type: (c.type === 'income' || c.type === 'transfer') ? c.type : 'expense',
    budget: (c.budget !== undefined && c.budget !== null) ? roundToCents(Number(c.budget)) : undefined
  }));

  const rules: CategoryRule[] = (Array.isArray(obj.rules) ? obj.rules : []).map(r => {
    let conditions = r.conditions;
    if (typeof conditions === 'string') {
      try {
        conditions = JSON.parse(conditions);
      } catch {
        conditions = [];
      }
    }
    return {
      id: String(r.id),
      name: String(r.name || 'Regel'),
      priority: Number(r.priority || 20),
      conditions: Array.isArray(conditions) ? conditions : [],
      applyCategory: String(r.applyCategory || r.apply_category || 'sonstiges'),
      applySubcategory: r.applySubcategory || r.apply_subcategory || undefined,
      applyTags: Array.isArray(r.applyTags) ? r.applyTags : undefined,
      enabled: r.enabled !== false && r.enabled !== 0
    };
  });

  const transactions: Transaction[] = (Array.isArray(obj.transactions) ? obj.transactions : []).map((t, index) => {
    return {
      id: typeof t.id === 'number' ? t.id : undefined,
      date: String(t.date),
      valutaDate: t.valutaDate || t.valuta_date || undefined,
      amount: roundToCents(Number(t.amount)),
      currency: String(t.currency || 'EUR'),
      payee: String(t.payee || 'Unbekannt'),
      purpose: String(t.purpose || ''),
      rawText: String(t.rawText || t.raw_text || ''),
      type: String(t.type || ''),
      category: String(t.category || 'sonstiges'),
      subcategory: t.subcategory || undefined,
      account: String(t.account || 'comdirect Girokonto'),
      status: t.status === 'pending' ? 'pending' : 'booked',
      sourceHash: String(t.sourceHash || t.source_hash || `tx_migrated_${index}_${Date.now()}`),
      importedAt: String(t.importedAt || t.imported_at || new Date().toISOString()),
      isManual: !!t.isManual
    };
  });

  const bankTemplates: BankTemplate[] = (Array.isArray(obj.bankTemplates) ? obj.bankTemplates : []).map(bt => {
    let columns = bt.columns;
    if (typeof columns === 'string') {
      try {
        columns = JSON.parse(columns);
      } catch {
        columns = {};
      }
    }
    return {
      id: String(bt.id),
      name: String(bt.name),
      description: String(bt.description || ''),
      encoding: bt.encoding === 'utf-8' || bt.encoding === 'iso-8859-1' ? bt.encoding : 'windows-1252',
      delimiter: bt.delimiter === ',' || bt.delimiter === '\t' ? bt.delimiter : ';',
      headerIdentifier: String(bt.headerIdentifier || bt.header_identifier || 'Buchungstag'),
      columns: columns || {},
      textParser: bt.textParser || bt.text_parser || 'comdirect',
      dateFormat: bt.dateFormat === 'YYYY-MM-DD' ? 'YYYY-MM-DD' : 'DD.MM.YYYY'
    };
  });

  return {
    format: BACKUP_FORMAT_IDENTIFIER,
    schemaVersion: CURRENT_BACKUP_SCHEMA_VERSION,
    exportedAt: String(obj.exportedAt || new Date().toISOString()),
    sourcePlatform: (obj.sourcePlatform === 'ios' || obj.sourcePlatform === 'docker') ? obj.sourcePlatform : 'web',
    profileId,
    profileName,
    profiles: Array.isArray(obj.profiles) ? obj.profiles : undefined,
    accounts,
    categories,
    rules,
    transactions,
    bankTemplates
  };
}
