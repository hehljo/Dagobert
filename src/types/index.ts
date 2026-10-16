export interface Profile {
  id: string;
  name: string;
  icon: string;
  color: string;
  isDefault: boolean;
  hasPin: boolean;
  createdAt?: string;
}

export interface Transaction {
  id?: number;
  date: string; // YYYY-MM-DD
  valutaDate?: string; // YYYY-MM-DD
  amount: number; // positive = income, negative = expense
  currency: string;
  payee: string; // counterparty / empfaenger / auftraggeber
  purpose: string; // verwendungszweck / notiz
  rawText: string; // full original text
  type: string; // Vorgang, e.g. "Lastschrift / Belastung", "Kartenverfügung"
  category: string;
  subcategory?: string;
  account: string;
  tags?: string[];
  importedAt: string;
  sourceHash: string; // deterministic hash for deduplication
  isManual?: boolean;
  status?: 'booked' | 'pending';
}

export interface Account {
  id: string;
  name: string;
  iban?: string;
  initialBalance: number;
  initialBalanceDate: string; // YYYY-MM-DD
  checkpointBalance?: number;
  checkpointDate?: string; // YYYY-MM-DD
}

export interface CsvMetadata {
  startDate?: string;
  endDate?: string;
  newBalance?: number;
  oldBalance?: number;
  iban?: string;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  type: 'expense' | 'income' | 'transfer';
  budget?: number;
}

export interface RuleCondition {
  field: 'payee' | 'purpose' | 'rawText' | 'type' | 'amount';
  operator: 'contains' | 'equals' | 'startsWith' | 'regex' | 'greaterThan' | 'lessThan';
  value: string;
}

export interface CategoryRule {
  id: string;
  name: string;
  priority: number;
  conditions: RuleCondition[];
  applyCategory: string;
  applySubcategory?: string;
  applyTags?: string[];
  enabled: boolean;
}

export interface BankTemplate {
  id: string;
  name: string;
  description: string;
  encoding: 'windows-1252' | 'utf-8' | 'iso-8859-1';
  delimiter: ';' | ',' | '\t';
  headerIdentifier: string; // Line that starts the table, e.g. "Buchungstag"
  columns: {
    date: string;
    valutaDate?: string;
    type?: string;
    rawText: string;
    amount: string;
  };
  textParser: 'comdirect' | 'standard';
  dateFormat: 'DD.MM.YYYY' | 'YYYY-MM-DD';
}

export interface ImportPreviewRow {
  date: string;
  valutaDate?: string;
  type: string;
  payee: string;
  purpose: string;
  amount: number;
  category: string;
  rawText: string;
  sourceHash: string;
  isDuplicate: boolean;
  isPendingPromotion?: boolean;
  status: 'booked' | 'pending';
}
