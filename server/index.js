import express from 'express';
import path from 'path';
import fs from 'fs';
import { db, initDatabase, seedProfileDefaults, loadStandardRules, hashPinServer } from './db.js';
import { createProfileSecurity } from './profileSecurity.js';
import { createBackupStore } from './backupStore.js';
import { mountComdirect } from './comdirect.js';
import { comdirectAccountFromSource, validBankDate } from '../src/lib/bankImport.ts';
import { planRulesImport } from '../src/data/rulesPackage.ts';
import { createBankAccessStore } from './bankAccessStore.js';
import { normalizeBackupPayload, backupProfiles } from '../src/data/backupSchema.ts';

initDatabase();
const backups = createBackupStore(db);

const app = express();
app.use(express.json({ limit: '50mb' }));

// Helper: check profile exists
function getProfile(profileId) {
  return db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
}

const { requireAccess, unlock } = createProfileSecurity(getProfile, hashPinServer);
const bodyProfileAccess = requireAccess(req => req.body?.profileId);
const bankAccessStore = createBankAccessStore(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
mountComdirect(app, bodyProfileAccess, fetch, { store: bankAccessStore, canSave: id => !!getProfile(id)?.pin_hash });
const queryProfileAccess = requireAccess(req => req.query.profileId || 'privat');
const profileAccess = requireAccess(req => req.params.id);
// Resolve ownership from the database, never from a caller-supplied profile ID.
const transactionAccess = requireAccess(req =>
  db.prepare('SELECT profile_id FROM transactions WHERE id = ?').get(req.params.id)?.profile_id);

// ----------------------------------------------------
// Profiles Endpoints
// ----------------------------------------------------

app.get('/api/profiles', (req, res) => {
  const rows = db.prepare('SELECT id, name, icon, color, is_default, pin_hash, created_at FROM profiles ORDER BY is_default DESC, name ASC').all();
  const sanitized = rows.map(r => ({
    id: r.id,
    name: r.name,
    icon: r.icon,
    color: r.color,
    isDefault: !!r.is_default,
    hasPin: !!r.pin_hash,
    createdAt: r.created_at
  }));
  res.json(sanitized);
});

app.post('/api/profiles', (req, res) => {
  const { name, icon = 'User', color = '#0A84FF', pin } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name ist erforderlich' });
  }
  if (pin && (typeof pin !== 'string' || !/^\d{4,6}$/.test(pin))) {
    return res.status(400).json({ error: 'Die PIN muss 4 bis 6 Ziffern enthalten' });
  }

  const id = name.trim().toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now().toString(36).slice(-4);
  const now = new Date().toISOString();
  const pinHash = pin ? hashPinServer(pin) : null;

  db.prepare(`
    INSERT INTO profiles (id, name, icon, color, is_default, pin_hash, created_at)
    VALUES (?, ?, ?, ?, 0, ?, ?)
  `).run(id, name.trim(), icon, color, pinHash, now);

  seedProfileDefaults(id);

  res.json({ id, name: name.trim(), icon, color, isDefault: false, hasPin: !!pinHash });
});

app.put('/api/profiles/:id', profileAccess, (req, res) => {
  const { id } = req.params;
  const { name, icon, color, pin, removePin } = req.body;
  if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.trim().length > 100)) {
    return res.status(400).json({ error: 'Bitte einen Profilnamen mit 1 bis 100 Zeichen eingeben.' });
  }
  const profile = getProfile(id);
  if (!profile) return res.status(404).json({ error: 'Profil nicht gefunden' });
  if (pin && (typeof pin !== 'string' || !/^\d{4,6}$/.test(pin))) {
    return res.status(400).json({ error: 'Die PIN muss 4 bis 6 Ziffern enthalten' });
  }

  let pinHash = profile.pin_hash;
  if (removePin) {
    bankAccessStore.remove(id);
    pinHash = null;
  } else if (pin) {
    pinHash = hashPinServer(pin);
  }

  db.prepare(`
    UPDATE profiles
    SET name = COALESCE(?, name),
        icon = COALESCE(?, icon),
        color = COALESCE(?, color),
        pin_hash = ?
    WHERE id = ?
  `).run(name?.trim() ?? null, icon ?? null, color ?? null, pinHash, id);

  res.json({ success: true, hasPin: !!pinHash });
});

