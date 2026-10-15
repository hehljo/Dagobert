import { describe, it, expect } from 'vitest';
import { parseBankCsv, parseGermanAmount, parseGermanDate, parseComdirectBuchungstext } from '../lib/csvParser.ts';
import { evaluateRules } from '../lib/rulesEngine.ts';
import { COMDIRECT_TEMPLATE, DEFAULT_RULES } from '../lib/db.ts';

describe('CSV Parser & comdirect specifics', () => {
  it('parses German amounts with comma and dot thousands', () => {
    expect(parseGermanAmount('1.234,56')).toBe(1234.56);
    expect(parseGermanAmount('-45,99 €')).toBe(-45.99);
    expect(parseGermanAmount('0,00')).toBe(0);
    expect(parseGermanAmount('-1.000.500,25')).toBe(-1000500.25);
  });

  it('parses German dates to ISO YYYY-MM-DD', () => {
    expect(parseGermanDate('15.10.2026')).toBe('2026-10-15');
    expect(parseGermanDate('01.01.2025')).toBe('2025-01-01');
  });

  it('extracts payee and purpose from comdirect Buchungstext', () => {
    const raw = 'Auftraggeber: Arbeitgeber GmbH Buchungstext: Gehalt Oktober 2026 Ref. 12345';
    const parsed = parseComdirectBuchungstext(raw);
    expect(parsed.payee).toBe('Arbeitgeber GmbH');
    expect(parsed.purpose).toBe('Gehalt Oktober 2026');
  });

  it('extracts recipient and purpose from direct debit', () => {
    const raw = 'Empfänger: REWE Markt GmbH Buchungstext: Kartenzahlung 14.10. IBAN: DE1234567890';
    const parsed = parseComdirectBuchungstext(raw);
    expect(parsed.payee).toBe('REWE Markt GmbH');
    expect(parsed.purpose).toBe('Kartenzahlung 14.10.');
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

    // Row 1: Gehalt
    expect(rows[0].date).toBe('2026-10-12');
    expect(rows[0].payee).toBe('Arbeitgeber GmbH');
    expect(rows[0].amount).toBe(3450.00);
    expect(rows[0].type).toBe('Übertrag / Überweisung');

    // Row 2: REWE
    expect(rows[1].payee).toBe('REWE Markt GmbH');
    expect(rows[1].amount).toBe(-84.50);

    // Test Rule Evaluation
    const cat1 = evaluateRules(rows[0], DEFAULT_RULES);
    expect(cat1.category).toBe('gehalt');

    const cat2 = evaluateRules(rows[1], DEFAULT_RULES);
    expect(cat2.category).toBe('lebensmittel');

    const cat3 = evaluateRules(rows[2], DEFAULT_RULES);
    expect(cat3.category).toBe('mobilitaet');

    const cat4 = evaluateRules(rows[3], DEFAULT_RULES);
    expect(cat4.category).toBe('abos');
  });
});
