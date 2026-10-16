import express from 'express';
import path from 'path';
import fs from 'fs';
import { db, initDatabase, seedProfileDefaults, hashPinServer } from './db.js';

initDatabase();

const app = express();
app.use(express.json({ limit: '10mb' }));

// CORS headers for local/Tailscale access
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Helper: check profile exists
function getProfile(profileId) {
  return db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
}

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

app.put('/api/profiles/:id', (req, res) => {
  const { id } = req.params;
  const { name, icon, color, pin, removePin } = req.body;
  const profile = getProfile(id);
  if (!profile) return res.status(404).json({ error: 'Profil nicht gefunden' });

  let pinHash = profile.pin_hash;
  if (removePin) {
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
  `).run(name, icon, color, pinHash, id);

  res.json({ success: true, hasPin: !!pinHash });
});

app.delete('/api/profiles/:id', (req, res) => {
  const { id } = req.params;
  const total = db.prepare('SELECT count(*) as count FROM profiles').get().count;
  if (total <= 1) {
    return res.status(400).json({ error: 'Das letzte Profil kann nicht gelöscht werden' });
  }

  db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
  res.json({ success: true });
});

app.post('/api/profiles/:id/unlock', (req, res) => {
  const { id } = req.params;
  const { pin } = req.body;
  const profile = getProfile(id);
  if (!profile) return res.status(404).json({ error: 'Profil nicht gefunden' });

  if (!profile.pin_hash) {
    return res.json({ success: true });
  }

  const hashed = hashPinServer(pin);
  if (hashed === profile.pin_hash) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Falsche PIN' });
  }
});

// ----------------------------------------------------
// Data Endpoint (Full State for active profile)
// ----------------------------------------------------

app.get('/api/data', (req, res) => {
  const profileId = req.query.profileId || 'privat';
  const profile = getProfile(profileId);
  if (!profile) return res.status(404).json({ error: 'Profil nicht gefunden' });

  const accounts = db.prepare('SELECT * FROM accounts WHERE profile_id = ?').all(profileId).map(a => ({
    id: a.id,
    name: a.name,
    iban: a.iban,
    initialBalance: a.initial_balance,
    initialBalanceDate: a.initial_balance_date,
    checkpointBalance: a.checkpoint_balance !== null ? a.checkpoint_balance : undefined,
    checkpointDate: a.checkpoint_date || undefined
  }));

  const categories = db.prepare('SELECT * FROM categories WHERE profile_id = ?').all(profileId).map(c => ({
    id: c.id,
    name: c.name,
    icon: c.icon,
    color: c.color,
    type: c.type,
    budget: c.budget !== null ? c.budget : undefined
  }));

  const rules = db.prepare('SELECT * FROM rules WHERE profile_id = ? ORDER BY priority ASC').all(profileId).map(r => ({
    id: r.id,
    name: r.name,
    priority: r.priority,
    conditions: JSON.parse(r.conditions),
    applyCategory: r.apply_category,
    enabled: !!r.enabled
  }));

  const transactions = db.prepare('SELECT * FROM transactions WHERE profile_id = ? ORDER BY date DESC, id DESC').all(profileId).map(t => ({
    id: t.id,
    date: t.date,
    valutaDate: t.valuta_date || undefined,
    amount: t.amount,
    currency: t.currency,
    payee: t.payee,
    purpose: t.purpose,
    rawText: t.raw_text,
    type: t.type,
    category: t.category,
    account: t.account,
    status: t.status,
    sourceHash: t.source_hash,
    importedAt: t.imported_at
  }));

  const bankTemplates = db.prepare('SELECT * FROM bank_templates WHERE profile_id = ?').all(profileId).map(bt => ({
    id: bt.id,
    name: bt.name,
    description: bt.description,
    encoding: bt.encoding,
    delimiter: bt.delimiter,
    headerIdentifier: bt.header_identifier,
    columns: JSON.parse(bt.columns),
    textParser: bt.text_parser,
    dateFormat: bt.date_format
  }));

  res.json({
    profile: {
      id: profile.id,
      name: profile.name,
      icon: profile.icon,
      color: profile.color,
      hasPin: !!profile.pin_hash
    },
    accounts,
    categories,
    rules,
    transactions,
    bankTemplates
  });
});

// ----------------------------------------------------
// Transactions Endpoints
// ----------------------------------------------------

app.post('/api/transactions/batch', (req, res) => {
  const { profileId, transactions = [], accountCheckpoint } = req.body;
  if (!profileId) return res.status(400).json({ error: 'profileId erforderlich' });

  const existing = db.prepare('SELECT id, date, amount, payee, account, status, source_hash FROM transactions WHERE profile_id = ?').all(profileId);
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
    // 1. Account Checkpoint update if provided and newer
    if (accountCheckpoint?.newBalance !== undefined && accountCheckpoint?.endDate) {
      const acc = db.prepare('SELECT checkpoint_date FROM accounts WHERE id = ? AND profile_id = ?').get('comdirect', profileId);
      if (acc) {
        if (!acc.checkpoint_date || accountCheckpoint.endDate >= acc.checkpoint_date) {
          updateCheckpoint.run(
            accountCheckpoint.newBalance,
            accountCheckpoint.endDate,
            accountCheckpoint.iban || null,
            'comdirect',
            profileId
          );
        }
      }
    }

    // 2. Insert or promote transactions
    const now = new Date().toISOString();
    for (const t of transactions) {
      // Priority 1: If an identical booked hash already exists, it is a duplicate!
      if (existingHashes.has(t.sourceHash)) {
        skippedDuplicates++;
        continue;
      }

      // Priority 2: Check account-scoped and payee-scoped pending promotions
      const accountName = t.account || 'comdirect Girokonto';
      const key = `${t.date}|${Number(t.amount).toFixed(2)}|${t.payee.trim().toLowerCase()}|${accountName}`;
      const pendingList = pendingQueue.get(key);

      if (pendingList && pendingList.length > 0 && t.status === 'booked') {
        const target = pendingList.shift();
        updatePending.run(t.rawText, t.type, t.sourceHash, target.id);
        existingHashes.add(t.sourceHash);
        updatedCount++;
      } else {
        insertTx.run(
          profileId,
          t.date,
          t.valutaDate || null,
          Number(t.amount),
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
        existingHashes.add(t.sourceHash);
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

app.post('/api/transactions', (req, res) => {
  const { profileId, transaction } = req.body;
  if (!profileId || !transaction) return res.status(400).json({ error: 'Daten unvollständig' });

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

  res.json({ id: info.lastInsertRowid });
});

app.put('/api/transactions/:id', (req, res) => {
  const { id } = req.params;
  const { transaction } = req.body;
  if (!transaction) return res.status(400).json({ error: 'Keine Daten' });

  const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Buchung nicht gefunden' });

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

  res.json({ success: true });
});

app.delete('/api/transactions/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
  res.json({ success: true });
});

app.put('/api/accounts/:id', (req, res) => {
  const { id } = req.params;
  const { profileId, initialBalance, initialBalanceDate } = req.body;

  db.prepare(`
    UPDATE accounts
    SET initial_balance = COALESCE(?, initial_balance),
        initial_balance_date = COALESCE(?, initial_balance_date)
    WHERE id = ? AND profile_id = ?
  `).run(initialBalance, initialBalanceDate, id, profileId);

  res.json({ success: true });
});

app.post('/api/rules', (req, res) => {
  const { profileId, rule } = req.body;
  if (!profileId || !rule) return res.status(400).json({ error: 'Daten fehlen' });

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

  res.json({ success: true });
});

app.delete('/api/rules/:id', (req, res) => {
  const { id } = req.params;
  const profileId = req.query.profileId;
  if (profileId) {
    db.prepare('DELETE FROM rules WHERE id = ? AND profile_id = ?').run(id, profileId);
  } else {
    db.prepare('DELETE FROM rules WHERE id = ?').run(id);
  }
  res.json({ success: true });
});


// ----------------------------------------------------
// Server-Side Backup & Restore Endpoints
// ----------------------------------------------------
app.get('/api/backup', (req, res) => {
  const profileId = req.query.profileId || 'privat';
  const profile = getProfile(profileId);
  if (!profile) return res.status(404).json({ error: 'Profil nicht gefunden' });

  const accounts = db.prepare('SELECT * FROM accounts WHERE profile_id = ?').all(profileId);
  const categories = db.prepare('SELECT * FROM categories WHERE profile_id = ?').all(profileId);
  const rules = db.prepare('SELECT * FROM rules WHERE profile_id = ?').all(profileId).map(r => ({
    ...r,
    conditions: JSON.parse(r.conditions),
    applyCategory: r.apply_category,
    enabled: !!r.enabled
  }));
  const transactions = db.prepare('SELECT * FROM transactions WHERE profile_id = ?').all(profileId);
  const bankTemplates = db.prepare('SELECT * FROM bank_templates WHERE profile_id = ?').all(profileId).map(bt => ({
    ...bt,
    columns: JSON.parse(bt.columns)
  }));

  res.json({
    exportedAt: new Date().toISOString(),
    profileId,
    profileName: profile.name,
    accounts,
    categories,
    rules,
    transactions,
    bankTemplates
  });
});

app.post('/api/backup/import', (req, res) => {
  const { profileId, data } = req.body;
  if (!profileId || !data) return res.status(400).json({ error: 'Daten unvollständig' });

  const profile = getProfile(profileId);
  if (!profile) return res.status(404).json({ error: 'Profil nicht gefunden' });

  const txRunner = db.transaction(() => {
    // Clear profile transactions and rules
    db.prepare('DELETE FROM transactions WHERE profile_id = ?').run(profileId);
    db.prepare('DELETE FROM rules WHERE profile_id = ?').run(profileId);

    if (Array.isArray(data.transactions)) {
      const insertTx = db.prepare(`
        INSERT INTO transactions (
          profile_id, date, valuta_date, amount, currency, payee, purpose,
          raw_text, type, category, account, status, source_hash, imported_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const t of data.transactions) {
        insertTx.run(
          profileId,
          t.date,
          t.valutaDate || null,
          Number(t.amount),
          t.currency || 'EUR',
          t.payee || 'Unbekannt',
          t.purpose || '',
          t.rawText || '',
          t.type || '',
          t.category || 'sonstiges',
          t.account || 'comdirect Girokonto',
          t.status || 'booked',
          t.sourceHash || ('tx_' + Date.now().toString(36)),
          t.importedAt || new Date().toISOString()
        );
      }
    }

    if (Array.isArray(data.rules)) {
      const insertRule = db.prepare(`
        INSERT INTO rules (id, profile_id, name, priority, conditions, apply_category, enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const r of data.rules) {
        insertRule.run(
          r.id,
          profileId,
          r.name,
          r.priority || 20,
          typeof r.conditions === 'string' ? r.conditions : JSON.stringify(r.conditions || []),
          r.applyCategory || r.apply_category || 'sonstiges',
          r.enabled ? 1 : 0
        );
      }
    }

    if (Array.isArray(data.accounts) && data.accounts.length > 0) {
      const updateAcc = db.prepare(`
        UPDATE accounts
        SET initial_balance = ?,
            initial_balance_date = ?,
            checkpoint_balance = ?,
            checkpoint_date = ?
        WHERE id = ? AND profile_id = ?
      `);
      for (const a of data.accounts) {
        updateAcc.run(
          a.initialBalance || a.initial_balance || 0,
          a.initialBalanceDate || a.initial_balance_date || '2026-01-01',
          a.checkpointBalance !== undefined ? a.checkpointBalance : (a.checkpoint_balance !== undefined ? a.checkpoint_balance : null),
          a.checkpointDate || a.checkpoint_date || null,
          a.id || 'comdirect',
          profileId
        );
      }
    }
  });

  txRunner();
  res.json({ success: true });
});

app.post('/api/reset', (req, res) => {
  const { profileId } = req.body;
  if (!profileId) return res.status(400).json({ error: 'profileId erforderlich' });

  const txRunner = db.transaction(() => {
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
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Dagobert Central Server running at http://0.0.0.0:${PORT}`);
});
