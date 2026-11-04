import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { startTestServer, request } from '../helpers/server.mjs';
import { normalizeBackupPayload, validateBackupPayload, backupProfiles } from '../../src/data/backupSchema.ts';
import { stableIdentity } from '../../src/data/identity.ts';
import { parseBankCsv } from '../../src/lib/csvParser.ts';
import { COMDIRECT_TEMPLATE } from '../../src/data/defaults.ts';
import { calculateRealAccountBalance } from '../../src/lib/db.ts';
import { calculateStatistics } from '../../src/lib/statistics.ts';

const directory = process.env.DAGOBERT_PORTABLE_DIR;
const binary = process.env.DAGOBERT_NATIVE_RUNNER;
const cases = {};
function runNative(args) {
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
function canonical(payload) {
  const clean = value => {
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
      .filter(k => value[k] !== undefined)
      .map(k => [k, clean(value[k])]));
    return value;
  };
  return backupProfiles(normalizeBackupPayload(payload)).sort((a, b) => a.profileId.localeCompare(b.profileId)).map(profile => {
    const { includedCollections: _included, ...data } = profile;
    const entities = key => profile[key].map(clean).sort((a, b) => a.id.localeCompare(b.id));
    return { ...clean(data), accounts: entities('accounts'), categories: entities('categories'), rules: entities('rules'),
      bankTemplates: entities('bankTemplates'), syncConflicts: clean(profile.syncConflicts ?? []),
      // Only the local transaction ID may differ. Preserve nested IDs and timestamps.
      transactions: profile.transactions.map(({ id: _id, ...tx }) => clean(tx)).sort((a, b) => a.syncId.localeCompare(b.syncId)) };
  });
}
function assertFinancialResults(payload) {
  const profiles = backupProfiles(normalizeBackupPayload(payload));
  const root = profiles[0];
  assert.equal(calculateRealAccountBalance(root.accounts.find(a => a.id === 'comdirect'), root.transactions), -12.34);
  const totals = calculateStatistics(root.transactions, root.categories, { year: 2026 });
  assert.deepEqual([totals.income, totals.expense, totals.net], [0, 12.34, -12.34]);
  const second = profiles[1];
  assert.equal(calculateRealAccountBalance(second.accounts.find(a => a.id === 'comdirect'), second.transactions), 987.65);
  const secondTotals = calculateStatistics(second.transactions, second.categories, { year: 2026 });
  assert.deepEqual([secondTotals.income, secondTotals.expense, secondTotals.net], [987.65, 0, 987.65]);
}
async function ok(url, path, method = 'GET', data, cookie) {
  const response = await request(url, path, method, data, cookie);
  const result = await response.json();
  assert.equal(response.status, 200, `${method} ${path}: ${JSON.stringify(result)}`);
  return result;
}