app.delete('/api/profiles/:id', profileAccess, (req, res) => {
  const { id } = req.params;
  const total = db.prepare('SELECT count(*) as count FROM profiles').get().count;
  if (total <= 1) {
    return res.status(400).json({ error: 'Das letzte Profil kann nicht gelöscht werden' });
  }

  bankAccessStore.remove(id);
  db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
  res.json({ success: true });
});

app.post('/api/profiles/:id/unlock', unlock);

// ----------------------------------------------------
// Data Endpoint (Full State for active profile)
// ----------------------------------------------------

app.get('/api/data', queryProfileAccess, (req, res) => {
  const profileId = req.query.profileId || 'privat';
  const profile = getProfile(profileId);
  if (!profile) return res.status(404).json({ error: 'Profil nicht gefunden' });

  const data = backups.readProfile(profileId);
  res.json({ profile: { ...data.profile, hasPin: !!profile.pin_hash },
    accounts: data.accounts, categories: data.categories, rules: data.rules,
    transactions: data.transactions, bankTemplates: data.bankTemplates });
});

// ----------------------------------------------------
// Transactions Endpoints
// ----------------------------------------------------

app.post('/api/transactions/batch', bodyProfileAccess, (req, res) => {
  const { profileId, transactions = [], accountCheckpoint, appendOnly = false, reviewedHashes = [] } = req.body;
  if (!profileId) return res.status(400).json({ error: 'profileId erforderlich' });
  if (appendOnly && (!Array.isArray(transactions) || transactions.some(t =>
    !t || typeof t.sourceHash !== 'string' || !t.sourceHash.startsWith('comdirect_api_') ||
    t.status !== 'booked' || t.currency !== 'EUR' || !Number.isFinite(t.amount) ||
    !Number.isSafeInteger(Math.round(t.amount * 100)) || !validBankDate(t.date) ||
    Math.abs(t.amount * 100 - Math.round(t.amount * 100)) > 0.0000001 ||
    (t.valutaDate && !validBankDate(t.valutaDate)) || typeof t.account !== 'string' || !t.account ||
    ['payee', 'purpose', 'rawText', 'type', 'category', 'importedAt'].some(key => typeof t[key] !== 'string')))) {
    return res.status(400).json({ error: 'Ungültige Buchungen im Bankabruf. Nichts gespeichert.' });
  }

  const existing = db.prepare('SELECT id, date, amount, payee, account, status, source_hash FROM transactions WHERE profile_id = ?').all(profileId);
  if (appendOnly) {
    try {
      if (!Array.isArray(reviewedHashes) || reviewedHashes.some(hash => typeof hash !== 'string')) throw new Error('Ungültige Freigabe.');
      const accepted = new Set(reviewedHashes);
      for (const t of transactions) {
        if (existing.some(old => old.account === t.account && old.source_hash === t.sourceHash)) continue;
        const historical = existing.some(old => old.account === t.account && old.date >= t.date &&
          !old.source_hash?.startsWith('comdirect_api_') && !backups.fields(profileId, 'transactions', old.id).isManual);
        if (historical && !accepted.has(t.sourceHash)) throw new Error('Historische Überschneidung noch nicht geprüft.');
      }
      const linked = new Map();
      const targets = new Map();
      for (const t of [...existing.map(t => ({ account: t.account, sourceHash: t.source_hash })), ...transactions]) {
        const bank = comdirectAccountFromSource(t.sourceHash);
        if (!bank) continue;
        const previous = linked.get(bank);
        if (previous && previous !== t.account) throw new Error('Dieses Bankkonto ist bereits einem anderen Zielkonto zugeordnet.');
        if (targets.has(t.account) && targets.get(t.account) !== bank) throw new Error('Dieses Zielkonto gehört zu einem anderen Bankkonto.');
        linked.set(bank, t.account);
        targets.set(t.account, bank);
      }
    } catch { return res.status(400).json({ error: 'Die Konto-Zuordnung oder historische Überschneidung muss erneut geprüft werden. Nichts gespeichert.' }); }
  }
  const existingHashes = new Set(existing.map(t => t.source_hash));

  // Pending queue map
  const pendingQueue = new Map();
  existing.forEach(t => {
    if (t.status === 'pending') {
      const key = `${t.date}|${Number(t.amount).toFixed(2)}|${t.payee.trim().toLowerCase()}|${t.account || 'comdirect Girokonto'}`;
      const list = pendingQueue.get(key) || [];
      list.push(t);
      pendingQueue.set(key, list);
    }
  });

  let insertedCount = 0;
  let updatedCount = 0;
  let skippedDuplicates = 0;

  const insertTx = db.prepare(`
    INSERT INTO transactions (
      profile_id, date, valuta_date, amount, currency, payee, purpose,
      raw_text, type, category, account, status, source_hash, imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updatePending = db.prepare(`
    UPDATE transactions
    SET status = 'booked',
        raw_text = ?,
        type = ?,
        source_hash = ?
    WHERE id = ?
  `);

  const updateCheckpoint = db.prepare(`
    UPDATE accounts
    SET checkpoint_balance = ?,
        checkpoint_date = ?,
        iban = COALESCE(?, iban)
    WHERE id = ? AND profile_id = ?
  `);

  const txRunner = db.transaction(() => {
    // 1. Account Checkpoint update if provided and valid
    if (!appendOnly && accountCheckpoint?.newBalance !== undefined && Number.isFinite(Number(accountCheckpoint.newBalance))) {
      const balance = Number(accountCheckpoint.newBalance);

      // Resolve checkpoint date: provided endDate, or max transaction date in batch, or max date in DB, or today
      let checkpointDate = accountCheckpoint.endDate;
      if (!checkpointDate && transactions && transactions.length > 0) {
        const dates = transactions.map(t => t.date).filter(Boolean);
        if (dates.length > 0) {
          checkpointDate = dates.reduce((max, d) => d > max ? d : max, dates[0]);
        }
      }
      if (!checkpointDate) {
        const latestTx = db.prepare('SELECT MAX(date) as max_date FROM transactions WHERE profile_id = ?').get(profileId);
        checkpointDate = latestTx?.max_date || new Date().toISOString().slice(0, 10);
      }

      const acc = db.prepare('SELECT checkpoint_date FROM accounts WHERE id = ? AND profile_id = ?').get('comdirect', profileId);
      if (acc) {
        if (!acc.checkpoint_date || checkpointDate >= acc.checkpoint_date) {
          updateCheckpoint.run(
            balance,
            checkpointDate,
            accountCheckpoint.iban || null,
            'comdirect',
            profileId
          );
        }
      }
    }

    // Differentiate booked duplicates from pending hashes
    const bookedHashes = new Set(existing.filter(t => t.status === 'booked').map(t => t.source_hash));

    const now = new Date().toISOString();
    for (const t of transactions) {
      // Priority 1: If an identical booked transaction already exists, or an identical pending item, skip it!
      if (bookedHashes.has(t.sourceHash) || (t.status === 'pending' && existingHashes.has(t.sourceHash))) {
        skippedDuplicates++;
        continue;
      }

      // Priority 2: Account-scoped and payee-scoped pending promotions
      const accountName = t.account || 'comdirect Girokonto';
      const key = `${t.date}|${Number(t.amount).toFixed(2)}|${t.payee.trim().toLowerCase()}|${accountName}`;
      const pendingList = pendingQueue.get(key);

      if (!appendOnly && pendingList && pendingList.length > 0 && t.status === 'booked') {
        const target = pendingList.shift();
        updatePending.run(t.rawText, t.type, t.sourceHash, target.id);
        bookedHashes.add(t.sourceHash);
        updatedCount++;
      } else {
        const info = insertTx.run(
          profileId,
          t.date,
          t.valutaDate || null,
          appendOnly ? Math.round(t.amount * 100) / 100 : Number(t.amount),
          t.currency || 'EUR',
          t.payee || 'Unbekannt',
          t.purpose || '',
          t.rawText || '',
          t.type || '',
          t.category || 'sonstiges',
          accountName,
          t.status || 'booked',
          t.sourceHash,
          now
        );
        backups.remember(profileId, 'transactions', Number(info.lastInsertRowid), t);
        if (t.status === 'booked') {
          bookedHashes.add(t.sourceHash);
        }
        insertedCount++;
      }
    }
  });

  txRunner();

  res.json({
    inserted: insertedCount,
    updated: updatedCount,
    duplicates: skippedDuplicates
  });
});

app.post('/api/transactions', bodyProfileAccess, (req, res) => {
  const { profileId, transaction } = req.body;
  if (!profileId || !transaction) return res.status(400).json({ error: 'Daten unvollständig' });

  const localId = db.transaction(() => {
  const now = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO transactions (
      profile_id, date, valuta_date, amount, currency, payee, purpose,
      raw_text, type, category, account, status, source_hash, imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    profileId,
    transaction.date,
    transaction.valutaDate || null,
    transaction.amount,
    transaction.currency || 'EUR',
    transaction.payee,
    transaction.purpose,
    transaction.rawText,
    transaction.type,
    transaction.category,
    transaction.account,
    transaction.status || 'booked',
    transaction.sourceHash || ('man_' + Date.now().toString(36)),
    now
  );

  const localId = Number(info.lastInsertRowid);
  backups.remember(profileId, 'transactions', localId, { ...transaction, isManual: true });
    return localId;
  })();
  res.json({ id: localId });
});

app.put('/api/transactions/:id', transactionAccess, (req, res) => {
  const { id } = req.params;
  const { transaction } = req.body;
  if (!transaction) return res.status(400).json({ error: 'Keine Daten' });

  const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Buchung nicht gefunden' });

  db.transaction(() => {
  const updatedDate = transaction.date ?? existing.date;
  const updatedAmount = transaction.amount !== undefined ? Number(transaction.amount) : existing.amount;
  const updatedPayee = transaction.payee ?? existing.payee;
  const updatedPurpose = transaction.purpose ?? existing.purpose;
  const updatedCategory = transaction.category ?? existing.category;
  const updatedStatus = transaction.status ?? existing.status;

  db.prepare(`
    UPDATE transactions
    SET date = ?,
        amount = ?,
        payee = ?,
        purpose = ?,
        category = ?,
        status = ?
    WHERE id = ?
  `).run(updatedDate, updatedAmount, updatedPayee, updatedPurpose, updatedCategory, updatedStatus, id);

  backups.remember(existing.profile_id, 'transactions', id, { ...backups.fields(existing.profile_id, 'transactions', id), ...transaction });
  })();
  res.json({ success: true });
});

app.delete('/api/transactions/:id', transactionAccess, (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
  res.json({ success: true });
});

app.put('/api/accounts/:id', bodyProfileAccess, (req, res) => {
  const { id } = req.params;
  const { profileId, initialBalance, initialBalanceDate, checkpointBalance, checkpointDate } = req.body;

  db.prepare(`
    UPDATE accounts
    SET initial_balance = COALESCE(?, initial_balance),
        initial_balance_date = COALESCE(?, initial_balance_date),
        checkpoint_balance = CASE WHEN ? = 1 THEN ? ELSE checkpoint_balance END,
        checkpoint_date = CASE WHEN ? = 1 THEN ? ELSE checkpoint_date END
    WHERE id = ? AND profile_id = ?
  `).run(
    initialBalance,
    initialBalanceDate,
    Object.hasOwn(req.body, 'checkpointBalance') ? 1 : 0,
    checkpointBalance ?? null,
    Object.hasOwn(req.body, 'checkpointDate') ? 1 : 0,
    checkpointDate ?? null,
    id,
    profileId
  );

  res.json({ success: true });
});

app.post('/api/rules/defaults', bodyProfileAccess, (req, res) => {
  res.json(loadStandardRules(req.body.profileId));
});
app.post('/api/rules/import', bodyProfileAccess, (req, res) => {
  try {
    const result = db.transaction(() => {
      const { profileId, data } = req.body;
      const current = backups.readProfile(profileId);
      const plan = planRulesImport(data, current.categories, current.rules);
      const category = db.prepare('INSERT INTO categories (id, profile_id, name, icon, color, type, budget) VALUES (?, ?, ?, ?, ?, ?, ?)');
      const rule = db.prepare('INSERT INTO rules (id, profile_id, name, priority, conditions, apply_category, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const c of plan.categories) {
        category.run(c.id, profileId, c.name, c.icon, c.color, c.type, c.budget ?? null);
        backups.remember(profileId, 'categories', c.id, c);
      }
      for (const r of plan.rules) {
        rule.run(r.id, profileId, r.name, r.priority, JSON.stringify(r.conditions), r.applyCategory, r.enabled ? 1 : 0);
        backups.remember(profileId, 'rules', r.id, r);
      }
      return { categoriesAdded: plan.categoriesAdded, rulesAdded: plan.rulesAdded, unchanged: plan.unchanged };
    })();
    res.json(result);
  } catch { res.status(400).json({ error: 'Die Regeln-Datei ist ungültig oder unvollständig. Es wurde nichts verändert.' }); }
});

app.post('/api/rules', bodyProfileAccess, (req, res) => {
  const { profileId, rule } = req.body;
  if (!profileId || !rule) return res.status(400).json({ error: 'Daten fehlen' });

  db.transaction(() => {
  db.prepare(`
    INSERT INTO rules (id, profile_id, name, priority, conditions, apply_category, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id, profile_id) DO UPDATE SET
      name = excluded.name,
      priority = excluded.priority,
      conditions = excluded.conditions,
      apply_category = excluded.apply_category,
      enabled = excluded.enabled
  `).run(rule.id, profileId, rule.name, rule.priority, JSON.stringify(rule.conditions), rule.applyCategory, rule.enabled ? 1 : 0);

  backups.remember(profileId, 'rules', rule.id, rule);
  })();
  res.json({ success: true });
});

app.delete('/api/rules/:id', requireAccess(req => req.query.profileId || req.body?.profileId), (req, res) => {
  const { id } = req.params;
  const profileId = req.query.profileId || req.body?.profileId;
  if (!profileId) {
    return res.status(400).json({ error: 'profileId ist erforderlich' });
  }
  db.prepare('DELETE FROM rules WHERE id = ? AND profile_id = ?').run(id, profileId);
  res.json({ success: true });
});

app.post('/api/categories', bodyProfileAccess, (req, res) => {
  const { profileId, category } = req.body;
  if (!profileId || !category || !category.name) {
    return res.status(400).json({ error: 'profileId und category.name sind erforderlich' });
  }

  const name = category.name.trim();
  const id = category.id || name.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 24) + '-' + Date.now().toString(36).slice(-4);
  const icon = category.icon || 'Tag';
  const color = category.color || '#30D158';
  const type = category.type || 'expense';
  const budget = typeof category.budget === 'number' && !isNaN(category.budget) ? category.budget : null;

  db.prepare(`
    INSERT INTO categories (id, profile_id, name, icon, color, type, budget)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id, profile_id) DO UPDATE SET
      name = excluded.name,
      icon = excluded.icon,
      color = excluded.color,
      type = excluded.type,
      budget = excluded.budget
  `).run(id, profileId, name, icon, color, type, budget);

  res.json({ success: true, category: { id, name, icon, color, type, budget } });
});

app.delete('/api/categories/:id', requireAccess(req => req.query.profileId || req.body?.profileId), (req, res) => {
  const { id } = req.params;
  const profileId = req.query.profileId || req.body?.profileId;
  if (!profileId) {
    return res.status(400).json({ error: 'profileId ist erforderlich' });
  }

  // Fallback existing transactions to 'sonstiges'
  db.prepare(`
    UPDATE transactions
    SET category = 'sonstiges'
    WHERE category = ? AND profile_id = ?
  `).run(id, profileId);

  // Delete category
  db.prepare('DELETE FROM categories WHERE id = ? AND profile_id = ?').run(id, profileId);

  res.json({ success: true });
});


// ----------------------------------------------------
// Server-Side Backup & Restore Endpoints
// ----------------------------------------------------
function accessProfiles(req, res, ids, done) {
  const unique = [...new Set(ids)];
  function next(index) {
    if (index === unique.length) return done();
    requireAccess(() => unique[index])(req, res, () => next(index + 1));
  }
  next(0);
}
app.get('/api/backup', queryProfileAccess, (req, res) => {
  const profileId = req.query.profileId || 'privat';
  const all = req.query.allProfiles === 'true';
  const ids = all ? db.prepare('SELECT id FROM profiles').all().map(p => p.id) : [profileId];
  accessProfiles(req, res, ids, () => {
    try { res.json(backups.exportBackup(profileId, all)); }
    catch (error) { res.status(400).json({ error: error.message }); }
  });
});

app.get('/api/backup/recovery', queryProfileAccess, (req, res) => {
  const rows = db.prepare('SELECT id,payload FROM recovery_snapshots WHERE profile_id=?').all(req.query.profileId || 'privat');
  res.json({ backups: rows.map(row => { const data = JSON.parse(row.payload); return { id: row.id, exportedAt: data.exportedAt, profileName: data.profileName }; }) });
});
app.get('/api/backup/recovery/:id', queryProfileAccess, (req, res) => {
  const row = db.prepare('SELECT payload FROM recovery_snapshots WHERE id=? AND profile_id=?').get(req.params.id, req.query.profileId || 'privat');
  if (!row) return res.status(404).json({ error: 'Sicherung nicht gefunden.' });
  const backup = JSON.parse(row.payload);
  const existing = backupProfiles(backup).map(p => p.profileId).filter(id => getProfile(id));
  accessProfiles(req, res, existing, () => res.json(backup));
});

app.post('/api/backup/import', bodyProfileAccess, (req, res) => {
  try {
    const data = normalizeBackupPayload(req.body.data);
    const mode = req.body.mode ?? 'replace';
    const ids = [req.body.profileId];
    if (mode !== 'new_profile') {
      for (const p of backupProfiles(data).slice(1)) {
        if (getProfile(p.profileId)) ids.push(p.profileId);
      }
    }
    accessProfiles(req, res, ids, () => {
      try { res.json(backups.importBackup(req.body.profileId, data, mode)); }
      catch (error) { res.status(409).json({ error: error.message }); }
    });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

app.post('/api/reset', bodyProfileAccess, (req, res) => {
  const { profileId } = req.body;
  if (!profileId) return res.status(400).json({ error: 'profileId erforderlich' });

  const txRunner = db.transaction(() => {
    db.prepare('DELETE FROM portable_fields WHERE profile_id = ?').run(profileId);
    db.prepare('DELETE FROM transactions WHERE profile_id = ?').run(profileId);
    db.prepare('DELETE FROM rules WHERE profile_id = ?').run(profileId);
    db.prepare('DELETE FROM categories WHERE profile_id = ?').run(profileId);
    db.prepare('DELETE FROM bank_templates WHERE profile_id = ?').run(profileId);
    db.prepare('DELETE FROM accounts WHERE profile_id = ?').run(profileId);

    seedProfileDefaults(profileId);
  });

  txRunner();
  res.json({ success: true });
});

// ----------------------------------------------------
// Serve Vite frontend build (production)
// ----------------------------------------------------
const DIST_DIR = path.join(process.cwd(), 'dist');
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

const PORT = process.env.PORT || 5052;
const HOST = process.env.HOST || '0.0.0.0';
const server = app.listen(PORT, HOST, error => {
  if (error) {
    console.error('Server konnte nicht gestartet werden:', error.message);
    process.exitCode = 1;
    return;
  }
  console.log(`Dagobert Central Server running at http://${HOST}:${server.address().port}`);
});
