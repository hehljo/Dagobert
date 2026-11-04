import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBankAccessStore } from '../server/bankAccessStore.js';

test('Saved bank access: encrypted, isolated, optional PIN, restart and authenticated ciphertext', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dagobert-bank-access-'));
  const store = createBankAccessStore(directory);
  const credentials = { clientId: 'synthetic-client', clientSecret: 'synthetic-secret', username: 'synthetic-user', password: 'synthetic-pin' };
  assert.deepEqual(store.status('one'), { saved: false, pinStored: false });
  store.save('one', credentials, false);
  assert.equal(store.load('one').password, undefined); assert.equal(store.load('one').clientSecret, credentials.clientSecret);
  assert.equal(store.load('two'), null);
  let file = path.join(directory, 'comdirect-access', fs.readdirSync(path.join(directory, 'comdirect-access'))[0]);
  const ciphertext = fs.readFileSync(file, 'utf8');
  for (const value of Object.values(credentials)) assert.ok(!ciphertext.includes(value));
  assert.equal(fs.statSync(file).mode & 0o077, 0);
  assert.equal(fs.statSync(path.join(directory, '.comdirect-access-key')).mode & 0o077, 0);
  store.save('one', credentials, true);
  assert.equal(createBankAccessStore(directory).load('one').password, credentials.password);
  const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
  envelope.data = Buffer.from('tampered').toString('base64'); fs.writeFileSync(file, JSON.stringify(envelope));
  assert.throws(() => store.load('one'));
  store.save('one', credentials, false); assert.equal(store.load('one').password, undefined);
  store.remove('one'); assert.equal(store.load('one'), null);
  // Keep the synthetic fixture directory as evidence; no production files involved.
});
