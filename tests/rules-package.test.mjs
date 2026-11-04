import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, request } from './helpers/server.mjs';
import { createRulesPackage } from '../src/data/rulesPackage.ts';

test('Rules-only API import and rename preserve financial records, accounts, profiles and existing definitions', async () => {
  const server = await startTestServer();
  const api = (route, method, body, cookie) => request(server.url, route, method, body, cookie);
  try {
    const profile = await (await api('/api/profiles', 'POST', { name: 'Rules test' })).json();
    const id = profile.id;
    await api('/api/transactions/batch', 'POST', { profileId: id, transactions: [{ date: '2026-11-01', amount: -12.34,
      currency: 'EUR', payee: 'Synthetic', purpose: 'Eigene Notiz', rawText: 'Test', type: 'Bar', category: 'sonstiges',
      account: 'comdirect Girokonto', sourceHash: 'tx_rules_test', status: 'booked' }] });
    const before = await (await api(`/api/data?profileId=${id}`)).json();
    const source = createRulesPackage([{ id: 'sonstiges', name: 'Meine manuelle Kategorie', icon: 'Tag', color: '#123456', type: 'expense' }],
      [{ id: 'custom-rule', name: 'Testregel', priority: 4, enabled: true, conditions: [{ field: 'payee', operator: 'contains', value: 'Synthetic' }], applyCategory: 'sonstiges' }]);
    const result = await (await api('/api/rules/import', 'POST', { profileId: id, data: source })).json();
    assert.equal(result.categoriesAdded, 1); assert.equal(result.rulesAdded, 1);
    const after = await (await api(`/api/data?profileId=${id}`)).json();
    assert.deepEqual(after.transactions, before.transactions); assert.deepEqual(after.accounts, before.accounts); assert.deepEqual(after.profile, before.profile);
    for (const c of before.categories) assert.deepEqual(after.categories.find(item => item.id === c.id), c);
    const imported = after.rules.find(r => r.id === 'custom-rule');
    assert.notEqual(imported.applyCategory, 'sonstiges');
    assert.equal(after.categories.find(c => c.id === imported.applyCategory).name, 'Meine manuelle Kategorie');
    const repeated = await (await api('/api/rules/import', 'POST', { profileId: id, data: source })).json();
    assert.equal(repeated.categoriesAdded, 0); assert.equal(repeated.rulesAdded, 0);
    const bad = { ...source, rules: [{ ...source.rules[0], applyCategory: 'missing' }] };
    assert.equal((await api('/api/rules/import', 'POST', { profileId: id, data: bad })).status, 400);
    assert.deepEqual(await (await api(`/api/data?profileId=${id}`)).json(), after);
    assert.equal((await api(`/api/profiles/${id}`, 'PUT', { name: ' Neuer Profilname ' })).status, 200);
    const renamed = await (await api(`/api/data?profileId=${id}`)).json();
    assert.equal(renamed.profile.id, id); assert.equal(renamed.profile.name, 'Neuer Profilname');
    assert.deepEqual(renamed.transactions, after.transactions); assert.deepEqual(renamed.accounts, after.accounts);
    assert.equal((await api(`/api/profiles/${id}`, 'PUT', { name: ' ' })).status, 400);
    const locked = await (await api('/api/profiles', 'POST', { name: 'Protected rules test', pin: '1234' })).json();
    assert.equal((await api('/api/rules/import', 'POST', { profileId: locked.id, data: source })).status, 401);
    assert.equal((await api(`/api/profiles/${locked.id}`, 'PUT', { name: 'Forbidden' })).status, 401);
  } finally { await server.stop(); }
});
