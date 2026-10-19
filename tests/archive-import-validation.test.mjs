import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBankCsv, extractComdirectMetadata } from '../src/lib/csvParser.ts';
import { startTestServer, request } from './helpers/server.mjs';

const COMDIRECT_TEMPLATE = {
  id: 'comdirect-giro',
  name: 'comdirect Girokonto',
  delimiter: ';',
  headerIdentifier: 'Buchungstag',
  textParser: 'comdirect',
  columns: {
    date: 'Buchungstag',
    valutaDate: 'Wertstellung (Valuta)',
    type: 'Vorgang',
    rawText: 'Buchungstext',
    amount: 'Umsatz in EUR'
  }
};

test('Import-Szenario: 4 alte Archive ohne Kontostand + 1 aktuelle Datei mit Duplikaten und Kontostand', async () => {
  const server = await startTestServer();
  const api = (route, method, body) => request(server.url, route, method, body);

  try {
    const profile = await (await api('/api/profiles', 'POST', { name: 'Test-Import-Archiv' })).json();
    const profileId = profile.id;

    // 1. Erstelle 4 Archiv-Dateien ohne Kontostand (Jahre 2022, 2023, 2024, 2025)
    const archive2022 = [
      '"Buchungstag";"Wertstellung (Valuta)";"Vorgang";"Buchungstext";"Umsatz in EUR"',
      '"10.03.2022";"10.03.2022";"Lastschrift";"Empfänger: Stadtwerke Buchungstext: Strom 2022";"-85,50"',
      '"15.06.2022";"15.06.2022";"Überweisung";"Auftraggeber: Arbeitgeber Buchungstext: Gehalt";"2.800,00"'
    ].join('\n');

    const archive2023 = [
      '"Buchungstag";"Wertstellung (Valuta)";"Vorgang";"Buchungstext";"Umsatz in EUR"',
      '"12.04.2023";"12.04.2023";"Kartenzahlung";"Empfänger: REWE Supermarkt Buchungstext: Einkauf";"-45,20"',
      '"20.08.2023";"20.08.2023";"Überweisung";"Empfänger: Vermieter Buchungstext: Miete August";"-750,00"'
    ].join('\n');

    const archive2024 = [
      '"Buchungstag";"Wertstellung (Valuta)";"Vorgang";"Buchungstext";"Umsatz in EUR"',
      '"05.01.2024";"05.01.2024";"Lastschrift";"Empfänger: Versicherung Buchungstext: Haftpflicht";"-62,00"',
      '"15.11.2024";"15.11.2024";"Kartenzahlung";"Empfänger: Tankstelle Buchungstext: Benzin";"-78,40"'
    ].join('\n');

    // Archiv 2025 enthält Buchung B1 und B2. B2 wird später auch in der aktuellen Datei enthalten sein!
    const archive2025 = [
      '"Buchungstag";"Wertstellung (Valuta)";"Vorgang";"Buchungstext";"Umsatz in EUR"',
      '"10.10.2025";"10.10.2025";"Überweisung";"Empfänger: Internetanbieter Buchungstext: Glasfaser";"-39,99"',
      '"28.12.2025";"28.12.2025";"Kartenzahlung";"Empfänger: Edeka Markt Buchungstext: Silvester-Einkauf";"-124,50"'
    ].join('\n');

    // 2. Aktuelle Datei (2026):
    // - Besitzt "Neuer Kontostand: 4.321,50 EUR" im Header
    // - Besitzt Zeitraum 01.12.2025 - 15.01.2026
    // - Enthält B2 ("28.12.2025 Edeka Silvester-Einkauf -124,50") NOCHMAL als Überschneidung!
    // - Enthält neue Buchungen von Januar 2026
    const currentFile = [
      '"Umsätze Girokonto"',
      '"Zeitraum: 01.12.2025 - 15.01.2026"',
      '"Alter Kontostand";"3.990,20 EUR"',
      '"Neuer Kontostand";"4.321,50 EUR"',
      '"IBAN";"DE12345678901234567890"',
      '',
      '"Buchungstag";"Wertstellung (Valuta)";"Vorgang";"Buchungstext";"Umsatz in EUR"',
      '"28.12.2025";"28.12.2025";"Kartenzahlung";"Empfänger: Edeka Markt Buchungstext: Silvester-Einkauf";"-124,50"',
      '"05.01.2026";"05.01.2026";"Überweisung";"Empfänger: Fitnessstudio Buchungstext: Monatsbeitrag";"-29,90"',
      '"12.01.2026";"12.01.2026";"Überweisung";"Auftraggeber: Arbeitgeber Buchungstext: Gehalt Jan";"3.100,00"'
    ].join('\n');

    const archives = [archive2022, archive2023, archive2024, archive2025];
    let totalImportedFromArchives = 0;

    // Importiere nacheinander die 4 alten Archive
    for (let idx = 0; idx < archives.length; idx++) {
      const content = archives[idx];
      const meta = extractComdirectMetadata(content);
      assert.equal(meta.newBalance, undefined, `Archiv ${idx + 1} darf keinen neuen Kontostand haben`);

      // Hole aktuelle Hashes aus DB zur Duplikaterkennung
      const currentData = await (await api(`/api/data?profileId=${profileId}`)).json();
      const existingHashes = new Set(currentData.transactions.map(t => t.sourceHash));

      const rows = parseBankCsv(content, COMDIRECT_TEMPLATE, existingHashes);
      assert.equal(rows.every(r => !r.isDuplicate), true, `Archiv ${idx + 1} sollte noch keine Duplikate haben`);

      const txs = rows.map(r => ({
        date: r.date,
        valutaDate: r.valutaDate,
        amount: r.amount,
        currency: 'EUR',
        payee: r.payee,
        purpose: r.purpose,
        rawText: r.rawText,
        type: r.type,
        category: r.category,
        account: COMDIRECT_TEMPLATE.name,
        sourceHash: r.sourceHash,
        status: r.status
      }));

      const res = await (await api('/api/transactions/batch', 'POST', {
        profileId,
        transactions: txs,
        accountCheckpoint: meta
      })).json();

      assert.equal(res.inserted, 2, `Archiv ${idx + 1} muss 2 Buchungen einfügen`);
      totalImportedFromArchives += res.inserted;
    }

    assert.equal(totalImportedFromArchives, 8, 'Insgesamt 8 Buchungen aus alten Archiven');

    // Stand vor dem aktuellen Import prüfen:
    const dataBeforeCurrent = await (await api(`/api/data?profileId=${profileId}`)).json();
    assert.equal(dataBeforeCurrent.transactions.length, 8);
    // Checkpoint darf noch NICHT 4.321,50 sein
    assert.notEqual(dataBeforeCurrent.accounts[0]?.checkpointBalance, 4321.50);

    // 3. Jetzt die aktuelle Datei importieren:
    const currentMeta = extractComdirectMetadata(currentFile);
    assert.equal(currentMeta.newBalance, 4321.50, 'Neuer Kontostand muss 4321.50 sein');
    assert.equal(currentMeta.endDate, '2026-01-15', 'Enddatum des Zeitraums muss 2026-01-15 sein');

    const hashesBefore = new Set(dataBeforeCurrent.transactions.map(t => t.sourceHash));
    const currentRows = parseBankCsv(currentFile, COMDIRECT_TEMPLATE, hashesBefore);

    // Die Edeka-Buchung vom 28.12.2025 muss als Duplikat erkannt werden!
    const duplicateRow = currentRows.find(r => r.date === '2025-12-28');
    assert.ok(duplicateRow, 'Edeka-Buchung muss in der Vorschau vorhanden sein');
    assert.equal(duplicateRow.isDuplicate, true, 'Edeka-Buchung MUSS als Duplikat markiert sein!');

    // Die beiden 2026er Buchungen müssen neu sein
    const newRows = currentRows.filter(r => !r.isDuplicate);
    assert.equal(newRows.length, 2, 'Genau 2 Buchungen müssen neu sein');

    // Jetzt batchImport ausführen (das Frontend sendet die Zeilen)
    const currentTxs = currentRows.map(r => ({
      date: r.date,
      valutaDate: r.valutaDate,
      amount: r.amount,
      currency: 'EUR',
      payee: r.payee,
      purpose: r.purpose,
      rawText: r.rawText,
      type: r.type,
      category: r.category,
      account: COMDIRECT_TEMPLATE.name,
      sourceHash: r.sourceHash,
      status: r.status
    }));

    const currentResult = await (await api('/api/transactions/batch', 'POST', {
      profileId,
      transactions: currentTxs,
      accountCheckpoint: currentMeta
    })).json();

    // Server muss Duplikat überspringen und nur 2 neue einfügen!
    assert.equal(currentResult.inserted, 2, 'Server darf nur 2 neue Buchungen einfügen');
    assert.equal(currentResult.duplicates, 1, 'Server muss genau 1 Duplikat überspringen');

    // 4. Finale DB-Validierung:
    const finalData = await (await api(`/api/data?profileId=${profileId}`)).json();
    assert.equal(finalData.transactions.length, 10, 'Insgesamt exakt 10 eindeutige Buchungen in der DB');

    // Kontostand-Checkpoint muss jetzt vom aktuellen Import gesetzt sein!
    const account = finalData.accounts.find(a => a.id === 'comdirect');
    assert.ok(account, 'Konto comdirect muss existieren');
    assert.equal(account.checkpointBalance, 4321.50, 'Kontostand muss auf 4321.50 aktualisiert sein');
    assert.equal(account.checkpointDate, '2026-01-15', 'Stichtag muss auf 2026-01-15 aktualisiert sein');
    assert.equal(account.iban, 'DE12345678901234567890', 'IBAN muss übernommen worden sein');

    console.log('VALIDATION SUCCESSFUL: Alle 4 Archive + aktuelle Datei mit Duplikaten und Kontostand fehlerfrei verifiziert!');
  } finally {
    await server.stop();
  }
});
