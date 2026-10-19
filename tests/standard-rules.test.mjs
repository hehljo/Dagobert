import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../src/lib/standardRules.json' with { type: 'json' };
import { startTestServer, request } from './helpers/server.mjs';
import { NEW_MERCHANT_PRESET_IDS } from './helpers/presets.mjs';

test('Standard presets: new profiles, legacy updates, customizations, idempotency and profile authorization', async () => {
  const server = await startTestServer();
  const api = (route, method, body, cookie) => request(server.url, route, method, body, cookie);
  const data = async id => (await api(`/api/data?profileId=${id}`)).json();
  try {
    const { id } = await (await api('/api/profiles', 'POST', { name: 'Preset Test' })).json();
    assert.deepEqual((await data(id)).rules.toSorted((a, b) => a.id.localeCompare(b.id)), catalog.rules.toSorted((a, b) => a.id.localeCompare(b.id)));
    const otherBefore = await data('privat');
    const save = rule => api('/api/rules', 'POST', { profileId: id, rule });
    for (const ruleId of NEW_MERCHANT_PRESET_IDS) {
      assert.equal((await api(`/api/rules/${ruleId}?profileId=${id}`, 'DELETE')).status, 200);
    }
    await save({ ...catalog.previousVersions[0], enabled: false });
    const customized = { ...catalog.rules.find(r => r.id === 'rule-abos'), name: 'Meine Abos', enabled: false };
    await save(customized);
    const own = { ...catalog.rules[0], id: 'own-rule', name: 'Meine eigene Regel', priority: 5 };
    await save(own);
    assert.deepEqual(await (await api('/api/rules/defaults', 'POST', { profileId: id })).json(), { inserted: 3, updated: 1 });
    const updated = await data(id);
    assert.deepEqual(updated.rules.find(r => r.id === 'rule-drogerie'), { ...catalog.rules.find(r => r.id === 'rule-drogerie'), enabled: false });
    assert.deepEqual(updated.rules.find(r => r.id === customized.id), customized);
    assert.deepEqual(updated.rules.find(r => r.id === own.id), own);
    assert.deepEqual(await (await api('/api/rules/defaults', 'POST', { profileId: id })).json(), { inserted: 0, updated: 0 });
    // A changed legacy definition must not be replaced just because its ID is a preset ID.
    const customLegacy = { ...catalog.previousVersions[0], conditions: [{ field: 'rawText', operator: 'contains', value: 'MEINE APOTHEKE' }] };
    await save(customLegacy);
    await api('/api/rules/defaults', 'POST', { profileId: id });
    assert.deepEqual((await data(id)).rules.find(r => r.id === customLegacy.id), customLegacy);
    assert.deepEqual(await data('privat'), otherBefore);

    const protectedProfile = await (await api('/api/profiles', 'POST', { name: 'Protected presets', pin: '2468' })).json();
    assert.equal((await api('/api/rules/defaults', 'POST', { profileId: protectedProfile.id })).status, 401);
    const session = await api(`/api/profiles/${protectedProfile.id}/unlock`, 'POST', { pin: '2468' });
    const cookie = session.headers.get('set-cookie').split(';')[0];
    assert.equal((await api('/api/rules/defaults', 'POST', { profileId: protectedProfile.id }, cookie)).status, 200);
    assert.equal((await api('/api/rules/defaults', 'POST', { profileId: 'missing' })).status, 404);
  } finally {
    await server.stop();
  }
});
