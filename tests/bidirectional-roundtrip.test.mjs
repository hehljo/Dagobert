import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, request } from './helpers/server.mjs';
import { validateBackupPayload, normalizeBackupPayload, roundToCents } from '../src/data/backupSchema.ts';

test('Bidirektionaler Round-Trip: Docker -> JSON-Vertrag -> Docker & Schema-Konsistenz', async (t) => {
  const serverA = await startTestServer();
  const serverB = await startTestServer();

  t.after(async () => {
    await serverA.stop();
    await serverB.stop();
  });

  // 1. Synthetische Testdaten in Server A anlegen
  const profileId = 'privat';

  // Neues Konto mit Startsaldo & Checkpoint
  await request(serverA.url, `/api/accounts/comdirect`, 'PUT', {
    profileId,
    initialBalance: 1250.55,
    initialBalanceDate: '2026-01-01',
    checkpointBalance: 2450.80,
    checkpointDate: '2026-10-01'
  });

  // Eigene Kategorie
  const catRes = await request(serverA.url, '/api/categories', 'POST', {
    profileId,
    category: {
      id: 'hobbys',
      name: 'Hobbys & Freizeit',
      icon: 'Gamepad2',
      color: '#AF52DE',
      type: 'expense',
      budget: 150.00
    }
  });
  assert.equal(catRes.status, 200);

  // Eigene Regel
  const ruleRes = await request(serverA.url, '/api/rules', 'POST', {
    profileId,
    rule: {
      id: 'rule-steam-games',
      name: 'Steam Spiele',
      priority: 15,
      conditions: [{ field: 'payee', operator: 'contains', value: 'Steam' }],
      applyCategory: 'hobbys',
      enabled: true
    }
  });
  assert.equal(ruleRes.status, 200);

  // Mehrere Buchungen mit Umlauten, negativen & positiven Cent-Beträgen, gebucht & pending
  const testTxs = [
    {
      date: '2026-10-02',
      valutaDate: '2026-10-03',
      amount: -49.99,
      currency: 'EUR',
      payee: 'Steam Games Hamburg',
      purpose: 'Kauf: Retro Indie Adventure',
      rawText: 'Kartenzahlung Steam Games Hamburg',
      type: 'Kartenverfügung',
      category: 'hobbys',
      account: 'comdirect Girokonto',
      status: 'booked',
      sourceHash: 'tx_steam_test_01',
      importedAt: '2026-10-02T12:00:00.000Z'
    },
    {
      date: '2026-10-05',
      valutaDate: '2026-10-05',
      amount: 2800.50,
      currency: 'EUR',
      payee: 'Muster-Arbeitgeber AG München',
      purpose: 'Gehaltsabrechnung Oktober 2026 für Johannes',
      rawText: 'Überweisung Gehalt Oktober 2026',
      type: 'Überweisung',
      category: 'gehalt',
      account: 'comdirect Girokonto',
      status: 'booked',
      sourceHash: 'tx_salary_test_02',
      importedAt: '2026-10-05T08:00:00.000Z'
    },
    {
      date: '2026-10-06',
      amount: -18.75,
      currency: 'EUR',
      payee: 'Bäckerei Müller Augsburg',
      purpose: 'Frühstück & Kaffee',
      rawText: 'Kartenzahlung Bäckerei Müller',
      type: 'Kartenverfügung',
      category: 'lebensmittel',
      account: 'comdirect Girokonto',
      status: 'pending',
      sourceHash: 'tx_bakery_pending_03',
      importedAt: '2026-10-06T09:30:00.000Z'
    }
  ];

  const batchRes = await request(serverA.url, '/api/transactions/batch', 'POST', {
    profileId,
    transactions: testTxs
  });
  assert.equal(batchRes.status, 200);
  const batchData = await batchRes.json();
  assert.equal(batchData.inserted, 3);

  // ----------------------------------------------------
  // TEST A: Docker -> iOS -> Docker
  // ----------------------------------------------------
  // Schritt 1: Vollständigen Export aus Server A ziehen
  const exportResA = await request(serverA.url, `/api/backup?profileId=${profileId}`);
  assert.equal(exportResA.status, 200);
  const dockerExport = await exportResA.json();

  // Validierung prüfen
  const valResult = validateBackupPayload(dockerExport);
  assert.equal(valResult.valid, true, 'Docker Export muss valides Backup sein');
  assert.equal(valResult.summary?.transactionsCount, 3);
  assert.ok(valResult.summary?.accountsCount >= 1);
  assert.ok(valResult.summary?.templatesCount >= 1);

  // Schritt 2: Normalisierung in kanonisches iOS Format
  const iosPayload = normalizeBackupPayload(dockerExport, profileId);
  assert.equal(iosPayload.format, 'dagobert_backup');
  assert.equal(iosPayload.schemaVersion, 2);
  assert.equal(iosPayload.transactions.length, 3);

  // Prüfe Betragspräzision in Cents (kein Fließkomma-Drift)
  const txSteam = iosPayload.transactions.find(t => t.sourceHash === 'tx_steam_test_01');
  const txSalary = iosPayload.transactions.find(t => t.sourceHash === 'tx_salary_test_02');
  assert.ok(txSteam && txSalary);
  assert.equal(roundToCents(txSteam.amount), -49.99);
  assert.equal(roundToCents(txSalary.amount), 2800.50);

  // Schritt 3: Import auf frischer Docker-Instanz Server B
  const importResB = await request(serverB.url, '/api/backup/import', 'POST', {
    profileId,
    data: iosPayload
  });
  assert.equal(importResB.status, 200, 'Import in Server B muss erfolgreich sein');

  // Schritt 4: Server B exportieren und 1:1 vergleichen
  const exportResB = await request(serverB.url, `/api/backup?profileId=${profileId}`);
  assert.equal(exportResB.status, 200);
  const reExportB = await exportResB.json();

  // Transaktionen vergleichen
  assert.equal(reExportB.transactions.length, dockerExport.transactions.length);
  for (const origTx of dockerExport.transactions) {
    const match = reExportB.transactions.find(t => t.sourceHash === origTx.sourceHash);
    assert.ok(match, `Buchung mit Hash ${origTx.sourceHash} muss in Server B existieren`);
    assert.equal(match.amount, origTx.amount);
    assert.equal(match.payee, origTx.payee);
    assert.equal(match.purpose, origTx.purpose);
    assert.equal(match.category, origTx.category);
    assert.equal(match.status, origTx.status);
  }

  // Konten vergleichen
  const origAcc = dockerExport.accounts.find(a => a.id === 'comdirect');
  const bAcc = reExportB.accounts.find(a => a.id === 'comdirect');
  assert.ok(bAcc);
  assert.equal(bAcc.initialBalance, origAcc.initialBalance);
  assert.equal(bAcc.checkpointBalance, origAcc.checkpointBalance);
  assert.equal(bAcc.checkpointDate, origAcc.checkpointDate);

  // Bank-Templates vergleichen (Fix für den vormals bestehenden Restore-Bug!)
  assert.ok(reExportB.bankTemplates.length >= 1, 'Bank-Templates müssen nach Restore erhalten bleiben');
  const origTpl = dockerExport.bankTemplates.find(t => t.id === 'comdirect');
  const bTpl = reExportB.bankTemplates.find(t => t.id === 'comdirect');
  assert.ok(bTpl, 'comdirect Bankvorlage muss existieren');
  assert.equal(bTpl.name, origTpl.name);
  assert.equal(bTpl.encoding, origTpl.encoding);

  // ----------------------------------------------------
  // TEST B: Wiederholter Import & Merge-Idempotenz
  // ----------------------------------------------------
  // Erneuter Import desselben Bestands über /api/transactions/batch -> 0 neue Buchungen
  const reBatch = await request(serverB.url, '/api/transactions/batch', 'POST', {
    profileId,
    transactions: testTxs
  });
  const reBatchData = await reBatch.json();
  assert.equal(reBatchData.inserted, 0, 'Wiederholter Batch-Import darf keine Duplikate erzeugen');
  assert.equal(reBatchData.duplicates, 3, 'Alle 3 bereits vorhandenen Buchungen müssen als Duplikate erkannt werden');

  // ----------------------------------------------------
  // TEST C: Historische Legacy-Backups ohne Schema-Tag
  // ----------------------------------------------------
  const legacyBackup = {
    exportedAt: '2026-08-01T10:00:00.000Z',
    profileId: 'privat',
    profileName: 'Privat',
    accounts: [{ id: 'comdirect', name: 'Girokonto', initialBalance: 100, initialBalanceDate: '2026-01-01' }],
    categories: [{ id: 'lebensmittel', name: 'Lebensmittel', icon: 'ShoppingCart', color: '#30D158', type: 'expense' }],
    rules: [],
    transactions: [
      {
        date: '2026-07-15',
        amount: -25.50,
        currency: 'EUR',
        payee: 'Supermarkt',
        purpose: 'Einkauf',
        rawText: 'Supermarkt Einkauf',
        type: 'Kartenverfügung',
        category: 'lebensmittel',
        sourceHash: 'tx_legacy_01',
        importedAt: '2026-07-15T11:00:00.000Z'
      }
    ],
    bankTemplates: []
  };

  const legacyVal = validateBackupPayload(legacyBackup);
  assert.equal(legacyVal.valid, true, 'Alte Backups müssen valide bleiben');
  const legacyNorm = normalizeBackupPayload(legacyBackup);
  assert.equal(legacyNorm.format, 'dagobert_backup');
  assert.equal(legacyNorm.schemaVersion, 2);
  assert.equal(legacyNorm.transactions[0].amount, -25.50);
});
