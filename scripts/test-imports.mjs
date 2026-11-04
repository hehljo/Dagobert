import assert from 'node:assert/strict';

export async function testImports({ api, newContext, record, url }) {
  const profile = await (await api('/api/profiles', 'POST', { name: 'Importprüfung' })).json();
  const profileId = profile.id;
  const data = async () => (await api(`/api/data?profileId=${profileId}`)).json();
  const backup = await (await api(`/api/backup?profileId=${profileId}`)).json();
  backup.transactions = [{ id: 'external-id', syncId: 'browser-import-transaction', date: '2026-11-01', amount: -123.45,
    currency: 'EUR', payee: 'Importprüfbuchung', purpose: 'Synthetisch', rawText: 'Synthetisch', type: 'Bar',
    category: 'sonstiges', account: 'comdirect Girokonto', sourceHash: 'browser-import', importedAt: '2026-11-01T12:00:00Z',
    status: 'booked', tags: ['Prüfung'], extension: { id: 'nested-preserved' } }];
  const context = await newContext();
  await context.addInitScript(id => { if (location.protocol === 'http:') localStorage.setItem('dagobert_active_profile_id', id); }, profileId);
  const page = await context.newPage();
  page.on('dialog', dialog => dialog.accept());
  const shown = locator => locator.waitFor({ state: 'visible', timeout: 8000 });
  const openBackupSection = async () => {
    const section = page.locator('[data-settings-section="backup"]');
    await shown(section.locator('summary'));
    if (await section.getAttribute('open') === null) await section.locator('summary').click();
  };
  const openBackup = async payload => {
    await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
    await openBackupSection();
    await page.getByRole('button', { name: 'Wiederherstellen', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Backup importieren', exact: true });
    await dialog.locator('input[type=file]').setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)) });
    await shown(dialog.getByText('Backup erfolgreich validiert', { exact: true }));
    return dialog;
  };
  try {
    await page.goto(url);
    await shown(page.getByRole('button', { name: 'Vorheriger Monat' }));
    let dialog = await openBackup(backup);
    assert.equal((await data()).transactions.length, 0, 'Preview must not import');
    await dialog.getByRole('radio', { name: /^Bestehende Daten ersetzen/ }).check();
    assert.equal(await dialog.getByRole('button', { name: 'Jetzt importieren' }).isDisabled(), true);
    await dialog.getByRole('checkbox').check();
    for (const colorScheme of ['light', 'dark']) {
      for (const [width, height] of [[320, 568], [360, 640], [390, 420], [390, 844], [768, 1024], [1440, 900]]) {
        await page.setViewportSize({ width, height }); await page.emulateMedia({ colorScheme });
        const submit = dialog.getByRole('button', { name: 'Jetzt importieren' });
        await submit.scrollIntoViewIfNeeded();
        const box = await submit.boundingBox();
        assert.ok(box && box.y >= 0 && box.y + box.height <= height && box.height >= 44, `Import action reachable ${width}x${height}`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        record(`backup_layout_${width}x${height}_${colorScheme}`, `Backupvorschau und Importaktion erreichbar: ${width}×${height}, ${colorScheme}`);
      }
    }
    await dialog.getByRole('button', { name: 'Jetzt importieren' }).click();
    await dialog.waitFor({ state: 'hidden' });
    const imported = (await data()).transactions;
    assert.equal(imported.length, 1); assert.equal(imported[0].amount, -123.45);
    assert.deepEqual(imported[0].extension, { id: 'nested-preserved' });
    assert.ok((await (await api(`/api/backup/recovery?profileId=${profileId}`)).json()).backups.length > 0);
    record('backup_preview_replace_confirmation', 'JSON-Vorschau schreibt nichts; bestätigtes Ersetzen speichert inklusive Zusatzfeld und Wiederherstellungssicherung');

    const conflicting = structuredClone(backup); conflicting.transactions[0].amount = -900;
    dialog = await openBackup(conflicting);
    await dialog.getByRole('button', { name: 'Jetzt importieren' }).click();
    await shown(dialog.getByText(/Konflikt in transactions/));
    assert.equal((await data()).transactions[0].amount, -123.45);
    await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    record('backup_merge_conflict_visible', 'Merge-Konflikt erscheint in der Vorschau und verändert den Bestand nicht');

    await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
    await openBackupSection();
    await page.getByRole('button', { name: 'Wiederherstellen', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Backup importieren', exact: true });
    await dialog.locator('input[type=file]').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
    await shown(dialog.getByText('Validierungsfehler', { exact: true }));
    assert.equal(await dialog.getByRole('button', { name: 'Jetzt importieren' }).count(), 0);
    await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    record('backup_invalid_file_keeps_data', 'Fehlerhafte JSON-Datei hat keine Importaktion und erhält vorhandene Daten');

    await page.getByTitle('Buchungen importieren').click();
    const csvDialog = page.getByRole('dialog', { name: 'Buchungen importieren', exact: true });
    const csv = '"Buchungstag";"Wertstellung (Valuta)";"Vorgang";"Buchungstext";"Umsatz in EUR"\n"01.11.2026";"01.11.2026";"Bar";"Testladen";"-12,34"';
    await csvDialog.locator('input[type=file]').setInputFiles({ name: 'synthetic.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await shown(csvDialog.getByRole('button', { name: '1 Buchungen speichern' }));
    await page.route('**/api/transactions/batch', route => route.fulfill({ status: 503, json: {} }));
    await csvDialog.getByRole('button', { name: '1 Buchungen speichern' }).click();
    await shown(csvDialog.getByText('Fehler beim Speichern der Buchungen', { exact: true }));
    assert.equal((await data()).transactions.length, 1);
    await page.unroute('**/api/transactions/batch');
    await csvDialog.getByRole('button', { name: '1 Buchungen speichern' }).click();
    await csvDialog.waitFor({ state: 'hidden' });
    assert.equal((await data()).transactions.length, 2);
    record('csv_import_retry_preserves_preview', 'CSV-Speicherfehler erhält Vorschau; Wiederholung speichert genau eine neue Buchung');
  } finally { await context.close(); }
}
