import type { BackupPayload, BackupProfileData, BackupValidationResult } from './interfaces.ts';
import type { Account, BankTemplate, Category, CategoryRule, Profile, Transaction } from '../types/index.ts';
import { stableIdentity } from './identity.ts';

export const CURRENT_BACKUP_SCHEMA_VERSION = 2;
export const BACKUP_FORMAT_IDENTIFIER = 'dagobert_backup';
const collections = ['accounts', 'categories', 'rules', 'transactions', 'bankTemplates'] as const;
type ObjectValue = Record<string, unknown>;
function canonicalJSON(value: unknown): string {
  const ordered = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(ordered);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .filter(([, v]) => v !== undefined).map(([key, v]) => [key, ordered(v)]));
    return value;
  };
  return JSON.stringify(ordered(value));
}

function object(value: unknown, label: string): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: Objekt erwartet.`);
  return value as ObjectValue;
}
function string(value: unknown, label: string, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string') throw new Error(`${label}: Text erwartet.`);
  return value;
}
function identifier(value: unknown, label: string): string {
  const result = string(value, label);
  if (!result || result.length > 500) throw new Error(`${label}: Ungültige ID.`);
  return result;
}
export function roundToCents(amount: number): number {
  if (!Number.isFinite(amount)) throw new Error('Ungültiger Geldbetrag.');
  // Permit binary floating-point noise, never silently discard fractional cents.
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(amount * 100 - cents) > 0.000001) {
    throw new Error('Geldbeträge müssen als sichere, ganze Centbeträge darstellbar sein.');
  }
  return cents / 100;
}
function money(value: unknown, label: string): number {
  if (typeof value !== 'number') throw new Error(`${label}: Zahl erwartet.`);
  return roundToCents(value);
}
function date(value: unknown, label: string): string {
  const result = string(value, label);
  const parsed = new Date(`${result}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) {
    throw new Error(`${label}: Ungültiges Kalenderdatum.`);
  }
  return result;
}
function strings(value: unknown, label: string): string[] | null | undefined {
  if (value === undefined || value === null) return value;
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) throw new Error(`${label}: Textliste erwartet.`);
  return value as string[];
}
function jsonValue(value: unknown, fallback: unknown, label: string): unknown {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { throw new Error(`${label}: Ungültiges JSON.`); }
}
function aliases(row: ObjectValue, fields: Record<string, string>): ObjectValue {
  const result = { ...row };
  for (const [snake, camel] of Object.entries(fields)) {
    if (result[camel] === undefined && result[snake] !== undefined) result[camel] = result[snake];
    delete result[snake];
  }
  // Device credentials are never part of a portable financial backup.
  for (const key of ['pin_hash', 'pinHash', 'pin', 'credentialId', 'keychainKey', 'sessionToken', 'ckSystemFields']) delete result[key];
  return result;
}
function profile(raw: unknown, id: string, name: string): Profile {
  const p = aliases(raw === undefined ? {} : object(raw, 'Profil'), { is_default: 'isDefault', created_at: 'createdAt' });
  return { ...p, id, name, icon: string(p.icon, 'Profil-Icon', 'User'), color: string(p.color, 'Profilfarbe', '#0A84FF'),
    isDefault: p.isDefault === true || p.isDefault === 1, hasPin: false };
}
function account(raw: unknown): Account {
  const a = aliases(object(raw, 'Konto'), { initial_balance: 'initialBalance', initial_balance_date: 'initialBalanceDate', checkpoint_balance: 'checkpointBalance', checkpoint_date: 'checkpointDate' });
  const result: Account = { ...a, id: identifier(a.id, 'Konto-ID'), name: string(a.name, 'Kontoname', 'Girokonto'),
    initialBalance: money(a.initialBalance ?? 0, 'Anfangssaldo'), initialBalanceDate: date(a.initialBalanceDate ?? '1970-01-01', 'Saldostichtag') };
  if (a.iban !== undefined && a.iban !== null) result.iban = string(a.iban, 'IBAN');
  if (a.checkpointBalance !== undefined && a.checkpointBalance !== null) result.checkpointBalance = money(a.checkpointBalance, 'Kontrollsaldo');
  if (a.checkpointDate !== undefined && a.checkpointDate !== null && a.checkpointDate !== '') result.checkpointDate = date(a.checkpointDate, 'Kontrollstichtag');
  return result;
}
function category(raw: unknown): Category {
  const c = object(raw, 'Kategorie');
  const type = c.type ?? 'expense';
  if (!['expense', 'income', 'transfer'].includes(String(type))) throw new Error('Unbekannter Kategorietyp.');
  const result: Category = { ...c, id: identifier(c.id, 'Kategorie-ID'), name: string(c.name, 'Kategoriename'),
    icon: string(c.icon, 'Kategorie-Icon', 'Package'), color: string(c.color, 'Kategoriefarbe', '#8E8E93'), type: type as Category['type'] };
  if (c.budget !== undefined && c.budget !== null) result.budget = money(c.budget, 'Budget');
  return result;
}
function rule(raw: unknown): CategoryRule {
  const r = aliases(object(raw, 'Regel'), { apply_category: 'applyCategory', apply_subcategory: 'applySubcategory', apply_tags: 'applyTags' });
  const conditions = jsonValue(r.conditions, [], 'Regelbedingungen');
  if (!Array.isArray(conditions)) throw new Error('Regelbedingungen müssen eine Liste sein.');
  const normalized = conditions.map(rawCondition => {
    const c = object(rawCondition, 'Regelbedingung');
    if (!['payee', 'purpose', 'rawText', 'type', 'amount'].includes(String(c.field)) ||
        !['contains', 'equals', 'startsWith', 'regex', 'greaterThan', 'lessThan'].includes(String(c.operator)) || typeof c.value !== 'string') {
      throw new Error('Unbekannte oder unvollständige Regelbedingung.');
    }
    if (c.operator === 'regex') { try { new RegExp(c.value); } catch { throw new Error('Ungültiger regulärer Ausdruck in einer Regel.'); } }
    return c as unknown as CategoryRule['conditions'][number];
  });
  const priority = r.priority ?? 20;
  if (typeof priority !== 'number' || !Number.isSafeInteger(priority)) throw new Error('Ungültige Regelpriorität.');
  if (r.enabled !== undefined && ![true, false, 0, 1].includes(r.enabled as boolean)) throw new Error('Ungültiger Aktivierungsstatus einer Regel.');
  return { ...r, id: identifier(r.id, 'Regel-ID'), name: string(r.name, 'Regelname', 'Regel'), priority,
    conditions: normalized, applyCategory: string(r.applyCategory, 'Regelkategorie', 'sonstiges'),
    applyTags: strings(r.applyTags, 'Regel-Tags'), enabled: r.enabled !== false && r.enabled !== 0 };
}
function transaction(raw: unknown): Transaction {
  const t = aliases(object(raw, 'Buchung'), { valuta_date: 'valutaDate', raw_text: 'rawText', source_hash: 'sourceHash', imported_at: 'importedAt', is_manual: 'isManual' });
  if (t.id !== undefined && !(typeof t.id === 'string' && t.id.length > 0) && !(typeof t.id === 'number' && Number.isSafeInteger(t.id))) throw new Error('Ungültige Buchungs-ID.');
  if (t.syncId !== undefined) identifier(t.syncId, 'Stabile Buchungs-ID');
  const status = t.status ?? 'booked';
  if (status !== 'pending' && status !== 'booked') throw new Error('Unbekannter Buchungsstatus.');
  const result: Transaction = { ...t, id: t.id as Transaction['id'], date: date(t.date, 'Buchungstag'), amount: money(t.amount, 'Betrag'),
    currency: string(t.currency, 'Währung', 'EUR'), payee: string(t.payee, 'Empfänger', ''), purpose: string(t.purpose, 'Verwendungszweck', ''),
    rawText: string(t.rawText, 'Buchungstext', ''), type: string(t.type, 'Buchungstyp', ''), category: identifier(t.category, 'Buchungskategorie'),
    account: string(t.account, 'Buchungskonto', 'comdirect Girokonto'), status,
    sourceHash: string(t.sourceHash, 'Import-Fingerprint', ''), importedAt: string(t.importedAt, 'Importzeitpunkt', '1970-01-01T00:00:00Z'),
    tags: strings(t.tags, 'Buchungs-Tags') };
  if (t.valutaDate !== undefined && t.valutaDate !== null && t.valutaDate !== '') result.valutaDate = date(t.valutaDate, 'Valuta');
  if (t.isManual !== undefined) {
    if (![true, false, 0, 1].includes(t.isManual as boolean)) throw new Error('Ungültige Kennzeichnung einer manuellen Buchung.');
    result.isManual = t.isManual === true || t.isManual === 1;
  }
  return result;
}
function template(raw: unknown): BankTemplate {
  const t = aliases(object(raw, 'Bankvorlage'), { header_identifier: 'headerIdentifier', text_parser: 'textParser', date_format: 'dateFormat' });
  const columns = object(jsonValue(t.columns, {}, 'Vorlagenspalten'), 'Vorlagenspalten');
  for (const key of ['date', 'rawText', 'amount']) identifier(columns[key], `Vorlagenspalte ${key}`);
  const encoding = t.encoding ?? 'windows-1252', delimiter = t.delimiter ?? ';', textParser = t.textParser ?? 'comdirect', dateFormat = t.dateFormat ?? 'DD.MM.YYYY';
  if (!['windows-1252', 'utf-8', 'iso-8859-1'].includes(String(encoding)) || ![';', ',', '\t'].includes(String(delimiter)) ||
      !['comdirect', 'standard'].includes(String(textParser)) || !['DD.MM.YYYY', 'YYYY-MM-DD'].includes(String(dateFormat))) throw new Error('Unbekannte Bankvorlagen-Konfiguration.');
  return { ...t, id: identifier(t.id, 'Bankvorlagen-ID'), name: string(t.name, 'Vorlagenname'), description: string(t.description, 'Beschreibung', ''),
    encoding, delimiter, headerIdentifier: string(t.headerIdentifier, 'Spaltenüberschrift', 'Buchungstag'), columns, textParser, dateFormat } as BankTemplate;
}
function bindTransactionAccount(tx: Transaction, accounts: Account[], accountsIncluded: boolean): void {
  if (tx.accountId === undefined) tx.accountId = accounts.find(a => a.id === tx.account || a.name === tx.account)?.id;
  else if (typeof tx.accountId !== 'string' || (accountsIncluded && !accounts.some(a => a.id === tx.accountId))) throw new Error('Ungültige Kontozuordnung einer Buchung.');
}
function conflicts(raw: unknown, profileId: string, accounts: Account[], accountsIncluded: boolean): unknown[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new Error('Konfliktsicherung: Liste erwartet.');
  const seen = new Set<string>();
  return raw.map(entry => {
    const conflict = object(entry, 'Konflikt');
    const recordId = identifier(conflict.recordId, 'Konfliktdatensatz');
    const id = identifier(conflict.id, 'Konflikt-ID');
    if (seen.has(id)) throw new Error('Doppelte Konflikt-ID.');
    seen.add(id);
    if (!Array.isArray(conflict.versions) || conflict.versions.length < 2) throw new Error('Konfliktversionen fehlen.');
    const changes = new Set<string>();
    const convert = (raw: unknown): ObjectValue => {
      const v = aliases(object(raw, 'Konfliktversion'), {});
      const entityId = identifier(v.id, 'Konfliktversion-ID');
      const kind = string(v.kind, 'Konflikttyp');
      if (v.schemaVersion !== 2 || v.profileId !== profileId ||
          ![...collections, 'profiles'].includes(kind) || recordId !== stableIdentity(`record:${profileId}:${kind}`, entityId)) {
        throw new Error('Ungültige Profil- oder Datensatzzuordnung einer Konfliktversion.');
      }
      identifier(v.changeId, 'Änderungs-ID');
      if (typeof v.revision !== 'number' || !Number.isSafeInteger(v.revision) || v.revision < 1) throw new Error('Ungültige Konfliktrevision.');
      if (v.deletedAt !== undefined && (typeof v.deletedAt !== 'string' || !Number.isFinite(Date.parse(v.deletedAt)))) throw new Error('Ungültiger Löschzeitpunkt.');
      if (v.resolves !== undefined && (!Array.isArray(v.resolves) || v.resolves.some(id => typeof id !== 'string' || !id))) throw new Error('Ungültige Konfliktauflösung.');
      const source = object(v.data, 'Konfliktinhalt');
      if (source.id !== entityId) throw new Error('Abweichende Datensatz-ID im Konfliktinhalt.');
      const converters = { accounts: account, categories: category, rules: rule, transactions: transaction, bankTemplates: template };
      const data = kind === 'profiles' ? profile(source, entityId, string(source.name, 'Profilname')) : converters[kind as typeof collections[number]](source);
      if (kind === 'transactions') bindTransactionAccount(data as Transaction, accounts, accountsIncluded);
      return { ...v, data };
    };
    const versions = conflict.versions.map(raw => {
      const v = convert(raw), change = String(v.changeId);
      if (changes.has(change)) throw new Error('Doppelte Konfliktversion.');
      changes.add(change);
      return v;
    });
    if (id !== stableIdentity(`conflict:${recordId}`, [...changes].sort().join(':'))) throw new Error('Ungültige Konfliktidentität.');
    const current = conflict.current === undefined ? undefined : convert(conflict.current);
    if (current && !versions.some(v => canonicalJSON(v) === canonicalJSON(current))) throw new Error('Aktuelle Konfliktversion fehlt.');
    return { ...conflict, versions, ...(current ? { current } : {}) };
  });
}
function normalizeProfile(raw: unknown, fallbackId?: string): BackupProfileData {
  const p = aliases(object(raw, 'Profilbestand'), {});
  if (!collections.some(key => Array.isArray(p[key]))) throw new Error('Die Datei enthält keine bekannten Dagobert-Datenstrukturen.');
  const id = identifier(p.profileId ?? fallbackId ?? 'privat', 'Profil-ID');
  const name = string(p.profileName, 'Profilname', 'Privat');
  const converters = { accounts: account, categories: category, rules: rule, transactions: transaction, bankTemplates: template };
  const result: ObjectValue = { ...p, profileId: id, profileName: name, profile: profile(p.profile, id, name) };
  for (const key of collections) {
    if (p[key] !== undefined && !Array.isArray(p[key])) throw new Error(`${key}: Liste erwartet.`);
    const values = ((p[key] ?? []) as unknown[]).map(converters[key] as (value: unknown) => unknown);
    const seen = new Set<string>();
    for (const value of values) {
      const entity = value as ObjectValue;
      const identity = key === 'transactions' ? entity.syncId ?? entity.id : entity.id;
      if (identity !== undefined) {
        const token = String(identity);
        if (seen.has(token)) throw new Error(`${key}: Doppelte ID ${token}.`);
        seen.add(token);
      }
    }
    result[key] = values;
  }
  if (p.includedCollections !== undefined && (!Array.isArray(p.includedCollections) || p.includedCollections.some(key => !collections.includes(key as typeof collections[number])))) throw new Error('Unbekannte Datenbereiche im Backup.');
  // Legacy backups were often partial. Preserve their explicit presence for safe restore.
  result.includedCollections = Array.isArray(p.includedCollections) ? p.includedCollections : collections.filter(key => p[key] !== undefined);
  const included = result.includedCollections as string[];
  if (new Set(included).size !== included.length || collections.some(key => !included.includes(key) && (result[key] as unknown[]).length > 0)) throw new Error('Widersprüchliche Datenbereiche im Backup.');
  const accounts = result.accounts as Account[];
  for (const tx of result.transactions as Transaction[]) bindTransactionAccount(tx, accounts, included.includes('accounts'));
  if (p.syncConflicts !== undefined) result.syncConflicts = conflicts(p.syncConflicts, id, accounts, included.includes('accounts'));
  return result as unknown as BackupProfileData;
}

