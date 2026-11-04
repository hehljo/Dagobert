import { registerPlugin } from '@capacitor/core';
import { detectPlatform } from '../platform/capabilities.ts';
import type { Transaction } from '../types/index.ts';
import type { BankTransaction } from '../lib/bankImport.ts';

export interface ComdirectAccount { accountId: string; iban: string; label: string; currency: string }
export interface ComdirectReply {
  saved?: boolean; pinStored?: boolean; canSave?: boolean;
  sessionId?: string;
  challenge?: { typ: 'P_TAN' | 'P_TAN_PUSH' | 'M_TAN'; image?: string };
  accounts?: ComdirectAccount[];
  values?: BankTransaction[];
  paging?: { index: number; matches: number };
}
const bridge = registerPlugin<{
  comdirect(options: Record<string, unknown>): Promise<ComdirectReply>;
  batchImportTransactions(options: Record<string, unknown>): Promise<{ inserted: number; updated: number; duplicates: number }>;
}>('DagobertPlugin');

export async function comdirect(operation: string, profileId: string, options: Record<string, unknown> = {}): Promise<ComdirectReply> {
  if (detectPlatform().isNative) return bridge.comdirect({ ...options, operation, profileId });
  if (location.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    throw new Error('Für den Bankzugang ist HTTPS erforderlich.');
  }
  const response = await fetch(`/api/comdirect/${encodeURIComponent(operation)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
    body: JSON.stringify({ ...options, profileId }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Der Bankabruf ist fehlgeschlagen.');
  return data;
}

export async function appendComdirectTransactions(profileId: string, transactions: Transaction[], reviewedHashes: string[]) {
  if (detectPlatform().isNative) return bridge.batchImportTransactions({ profileId, transactions, appendOnly: true, reviewedHashes });
  const response = await fetch('/api/transactions/batch', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId, transactions, appendOnly: true, reviewedHashes }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Die Buchungen konnten nicht gespeichert werden.');
  return data as { inserted: number; updated: number; duplicates: number };
}
