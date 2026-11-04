import { randomUUID } from 'node:crypto';
import { normalizeBackupPayload, backupProfiles } from '../src/data/backupSchema.ts';
import { stableIdentity, transactionIdentity } from '../src/data/identity.ts';

const collections = ['accounts', 'categories', 'rules', 'transactions', 'bankTemplates'];
const tables = { accounts: 'accounts', categories: 'categories', rules: 'rules', transactions: 'transactions', bankTemplates: 'bank_templates' };

export function createBackupStore(db) {
  db.prepare('INSERT OR IGNORE INTO portable_settings(key, value) VALUES (?, ?)').run('datasetId', randomUUID());
  const datasetId = db.prepare('SELECT value FROM portable_settings WHERE key = ?').get('datasetId').value;
  function fields(profileId, type, id) {
    const row = db.prepare('SELECT payload FROM portable_fields WHERE profile_id = ? AND entity_type = ? AND entity_id = ?').get(profileId, type, String(id));
    return row ? JSON.parse(row.payload) : {};
  }
  function remember(profileId, type, id, payload) {
    db.prepare(`INSERT INTO portable_fields(profile_id, entity_type, entity_id, payload) VALUES (?, ?, ?, ?)
      ON CONFLICT(profile_id, entity_type, entity_id) DO UPDATE SET payload = excluded.payload`).run(profileId, type, String(id), JSON.stringify(payload));
  }
  function optional(profileId, type, row, column, key) {
    const extra = fields(profileId, type, row.id);
    return row[column] !== null || Object.hasOwn(extra, key) ? { [key]: row[column] } : {};
  }
  function readProfile(profileId) {
    const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
    if (!row) throw new Error('Profil nicht gefunden.');
    const profile = { ...fields(profileId, 'profile', profileId), id: row.id, name: row.name, icon: row.icon,
      color: row.color, isDefault: !!row.is_default, hasPin: false, createdAt: row.created_at };
    const accounts = db.prepare('SELECT * FROM accounts WHERE profile_id = ?').all(profileId).map(a => ({
      ...fields(profileId, 'accounts', a.id), id: a.id, name: a.name, ...optional(profileId, 'accounts', a, 'iban', 'iban'),
      initialBalance: a.initial_balance, initialBalanceDate: a.initial_balance_date,
      ...optional(profileId, 'accounts', a, 'checkpoint_balance', 'checkpointBalance'), ...optional(profileId, 'accounts', a, 'checkpoint_date', 'checkpointDate') }));
    const categories = db.prepare('SELECT * FROM categories WHERE profile_id = ?').all(profileId).map(c => ({
      ...fields(profileId, 'categories', c.id), id: c.id, name: c.name, icon: c.icon, color: c.color, type: c.type, ...optional(profileId, 'categories', c, 'budget', 'budget') }));
    const rules = db.prepare('SELECT * FROM rules WHERE profile_id = ? ORDER BY priority, id').all(profileId).map(r => ({
      ...fields(profileId, 'rules', r.id), id: r.id, name: r.name, priority: r.priority, conditions: JSON.parse(r.conditions), applyCategory: r.apply_category, enabled: !!r.enabled }));
    const transactions = db.prepare('SELECT * FROM transactions WHERE profile_id = ? ORDER BY id').all(profileId).map(t => ({
      ...fields(profileId, 'transactions', t.id), id: t.id, syncId: fields(profileId, 'transactions', t.id).syncId ?? stableIdentity(`docker:${datasetId}:${profileId}`, String(t.id)),
      date: t.date, ...optional(profileId, 'transactions', t, 'valuta_date', 'valutaDate'), amount: t.amount, currency: t.currency, payee: t.payee,
      purpose: t.purpose, rawText: t.raw_text, type: t.type, category: t.category, account: t.account,
      status: t.status, sourceHash: t.source_hash, importedAt: t.imported_at }));
    const bankTemplates = db.prepare('SELECT * FROM bank_templates WHERE profile_id = ?').all(profileId).map(t => ({
      ...fields(profileId, 'bankTemplates', t.id), id: t.id, name: t.name, description: t.description, encoding: t.encoding,
      delimiter: t.delimiter, headerIdentifier: t.header_identifier, columns: JSON.parse(t.columns), textParser: t.text_parser, dateFormat: t.date_format }));
    return { ...fields(profileId, 'snapshot', profileId), profileId, profileName: profile.name, profile, includedCollections: collections, accounts, categories, rules, transactions, bankTemplates };
  }
  function exportBackup(profileId, includeAllProfiles = false) {
    const root = readProfile(profileId);
    const others = includeAllProfiles ? db.prepare('SELECT id FROM profiles WHERE id <> ? ORDER BY id').all(profileId).map(p => readProfile(p.id)) : [];
    return normalizeBackupPayload({ ...root, format: 'dagobert_backup', schemaVersion: 2, exportedAt: new Date().toISOString(),
      sourcePlatform: 'docker', profiles: [root.profile, ...others.map(p => p.profile)], additionalProfiles: others });
  }
  function comparable(value) {
    if (Array.isArray(value)) return value.map(comparable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
      .filter(key => value[key] !== undefined)
      .map(key => [key, comparable(value[key])]));
    return value;
  }
  function equal(a, b) {
    const financial = value => Object.fromEntries(Object.entries(value).filter(([key]) => !['id', 'syncId', 'importedAt', 'hasPin'].includes(key)));
    return JSON.stringify(comparable(financial(a))) === JSON.stringify(comparable(financial(b)));
  }
  function importBackup(targetProfileId, raw, mode = 'merge') {
    if (!['replace', 'merge', 'new_profile'].includes(mode)) throw new Error('Unbekannter Importmodus.');
    const payload = normalizeBackupPayload(raw);
    const incoming = backupProfiles(payload);
    // Plan all conflicts and profile assignments before any write. Any failure rolls back every profile.
    return db.transaction(() => {
      const targets = incoming.map((snapshot, index) => ({ snapshot, id: mode === 'new_profile' ? randomUUID() : index === 0 ? targetProfileId : snapshot.profileId }));
      if (new Set(targets.map(target => target.id)).size !== targets.length) {
        throw new Error('Mehrere gesicherte Profile würden dasselbe Zielprofil überschreiben. Bitte ein anderes Ziel wählen oder als neue Profile importieren.');
      }
      if (mode === 'replace') {
        const current = targets.filter(t => db.prepare('SELECT id FROM profiles WHERE id=?').get(t.id)).map(t => readProfile(t.id));
        if (current.length) {
          const recovery = normalizeBackupPayload({ ...current[0], format: 'dagobert_backup', schemaVersion: 2, exportedAt: new Date().toISOString(),
            sourcePlatform: 'docker', profiles: current.map(p => p.profile), additionalProfiles: current.slice(1) });
          db.prepare('INSERT INTO recovery_snapshots(id,profile_id,payload) VALUES (?,?,?)').run(randomUUID(), targetProfileId, JSON.stringify(recovery));
        }
      }
      const importedProfiles = [];
      for (const { snapshot, id } of targets) {
        const exists = db.prepare('SELECT id FROM profiles WHERE id = ?').get(id);
        if (!exists) {
          const p = snapshot.profile;
          db.prepare('INSERT INTO profiles(id, name, icon, color, is_default, pin_hash, created_at) VALUES (?, ?, ?, ?, 0, NULL, ?)')
            .run(id, snapshot.profileName, p.icon, p.color, p.createdAt ?? new Date().toISOString());
        }
        const current = readProfile(id);
        if (mode === 'replace') {
          // Preserve the target's local PIN. Only imported profiles need security setup.
          db.prepare('UPDATE profiles SET name = ?, icon = ?, color = ?, created_at = COALESCE(?, created_at) WHERE id = ?')
            .run(snapshot.profileName, snapshot.profile.icon, snapshot.profile.color, snapshot.profile.createdAt ?? null, id);
        }
        remember(id, 'profile', id, snapshot.profile);
        const { accounts, categories, rules, transactions, bankTemplates, ...extra } = snapshot;
        remember(id, 'snapshot', id, extra);
        const included = snapshot.includedCollections ?? collections;
        for (const kind of collections) {
          if (!included.includes(kind)) continue;
          const original = current[kind];
          const seen = new Map();
          if (mode === 'replace') {
            db.prepare(`DELETE FROM ${tables[kind]} WHERE profile_id = ?`).run(id);
            db.prepare('DELETE FROM portable_fields WHERE profile_id = ? AND entity_type = ?').run(id, kind);
          }
          const occurrences = new Map();
          for (const value of snapshot[kind]) {
            const fingerprint = `${value.account ?? ''}:${value.sourceHash ?? ''}`;
            const occurrence = (occurrences.get(fingerprint) ?? 0) + 1;
            occurrences.set(fingerprint, occurrence);
            const syncId = kind === 'transactions' ? transactionIdentity(snapshot.profileId, value, occurrence) : undefined;
            const match = mode !== 'replace' && original.find(existing => kind === 'transactions'
              ? existing.syncId === syncId || (!value.syncId && value.id !== undefined && String(existing.id) === String(value.id)) : existing.id === value.id);
            if (match) {
              if (!equal(match, value)) throw new Error(`Konflikt in ${kind}: ${value.name ?? value.date ?? value.id}. Bestehende und importierte Werte unterscheiden sich; bitte getrennt als neues Profil importieren.`);
              continue;
            }
            if (kind === 'transactions' && mode === 'merge' && !value.syncId && value.id === undefined) {
              const matches = original.filter(existing => existing.sourceHash === value.sourceHash && equal(existing, value));
              const used = seen.get(fingerprint) ?? 0;
              if (used < matches.length) { seen.set(fingerprint, used + 1); continue; }
            }
            let localId = value.id;
            switch (kind) {
              case 'accounts': db.prepare(`INSERT INTO accounts(id, profile_id, name, iban, initial_balance, initial_balance_date, checkpoint_balance, checkpoint_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(value.id, id, value.name, value.iban ?? null, value.initialBalance, value.initialBalanceDate, value.checkpointBalance ?? null, value.checkpointDate ?? null); break;
              case 'categories': db.prepare('INSERT INTO categories(id, profile_id, name, icon, color, type, budget) VALUES (?, ?, ?, ?, ?, ?, ?)')
                .run(value.id, id, value.name, value.icon, value.color, value.type, value.budget ?? null); break;
              case 'rules': db.prepare('INSERT INTO rules(id, profile_id, name, priority, conditions, apply_category, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)')
                .run(value.id, id, value.name, value.priority, JSON.stringify(value.conditions), value.applyCategory, value.enabled ? 1 : 0); break;
              case 'bankTemplates': db.prepare(`INSERT INTO bank_templates(id, profile_id, name, description, encoding, delimiter, header_identifier, columns, text_parser, date_format) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(value.id, id, value.name, value.description, value.encoding, value.delimiter, value.headerIdentifier, JSON.stringify(value.columns), value.textParser, value.dateFormat); break;
              case 'transactions': {
                const result = db.prepare(`INSERT INTO transactions(profile_id, date, valuta_date, amount, currency, payee, purpose, raw_text, type, category, account, status, source_hash, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                  .run(id, value.date, value.valutaDate ?? null, value.amount, value.currency, value.payee, value.purpose, value.rawText, value.type, value.category, value.account, value.status, value.sourceHash, value.importedAt);
                localId = Number(result.lastInsertRowid);
                break;
              }
            }
            remember(id, kind, localId, { ...value, ...(syncId ? { syncId } : {}) });
          }
        }
        importedProfiles.push(id);
      }
      return { success: true, profileIds: importedProfiles };
    })();
  }
  return { readProfile, exportBackup, importBackup, fields, remember };
}
