import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { APP_LOCKED_EVENT, APP_UNLOCKED_EVENT } from '../src/platform/appAccess.ts';
import { testSalaryBudget } from './test-salary-budget.mjs';

export async function testSettings({ api, newContext, record, url }) {
  await testSalaryBudget({ api, newContext, record, url });
  const artifacts = join('.ruttla-evidence', 'settings', randomUUID()); mkdirSync(artifacts, { recursive: true });
  const profile = await (await api('/api/profiles', 'POST', { name: 'UI Settings Test' })).json();
  const context = await newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(id => { if (location.protocol === 'http:' || location.protocol === 'https:') localStorage.setItem('dagobert_active_profile_id', id); }, profile.id);
  const page = await context.newPage(); await page.goto(url);
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  const section = id => page.locator(`[data-settings-section="${id}"]`);
  await section('account').waitFor();
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    const bounds = await section('account').evaluate(el => ({ section: el.getBoundingClientRect().toJSON(),
      inputs: [...el.querySelectorAll('input')].map(input => input.getBoundingClientRect().toJSON()), overflow: document.documentElement.scrollWidth > innerWidth }));
    assert.equal(bounds.overflow, false); assert.equal(bounds.inputs.length, 4);
    for (const input of bounds.inputs) { assert.ok(input.width > 0); assert.ok(input.left >= bounds.section.left && input.right <= bounds.section.right + 1); }
    await page.screenshot({ path: join(artifacts, `settings-${width}.png`) });
    record(`settings_controls_fit_${width}`, `Einstellungsfelder passen bei ${width}px in den Bereich`);
  }
  assert.equal(await section('categories').getAttribute('open'), null);
  await section('categories').locator('summary').click();
  await page.reload(); await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  assert.notEqual(await section('categories').getAttribute('open'), null);
  await section('categories').locator('summary').click();
  await page.reload(); await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  assert.equal(await section('categories').getAttribute('open'), null);
  record('settings_collapse_persists', 'Einstellungen merken offenen und geschlossenen Zustand');
  assert.equal(await section('icloud').count(), 0);
  record('web_hides_native_settings', 'Web zeigt keine iCloud-Optionen');
  await page.getByTitle('Profil wechseln').click();
  await page.getByRole('button', { name: 'Profil UI Settings Test umbenennen', exact: true }).click();
  await page.getByLabel('Profil umbenennen', { exact: true }).fill('Mein Haushalt');
  await page.getByRole('button', { name: 'Namen speichern', exact: true }).click();
  await page.getByRole('button', { name: 'Profil Mein Haushalt umbenennen', exact: true }).waitFor();
  assert.equal((await (await api(`/api/data?profileId=${profile.id}`)).json()).profile.id, profile.id);
  await page.getByRole('dialog', { name: 'Profile und Bereiche' }).getByRole('button', { name: 'Schließen', exact: true }).click();
  record('profile_rename_keeps_identity_ui', 'Profil umbenannt ohne Wechsel der Datenidentität');
  await page.getByRole('button', { name: 'Regeln', exact: true }).click();
  const transfer = page.getByRole('region', { name: 'Regeln und Kategorien übertragen' });
  const download = page.waitForEvent('download');
  await transfer.getByRole('button', { name: 'Regeln und Kategorien exportieren', exact: true }).click();
  const file = await download; const saved = join(artifacts, 'rules-export.json'); await file.saveAs(saved);
  const exported = JSON.parse(readFileSync(saved, 'utf8'));
  assert.equal(exported.format, 'dagobert_rules'); assert.equal(exported.transactions, undefined); assert.ok(exported.categories.length > 0);
  await transfer.getByLabel('Regeln-Datei auswählen').setInputFiles({ name: 'rules.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    format: 'dagobert_rules', schemaVersion: 1, exportedAt: new Date().toISOString(),
    categories: [{ id: 'manual-ui', name: 'Eigene UI Kategorie', icon: 'Tag', color: '#123456', type: 'expense' }], rules: [],
  })) });
  await transfer.getByRole('button', { name: 'Regeln und Kategorien ergänzen', exact: true }).click();
  await transfer.getByText(/0 Regeln und 1 Kategorien ergänzt/).waitFor();
  assert.ok((await (await api(`/api/data?profileId=${profile.id}`)).json()).categories.some(c => c.id === 'manual-ui'));
  record('rules_transfer_preview_and_import', 'Regeln-Datei exportiert und manuelle Kategorie über Vorschau ergänzt');
  await context.close();

  // Frontend lifecycle contract with a fake native transport, not an OS/Face-ID proof.
  const fixture = await (await api(`/api/data?profileId=${profile.id}`)).json();
  const native = await newContext({ viewport: { width: 390, height: 844 } });
  await native.addInitScript(({ fixture, lockedEvent, unlockedEvent }) => {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    localStorage.setItem('dagobert_active_profile_id', fixture.profile.id);
    window.__nativeTest = { unlocked: false, calls: [], inboxFails: 1, lockedEvent, unlockedEvent };
    const methods = ['getAppLockState', 'getProfiles', 'getProfileData', 'getDeviceSecurity', 'getSyncStatus', 'getRecoveryBackups',
      'getIncomingDocuments', 'comdirect', 'batchImportTransactions', 'addListener', 'removeListener'];
    window.webkit = { messageHandlers: { bridge: {} } };
    window.Capacitor = {
      PluginHeaders: [{ name: 'DagobertPlugin', methods: methods.map(name => ({ name, rtype: 'promise' })) },
        { name: 'StatusBar', methods: [{ name: 'setStyle', rtype: 'promise' }] }],
      nativeCallback: () => 'synthetic-callback',
      nativePromise: async (plugin, method, options) => {
        const state = window.__nativeTest; state.calls.push(method);
        if (plugin === 'StatusBar') return {};
        if (method === 'getAppLockState') return { unlocked: state.unlocked };
        if (!state.unlocked) throw Object.assign(new Error('App locked'), { code: 'APP_LOCKED' });
        if (method === 'getProfiles') return { profiles: [{ ...fixture.profile, hasPin: false }] };
        if (method === 'getProfileData') return fixture;
        if (method === 'getIncomingDocuments') {
          if (state.inboxFails-- > 0) throw Object.assign(new Error('App locked'), { code: 'APP_LOCKED' });
          return { documents: [] };
        }
        if (method === 'getDeviceSecurity') return { enabled: true };
        if (method === 'getRecoveryBackups') return { backups: [] };
        if (method === 'getSyncStatus') return { enabled: false, state: 'disabled', pendingChangesCount: 0, lastSyncAt: null, conflictsCount: 0, errorMessage: null, iCloudAccountStatus: 'noAccount' };
        if (method === 'comdirect' && options.operation === 'saved-access') return { saved: false, pinStored: false, canSave: true };
        if (method === 'comdirect' && options.operation === 'login') return { sessionId: 'synthetic-session', challenge: { typ: 'P_TAN_PUSH' } };
        if (method === 'comdirect' && options.operation === 'confirm') return { accounts: [{ accountId: 'synthetic-bank', label: 'Testkonto', iban: '', currency: 'EUR' }] };
        if (method === 'comdirect' && options.operation === 'transactions') return {
          values: Array.from({ length: 140 }, (_, i) => ({ reference: `synthetic-${i}`, bookingStatus: 'BOOKED',
            bookingDate: '2026-11-02', amount: { value: '-1.00', unit: 'EUR' }, creditor: { holderName: `Testumsatz ${i}` } })),
          paging: { index: 0, matches: 140 },
        };
        if (method === 'batchImportTransactions') {
          state.imported = options;
          return { inserted: options.transactions.length, updated: 0, duplicates: 0 };
        }
        return {};
      },
    };
  }, { fixture, lockedEvent: APP_LOCKED_EVENT, unlockedEvent: APP_UNLOCKED_EVENT });
  const npage = await native.newPage(); await npage.goto(url); await npage.waitForTimeout(100);
  assert.equal(await npage.evaluate(() => window.__nativeTest.calls.filter(c => c === 'getProfileData').length), 0);
  await npage.evaluate(() => { window.__nativeTest.unlocked = true; window.dispatchEvent(new Event(window.__nativeTest.unlockedEvent)); });
  await npage.getByTitle('Buchungen importieren').click();
  await npage.getByRole('button', { name: /comdirect direkt abrufen/ }).click();
  for (const [label, value] of [['Client-ID', 'synthetic-client'], ['Client-Secret', 'synthetic-secret'], ['Zugangsnummer', 'synthetic-user'], ['Onlinebanking-PIN', 'synthetic-pin']]) await npage.getByLabel(label, { exact: true }).fill(value);
  await npage.getByRole('button', { name: 'Verbinden und TAN anfordern', exact: true }).click();
  await npage.getByText(/Bestätige den Zugang in der comdirect photoTAN-App/).waitFor();
  const count = await npage.evaluate(() => window.__nativeTest.calls.filter(c => c === 'getProfileData').length);
  await npage.evaluate(() => { window.__nativeTest.unlocked = false; window.dispatchEvent(new Event(window.__nativeTest.lockedEvent)); window.dispatchEvent(new Event('focus')); });
  await npage.waitForTimeout(100);
  assert.equal(await npage.evaluate(() => window.__nativeTest.calls.filter(c => c === 'getProfileData').length), count);
  record('native_app_lock_gates_refresh', 'Native-Fassade: keine Datenabrufe während der App-Sperre');
  await npage.evaluate(() => { window.__nativeTest.unlocked = true; window.dispatchEvent(new Event(window.__nativeTest.unlockedEvent)); });
  await npage.getByText(/Bestätige den Zugang in der comdirect photoTAN-App/).waitFor();
  assert.equal(await npage.getByText(/Aktualisierung fehlgeschlagen|Geöffnete Dateien konnten nicht gelesen/).count(), 0);
  record('native_bank_form_survives_unlock', 'Native-Fassade: TAN-Dialog bleibt bei Rückkehr erhalten');
  record('native_inbox_expected_lock_recovers', 'Native-Fassade: erwartete Sperre hinterlässt keinen Dateieingangsfehler');
  await npage.getByRole('button', { name: 'Freigabe abgeschlossen', exact: true }).click();
  await npage.getByLabel('Dieses Bankkonto gehört zum gewählten Dagobert-Konto.').check();
  assert.equal(await npage.getByRole('button', { name: /Buchungen hinzufügen/ }).count(), 0);
  await npage.getByRole('button', { name: 'Umsätze zur Vorschau abrufen', exact: true }).click();
  const importAction = npage.getByRole('button', { name: '140 Buchungen hinzufügen', exact: true });
  const preview = npage.getByRole('region', { name: 'Geladene Umsätze', exact: true });
  await importAction.waitFor();
  for (const width of [320, 390, 768]) {
    await npage.setViewportSize({ width, height: 568 });
    await importAction.scrollIntoViewIfNeeded();
    const actionBounds = await importAction.boundingBox();
    const previewBounds = await preview.boundingBox();
    assert.ok(actionBounds && previewBounds);
    assert.ok(actionBounds.y + actionBounds.height <= previewBounds.y, 'Importaktion muss über der Umsatzliste liegen');
    assert.ok(actionBounds.x >= 0 && actionBounds.x + actionBounds.width <= width);
    assert.ok(actionBounds.y >= 0 && actionBounds.y + actionBounds.height <= 568);
    assert.ok(actionBounds.height >= 48);
    await npage.screenshot({ path: join(artifacts, `comdirect-import-${width}.png`) });
  }
  record('comdirect_import_action_above_preview', 'Importaktion liegt bei 320/390/768px und kleiner Höhe über 140 geladenen Umsätzen');
  await preview.getByRole('checkbox').first().uncheck();
  await npage.getByRole('button', { name: '139 Buchungen hinzufügen', exact: true }).click();
  await npage.getByRole('dialog', { name: 'comdirect direkt abrufen', exact: true }).waitFor({ state: 'hidden' });
  const imported = await npage.evaluate(() => window.__nativeTest.imported);
  assert.equal(imported.transactions.length, 139);
  assert.equal(imported.appendOnly, true);
  assert.ok(imported.transactions.every(t => !t.sourceHash.includes('"synthetic-0"')));
  record('comdirect_import_action_keeps_selection', 'Importaktion oben übernimmt ausschließlich die 139 ausgewählten synthetischen Umsätze');
  await npage.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await npage.locator('[data-settings-section="security"] > summary').click();
  assert.equal(await npage.locator('[data-settings-section="profile-pin"]').count(), 0);
  assert.equal(await npage.getByRole('button', { name: 'App-Sperre deaktivieren', exact: true }).count(), 0);
  await npage.getByText('Face ID, Touch ID oder Gerätecode', { exact: true }).waitFor();
  record('native_ui_uses_device_security', 'Native-Fassade: Gerätesicherheit ohne zweite PIN oder Abschaltoption');
  await native.close();
}
