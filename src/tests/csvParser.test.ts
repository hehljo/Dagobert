import { describe, it, expect } from 'vitest';
import {
  parseBankCsv,
  parseGermanAmount,
  parseGermanDate,
  parseComdirectBuchungstext,
  computeTransactionHash
} from '../lib/csvParser.ts';
import { evaluateRules, createSuggestedRule } from '../lib/rulesEngine.ts';
import { COMDIRECT_TEMPLATE, DEFAULT_RULES } from '../lib/db.ts';

describe('CSV Parser & comdirect specifics', () => {
  it('parses German amounts with comma and dot thousands and rejects invalid', () => {
    expect(parseGermanAmount('1.234,56')).toBe(1234.56);
    expect(parseGermanAmount('-45,99 €')).toBe(-45.99);
    expect(parseGermanAmount('0,00')).toBe(0);
    expect(parseGermanAmount('-1.000.500,25')).toBe(-1000500.25);
    expect(parseGermanAmount('unbekannt')).toBe(null);
  });

  it('parses German dates to ISO YYYY-MM-DD and rejects invalid calendar days', () => {
    expect(parseGermanDate('15.10.2026')).toBe('2026-10-15');
    expect(parseGermanDate('01.01.2025')).toBe('2025-01-01');
    expect(parseGermanDate('31.02.2026')).toBe(null); // Invalid day in Feb!
    expect(parseGermanDate('32.01.2026')).toBe(null); // Invalid day
  });

  it('prevents hash collisions between similar short texts like Aa and BB', () => {
    const hashAa = computeTransactionHash('2026-10-15', 50.0, 'Aa');
    const hashBb = computeTransactionHash('2026-10-15', 50.0, 'BB');
    expect(hashAa).not.toBe(hashBb);
  });

  it('extracts payee and purpose from comdirect Buchungstext', () => {
    const raw = 'Auftraggeber: Arbeitgeber GmbH Buchungstext: Gehalt Oktober 2026 Ref. 12345';
    const parsed = parseComdirectBuchungstext(raw);
    expect(parsed.payee).toBe('Arbeitgeber GmbH');
    expect(parsed.purpose).toBe('Gehalt Oktober 2026');
  });

  it('learned user rule has priority 5 and beats default rules', () => {
    const dummyTx = {
      date: '2026-10-15',
      amount: -45.0,
      currency: 'EUR',
      payee: 'REWE Markt GmbH',
      purpose: 'Wocheneinkauf',
      rawText: 'Empfänger: REWE Markt GmbH',
      type: 'Lastschrift',
      category: 'sonstiges',
      account: 'Girokonto',
      importedAt: '',
      sourceHash: ''
    };

    // By default, REWE is 'lebensmittel' (priority 20)
    const initial = evaluateRules(dummyTx, DEFAULT_RULES);
    expect(initial.category).toBe('lebensmittel');

    // User learns rule: REWE should be 'freizeit'
    const userRule = createSuggestedRule(dummyTx, 'freizeit');
    expect(userRule).not.toBeNull();
    expect(userRule!.priority).toBe(5); // Priority 5 beats 20!

    const combined = evaluateRules(dummyTx, [userRule!, ...DEFAULT_RULES]);
    expect(combined.category).toBe('freizeit');
  });

  it('parses realistic comdirect CSV with metadata and Umlauts', () => {
    const csvContent = `
"Umsätze Girokonto";"Zeitraum: 01.10.2026 - 15.10.2026"
"Konto";"DE12345678901234567890"

"Buchungstag";"Wertstellung (Valuta)";"Vorgang";"Buchungstext";"Umsatz in EUR"
"12.10.2026";"12.10.2026";"Übertrag / Überweisung";"Auftraggeber: Arbeitgeber GmbH Buchungstext: Gehalt Oktober 2026";"3.450,00"
"13.10.2026";"13.10.2026";"Lastschrift / Belastung";"Empfänger: REWE Markt GmbH Buchungstext: Einkauf Wocheneinkauf";"-84,50"
"14.10.2026";"14.10.2026";"Kartenverfügung";"Empfänger: ARAL Tankstelle Buchungstext: Tanken Super E10";"-72,10"
"15.10.2026";"15.10.2026";"Lastschrift / Belastung";"Empfänger: Netflix International Buchungstext: Abo Monatsbeitrag";"-17,99"
`;

    const rows = parseBankCsv(csvContent, COMDIRECT_TEMPLATE);
    expect(rows.length).toBe(4);

    expect(rows[0].date).toBe('2026-10-12');
    expect(rows[0].payee).toBe('Arbeitgeber GmbH');
    expect(rows[0].amount).toBe(3450.0);
    expect(rows[0].type).toBe('Übertrag / Überweisung');
  });
});