test('Portable contract: real Docker and production Swift SQLite, synthetic data only', async () => {
  assert.ok(directory && binary, 'Use npm run test:portable; native persistence must not be mocked');
  const project = readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8');
  const file = project.match(/([A-F0-9]{24}) \/\* DocumentInbox.swift \*\/ = \{isa = PBXFileReference;/)?.[1];
  assert.ok(file);
  const build = project.match(new RegExp(`([A-F0-9]{24}) /\\* DocumentInbox.swift in Sources \\*/ = \\{isa = PBXBuildFile; fileRef = ${file}`))?.[1];
  assert.ok(build);
  const phases = project.match(/\/\* Begin PBXSourcesBuildPhase section \*\/[\s\S]*?\/\* End PBXSourcesBuildPhase section \*\//)?.[0];
  assert.ok(phases?.includes(`${build} /* DocumentInbox.swift in Sources */`), 'Inbox must be part of the App source target');
  cases.native_inbox_target_membership = true;
  // Opt-in source policies for this Capacitor shell; no OS authentication claim.
  const scene = readFileSync('ios/App/App/SceneDelegate.swift', 'utf8');
  const unlock = scene.slice(scene.indexOf('@objc private func unlock('), scene.indexOf('func scene(_ scene: UIScene, openURLContexts'));
  const reloadsOnUnlock = value => /webView\??\s*\.reload\s*\(/.test(value.replace(/\/\/[^\n]*/g, ''));
  assert.ok(unlock.startsWith('@objc private func unlock('));
  assert.equal(reloadsOnUnlock(unlock), false);
  assert.equal(reloadsOnUnlock(unlock.replace('reveal()', 'reveal(); webView?.reload()')), true);
  cases.native_unlock_keeps_webview_source_policy = true;
  const plugin = readFileSync('ios/App/App/DagobertPlugin.swift', 'utf8');
  const guarded = plugin.slice(plugin.indexOf('private func perform('), plugin.indexOf('private func required('));
  const accessBeforeDatabase = value => value.indexOf('try SecurityManager.shared.requireAppAccess()') >= 0 &&
    value.indexOf('try SecurityManager.shared.requireAppAccess()') < value.indexOf('let db =');
  assert.equal(accessBeforeDatabase(guarded), true);
  assert.equal(accessBeforeDatabase(guarded.replace('try SecurityManager.shared.requireAppAccess()', '')), false);
  cases.native_bridge_guard_source_policy = true;
  const config = readFileSync('capacitor.config.ts', 'utf8'), header = readFileSync('src/components/Navbar.tsx', 'utf8');
  const css = readFileSync('src/glass-theme.css', 'utf8');
  const safeAreaSingleOwner = (configuration, style) => /contentInset:\s*['"]never['"]/.test(configuration) &&
    [...style.matchAll(/\.glass-dock\s*\{([^{}]*)\}/g)].every(([, body]) =>
      !(/margin[^;]*env\(safe-area-inset-bottom/.test(body) && /padding-bottom[^;]*env\(safe-area-inset-bottom/.test(body)));
  assert.ok(header.includes('env(safe-area-inset-top'));
  assert.equal(safeAreaSingleOwner(config, css), true);
  assert.equal(safeAreaSingleOwner(config.replace("contentInset: 'never'", "contentInset: 'automatic'"), css), false);
  assert.equal(safeAreaSingleOwner(config, css.replace('padding-bottom: 6px;', 'padding-bottom: env(safe-area-inset-bottom, 0px);')), false);
  cases.native_safe_area_single_owner_source_policy = true;
  mkdirSync(directory, { recursive: true });
  const vectors = [['record:privat:transactions', 'abc'], ['ÄÖÜ namespace', 'Überweisung €'], ['', ''], ['transaction:privat', 'import:comdirect:test:2']]
    .map(([namespace, value]) => ({ namespace, value, expected: stableIdentity(namespace, value) }));
  writeFileSync(join(directory, 'identity-vectors.json'), JSON.stringify(vectors));
  runNative(['selftest', directory]);
  Object.assign(cases, JSON.parse(readFileSync(join(directory, 'native-result.json'), 'utf8')).cases);
  const a = await startTestServer(), b = await startTestServer();
  let complete = false;
  try {
    const second = await ok(a.url, '/api/profiles', 'POST', { name: 'Synthetisch Zweitprofil', color: '#AA33CC', icon: 'Wallet' });
    await ok(a.url, '/api/transactions', 'POST', { profileId: 'privat', transaction: {
      date: '2026-11-01', valutaDate: '2026-11-02', amount: -12.34, currency: 'EUR', payee: '', purpose: 'Prüfdaten', rawText: '',
      type: 'Bar', category: 'sonstiges', subcategory: '', tags: ['synthetisch', 'ÄÖÜ'], account: 'comdirect Girokonto',
      status: 'pending', sourceHash: 'identical-fingerprint', extensionField: { preserved: true, id: 'nested-id', createdAt: '2020-01-01', syncConflicts: { preserved: true } }
    } });
    await ok(a.url, '/api/transactions', 'POST', { profileId: 'privat', transaction: {
      date: '2026-11-01', amount: -12.34, currency: 'EUR', payee: 'Tatsächlich zweite Buchung', purpose: 'Prüfdaten', rawText: '',
      type: 'Bar', category: 'sonstiges', account: 'comdirect Girokonto', status: 'booked', sourceHash: 'identical-fingerprint'
    } });
    await ok(a.url, '/api/transactions', 'POST', { profileId: second.id, transaction: {
      date: '2026-10-31', amount: 987.65, currency: 'EUR', payee: 'Zweitprofil', purpose: '', rawText: '', type: 'Bar', category: 'gehalt', account: 'comdirect Girokonto', sourceHash: 'second-profile'
    } });
    await ok(a.url, '/api/rules', 'POST', { profileId: 'privat', rule: {
      id: 'zero-priority', name: 'Deaktivierte Regel', priority: 0, enabled: false, conditions: [{ field: 'payee', operator: 'contains', value: 'ÄÖÜ' }],
      applyCategory: 'sonstiges', applySubcategory: '', applyTags: ['Prüfung'], futureRuleOption: { preserve: 42 }
    } });
    await ok(a.url, '/api/accounts/comdirect', 'PUT', { profileId: 'privat', initialBalance: 123.45, initialBalanceDate: '2026-01-01', checkpointBalance: 0, checkpointDate: '2026-10-31' });
    const original = await ok(a.url, '/api/backup?profileId=privat&allProfiles=true');
    assertFinancialResults(original);
    assert.equal(original.additionalProfiles.length, 1);
    assert.equal(original.additionalProfiles[0].transactions.length, 1);
    assert.equal(original.transactions.length, 2);
    assert.notEqual(original.transactions[0].syncId, original.transactions[1].syncId);
    cases.complete_multi_profile_backup = true;
    const input = join(directory, 'docker-original.json'), output = join(directory, 'native-export.json');
    writeFileSync(input, JSON.stringify(original));
    const nativeDirectory = join(directory, 'roundtrip-a'); mkdirSync(nativeDirectory);
    runNative(['roundtrip', nativeDirectory, input, output]);
    const native = JSON.parse(readFileSync(output, 'utf8'));
    assert.deepEqual(canonical(native), canonical(original));
    assertFinancialResults(native);
    cases.docker_native_roundtrip = true;
    await ok(b.url, '/api/backup/import', 'POST', { profileId: 'privat', data: native, mode: 'replace' });
    const fromB = await ok(b.url, '/api/backup?profileId=privat&allProfiles=true');
    assert.deepEqual(canonical(fromB), canonical(original));
    assertFinancialResults(fromB);
    cases.independent_balance_and_statistics = true;
    cases.native_docker_roundtrip = true;
    const reverseInput = join(directory, 'docker-reexport.json'), reverseOutput = join(directory, 'native-reimport.json');
    writeFileSync(reverseInput, JSON.stringify(fromB));
    const reverseDirectory = join(directory, 'roundtrip-b'); mkdirSync(reverseDirectory);
    runNative(['roundtrip', reverseDirectory, reverseInput, reverseOutput]);
    assert.deepEqual(canonical(JSON.parse(readFileSync(reverseOutput, 'utf8'))), canonical(original));
    cases.reverse_native_roundtrip = true;
    await ok(b.url, '/api/backup/import', 'POST', { profileId: 'privat', data: native, mode: 'merge' });
    await ok(b.url, '/api/backup/import', 'POST', { profileId: 'privat', data: native, mode: 'merge' });
    assert.deepEqual(canonical(await ok(b.url, '/api/backup?profileId=privat&allProfiles=true')), canonical(original));
    cases.merge_idempotent_all_entities = true;
    cases.equal_fingerprints_keep_distinct_bookings = true;
    cases.optional_and_unknown_fields_preserved = true;
    const conflicting = structuredClone(native); conflicting.transactions[0].amount = -900;
    const beforeConflict = canonical(await ok(b.url, '/api/backup?profileId=privat&allProfiles=true'));
    const conflictResponse = await request(b.url, '/api/backup/import', 'POST', { profileId: 'privat', data: conflicting, mode: 'merge' });
    assert.equal(conflictResponse.status, 409);
    assert.deepEqual(canonical(await ok(b.url, '/api/backup?profileId=privat&allProfiles=true')), beforeConflict);
    cases.merge_conflict_rolls_back = true;
    const nestedConflict = structuredClone(native);
    nestedConflict.transactions.find(t => t.extensionField).extensionField.id = 'changed-nested-id';
    assert.equal((await request(b.url, '/api/backup/import', 'POST', { profileId: 'privat', data: nestedConflict, mode: 'merge' })).status, 409);
    assert.deepEqual(canonical(await ok(b.url, '/api/backup?profileId=privat&allProfiles=true')), beforeConflict);
    cases.nested_unknown_field_merge_conflict = true;
    for (const corrupt of [
      { ...native, schemaVersion: 999 },
      { ...native, rules: [{ id: 'broken', conditions: '{broken' }] },
      { ...native, transactions: [{ ...native.transactions[0], date: '2026-02-30' }] },
      { ...native, transactions: [{ ...native.transactions[0], amount: 1.005 }] },
      { ...native, transactions: [{ ...native.transactions[0], amount: '12.34' }] },
      { ...native, accounts: 'invalid' },
      { ...native, accounts: [] },
      { ...native, includedCollections: ['transactions'] }
    ]) {
      assert.equal(validateBackupPayload(corrupt).valid, false);
      assert.equal((await request(b.url, '/api/backup/import', 'POST', { profileId: 'privat', data: corrupt })).status, 400);
    }
    assert.deepEqual(canonical(await ok(b.url, '/api/backup?profileId=privat&allProfiles=true')), beforeConflict);
    cases.invalid_backup_leaves_store_unchanged = true;
    assert.equal((await request(b.url, '/api/backup/import', 'POST', { profileId: native.additionalProfiles[0].profileId, data: native, mode: 'replace' })).status, 409);
    const emptyCollision = structuredClone(native);
    for (const profile of [emptyCollision, ...emptyCollision.additionalProfiles]) {
      for (const collection of ['accounts', 'categories', 'rules', 'transactions', 'bankTemplates']) profile[collection] = [];
      profile.includedCollections = [];
    }
    assert.equal((await request(b.url, '/api/backup/import', 'POST', { profileId: native.additionalProfiles[0].profileId, data: emptyCollision, mode: 'merge' })).status, 409);
    assert.deepEqual(canonical(await ok(b.url, '/api/backup?profileId=privat&allProfiles=true')), beforeConflict);
    cases.multi_profile_target_collision_rejected = true;
    const pinned1 = await ok(a.url, '/api/profiles', 'POST', { name: 'Geschützt A', pin: '1357' });
    const pinned2 = await ok(a.url, '/api/profiles', 'POST', { name: 'Geschützt B', pin: '2468' });
    assert.equal((await request(a.url, '/api/backup?profileId=privat&allProfiles=true')).status, 401);
    const unlock1 = await request(a.url, `/api/profiles/${pinned1.id}/unlock`, 'POST', { pin: '1357' });
    const cookie1 = unlock1.headers.get('set-cookie').split(';')[0];
    assert.equal((await request(a.url, '/api/backup?profileId=privat&allProfiles=true', 'GET', undefined, cookie1)).status, 401);
    const unlock2 = await request(a.url, `/api/profiles/${pinned2.id}/unlock`, 'POST', { pin: '2468' }, cookie1);
    const cookie2 = unlock2.headers.get('set-cookie').split(';')[0];
    const protectedExport = await ok(a.url, '/api/backup?profileId=privat&allProfiles=true', 'GET', undefined, cookie2);
    assert.equal(protectedExport.profiles.length, 4);
    assert.ok(!JSON.stringify(protectedExport).includes('pin_hash'));
    cases.full_backup_requires_all_profile_grants = true;
    const partial = { accounts: [], categories: [], rules: [], transactions: [], bankTemplates: [], profileId: 'privat', profileName: 'Leer' };
    await ok(b.url, '/api/backup/import', 'POST', { profileId: 'privat', data: partial, mode: 'replace' });
    const empty = await ok(b.url, '/api/backup?profileId=privat');
    for (const key of ['accounts', 'categories', 'rules', 'transactions', 'bankTemplates']) assert.equal(empty[key].length, 0);
    const recoveries = await ok(b.url, '/api/backup/recovery?profileId=privat');
    assert.ok(recoveries.backups.length >= 2);
    const recovery = await ok(b.url, `/api/backup/recovery/${recoveries.backups.at(-1).id}?profileId=privat`);
    assert.equal(recovery.transactions.length, 2);
    cases.empty_replace_and_recovery_backup = true;
    const legacy = { profileId: 'privat', profileName: 'Legacy', rules: [{ id: 'legacy', name: 'Legacy', priority: 0, conditions: '[]', apply_category: 'sonstiges', enabled: 0 }] };
    const migrated = normalizeBackupPayload(legacy);
    assert.equal(migrated.rules[0].priority, 0); assert.equal(migrated.rules[0].enabled, false);
    await ok(b.url, '/api/backup/import', 'POST', { profileId: 'privat', data: migrated, mode: 'replace' });
    cases.legacy_partial_backup_migration = true;
    const csv = '"Buchungstag";"Wertstellung (Valuta)";"Vorgang";"Buchungstext";"Umsatz in EUR"\n' +
      Array(2).fill('"01.11.2026";"01.11.2026";"Bar";"Testladen";"-12,34"').join('\n');
    const parsed = parseBankCsv(csv, COMDIRECT_TEMPLATE);
    assert.equal(parsed.length, 2); assert.notEqual(parsed[0].sourceHash, parsed[1].sourceHash);
    const again = parseBankCsv(csv, COMDIRECT_TEMPLATE, new Set(parsed.map(t => t.sourceHash)));
    assert.ok(again.every(t => t.isDuplicate));
    cases.csv_identical_occurrences_repeat_safely = true;
    const conflictBackup = JSON.parse(readFileSync(join(directory, 'conflict-backup.json'), 'utf8'));
    await ok(b.url, '/api/backup/import', 'POST', { profileId: 'privat', data: conflictBackup, mode: 'replace' });
    const conflictReexport = await ok(b.url, '/api/backup?profileId=privat');
    assert.deepEqual(conflictReexport.syncConflicts, conflictBackup.syncConflicts);
    const conflictPath = join(directory, 'docker-conflict-backup.json');
    writeFileSync(conflictPath, JSON.stringify(conflictReexport));
    const conflictDir = join(directory, 'conflict-restore'); mkdirSync(conflictDir);
    runNative(['verify-conflicts', conflictDir, conflictPath]);
    cases.conflict_backup_docker_native_restore = true;
    const corruptConflict = structuredClone(conflictBackup);
    corruptConflict.syncConflicts[0].versions[0].profileId = 'foreign-profile';
    assert.equal(validateBackupPayload(corruptConflict).valid, false);
    assert.equal((await request(b.url, '/api/backup/import', 'POST', { profileId: 'privat', data: corruptConflict, mode: 'replace' })).status, 400);
    assert.deepEqual(canonical(await ok(b.url, '/api/backup?profileId=privat')), canonical(conflictReexport));
    cases.invalid_conflict_backup_rejected = true;
    const invalidCurrent = structuredClone(conflictBackup);
    invalidCurrent.syncConflicts[0].current.data.amount = 111.11;
    assert.equal(validateBackupPayload(invalidCurrent).valid, false);
    complete = true;
  } finally {
    await a.stop(); await b.stop();
    writeFileSync(join(directory, 'combined-result.json'), JSON.stringify({ version: 1, checks: Object.keys(cases).length, failures: complete ? 0 : 1, cases }));
  }
});
