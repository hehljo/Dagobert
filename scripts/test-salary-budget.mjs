import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { salaryBudgetStorageKey } from '../src/lib/salaryBudget.ts';

export async function testSalaryBudget({ api, newContext, record, url }) {
  const artifacts = join('.ruttla-evidence', 'salary-budget', randomUUID());
  mkdirSync(artifacts, { recursive: true });
  const profile = await (await api('/api/profiles', 'POST', { name: 'Budget Testprofil' })).json();
  const second = await (await api('/api/profiles', 'POST', { name: 'Budget Zweitprofil' })).json();
  const before = await (await api(`/api/data?profileId=${profile.id}`)).json();
  const transactions = [
    ['2026-10-24', 400, 'gehalt'], ['2026-10-25', 3000, 'gehalt'], ['2026-10-28', 500, 'gehalt'],
    ['2026-11-02', -2000, 'wohnen'], ['2026-11-03', 100, 'rueckerstattung'], ['2026-11-28', 3200, 'gehalt'],
  ].map(([date, amount, category], index) => ({ date, amount, category, currency: 'EUR',
    payee: 'Budget Test', purpose: 'Synthetische Buchung', rawText: '', type: '', account: before.accounts[0].name,
    sourceHash: `salary-budget-${index}`, status: 'booked' }));
  assert.equal((await api('/api/transactions/batch', 'POST', { profileId: profile.id, transactions })).ok, true);
  const snapshot = await (await api(`/api/data?profileId=${profile.id}`)).json();
  const context = await newContext({ viewport: { width: 390, height: 844 } });
  // Preserve a user's profile switch across reload; initialize only this test context once.
  await context.addInitScript(id => {
    if (/^https?:$/.test(location.protocol) && !localStorage.getItem('dagobert_active_profile_id')) localStorage.setItem('dagobert_active_profile_id', id);
  }, profile.id);
  const page = await context.newPage();
  await page.clock.setFixedTime('2026-11-04T12:00:00Z');
  const key = salaryBudgetStorageKey(profile.id, 'web');
  const kpi = label => page.locator('.glass-kpi').filter({ has: page.getByText(label, { exact: true }) }).locator('.glass-kpi-value');
  const settings = page.locator('[data-settings-section="salary-budget"]');
  const openSettings = async () => {
    await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
    await settings.waitFor();
    if (await settings.getAttribute('open') === null) await settings.locator('summary').click();
  };
  const dashboard = () => page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await page.goto(url);
  await kpi('Cashflow (Monat)').waitFor();
  assert.match(await kpi('Cashflow (Monat)').innerText(), /\+1\.300,00/);
  const realBalance = await kpi('Kontostand').innerText();
  assert.equal(await page.getByRole('group', { name: 'Monatsansicht', exact: true }).count(), 0);
  record('salary_budget_default_calendar', 'Ohne Opt-in bleiben November-Cashflow und Kalendermonat unverändert');

  // Abgeschlossener Monat: zweite Kachel Kontostand Monatsende; Oktoberende = aktuell minus November-Buchungen (+1.300).
  const euro = text => Number(text.replace(/[^\d,-]/g, '').replace(',', '.'));
  assert.equal(await kpi('Kontostand Monatsende').count(), 0);
  await page.getByRole('button', { name: 'Vorheriger Monat' }).click();
  await kpi('Kontostand Monatsende').waitFor();
  assert.equal(await kpi('Kontostand aktuell').innerText(), realBalance);
  assert.equal(Math.round(euro(await kpi('Kontostand Monatsende').innerText()) * 100), Math.round((euro(realBalance) - 1300) * 100));
  assert.equal(await page.getByText('vor erster Buchung, zurückgerechnet').count(), 0);
  await page.getByRole('button', { name: 'Nächster Monat' }).click();
  await kpi('Kontostand').waitFor();
  record('dashboard_month_end_balance', 'Vergangener Monat zeigt Kontostand aktuell und Kontostand Monatsende; laufender Monat nur Kontostand');

  // Monatsergebnis abschaltbar, Standard an; danach wieder einschalten.
  await openSettings();
  const resultToggle = settings.getByRole('checkbox', { name: /Monatsergebnis/ });
  assert.equal(await resultToggle.isChecked(), true);
  await resultToggle.uncheck();
  await settings.getByRole('button', { name: 'Monatsansicht speichern' }).click();
  await dashboard();
  await kpi('Kontostand').waitFor();
  assert.equal(await kpi('Cashflow (Monat)').count(), 0);
  await openSettings();
  await resultToggle.check();
  await settings.getByRole('button', { name: 'Monatsansicht speichern' }).click();
  await dashboard();
  await kpi('Cashflow (Monat)').waitFor();
  record('dashboard_month_result_toggle', 'Monatsergebnis standardmäßig sichtbar, ausblendbar und wieder einblendbar');

  // Sparen & Investieren: Standard verrechnen, Auswahl überlebt Reload, Zurückstellen stellt den Standard her.
  await openSettings();
  const savingsSelect = settings.getByLabel('Sparen & Investieren in der Übersicht', { exact: true });
  assert.equal(await savingsSelect.inputValue(), 'netted');
  await savingsSelect.selectOption('transfer');
  await settings.getByRole('button', { name: 'Monatsansicht speichern' }).click();
  await page.reload();
  await openSettings();
  assert.equal(await savingsSelect.inputValue(), 'transfer');
  await savingsSelect.selectOption('netted');
  await settings.getByRole('button', { name: 'Monatsansicht speichern' }).click();
  await dashboard();
  await kpi('Cashflow (Monat)').waitFor();
  assert.match(await kpi('Cashflow (Monat)').innerText(), /\+1\.300,00/);
  record('dashboard_savings_mode_setting', 'Sparen & Investieren: Standard verrechnen, Umbuchung speicherbar, Rückstellung auf Standard');

  // Statistik: Kontostand-Verlauf mit aktuellem Monat als letztem Punkt.
  await page.getByRole('button', { name: 'Statistik', exact: true }).click();
  await page.getByRole('heading', { name: 'Kontostand-Verlauf' }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^November 2026 \(aktuell\):/ }).count(), 1);
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    await page.locator('section[aria-labelledby="balance-history-title"]').screenshot({ path: join(artifacts, `balance-history-${colorScheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await dashboard();
  record('statistics_balance_history', 'Statistik zeigt den Kontostand-Verlauf bis zum laufenden Monat');

  await openSettings();
  assert.equal(await settings.getByRole('checkbox', { name: 'Gehalt für den Folgemonat verwenden' }).isChecked(), false);
  assert.equal(await settings.getByLabel('Gehalt ab Tag', { exact: true }).inputValue(), '25');
  await settings.getByRole('checkbox', { name: 'Gehalt für den Folgemonat verwenden' }).check();
  await settings.getByRole('button', { name: 'Monatsansicht speichern', exact: true }).click();
  await page.reload();
  await kpi('Budgetsaldo (Monat)').waitFor();
  assert.match(await kpi('Budgetsaldo (Monat)').innerText(), /\+1\.600,00/);
  assert.match(await page.locator('.glass-kpi-cashflow').innerText(), /\+3\.600,00/);
  assert.equal(await page.locator('.glass-kpi').count(), 2, 'Einnahmen/Ausgaben stehen in der Monatsergebnis-Kachel, keine eigenen Kacheln');
  assert.equal(await kpi('Kontostand').innerText(), realBalance);
  await page.getByRole('button', { name: 'Kalendermonat', exact: true }).click();
  assert.match(await kpi('Cashflow (Monat)').innerText(), /\+1\.300,00/);
  await page.getByRole('button', { name: 'Budgetmonat', exact: true }).click();
  assert.match(await kpi('Budgetsaldo (Monat)').innerText(), /\+1\.600,00/);
  record('salary_budget_assignment_and_reload', 'Stichtag 25 überlebt Reload; Budget und Kalender stimmen bei variablem Zahltag ohne Doppelerfassung');

  // Kategorie im Budgetmonat antippen: Buchungsliste zeigt denselben Zeitraum von Gehalt zu Gehalt.
  await page.getByRole('button', { name: /^Wohnen/ }).first().click();
  const listStatus = page.getByRole('status').filter({ hasText: 'Budgetmonat 25.10.2026 – 27.11.2026' });
  await listStatus.waitFor();
  assert.match(await listStatus.innerText(), /^1 Buchungen/);
  await dashboard();
  await kpi('Budgetsaldo (Monat)').waitFor();
  record('budget_category_filter_period', 'Kategorie-Antippen im Budgetmonat filtert die Buchungsliste auf den Gehaltszeitraum');

  await openSettings();
  await settings.getByLabel('Gehalt ab Tag', { exact: true }).selectOption('28');
  await settings.getByRole('button', { name: 'Monatsansicht speichern', exact: true }).click();
  await settings.getByRole('status').waitFor();
  await dashboard();
  assert.match(await kpi('Budgetsaldo (Monat)').innerText(), /-1\.400,00/);
  record('salary_budget_cutoff_editable', 'Stichtag 28 verschiebt nur das spätere Oktobergehalt in den November');

  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    await page.evaluate(theme => localStorage.setItem('dagobert_theme', theme), colorScheme);
    await page.reload();
    await kpi('Budgetsaldo (Monat)').waitFor();
    await page.waitForFunction(dark => document.documentElement.classList.contains('dark') === dark, colorScheme === 'dark');
    for (const [width, height] of [[320, 568], [390, 420], [768, 1024]]) {
      await page.setViewportSize({ width, height });
      await openSettings();
      for (const control of [settings.getByLabel('Gehalt ab Tag', { exact: true }), settings.getByRole('button', { name: 'Monatsansicht speichern', exact: true })]) {
        await control.scrollIntoViewIfNeeded();
        const bounds = await control.boundingBox();
        assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width);
        assert.ok(bounds.height >= 48 && bounds.y >= 0 && bounds.y + bounds.height <= height);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: join(artifacts, `settings-${width}-${height}-${colorScheme}.png`) });
      await dashboard();
      for (const name of ['Kalendermonat', 'Budgetmonat']) {
        const control = page.getByRole('button', { name, exact: true });
        await control.scrollIntoViewIfNeeded();
        const bounds = await control.boundingBox();
        assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.height >= 48);
        assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= height);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: join(artifacts, `dashboard-${width}-${height}-${colorScheme}.png`) });
    }
  }
  record('salary_budget_controls_fit', 'Stichtag, Speichern und Monatsumschalter bei schmalen/niedrigen Ansichten in Light/Dark erreichbar');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTitle('Profil wechseln').click();
  await page.getByRole('button', { name: /^Budget Zweitprofil/ }).click();
  await kpi('Cashflow (Monat)').waitFor();
  assert.equal(await page.getByRole('group', { name: 'Monatsansicht', exact: true }).count(), 0);
  await openSettings();
  assert.equal(await settings.getByRole('checkbox', { name: 'Gehalt für den Folgemonat verwenden' }).isChecked(), false);
  assert.equal(await settings.getByLabel('Gehalt ab Tag', { exact: true }).inputValue(), '25');
  await page.getByTitle('Profil wechseln').click();
  await page.getByRole('button', { name: /^Budget Testprofil/ }).click();
  await settings.waitFor();
  assert.equal(await settings.getByRole('checkbox', { name: 'Gehalt für den Folgemonat verwenden' }).isChecked(), true);
  assert.equal(await settings.getByLabel('Gehalt ab Tag', { exact: true }).inputValue(), '28');
  record('salary_budget_profile_isolation', 'Profilwechsel übernimmt keine fremde Zuordnung und erhält den eigenen Stichtag');

  // A blocked local write must remain visible and must not claim a successful save.
  await page.evaluate(() => { window.__budgetStorageSet = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new Error('synthetic storage failure'); }; });
  await settings.getByLabel('Gehalt ab Tag', { exact: true }).selectOption('29');
  await settings.getByRole('button', { name: 'Monatsansicht speichern', exact: true }).click();
  await settings.getByRole('alert').waitFor();
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).startDay, key), 28);
  assert.equal(await settings.getByRole('status').count(), 0);
  await page.evaluate(() => { Storage.prototype.setItem = window.__budgetStorageSet; });
  record('salary_budget_storage_error_visible', 'Speicherfehler bleibt sichtbar; zuvor gespeicherter Stichtag wird erhalten');

  await settings.getByRole('checkbox', { name: 'Gehalt für den Folgemonat verwenden' }).uncheck();
  await settings.getByRole('button', { name: 'Monatsansicht speichern', exact: true }).click();
  await page.reload();
  await kpi('Cashflow (Monat)').waitFor();
  assert.match(await kpi('Cashflow (Monat)').innerText(), /\+1\.300,00/);
  assert.equal(await kpi('Kontostand').innerText(), realBalance);
  assert.deepEqual(await (await api(`/api/data?profileId=${profile.id}`)).json(), snapshot);
  record('salary_budget_disable_preserves_data', 'Abschalten stellt Kalender wieder her; Konten und vollständiger finanzieller Datensatz unverändert');

  await page.evaluate(({ webKey, iosKey }) => {
    localStorage.setItem(webKey, '{broken');
    localStorage.setItem(iosKey, JSON.stringify({ enabled: true, startDay: 1 }));
  }, { webKey: key, iosKey: salaryBudgetStorageKey(profile.id, 'ios') });
  await page.reload();
  await kpi('Cashflow (Monat)').waitFor();
  assert.equal(await page.getByRole('group', { name: 'Monatsansicht', exact: true }).count(), 0);
  record('salary_budget_corrupt_preferences_safe', 'Defekte lokale Einstellung fällt auf Kalender zurück; iOS-Schlüssel wird im Web nicht übernommen');
  await context.close();
}
