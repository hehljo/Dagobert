/** Deterministic UUIDv8 for namespaced identities, not for authentication or security. */
export function stableIdentity(namespace: string, value: string): string {
  const bytes = new TextEncoder().encode(`${namespace.length}:${namespace}${value}`);
  const mask = (1n << 128n) - 1n;
  let hash = 0x6c62272e07bb014262b821756295c58dn;
  for (const byte of bytes) hash = ((hash ^ BigInt(byte)) * 0x0000000001000000000000000000013bn) & mask;
  const hex = hash.toString(16).padStart(32, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20)}`;
}

/** Fingerprints identify import occurrences; they are never a global UNIQUE constraint. */
export function transactionIdentity(profileId: string, transaction: { syncId?: string; id?: number | string; sourceHash: string; account: string }, occurrence: number): string {
  if (transaction.syncId) return transaction.syncId;
  return stableIdentity(`transaction:${profileId}`, transaction.id !== undefined
    ? `id:${transaction.id}` : `import:${transaction.account}:${transaction.sourceHash}:${occurrence}`);
}

/** Stable descending tie-breaker for Docker integer IDs and native string IDs. */
export function compareTransactionIds(a: number | string | undefined, b: number | string | undefined): number {
  if (typeof a === 'number' && typeof b === 'number') return b - a;
  return String(b ?? '').localeCompare(String(a ?? ''), 'en', { numeric: true });
}
