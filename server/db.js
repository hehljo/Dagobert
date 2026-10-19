import standardRules from '../src/lib/standardRules.json' with { type: 'json' };
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'dagobert.db');

let dbInstance;

try {
  const { DatabaseSync } = await import('node:sqlite');
  class NodeSqliteWrapper {
    constructor(filePath) {
      this._db = new DatabaseSync(filePath);
    }
    exec(sql) { return this._db.exec(sql); }
    prepare(sql) { return this._db.prepare(sql); }
    pragma(sql) { return this._db.exec(`PRAGMA ${sql};`); }
    transaction(fn) {
      return (...args) => {
        this._db.exec('BEGIN');
        try {
          const res = fn(...args);
          this._db.exec('COMMIT');
          return res;
        } catch (e) {
          this._db.exec('ROLLBACK');
          throw e;
        }
      };
    }
  }
  dbInstance = new NodeSqliteWrapper(DB_PATH);
} catch {
  const BetterSqlite = (await import('better-sqlite3')).default;
  dbInstance = new BetterSqlite(DB_PATH);
}

const db = dbInstance;
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT 'User',
      color TEXT NOT NULL DEFAULT '#0A84FF',
      pin_hash TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      name TEXT NOT NULL,
      iban TEXT,
      initial_balance REAL NOT NULL DEFAULT 0,
      initial_balance_date TEXT NOT NULL,
      checkpoint_balance REAL,
      checkpoint_date TEXT,
      PRIMARY KEY (id, profile_id),
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      name TEXT NOT NULL,
      icon TEXT NOT NULL,
      color TEXT NOT NULL,
      type TEXT NOT NULL,
      budget REAL,
      PRIMARY KEY (id, profile_id),
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rules (
      id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      name TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 20,
      conditions TEXT NOT NULL,
      apply_category TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (id, profile_id),
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id TEXT NOT NULL,
      date TEXT NOT NULL,
      valuta_date TEXT,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'EUR',
      payee TEXT NOT NULL,
      purpose TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      type TEXT NOT NULL,
      category TEXT NOT NULL,
      account TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'booked',
      source_hash TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tx_profile_date ON transactions(profile_id, date);
    CREATE INDEX IF NOT EXISTS idx_tx_hash ON transactions(profile_id, source_hash);

    CREATE TABLE IF NOT EXISTS bank_templates (
      id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      encoding TEXT NOT NULL DEFAULT 'windows-1252',
      delimiter TEXT NOT NULL DEFAULT ';',
      header_identifier TEXT NOT NULL,
      columns TEXT NOT NULL,
      text_parser TEXT NOT NULL DEFAULT 'comdirect',
      date_format TEXT NOT NULL DEFAULT 'DD.MM.YYYY',
      PRIMARY KEY (id, profile_id),
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );
  `);

  const profileCount = db.prepare('SELECT count(*) as count FROM profiles').get().count;
  if (profileCount === 0) {
    const now = new Date().toISOString();
    const defaultProfileId = 'privat';

    db.prepare(`
      INSERT INTO profiles (id, name, icon, color, is_default, created_at)
      VALUES (?, ?, ?, ?, 1, ?)
    `).run(defaultProfileId, 'Privat', 'User', '#0A84FF', now);

    seedProfileDefaults(defaultProfileId);
  }
}

export function seedProfileDefaults(profileId) {
  const DEFAULT_CATEGORIES = [
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

  const DEFAULT_ACCOUNT = {
    id: 'comdirect',
    name: 'comdirect Girokonto',
    initial_balance: 0,
    initial_balance_date: '2026-01-01'
  };

  const DEFAULT_TEMPLATE = {
    id: 'comdirect',
    name: 'comdirect Girokonto',
    description: 'Automatische Erkennung für comdirect CSV mit Windows-1252 & Textzerlegung',
    encoding: 'windows-1252',
    delimiter: ';',
    header_identifier: 'Buchungstag',
    columns: JSON.stringify({
      date: 'Buchungstag',
      valutaDate: 'Wertstellung (Valuta)',
      type: 'Vorgang',
      rawText: 'Buchungstext',
      amount: 'Umsatz in EUR'
    }),
    text_parser: 'comdirect',
    date_format: 'DD.MM.YYYY'
  };

  const insertAccount = db.prepare(`
    INSERT OR IGNORE INTO accounts (id, profile_id, name, initial_balance, initial_balance_date)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertAccount.run(DEFAULT_ACCOUNT.id, profileId, DEFAULT_ACCOUNT.name, DEFAULT_ACCOUNT.initial_balance, DEFAULT_ACCOUNT.initial_balance_date);

  const insertCategory = db.prepare(`
    INSERT OR IGNORE INTO categories (id, profile_id, name, icon, color, type)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const c of DEFAULT_CATEGORIES) {
    insertCategory.run(c.id, profileId, c.name, c.icon, c.color, c.type);
  }

  const insertRule = db.prepare(`
    INSERT OR IGNORE INTO rules (id, profile_id, name, priority, conditions, apply_category, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const r of standardRules.rules) {
    insertRule.run(r.id, profileId, r.name, r.priority, JSON.stringify(r.conditions), r.applyCategory, r.enabled ? 1 : 0);
  }

  const insertTemplate = db.prepare(`
    INSERT OR IGNORE INTO bank_templates (id, profile_id, name, description, encoding, delimiter, header_identifier, columns, text_parser, date_format)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertTemplate.run(
    DEFAULT_TEMPLATE.id,
    profileId,
    DEFAULT_TEMPLATE.name,
    DEFAULT_TEMPLATE.description,
    DEFAULT_TEMPLATE.encoding,
    DEFAULT_TEMPLATE.delimiter,
    DEFAULT_TEMPLATE.header_identifier,
    DEFAULT_TEMPLATE.columns,
    DEFAULT_TEMPLATE.text_parser,
    DEFAULT_TEMPLATE.date_format
  );
}

// Add missing presets atomically; only migrate known, unedited older presets.
// The enabled flag is deliberately preserved, including for legacy defaults.
export function loadStandardRules(profileId) {
  const sameDefinition = (stored, preset) => {
    const conditions = JSON.parse(stored.conditions);
    return stored.name === preset.name && stored.priority === preset.priority &&
      stored.apply_category === preset.applyCategory &&
      conditions.length === preset.conditions.length &&
      conditions.every((condition, i) => {
        const expected = preset.conditions[i];
        return condition.field === expected.field && condition.operator === expected.operator && condition.value === expected.value;
      });
  };
  return db.transaction(() => {
    let inserted = 0;
    let updated = 0;
    const find = db.prepare('SELECT * FROM rules WHERE id = ? AND profile_id = ?');
    const insert = db.prepare(`INSERT INTO rules (id, profile_id, name, priority, conditions, apply_category, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const update = db.prepare(`UPDATE rules SET name = ?, priority = ?, conditions = ?, apply_category = ?
      WHERE id = ? AND profile_id = ?`);
    for (const preset of standardRules.rules) {
      const existing = find.get(preset.id, profileId);
      if (!existing) {
        insert.run(preset.id, profileId, preset.name, preset.priority, JSON.stringify(preset.conditions), preset.applyCategory, preset.enabled ? 1 : 0);
        inserted++;
      } else if (standardRules.previousVersions.some(previous => previous.id === preset.id && sameDefinition(existing, previous))) {
        update.run(preset.name, preset.priority, JSON.stringify(preset.conditions), preset.applyCategory, preset.id, profileId);
        updated++;
      }
    }
    return { inserted, updated };
  })();
}

export function hashPinServer(pin) {
  if (!pin || typeof pin !== 'string') return null;
  const trimmed = pin.trim();
  if (!trimmed) return null;
  return crypto.createHash('sha256').update(trimmed + '_dagobert_salt', 'utf8').digest('hex');
}

export { db };
