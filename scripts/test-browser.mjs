import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { startTestServer, request } from '../tests/helpers/server.mjs';
import { writeTestResult } from '../tests/helpers/evidence.mjs';

const server = await startTestServer();
let browser;
const errors = [];
let checks = 0;
let complete = false;
const cases = {};
const api = (route, method, body) => request(server.url, route, method, body);
const record = (id, label) => {
  assert.equal(cases[id], undefined, `Doppelter Prüffall: ${id}`);
  cases[id] = true;
  checks++;
  console.log(`PASS ${label}`);
};
const shown = locator => locator.waitFor({ state: 'visible', timeout: 8000 });
const dashboard = page => shown(page.getByRole('button', { name: 'Vorheriger Monat' }));
async function newContext(options = {}) {
  const context = await browser.newContext(options);
  context.on('page', page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error' && /React|hooks|static flag/i.test(message.text())) errors.push(message.text());
    });
  });
  return context;
}

try {
  browser = await chromium.launch({ headless: true });
  const month = new Date().toISOString().slice(0, 7);
  await api('/api/transactions/batch', 'POST', {
    profileId: 'privat',
    transactions: Array.from({ length: 12 }, (_, i) => ({
      date: `${month}-01`, amount: -10 - i, payee: `Testladen ${i}`, purpose: 'Testbuchung',
      rawText: 'Test', type: 'Bar', category: 'sonstiges', status: 'booked', sourceHash: `test-${i}`
    }))
  });
  const protectedProfile = await (await api('/api/profiles', 'POST', { name: 'Firma Test', pin: '2468' })).json();
  const context = await newContext();
  await context.addInitScript(() => { window.PublicKeyCredential = undefined; });
  const page = await context.newPage();

  await page.route('**/api/profiles', route => route.fulfill({ status: 503, json: {} }));
  await page.goto(server.url);
  await shown(page.getByRole('alert'));
  assert.match(await page.getByRole('alert').innerText(), /Profile konnten nicht geladen/);
  assert.equal(await page.getByText('Daten werden geladen...').count(), 0);
  await page.unroute('**/api/profiles');
  await page.getByRole('button', { name: 'Erneut versuchen' }).click();
  await dashboard(page);
  record('startup_retry', 'Startfehler verständlich angezeigt; erneuter Versuch lädt echte Daten');

  await page.route('**/api/data?*', route => route.fulfill({ status: 503, json: {} }));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await shown(page.getByRole('alert'));
  assert.match(await page.getByRole('alert').innerText(), /zuletzt geladenen Daten/);
  await page.getByRole('button', { name: 'Buchungen', exact: true }).click();
  await shown(page.getByText('Testladen 0', { exact: true }));
  record('background_preserves_data', 'Fehlgeschlagene Hintergrundaktualisierung erhält bestehende Buchungen');
  await page.unroute('**/api/data?*');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('alert').waitFor({ state: 'hidden' });

  await page.route('**/api/data?*', route => route.fulfill({ status: 503, json: {} }));
  await page.reload();
  await shown(page.getByRole('alert'));
  assert.match(await page.getByRole('alert').innerText(), /Kontodaten konnten nicht geladen/);
  assert.equal(await page.getByText('Daten werden geladen...').count(), 0);
  await page.unroute('**/api/data?*');
  await page.getByRole('button', { name: 'Erneut versuchen' }).click();
  await dashboard(page);
  record('profile_data_retry', 'Fehler beim ersten Laden der Kontodaten lässt sich wiederholen');

  let releaseLoad;
  let loadRequests = 0;
  const loadGate = new Promise(resolve => { releaseLoad = resolve; });
  await page.route('**/api/data?*', async route => {
    loadRequests++;
    await loadGate;
    await route.continue();
  });
  const nextLoad = page.waitForRequest('**/api/data?*');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await nextLoad;
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('focus'));
  });
  const nextResponse = page.waitForResponse('**/api/data?*');
  releaseLoad();
  await nextResponse;
  assert.equal(loadRequests, 1);
  await page.unroute('**/api/data?*');
  record('no_overlapping_sync', 'Langsame Hintergrundaktualisierung startet keine überlappenden Anfragen');

  let releaseSave;
  const saveGate = new Promise(resolve => { releaseSave = resolve; });
  await page.route('**/api/transactions', async route => {
    await saveGate;
    await route.fulfill({ status: 503, json: {} });
  });
  await page.getByTitle('Manuelle Buchung erfassen').click();
  const payee = page.getByPlaceholder('z.B. Supermarkt oder Gehalt');
  await payee.fill('Erhaltene Eingabe');
  await page.getByRole('button', { name: 'Buchung anlegen', exact: true }).click();
  await shown(page.getByRole('button', { name: 'Wird gespeichert…' }));
  assert.equal(await page.getByRole('button', { name: 'Schließen', exact: true }).isDisabled(), true);
  releaseSave();
  await shown(page.getByRole('alert'));
  assert.equal(await payee.inputValue(), 'Erhaltene Eingabe');
  await page.unroute('**/api/transactions');
  await page.getByRole('button', { name: 'Buchung anlegen', exact: true }).click();
  await payee.waitFor({ state: 'hidden' });
  const savedData = await (await api('/api/data?profileId=privat')).json();
  assert.equal(savedData.transactions.filter(tx => tx.payee === 'Erhaltene Eingabe').length, 1);
  record('save_waits_and_retains_input', 'Speichervorgang wird abgewartet; bei Fehler bleiben Eingaben erhalten; Wiederholung speichert genau einmal');

  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByRole('button', { name: 'App-Sperre aktivieren', exact: true }).click();
  await page.getByLabel('Neue App-PIN', { exact: true }).fill('2468');
  await page.getByRole('button', { name: 'PIN speichern', exact: true }).click();
  await shown(page.getByText('PIN-Sperre erfolgreich aktiviert!', { exact: true }));
  let apiRequests = 0;
  page.on('request', req => { if (new URL(req.url()).pathname.startsWith('/api/')) apiRequests++; });
  apiRequests = 0;
  await page.reload();
  await shown(page.getByLabel('App-PIN', { exact: true }));
  assert.equal(apiRequests, 0);
  await page.getByLabel('App-PIN', { exact: true }).fill('0000');
  await page.getByRole('button', { name: 'Entsperren', exact: true }).click();
  await shown(page.getByText('Falsche PIN. Bitte erneut versuchen.', { exact: true }));
  assert.equal(apiRequests, 0);
  await page.getByLabel('App-PIN', { exact: true }).fill('2468');
  await page.getByRole('button', { name: 'Entsperren', exact: true }).click();
  await dashboard(page);
  record('app_pin_blocks_before_api', 'PIN in Einstellungen eingerichtet; Neustart sperrt vor jedem API-Aufruf; falsche PIN bleibt gesperrt; richtige PIN öffnet');

  const localHash = createHash('sha256').update('2468_dagobert_salt').digest('hex');
  await page.evaluate(pinHash => {
    localStorage.setItem('dagobert_security_config', JSON.stringify({ enabled: true, type: 'passkey', pinHash }));
  }, localHash);
  await page.reload();
  await page.getByRole('button', { name: 'Stattdessen PIN verwenden' }).click();
  await shown(page.getByLabel('App-PIN', { exact: true }));
  await page.getByLabel('App-PIN', { exact: true }).fill('2468');
  await page.getByRole('button', { name: 'Entsperren', exact: true }).click();
  await dashboard(page);
  record('passkey_pin_fallback', 'Passkey-Fallback schaltet tatsächlich auf PIN-Eingabe um');
  await context.close();

  const lockedContext = await newContext();
  await lockedContext.addInitScript(id => {
    if (location.protocol === 'http:') localStorage.setItem('dagobert_active_profile_id', id);
  }, protectedProfile.id);
  const lockedPage = await lockedContext.newPage();
  await lockedPage.goto(server.url);
  await shown(lockedPage.getByLabel('Profil-PIN', { exact: true }));
  assert.equal(await lockedPage.getByRole('button', { name: 'Vorheriger Monat' }).count(), 0);
  await lockedPage.getByLabel('Profil-PIN', { exact: true }).fill('0000');
  await lockedPage.getByRole('button', { name: 'Entsperren', exact: true }).click();
  await shown(lockedPage.getByRole('alert'));
  await lockedPage.getByLabel('Profil-PIN', { exact: true }).fill('2468');
  await lockedPage.getByRole('button', { name: 'Entsperren', exact: true }).click();
  await dashboard(lockedPage);
  await lockedPage.reload();
  await dashboard(lockedPage);
  record('profile_pin_and_reload', 'Geschütztes zuletzt gewähltes Profil verlangt PIN; gültige Serversitzung funktioniert nach Reload');

  await lockedContext.clearCookies();
  await lockedPage.evaluate(() => window.dispatchEvent(new Event('focus')));
  await shown(lockedPage.getByLabel('Profil-PIN', { exact: true }));
  assert.equal(await lockedPage.getByRole('button', { name: 'Vorheriger Monat' }).count(), 0);
  record('expired_session_clears_data', 'Ungültige Serversitzung sperrt die Ansicht erneut und entfernt geladene Daten');

  // Geometry/error-state checks do not spend the real API's PIN retry budget.
  await lockedPage.route('**/api/profiles/*/unlock', route => route.fulfill({ status: 401, json: {} }));
  for (const colorScheme of ['light', 'dark']) {
    for (const [width, height] of [[320, 568], [360, 640], [390, 420], [390, 844], [768, 1024], [1440, 900]]) {
      await lockedPage.emulateMedia({ colorScheme });
      await lockedPage.evaluate(() => localStorage.removeItem('dagobert_theme'));
      await lockedPage.setViewportSize({ width, height });
      await lockedPage.reload();
      const input = lockedPage.getByLabel('Profil-PIN', { exact: true });
      await shown(input);
      await input.fill('0000');
      const button = lockedPage.getByRole('button', { name: 'Entsperren', exact: true });
      await button.scrollIntoViewIfNeeded();
      const bounds = await button.boundingBox();
      assert.ok(bounds.height >= 48 && bounds.y >= 0 && bounds.y + bounds.height <= height, `${width}×${height} ${colorScheme}`);
      assert.equal(await lockedPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await lockedPage.evaluate(() => getComputedStyle(document.documentElement).colorScheme), colorScheme);
      await button.click();
      await shown(lockedPage.getByRole('alert'));
      record(`pin_layout_${width}x${height}_${colorScheme}`, `PIN bedienbar, ohne Seitenüberlauf: ${width}×${height}, ${colorScheme}`);
    }
  }
  await lockedPage.screenshot({ path: '/tmp/dagobert-pin-desktop.png' });
  await lockedContext.close();

  // Profile switching uses the same authenticated API, including error handling.
  const switchContext = await newContext();
  const switchPage = await switchContext.newPage();
  await switchPage.goto(server.url);
  await dashboard(switchPage);
  await switchPage.getByTitle('Profil wechseln').click();
  await switchPage.getByRole('button', { name: /Firma Test/ }).click();
  await shown(switchPage.getByLabel('Profil-PIN', { exact: true }));
  await switchPage.route('**/api/profiles/*/unlock', route => route.fulfill({ status: 503, json: {} }));
  await switchPage.getByLabel('Profil-PIN', { exact: true }).fill('2468');
  await switchPage.getByRole('button', { name: 'Entsperren & Wechseln', exact: true }).click();
  await shown(switchPage.getByText('Entsperren fehlgeschlagen. Bitte die Verbindung prüfen.', { exact: true }));
  await switchPage.unroute('**/api/profiles/*/unlock');
  await switchPage.getByRole('button', { name: 'Entsperren & Wechseln', exact: true }).click();
  await dashboard(switchPage);
  assert.equal(await switchPage.getByText('Testladen 0', { exact: true }).count(), 0);
  record('profile_switch_retry_isolation', 'Profilwechsel: Netzwerkfehler abfangen, erneut entsperren, vorherige Profildaten entfernt');
  await switchContext.close();
  assert.deepEqual(errors, [], 'Keine JavaScript- oder React-Hook-Fehler');
  complete = true;
  console.log(`BROWSER_RESULT checks=${checks} errors=${errors.length}; echte lokale Test-API, injizierte Verbindungsfehler`);
} finally {
  await browser?.close();
  await server.stop();
  writeTestResult(cases, complete ? 0 : 1);
}
