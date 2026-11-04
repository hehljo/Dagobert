import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { mountComdirect } from '../server/comdirect.js';
import { startTestServer, request } from './helpers/server.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBankAccessStore } from '../server/bankAccessStore.js';

test('Bank session: fake provider, TAN once, profile ownership, fixed read endpoints, no tokens in UI', async () => {
  const calls = [];
  const bankFetch = async (url, options) => {
    calls.push({ url, ...options });
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://api.comdirect.de');
    if (parsed.pathname === '/oauth/token') {
      const form = new URLSearchParams(options.body);
      assert.equal(form.get('client_secret'), 'synthetic+&=secret');
      return Response.json({ access_token: 'synthetic-secret-bank-token', expires_in: 599 });
    }
    if (parsed.pathname.endsWith('/sessions')) return Response.json([{ identifier: 'session-1' }]);
    if (parsed.pathname.endsWith('/validate')) return Response.json({}, { status: 201,
      headers: { 'x-once-authentication-info': JSON.stringify({ id: 'challenge-1', typ: 'P_TAN_PUSH' }) } });
    if (parsed.pathname.endsWith('/sessions/session-1') && options.method === 'PATCH') {
      assert.equal(options.headers['x-once-authentication'], undefined);
      return Response.json({});
    }
    if (parsed.pathname.endsWith('/accounts/balances')) return Response.json({ values: [{ account: {
      accountId: 'bank-1', iban: 'DE00SYNTHETIC', currency: 'EUR', accountType: { text: 'Testkonto' },
    } }] });
    if (parsed.pathname.endsWith('/bank-1/transactions')) {
      assert.equal(parsed.searchParams.get('transactionState'), 'BOOKED');
      return Response.json({ paging: { index: 0, matches: 0 }, values: [] });
    }
    if (parsed.pathname === '/oauth/revoke') return new Response(null, { status: 204 });
    assert.fail('Unexpected bank endpoint');
  };
  const app = express(); app.use(express.json());
  const store = createBankAccessStore(mkdtempSync(join(tmpdir(), 'dagobert-saved-api-')));
  mountComdirect(app, (_req, _res, next) => next(), bankFetch, { store, canSave: id => id === 'test' });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  const api = (op, values = {}) => fetch(url + `/api/comdirect/${op}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: url }, body: JSON.stringify({ profileId: 'test', ...values }) });
  try {
    const login = await (await api('login', { clientId: 'synthetic-client', clientSecret: 'synthetic+&=secret', username: 'synthetic', password: 'synthetic', saveAccess: true, savePin: false })).json();
    assert.equal(login.challenge.typ, 'P_TAN_PUSH'); assert.ok(login.sessionId);
    assert.ok(!JSON.stringify(login).includes('synthetic-secret-bank-token'));
    assert.deepEqual(await (await api('saved-access')).json(), { saved: true, pinStored: false, canSave: true });
    assert.equal((await api('login', { useSaved: true })).status, 400);
    const foreign = await api('transactions', { profileId: 'other', sessionId: login.sessionId, accountId: 'bank-1', first: 0 });
    assert.equal(foreign.status, 400);
    const confirmed = await (await api('confirm', { sessionId: login.sessionId })).json();
    assert.equal(confirmed.accounts[0].accountId, 'bank-1');
    assert.deepEqual(await (await api('transactions', { sessionId: login.sessionId, accountId: 'bank-1', first: 0 })).json(), { paging: { index: 0, matches: 0 }, values: [] });
    assert.equal(calls.filter(c => c.url.endsWith('/validate')).length, 1);
    assert.equal(calls.filter(c => c.method === 'PATCH').length, 1);
    const count = calls.length;
    const crossSite = await fetch(url + '/api/comdirect/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://unrelated.invalid' }, body: JSON.stringify({ profileId: 'test' }) });
    assert.equal(crossSite.status, 403); assert.equal(calls.length, count);
    await api('disconnect', { sessionId: login.sessionId });
    assert.equal((await api('transactions', { sessionId: login.sessionId, accountId: 'bank-1', first: 0 })).status, 400);
    const reuse = await (await api('login', { useSaved: true, password: 'synthetic', saveAccess: true, savePin: true })).json();
    assert.ok(reuse.sessionId); assert.deepEqual(await (await api('saved-access')).json(), { saved: true, pinStored: true, canSave: true });
    assert.ok((await (await api('login', { useSaved: true })).json()).sessionId);
    assert.deepEqual(await (await api('saved-access', { profileId: 'other' })).json(), { saved: false, pinStored: false, canSave: false });
    await api('forget-access'); assert.deepEqual(await (await api('saved-access')).json(), { saved: false, pinStored: false, canSave: true });
    assert.ok(!calls.some(c => c.url.includes('/brokerage/') || c.url.includes('orders')));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('Append-only API import preserves CSV, pending records, categories and balance; repeated references and invalid batches are safe', async () => {
  const server = await startTestServer();
  const api = (route, method, body) => request(server.url, route, method, body);
  try {
    const profile = await (await api('/api/profiles', 'POST', { name: 'Synthetic API protection' })).json();
    const profileId = profile.id;
    const tx = { date: '2026-11-01', amount: -12.34, currency: 'EUR', payee: 'Testgeschäft', purpose: 'Eigene Notiz',
      rawText: 'Original CSV', type: 'Karte', category: 'freizeit', account: 'comdirect Girokonto', importedAt: '2026-11-01T00:00:00Z', status: 'pending', sourceHash: 'tx_old_csv' };
    assert.equal((await api('/api/transactions/batch', 'POST', { profileId, transactions: [tx], accountCheckpoint: { newBalance: 123, endDate: '2026-11-01' } })).status, 200);
    const before = await (await api(`/api/data?profileId=${profileId}`)).json();
    const bank = { ...tx, status: 'booked', category: 'sonstiges', rawText: 'Anderer Banktext', sourceHash: 'comdirect_api_["bank-1","reference-1"]' };
    assert.equal((await api('/api/transactions/batch', 'POST', { profileId, appendOnly: true, transactions: [bank] })).status, 400);
    assert.deepEqual(await (await api(`/api/data?profileId=${profileId}`)).json(), before);
    const result = await (await api('/api/transactions/batch', 'POST', { profileId, appendOnly: true, reviewedHashes: [bank.sourceHash], transactions: [bank, bank], accountCheckpoint: { newBalance: 999, endDate: '2026-12-01' } })).json();
    assert.deepEqual(result, { inserted: 1, updated: 0, duplicates: 1 });
    const after = await (await api(`/api/data?profileId=${profileId}`)).json();
    assert.deepEqual(after.accounts, before.accounts);
    assert.deepEqual(after.transactions.find(t => t.id === before.transactions[0].id), before.transactions[0]);
    assert.deepEqual(await (await api('/api/transactions/batch', 'POST', { profileId, appendOnly: true, transactions: [bank] })).json(), { inserted: 0, updated: 0, duplicates: 1 });
    const stable = await (await api(`/api/data?profileId=${profileId}`)).json();
    for (const changed of [{ ...bank, account: 'Falsches Zielkonto' },
      { ...bank, sourceHash: 'comdirect_api_["other-bank","reference-1"]' }, { ...bank, amount: 12.345 }]) {
      assert.equal((await api('/api/transactions/batch', 'POST', { profileId, appendOnly: true, reviewedHashes: [changed.sourceHash], transactions: [changed] })).status, 400);
    }
    assert.equal((await api('/api/transactions/batch', 'POST', { profileId, appendOnly: true, transactions: [
      { ...bank, sourceHash: 'comdirect_api_["bank-1","new"]' }, { ...bank, date: '2026-02-31' },
    ] })).status, 400);
    assert.deepEqual(await (await api(`/api/data?profileId=${profileId}`)).json(), stable);
    const locked = await (await api('/api/profiles', 'POST', { name: 'Protected synthetic', pin: '1234' })).json();
    assert.equal((await api('/api/comdirect/login', 'POST', { profileId: locked.id })).status, 401);
    assert.equal((await api('/api/comdirect/saved-access', 'POST', { profileId: locked.id })).status, 401);
    assert.deepEqual(await (await api('/api/comdirect/saved-access', 'POST', { profileId })).json(), { saved: false, pinStored: false, canSave: false });
    const protectedStore = createBankAccessStore(server.directory);
    protectedStore.save(locked.id, { clientId: 'synthetic', clientSecret: 'synthetic', username: 'synthetic', password: 'synthetic' }, true);
    const unlock = await request(server.url, `/api/profiles/${locked.id}/unlock`, 'POST', { pin: '1234' });
    const cookie = unlock.headers.get('set-cookie').split(';')[0];
    const saved = await request(server.url, '/api/comdirect/saved-access', 'POST', { profileId: locked.id }, cookie);
    assert.deepEqual(await saved.json(), { saved: true, pinStored: true, canSave: true });
    assert.equal((await request(server.url, `/api/profiles/${locked.id}`, 'PUT', { removePin: true }, cookie)).status, 200);
    assert.equal(protectedStore.load(locked.id), null, 'Removing the profile guard must remove saved bank credentials first');
  } finally { await server.stop(); }
});
