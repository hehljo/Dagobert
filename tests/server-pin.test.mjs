import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, request } from './helpers/server.mjs';
import { writeTestResult } from './helpers/evidence.mjs';

test('PIN schützt Daten, Änderungen und Backups auch bei direktem API-Zugriff', async () => {
  const server = await startTestServer();
  const api = (route, method, body, cookie) => request(server.url, route, method, body, cookie);
  const cases = {};
  let complete = false;
  try {
    const profile = await (await api('/api/profiles', 'POST', { name: 'Testprofil', pin: '2468' })).json();
    const second = await (await api('/api/profiles', 'POST', { name: 'Zweites Profil', pin: '1357' })).json();
    assert.ok(profile.id);
    assert.equal((await api('/api/data?profileId=privat')).status, 200);
    assert.equal((await api('/api/profiles', 'POST', { name: 'Ungültig', pin: '12' })).status, 400);
    cases.public_profile_access = true;

    const guarded = [
      [`/api/data?profileId=${profile.id}`, 'GET'],
      [`/api/backup?profileId=${profile.id}`, 'GET'],
      ['/api/transactions', 'POST', { profileId: profile.id, transaction: {} }],
      ['/api/transactions/batch', 'POST', { profileId: profile.id, transactions: [] }],
      ['/api/accounts/comdirect', 'PUT', { profileId: profile.id, initialBalance: 99 }],
      ['/api/rules', 'POST', { profileId: profile.id, rule: {} }],
      [`/api/rules/rule-gehalt?profileId=${profile.id}`, 'DELETE'],
      ['/api/backup/import', 'POST', { profileId: profile.id, data: {} }],
      ['/api/reset', 'POST', { profileId: profile.id }],
      [`/api/profiles/${profile.id}`, 'PUT', { removePin: true }],
      [`/api/profiles/${profile.id}`, 'DELETE']
    ];
    for (const args of guarded) {
      assert.equal((await api(...args)).status, 401, `${args[1]} ${args[0]}`);
    }
    cases.protected_routes_denied = true;
    assert.equal((await api(`/api/profiles/${profile.id}/unlock`, 'POST', { pin: '0000' })).status, 401);
    cases.wrong_pin_denied = true;
    const unlocked = await api(`/api/profiles/${profile.id}/unlock`, 'POST', { pin: '2468' });
    assert.equal(unlocked.status, 200);
    const setCookie = unlocked.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    const cookie = setCookie.split(';')[0];
    const data = await api(`/api/data?profileId=${profile.id}`, 'GET', undefined, cookie);
    assert.equal(data.status, 200);
    assert.equal(data.headers.get('cache-control'), 'no-store');
    assert.equal((await api(`/api/data?profileId=${second.id}`, 'GET', undefined, cookie)).status, 401);
    assert.equal((await api(`/api/data?profileId=${profile.id}`, 'GET', undefined, 'dagobert_profile_session=fake')).status, 401);
    cases.valid_session_only_own_profile = true;

    const created = await api('/api/transactions', 'POST', {
      profileId: profile.id,
      transaction: { date: '2026-10-18', amount: -12, payee: 'Testladen', purpose: '', rawText: '', type: 'Bar', category: 'sonstiges', account: 'comdirect Girokonto' }
    }, cookie);
    if (!created.ok) throw new Error(await created.text());
    const { id } = await created.json();
    assert.equal((await api(`/api/transactions/${id}`, 'PUT', { profileId: 'privat', transaction: { amount: -50 } })).status, 401);
    assert.equal((await api(`/api/transactions/${id}`, 'DELETE', { profileId: 'privat' })).status, 401);
    assert.equal((await api(`/api/transactions/${id}`, 'PUT', { transaction: { amount: -13 } }, cookie)).status, 200);
    assert.equal((await api(`/api/backup?profileId=${profile.id}`, 'GET', undefined, cookie)).status, 200);
    cases.transaction_owner_resolved = true;

    // A PIN change invalidates the existing session without any schema migration.
    assert.equal((await api(`/api/profiles/${profile.id}`, 'PUT', { pin: '8642' }, cookie)).status, 200);
    assert.equal((await api(`/api/data?profileId=${profile.id}`, 'GET', undefined, cookie)).status, 401);
    cases.changed_pin_invalidates_session = true;
    for (let i = 0; i < 5; i++) {
      assert.equal((await api(`/api/profiles/${second.id}/unlock`, 'POST', { pin: '0000' })).status, 401);
    }
    const limited = await api(`/api/profiles/${second.id}/unlock`, 'POST', { pin: '1357' });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    cases.retry_limit = true;
    const cors = await fetch(server.url + '/api/profiles', { headers: { Origin: 'https://example.invalid' } });
    assert.equal(cors.headers.get('access-control-allow-origin'), null);
    cases.cross_origin_not_enabled = true;
    complete = true;
  } finally {
    await server.stop();
    writeTestResult(cases, complete ? 0 : 1);
  }
});