/** Full snapshots for every exported profile. The root contains the selected profile. */
export function backupProfiles(payload: BackupPayload): BackupProfileData[] {
  const { additionalProfiles: _additional, profiles: _profiles, format: _format, schemaVersion: _schema,
    exportedAt: _exported, sourcePlatform: _source, ...root } = payload;
  return [root as BackupProfileData, ...(payload.additionalProfiles ?? [])];
}
export function normalizeBackupPayload(raw: unknown, fallbackProfileId?: string): BackupPayload {
  const obj = object(raw, 'Backup');
  if (obj.format !== undefined && obj.format !== BACKUP_FORMAT_IDENTIFIER) throw new Error('Unbekanntes Backupformat.');
  if (obj.schemaVersion !== undefined && (!Number.isInteger(obj.schemaVersion) || Number(obj.schemaVersion) < 1 || Number(obj.schemaVersion) > CURRENT_BACKUP_SCHEMA_VERSION)) {
    throw new Error('Diese Backupversion wird nicht unterstützt. Bitte Dagobert aktualisieren.');
  }
  const root = normalizeProfile(obj, fallbackProfileId);
  const additional = obj.additionalProfiles === undefined ? [] : obj.additionalProfiles;
  if (!Array.isArray(additional)) throw new Error('Zusätzliche Profilbestände müssen eine Liste sein.');
  const extra = additional.map(p => normalizeProfile(p));
  const ids = new Set([root.profileId]);
  for (const p of extra) {
    if (ids.has(p.profileId)) throw new Error('Profil-IDs sind im Backup mehrfach enthalten.');
    ids.add(p.profileId);
  }
  if (obj.profiles !== undefined) {
    if (!Array.isArray(obj.profiles)) throw new Error('Profile müssen eine Liste sein.');
    if (obj.profiles.some(p => !ids.has(String(object(p, 'Profil').id)))) {
      throw new Error('Dieses ältere Gesamtbackup enthält Profilnamen ohne deren Daten. Bitte jedes Profil einzeln exportieren.');
    }
  }
  const result: BackupPayload = { ...root, format: BACKUP_FORMAT_IDENTIFIER, schemaVersion: CURRENT_BACKUP_SCHEMA_VERSION,
    exportedAt: string(obj.exportedAt, 'Exportzeitpunkt', '1970-01-01T00:00:00Z'),
    sourcePlatform: obj.sourcePlatform === 'ios' || obj.sourcePlatform === 'docker' ? obj.sourcePlatform : 'web',
    profiles: [root.profile!, ...extra.map(p => p.profile!)], additionalProfiles: extra };
  if (!Number.isFinite(Date.parse(result.exportedAt))) throw new Error('Ungültiger Exportzeitpunkt.');
  return result;
}
export function validateBackupPayload(raw: unknown): BackupValidationResult {
  try {
    const payload = normalizeBackupPayload(raw);
    const profiles = backupProfiles(payload);
    const txs = profiles.flatMap(p => p.transactions);
    const dates = txs.map(t => t.date).sort();
    return { valid: true, summary: { profilesCount: profiles.length, accountsCount: profiles.reduce((n, p) => n + p.accounts.length, 0),
      categoriesCount: profiles.reduce((n, p) => n + p.categories.length, 0), rulesCount: profiles.reduce((n, p) => n + p.rules.length, 0),
      transactionsCount: txs.length, templatesCount: profiles.reduce((n, p) => n + p.bankTemplates.length, 0),
      dateRange: dates.length ? { min: dates[0], max: dates[dates.length - 1] } : undefined } };
  } catch (error) { return { valid: false, error: error instanceof Error ? error.message : 'Ungültiges Backup.' }; }
}
