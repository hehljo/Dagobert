import assert from 'node:assert/strict';
import catalog from '../src/lib/standardRules.json' with { type: 'json' };
import { NEW_MERCHANT_PRESET_IDS } from '../tests/helpers/presets.mjs';

export async function testCategorization({ api, newContext, record, url }) {
  const profile = await (await api('/api/profiles', 'POST', { name: 'Kategorisierung Test' })).json();
  const profileId = profile.id;
  const data = async () => (await api(`/api/data?profileId=${profileId}`)).json();
  const otherBefore = await (await api('/api/data?profileId=privat')).json();
  for (const id of NEW_MERCHANT_PRESET_IDS) {
    await api(`/api/rules/${id}?profileId=${profileId}`, 'DELETE');
  }
  await api('/api/rules', 'POST', { profileId, rule: catalog.previousVersions[0] });
  const custom = { ...catalog.rules.find(r => r.id === 'rule-abos'), name: 'Meine Streaming-Regel', enabled: false };
  await api('/api/rules', 'POST', { profileId, rule: custom });
  const month = new Date().toISOString().slice(0, 7);
  const fixture = [
    ['2022-03-10', 'Archiv Shopping', 'ZALANDO', 'sonstiges'],
    ['2023-04-11', 'Archiv Essen', 'WOLT', 'sonstiges'],
    ['2024-05-12', 'Archiv Strom', 'E.ON', 'sonstiges'],
    ['2025-06-13', 'Archiv Apotheke', 'SHOP-APOTHEKE', 'sonstiges'],
    ['2021-07-14', 'Archiv ohne Treffer', 'Unbekannter Laden', 'sonstiges'],
    [`${month}-01`, 'Manuell zugeordnet', 'ZALANDO', 'freizeit'],
    [`${month}-02`, 'Offen heute', 'Unbekannter Laden', 'sonstiges']
  ];
  await api('/api/transactions/batch', 'POST', {
    profileId,
    transactions: fixture.map(([date, payee, rawText, category], i) => ({
      date, payee, rawText, category, purpose: 'Prüfbuchung', type: 'Lastschrift',
      amount: -10 - i, status: 'booked', sourceHash: `categorization-${i}`
    }))
  });
  const context = await newContext();
  await context.addInitScript(id => {
    if (location.protocol === 'http:') localStorage.setItem('dagobert_active_profile_id', id);
  }, profileId);
  const page = await context.newPage();
  const shown = locator => locator.waitFor({ state: 'visible', timeout: 8000 });
  try {
    await page.goto(url);
    await page.getByRole('button', { name: 'Regeln', exact: true }).click();
    const defaults = () => page.getByRole('button', { name: 'Standard-Regeln laden / aktualisieren', exact: true });
    await page.route('**/api/rules/defaults', route => route.fulfill({ status: 503, json: {} }));
    await defaults().click();
    await shown(page.getByRole('alert'));
    assert.match(await page.getByRole('alert').innerText(), /Standard-Regeln konnten nicht geladen/);
    await page.unroute('**/api/rules/defaults');

    let release;
    let calls = 0;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/rules/defaults', async route => { calls++; await gate; await route.continue(); });
    await defaults().click();
    await shown(page.getByRole('button', { name: 'Standard-Regeln werden geladen…' }));
    assert.equal(await page.getByRole('button', { name: 'Standard-Regeln werden geladen…' }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Regeln anwenden' }).isDisabled(), true);
    release();
    await shown(page.getByRole('status').filter({ hasText: '3 Standard-Regeln ergänzt, 1 aktualisiert.' }));
    await shown(defaults());
    assert.equal(calls, 1);
    await page.unroute('**/api/rules/defaults');
    await defaults().click();
    await shown(page.getByRole('status').filter({ hasText: 'Standard-Regeln sind aktuell.' }));
    assert.equal((await data()).rules.length, catalog.rules.length);
    assert.deepEqual((await data()).rules.find(r => r.id === custom.id), custom);
    record('preset_load_retry_idempotent', 'Standardregeln: Fehler/Wiederholung, alter Katalog aktualisiert, keine Duplikate, eigene Regel erhalten');

    await page.getByRole('button', { name: 'Buchungen', exact: true }).click();
    await shown(page.getByText('Offen heute', { exact: true }));
    assert.equal(await page.getByText('Archiv Shopping', { exact: true }).count(), 0);
    await page.getByPlaceholder('Buchungen durchsuchen (Empfänger, Zweck, Betrag)...').fill('Kein Treffer');
    await page.getByRole('button', { name: 'Einnahmen', exact: true }).click();
    const uncategorized = () => page.getByRole('button', { name: /^Nur unkategorisiert/ });
    await uncategorized().click();
    await shown(page.getByText('Archiv Shopping', { exact: true }));
    assert.equal(await uncategorized().getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByRole('button', { name: 'Alle Monate anzeigen' }).getAttribute('aria-pressed'), 'true');
    assert.match(await uncategorized().innerText(), /\(6\)/);
    assert.match(await page.getByRole('status').innerText(), /6 Buchungen · Alle Jahre/);
    assert.equal(await page.getByText('Manuell zugeordnet', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Testladen 0', { exact: true }).count(), 0);
    await shown(page.getByText(/2021/, { exact: false }).last());
    record('uncategorized_all_archives', 'Ein Klick zeigt sechs offene Buchungen über alle Archivjahre, setzt einschränkende Filter zurück und trennt Profile');

    await page.getByRole('button', { name: 'Alle Monate anzeigen' }).click();
    assert.equal(await page.getByText('Archiv Shopping', { exact: true }).count(), 0);
    await shown(page.getByText('Offen heute', { exact: true }));
    assert.match(await page.getByRole('status').innerText(), /1 Buchungen/);
    await page.getByRole('button', { name: 'Alle Monate anzeigen' }).click();
    await page.getByPlaceholder('Buchungen durchsuchen (Empfänger, Zweck, Betrag)...').fill('SHOP-APOTHEKE');
    await shown(page.getByText('Archiv Apotheke', { exact: true }));
    assert.equal(await page.getByText('Archiv Shopping', { exact: true }).count(), 0);
    await page.getByPlaceholder('Buchungen durchsuchen (Empfänger, Zweck, Betrag)...').fill('');
    await uncategorized().click();
    await shown(page.getByText('Manuell zugeordnet', { exact: true }));
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await page.getByRole('button', { name: /^Freizeit & Restaurant / }).click();
    await shown(page.getByText('Manuell zugeordnet', { exact: true }));
    await uncategorized().click();
    await shown(page.getByText('Archiv Shopping', { exact: true }));
    assert.equal(await page.getByRole('button', { name: 'Kategoriefilter aufheben' }).count(), 0);
    record('transaction_filters_combine', 'Monatsgrenze wiederherstellbar; Suche und Kategorienfilter funktionieren mit der offenen Liste');

    // Fail the second actual update, so the result must report the one persisted change.
    await page.getByRole('button', { name: 'Regeln', exact: true }).click();
    let updates = 0;
    await page.route('**/api/transactions/*', async route => {
      if (route.request().method() === 'PUT' && ++updates === 2) await route.fulfill({ status: 503, json: {} });
      else await route.continue();
    });
    await page.getByRole('button', { name: 'Regeln anwenden' }).click();
    await shown(page.getByRole('alert').filter({ hasText: /Anwenden abgebrochen. 1 Buchungen neu kategorisiert/ }));
    await page.unroute('**/api/transactions/*');
    await page.getByRole('button', { name: 'Regeln anwenden' }).click();
    await shown(page.getByRole('status').filter({ hasText: '3 Buchungen neu kategorisiert.' }));
    const after = await data();
    for (const [payee, category] of [['Archiv Shopping', 'shopping'], ['Archiv Essen', 'freizeit'], ['Archiv Strom', 'wohnen'], ['Archiv Apotheke', 'gesundheit'], ['Archiv ohne Treffer', 'sonstiges'], ['Manuell zugeordnet', 'freizeit']]) {
      assert.equal(after.transactions.find(tx => tx.payee === payee).category, category);
    }
    await page.getByRole('button', { name: 'Regeln anwenden' }).click();
    await shown(page.getByRole('status').filter({ hasText: '0 Buchungen neu kategorisiert.' }));
    assert.deepEqual(await (await api('/api/data?profileId=privat')).json(), otherBefore);
    record('apply_rules_feedback_preserves_categories', 'Anwenden: Teilfehler mit echtem Zähler, Wiederholung, null neue Treffer, manuelle Kategorien und fremdes Profil erhalten');

    await page.getByRole('button', { name: 'Buchungen', exact: true }).click();
    await uncategorized().click();
    assert.match(await uncategorized().innerText(), /\(2\)/);
    await page.getByText('Archiv ohne Treffer', { exact: true }).click();
    await page.getByRole('button', { name: /Gesundheit & Pflege/ }).click();
    await page.getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
    await page.getByPlaceholder('z.B. Supermarkt oder Gehalt').waitFor({ state: 'hidden' });
    await shown(uncategorized());
    assert.equal(await uncategorized().getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByRole('button', { name: 'Alle Monate anzeigen' }).getAttribute('aria-pressed'), 'true');
    assert.match(await uncategorized().innerText(), /\(1\)/);
    assert.equal(await page.getByText('Archiv ohne Treffer', { exact: true }).count(), 0);
    record('uncategorized_edit_keeps_filters', 'Archivbuchung manuell zuordnen: verschwindet aus offenen Buchungen, Zähler sinkt, Filter bleiben aktiv');

    for (const colorScheme of ['light', 'dark']) {
      for (const [width, height] of [[320, 568], [360, 640], [390, 420], [390, 844], [768, 1024], [1440, 900]]) {
        await page.emulateMedia({ colorScheme });
        await page.evaluate(() => localStorage.removeItem('dagobert_theme'));
        await page.setViewportSize({ width, height });
        await page.reload();
        await page.getByRole('button', { name: 'Regeln', exact: true }).click();
        for (const button of [defaults(), page.getByRole('button', { name: 'Regeln anwenden' })]) {
          await button.scrollIntoViewIfNeeded();
          const box = await button.boundingBox();
          assert.ok(box.width >= 48 && box.height >= 48 && box.x >= 0 && box.x + box.width <= width, `${width}×${height} ${colorScheme}`);
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        if (width === 320) await page.screenshot({ path: `/tmp/dagobert-rules-${colorScheme}.png` });
        await page.getByRole('button', { name: 'Buchungen', exact: true }).click();
        for (const button of [uncategorized(), page.getByRole('button', { name: 'Alle Monate anzeigen' })]) {
          await button.scrollIntoViewIfNeeded();
          const box = await button.boundingBox();
          assert.ok(box.width >= 48 && box.height >= 48 && box.x >= 0 && box.x + box.width <= width);
          await button.click();
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        if (width === 320) await page.screenshot({ path: `/tmp/dagobert-transactions-${colorScheme}.png` });
        record(`categorization_layout_${width}x${height}_${colorScheme}`, `Regeln und Filter bedienbar ohne Seitenüberlauf: ${width}×${height}, ${colorScheme}`);
      }
    }
  } finally {
    await context.close();
  }
}
