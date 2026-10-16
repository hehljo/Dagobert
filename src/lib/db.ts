import Dexie, { type Table } from 'dexie';
import type { Transaction, Category, CategoryRule, BankTemplate, Account } from '../types/index.ts';

export class DagobertDatabase extends Dexie {
  transactions!: Table<Transaction, number>;
  categories!: Table<Category, string>;
  rules!: Table<CategoryRule, string>;
  bankTemplates!: Table<BankTemplate, string>;
  accounts!: Table<Account, string>;

  constructor() {
    super('DagobertDB');
    this.version(1).stores({
      transactions: '++id, date, category, account, sourceHash, amount',
      categories: 'id, name, type',
      rules: 'id, priority, enabled',
      bankTemplates: 'id, name'
    });
    this.version(2).stores({
      accounts: 'id, name'
    });
  }
}

export const db = new DagobertDatabase();

export const DEFAULT_ACCOUNT: Account = {
  id: 'comdirect',
  name: 'comdirect Girokonto',
  initialBalance: 0,
  initialBalanceDate: '2026-01-01'
};

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'lebensmittel', name: 'Lebensmittel & Supermarkt', icon: 'ShoppingCart', color: '#30D158', type: 'expense' },
  { id: 'wohnen', name: 'Wohnen & Miete', icon: 'Home', color: '#0A84FF', type: 'expense' },
  { id: 'mobilitaet', name: 'Mobilität & Transport', icon: 'Car', color: '#FF9F0A', type: 'expense' },
  { id: 'freizeit', name: 'Freizeit & Restaurant', icon: 'Utensils', color: '#FF375F', type: 'expense' },
  { id: 'abos', name: 'Abos & Verträge', icon: 'Smartphone', color: '#BF5AF2', type: 'expense' },
  { id: 'shopping', name: 'Shopping & Kleidung', icon: 'ShoppingBag', color: '#FFD60A', type: 'expense' },
  { id: 'gesundheit', name: 'Gesundheit & Pflege', icon: 'HeartPulse', color: '#64D2FF', type: 'expense' },
  { id: 'investieren', name: 'Sparen & Investieren', icon: 'TrendingUp', color: '#5E5CE6', type: 'transfer' },
  { id: 'gehalt', name: 'Gehalt & Einkommen', icon: 'Briefcase', color: '#32D74B', type: 'income' },
  { id: 'rueckerstattung', name: 'Rückerstattungen', icon: 'RotateCcw', color: '#40C8E0', type: 'income' },
  { id: 'sonstiges', name: 'Sonstiges', icon: 'Package', color: '#8E8E93', type: 'expense' }
];

export const COMDIRECT_TEMPLATE: BankTemplate = {
  id: 'comdirect',
  name: 'comdirect Girokonto',
  description: 'Automatische Erkennung für comdirect CSV mit Windows-1252 & Textzerlegung',
  encoding: 'windows-1252',
  delimiter: ';',
  headerIdentifier: 'Buchungstag',
  columns: {
    date: 'Buchungstag',
    valutaDate: 'Wertstellung (Valuta)',
    type: 'Vorgang',
    rawText: 'Buchungstext',
    amount: 'Umsatz in EUR'
  },
  textParser: 'comdirect',
  dateFormat: 'DD.MM.YYYY'
};

