import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, COMDIRECT_TEMPLATE } from '../lib/db.ts';
import { autoCategorizePreview, createSuggestedRule, evaluateRules } from '../lib/rulesEngine.ts';
import { parseBankCsv } from '../lib/csvParser.ts';

const merchants: [string, string[]][] = [
  ['shopping', ['ZALANDO', 'ZARA', 'H&M', 'H AND M', 'HENNES', 'ABOUT YOU', 'ASOS', 'BREUNINGER', 'PEEK', 'CLOPPENBURG', 'C&A', 'SNIPES', 'OTTO', 'BESTSECRET', 'TK MAXX', 'PRIMARK', 'DEICHMANN', 'NEW YORKER', 'MANGO', 'UNIQLO', 'BONPRIX', 'AMAZON']],
  ['freizeit', ['LIEFERANDO', 'WOLT', 'UBER EATS', 'MCDONALD', "McDonald's", 'MCDONALDS', 'BURGER KING', 'SUBWAY', 'DOMINO', "Domino's", 'VAPIANO', 'KFC', 'STARBUCKS', 'BACKWERK', 'DEAN AND DAVID']],
  ['wohnen', ['TELEKOM', 'VODAFONE', 'O2', '1&1', 'CONGSTAR', 'RUNDFUNK', 'BEITRAGSSERVICE', 'GEZ', 'STADTWERKE', 'ENBW', 'E.ON', 'VATTENFALL']],
  ['gesundheit', ['DM-DROGERIE', 'DM FIL', 'ROSSMANN', 'MUELLER', 'DOCMORRIS', 'SHOP-APOTHEKE', 'APOTHEKE']]
];
const transaction = (rawText: string) => ({
  date: '2022-01-01', amount: -20, currency: 'EUR', payee: 'Zahlungsdienstleister', purpose: 'Kartenzahlung',
  rawText, type: 'Lastschrift', category: 'sonstiges', account: 'comdirect', importedAt: '', sourceHash: ''
});

describe('Standard merchant catalog', () => {
  for (const [category, names] of merchants) {
    it.each(names)(`classifies %s as ${category} using the full bank text`, name => {
      expect(evaluateRules(transaction(`Kartenverfügung ${name.toLowerCase()} Ref. 123`), DEFAULT_RULES).category).toBe(category);
    });
  }

  it.each(['LOTTO', 'MO2X-12345', 'BEZON', 'ZARATHUSTRA', 'DOMINOSTEIN'])('does not classify a substring or wildcard lookalike: %s', name => {
    expect(evaluateRules(transaction(`Referenz ${name}`), DEFAULT_RULES).matchedRule).toBeUndefined();
  });

  it('keeps specific Amazon Prime subscriptions ahead of general Amazon shopping', () => {
    expect(evaluateRules(transaction('AMAZON PRIME'), DEFAULT_RULES).category).toBe('abos');
  });

  it('keeps learned rules ahead of the merchant catalog', () => {
    const tx = transaction('ZALANDO');
    const learned = createSuggestedRule(tx, 'freizeit')!;
    expect(evaluateRules(tx, [...DEFAULT_RULES, learned]).category).toBe('freizeit');
  });

  it('ignores disabled presets', () => {
    const rules = DEFAULT_RULES.map(rule => rule.id === 'rule-shopping' ? { ...rule, enabled: false } : rule);
    expect(evaluateRules(transaction('ZALANDO'), rules).category).toBe('sonstiges');
  });

  it('categorizes real parsed comdirect archive rows in the import preview', () => {
    const csv = [
      '"Buchungstag";"Wertstellung (Valuta)";"Vorgang";"Buchungstext";"Umsatz in EUR"',
      '"10.03.2022";"10.03.2022";"Lastschrift";"Empfänger: Zahlungsdienstleister Buchungstext: SHOP-APOTHEKE Bestellung";"-20,00"'
    ].join('\n');
    const rows = autoCategorizePreview(parseBankCsv(csv, COMDIRECT_TEMPLATE), DEFAULT_RULES);
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe('gesundheit');
    expect(rows[0].date).toBe('2022-03-10');
  });
});
