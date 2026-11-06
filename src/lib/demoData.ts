import { DEFAULT_ACCOUNT } from '../data/defaults.ts';
import type { Transaction } from '../types/index.ts';

// Demo-Buchungen relativ zum heutigen Tag: laufender Monat bis heute plus zwei volle Vormonate.
// So zeigen Übersicht, Budgetmonat und Statistik nach dem Laden sofort Werte, egal wann jemand
// (etwa die App-Prüfung) die App öffnet. Rein und ohne Umgebung, damit Tests sie direkt aufrufen.
type DemoEntry = { day: number; amount: number; payee: string; purpose: string; type: string; category: string };

const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export const DEMO_MONTHS = 3;

function entries(monthIndex: number, monthLabel: string, mmYYYY: string, variant: number): DemoEntry[] {
  // variant 0..2 verschiebt Beträge leicht, damit die Monate nicht identisch aussehen
  const v = (base: number, step: number) => Math.round((base + step * variant) * 100) / 100;
  return [
    { day: 1, amount: 3250, payee: 'Arbeitgeber GmbH', purpose: `Gehalt ${monthLabel}`, type: 'Übertrag / Überweisung', category: 'gehalt' },
    { day: 2, amount: -850, payee: 'Hausverwaltung Becker', purpose: `Miete & Nebenkosten ${mmYYYY}`, type: 'Dauerauftrag / Lastschrift', category: 'wohnen' },
    { day: 3, amount: -250, payee: 'Depot Sparplan', purpose: `ETF-Sparplan ${mmYYYY}`, type: 'Dauerauftrag / Lastschrift', category: 'investieren' },
    { day: 4, amount: v(-64.8, 7.35), payee: 'REWE Markt GmbH', purpose: 'Einkauf Lebensmittel', type: 'Kartenverfügung', category: 'lebensmittel' },
    { day: 7, amount: v(-71.2, -4.1), payee: 'Aral Tankstelle', purpose: 'Tanken', type: 'Kartenverfügung', category: 'mobilitaet' },
    { day: 9, amount: -17.99, payee: 'Streaming-Abo', purpose: `Monatsabo ${mmYYYY}`, type: 'Lastschrift / Belastung', category: 'abos' },
    { day: 11, amount: v(-48.3, 5.2), payee: 'Edeka Center', purpose: 'Einkauf Lebensmittel', type: 'Kartenverfügung', category: 'lebensmittel' },
    { day: 14, amount: v(-45, 12.5), payee: 'Kino & Café am Markt', purpose: 'Freizeit', type: 'Kartenverfügung', category: 'freizeit' },
    { day: 17, amount: v(-89.9, -20), payee: 'Kaufhaus Müller', purpose: 'Kleidung', type: 'Kartenverfügung', category: 'shopping' },
    { day: 19, amount: v(-56.75, 3.6), payee: 'Aldi Süd', purpose: 'Einkauf Lebensmittel', type: 'Kartenverfügung', category: 'lebensmittel' },
    { day: 23, amount: v(-24.5, monthIndex % 2 ? 8 : 0), payee: 'Apotheke am Dom', purpose: 'Apotheke', type: 'Kartenverfügung', category: 'gesundheit' },
    { day: 27, amount: v(-38.4, 2.9), payee: 'Lidl', purpose: 'Einkauf Lebensmittel', type: 'Kartenverfügung', category: 'lebensmittel' },
  ];
}

const pad = (n: number) => String(n).padStart(2, '0');

export function buildDemoTransactions(today: Date, importedAt = new Date().toISOString()): Partial<Transaction>[] {
  const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const result: Partial<Transaction>[] = [];
  for (let offset = DEMO_MONTHS - 1; offset >= 0; offset--) {
    const first = new Date(today.getFullYear(), today.getMonth() - offset, 1);
    const year = first.getFullYear(), month = first.getMonth();
    const monthKey = `${year}-${pad(month + 1)}`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    entries(month, `${MONTH_NAMES[month]} ${year}`, `${pad(month + 1)}/${year}`, offset).forEach((entry, index) => {
      const date = `${monthKey}-${pad(Math.min(entry.day, lastDay))}`;
      if (date > todayKey) return;
      const sign = entry.amount >= 0 ? 'Auftraggeber' : 'Empfänger';
      result.push({
        date, amount: entry.amount, currency: 'EUR', payee: entry.payee, purpose: entry.purpose,
        rawText: `${sign}: ${entry.payee} Buchungstext: ${entry.purpose}`, type: entry.type, category: entry.category,
        account: DEFAULT_ACCOUNT.name, accountId: DEFAULT_ACCOUNT.id, status: 'booked', importedAt,
        sourceHash: `demo_${monthKey}_${index + 1}`,
      });
    });
  }
  return result;
}
