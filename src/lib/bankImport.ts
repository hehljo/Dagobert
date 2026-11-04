import type { ImportPreviewRow, Transaction } from '../types/index.ts';
import { isValidCalendarDate } from './csvParser.ts';

export const COMDIRECT_SOURCE = 'comdirect_api_';
export function comdirectAccountFromSource(hash: string): string | undefined {
  if (typeof hash !== 'string' || !hash.startsWith(COMDIRECT_SOURCE)) return undefined;
  const value: unknown = JSON.parse(hash.slice(COMDIRECT_SOURCE.length));
  if (!Array.isArray(value) || value.length !== 2 || value.some(v => typeof v !== 'string' || !v)) {
    throw new Error('Ungültige Bankreferenz.');
  }
  return value[0] as string;
}
export interface BankTransaction {
  reference: string;
  bookingStatus: string;
  bookingDate: string;
  valutaDate?: string;
  amount: { value: string; unit: string };
  remitter?: { holderName?: string };
  creditor?: { holderName?: string };
  deptor?: { holderName?: string };
  remittanceInfo?: string;
  transactionType?: { key?: string; text?: string };
}

export async function readAllComdirectTransactions(fetchPage: (first: number) => Promise<{
  values?: BankTransaction[]; paging?: { index: number; matches: number };
}>): Promise<BankTransaction[]> {
  const all: BankTransaction[] = [];
  let total: number | undefined;
  for (let page = 0; page < 200; page++) {
    const result = await fetchPage(all.length);
    if (!Array.isArray(result.values) || !result.paging || !Number.isSafeInteger(result.paging.matches) ||
        result.paging.matches < 0 || result.paging.matches > 20000 || result.paging.index !== all.length ||
        (total !== undefined && total !== result.paging.matches)) {
      throw new Error('Der Bankabruf ist unvollständig oder hat sich während des Lesens geändert. Bitte neu abrufen; es wurde nichts gespeichert.');
    }
    total = result.paging.matches;
    all.push(...result.values);
    if (all.length > total || (result.values.length === 0 && all.length < total)) throw new Error('Der Bankabruf ist unvollständig. Es wurde nichts gespeichert.');
    if (all.length === total) return all;
  }
  throw new Error('Zu viele Abrufseiten. Es wurde nichts gespeichert.');
}

export function validBankDate(value: string): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  return isValidCalendarDate(y, m, d);
}

export function mapComdirectTransactions(values: BankTransaction[], accountId: string): ImportPreviewRow[] {
  const seen = new Set<string>();
  return values.map(value => {
    if (!value || value.bookingStatus !== 'BOOKED' || typeof value.reference !== 'string' || !value.reference ||
        !validBankDate(value.bookingDate) || value.amount?.unit !== 'EUR' ||
        typeof value.amount.value !== 'string' ||
        !/^-?\d+(?:\.\d{1,2})?$/.test(value.amount.value)) {
      throw new Error('Der Abruf enthält unvollständige Buchungen oder eine andere Währung. Es wurde nichts importiert.');
    }
    const amount = Number(value.amount.value);
    if (!Number.isSafeInteger(Math.round(amount * 100))) throw new Error('Ungültiger Buchungsbetrag.');
    const sourceHash = COMDIRECT_SOURCE + JSON.stringify([accountId, value.reference]);
    if (seen.has(sourceHash)) throw new Error('Der Bankabruf enthält wiederholte Referenzen. Bitte erneut abrufen.');
    seen.add(sourceHash);
    const purpose = value.remittanceInfo || '';
    const party = amount < 0 ? value.creditor : (value.remitter || value.deptor);
    return {
      date: value.bookingDate,
      valutaDate: value.valutaDate && validBankDate(value.valutaDate) ? value.valutaDate : undefined,
      amount, payee: party?.holderName || purpose.slice(0, 80) || 'Unbekannt', purpose,
      rawText: purpose, type: value.transactionType?.text || value.transactionType?.key || '',
      category: 'sonstiges', sourceHash, status: 'booked', isDuplicate: false,
    };
  });
}

// Cross-source similarity is a review hint, never permission to overwrite or merge.
export function possibleCrossSourceDuplicate(row: ImportPreviewRow, account: string, existing: Transaction[]): boolean {
  const api = row.sourceHash.startsWith(COMDIRECT_SOURCE);
  // CSV has no bank reference. Protect its entire historical range instead of
  // silently assuming differently formatted bank text represents a new payment.
  return existing.some(t => !t.isManual && t.account === account &&
    t.sourceHash.startsWith(COMDIRECT_SOURCE) !== api &&
    t.currency === 'EUR' && row.date <= t.date);
}
