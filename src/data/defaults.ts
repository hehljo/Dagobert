import standardRules from '../lib/standardRules.json' with { type: 'json' };
import type { Account, Category, CategoryRule, BankTemplate } from '../types/index.ts';

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

// Shared with the server so new profiles and the preset loader use the same catalog.
export const DEFAULT_RULES = standardRules.rules as CategoryRule[];


export const PROFILE_DEFAULTS = { accounts: [DEFAULT_ACCOUNT], categories: DEFAULT_CATEGORIES, rules: DEFAULT_RULES, transactions: [], bankTemplates: [COMDIRECT_TEMPLATE] };
