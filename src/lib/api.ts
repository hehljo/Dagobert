import type { Profile, Account, Category, CategoryRule, Transaction, BankTemplate, CsvMetadata } from '../types/index.ts';

const BASE_URL = ''; // Relative to current host so it works across any IP/domain/Tailscale!

export class ProfileLockedError extends Error {}

export async function fetchProfiles(): Promise<Profile[]> {
  const res = await fetch(`${BASE_URL}/api/profiles`);
  if (!res.ok) throw new Error('Fehler beim Laden der Profile');
  return res.json();
}

export async function createProfile(name: string, icon: string = 'User', color: string = '#0A84FF', pin?: string): Promise<Profile> {
  const res = await fetch(`${BASE_URL}/api/profiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, icon, color, pin })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Fehler beim Erstellen des Profils');
  }
  return res.json();
}

export async function unlockProfile(profileId: string, pin: string): Promise<boolean> {
  const res = await fetch(`${BASE_URL}/api/profiles/${profileId}/unlock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin })
  });
  if (res.status === 401) return false;
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Entsperren fehlgeschlagen. Bitte die Verbindung prüfen.');
  }
  return res.ok;
}

export async function fetchProfileData(profileId: string): Promise<{
  profile: Profile;
  accounts: Account[];
  categories: Category[];
  rules: CategoryRule[];
  transactions: Transaction[];
  bankTemplates: BankTemplate[];
}> {
  const res = await fetch(`${BASE_URL}/api/data?profileId=${encodeURIComponent(profileId)}`);
  if (res.status === 401) throw new ProfileLockedError();
  if (!res.ok) throw new Error('Fehler beim Laden der Kontodaten');
  return res.json();
}

export async function batchImportTransactions(
  profileId: string,
  transactions: Partial<Transaction>[],
  accountCheckpoint?: CsvMetadata
): Promise<{ inserted: number; updated: number; duplicates: number }> {
  const res = await fetch(`${BASE_URL}/api/transactions/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profileId,
      transactions,
      accountCheckpoint
    })
  });
  if (!res.ok) throw new Error('Fehler beim Speichern der Buchungen');
  return res.json();
}

export async function createManualTransaction(profileId: string, transaction: Transaction): Promise<number> {
  const res = await fetch(`${BASE_URL}/api/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId, transaction })
  });
  if (!res.ok) throw new Error('Fehler beim Anlegen der Buchung');
  const data = await res.json();
  return data.id;
}

export async function updateExistingTransaction(id: number, transaction: Partial<Transaction>): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/transactions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction })
  });
  if (!res.ok) throw new Error('Fehler beim Aktualisieren der Buchung');
}

export async function deleteExistingTransaction(id: number): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/transactions/${id}`, {
    method: 'DELETE'
  });
  if (!res.ok) throw new Error('Fehler beim Löschen der Buchung');
}

export async function updateAccountSettings(
  profileId: string,
  id: string,
  initialBalance?: number,
  initialBalanceDate?: string,
  checkpointBalance?: number | null,
  checkpointDate?: string | null
): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/accounts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId, initialBalance, initialBalanceDate, checkpointBalance, checkpointDate })
  });
  if (!res.ok) throw new Error('Fehler beim Aktualisieren des Kontos');
}

export async function createCategoryRule(profileId: string, rule: CategoryRule): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId, rule })
  });
  if (!res.ok) throw new Error('Fehler beim Speichern der Regel');
}

export async function deleteCategoryRule(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/rules/${id}`, {
    method: 'DELETE'
  });
  if (!res.ok) throw new Error('Fehler beim Löschen der Regel');
}

export async function deleteCategoryRuleScoped(profileId: string, id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/rules/${id}?profileId=${encodeURIComponent(profileId)}`, {
    method: 'DELETE'
  });
  if (!res.ok) throw new Error('Fehler beim Löschen der Regel');
}

export async function exportProfileBackup(profileId: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/backup?profileId=${encodeURIComponent(profileId)}`);
  if (!res.ok) throw new Error('Fehler beim Exportieren des Backups');
  return res.json();
}

export async function importProfileBackup(profileId: string, data: any): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/backup/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId, data })
  });
  if (!res.ok) throw new Error('Fehler beim Wiederherstellen des Backups');
}

export async function resetProfileData(profileId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId })
  });
  if (!res.ok) throw new Error('Fehler beim Zurücksetzen des Profils');
}