export const DEFAULT_RULES: CategoryRule[] = [
  {
    id: 'rule-gehalt',
    name: 'Gehalt / Salär',
    priority: 10,
    conditions: [
      { field: 'purpose', operator: 'contains', value: 'Gehalt' }
    ],
    applyCategory: 'gehalt',
    enabled: true
  },
  {
    id: 'rule-supermarkt',
    name: 'Supermärkte & Discounter',
    priority: 20,
    conditions: [
      { field: 'rawText', operator: 'regex', value: '(REWE|EDEKA|ALDI|LIDL|KAUFLAND|PENNY|NETTO|DENNS)' }
    ],
    applyCategory: 'lebensmittel',
    enabled: true
  },
  {
    id: 'rule-drogerie',
    name: 'Drogerie & Pflege',
    priority: 25,
    conditions: [
      { field: 'rawText', operator: 'regex', value: '(DM-DROGERIE|ROSSMANN|MUELLER)' }
    ],
    applyCategory: 'gesundheit',
    enabled: true
  },
  {
    id: 'rule-tanken',
    name: 'Tanken & Ladestrom',
    priority: 30,
    conditions: [
      { field: 'rawText', operator: 'regex', value: '(ARAL|SHELL|TOTAL|JET|ESSO|ENBW|IONITY|TESLA)' }
    ],
    applyCategory: 'mobilitaet',
    enabled: true
  },
  {
    id: 'rule-abos',
    name: 'Streaming & Software',
    priority: 35,
    conditions: [
      { field: 'rawText', operator: 'regex', value: '(NETFLIX|SPOTIFY|APPLE|GOOGLE|AMAZON PRIME|DISNEY|OPENAI|GITHUB)' }
    ],
    applyCategory: 'abos',
    enabled: true
  },
  {
    id: 'rule-bahn',
    name: 'Bahn & ÖPNV',
    priority: 40,
    conditions: [
      { field: 'rawText', operator: 'regex', value: '(DEUTSCHE BAHN|DB VERTRIEB|AVV|MVG)' }
    ],
    applyCategory: 'mobilitaet',
    enabled: true
  }
];

export async function initDatabaseDefaults() {
  const catCount = await db.categories.count();
  if (catCount === 0) {
    await db.categories.bulkAdd(DEFAULT_CATEGORIES);
  } else {
    // Migrate any legacy emoji icons to Lucide names
    const existing = await db.categories.toArray();
    for (const cat of existing) {
      if (cat.icon && (cat.icon.length > 2 || /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(cat.icon))) {
        const defaultMatch = DEFAULT_CATEGORIES.find(d => d.id === cat.id);
        if (defaultMatch) {
          await db.categories.update(cat.id, { icon: defaultMatch.icon });
        }
      }
    }
  }

  const templateCount = await db.bankTemplates.count();
  if (templateCount === 0) {
    await db.bankTemplates.add(COMDIRECT_TEMPLATE);
  }

  const ruleCount = await db.rules.count();
  if (ruleCount === 0) {
    await db.rules.bulkAdd(DEFAULT_RULES);
  }

  const accountCount = await db.accounts.count();
  if (accountCount === 0) {
    await db.accounts.add(DEFAULT_ACCOUNT);
  }
}

/**
 * Calculates current real account balance.
 * If a comdirect checkpoint (Neuer Kontostand) exists:
 * current = checkpointBalance + sum(transactions where date > checkpointDate)
 * Otherwise:
 * current = initialBalance + sum(transactions where date >= initialBalanceDate)
 */
export function calculateRealAccountBalance(account: Account | undefined, txs: Transaction[]): number {
  if (!account) return 0;

  // STRICT ACCOUNT SCOPING: Only include transactions belonging to this account and exclude unbooked 'pending' items!
  const accountTxs = txs.filter(t =>
    (!t.account || t.account === account.name || t.account === account.id) &&
    t.status !== 'pending'
  );

  if (account.checkpointBalance !== undefined && account.checkpointDate) {
    // Only transactions AFTER checkpoint date
    const afterCheckpoint = accountTxs.filter(t => t.date > account.checkpointDate!);
    const delta = afterCheckpoint.reduce((sum, t) => sum + t.amount, 0);
    return account.checkpointBalance + delta;
  }

  const fromInitial = accountTxs.filter(t => t.date >= account.initialBalanceDate);
  const sum = fromInitial.reduce((sum, t) => sum + t.amount, 0);
  return account.initialBalance + sum;
}
