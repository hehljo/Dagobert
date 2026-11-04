import type {
  IDagobertRepository,
  BatchImportResult,
  RulePresetResult,
  BackupPayload,
  BackupValidationResult,
  BackupImportMode,
  RecoveryBackup
} from './interfaces.ts';
import type {
  Profile,
  Account,
  Category,
  CategoryRule,
  Transaction,
  BankTemplate,
  CsvMetadata
} from '../types/index.ts';
import { validateBackupPayload, normalizeBackupPayload } from './backupSchema.ts';
import type { RulesPackage, RulesImportResult } from './rulesPackage.ts';

const BASE_URL = '';

export class ProfileLockedError extends Error {}

export class WebDagobertRepository implements IDagobertRepository {
  async importRulesPackage(profileId: string, data: RulesPackage): Promise<RulesImportResult> {
    const response = await fetch('/api/rules/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId, data }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Regeln konnten nicht importiert werden.');
    return result;
  }
  async getProfiles(): Promise<Profile[]> {
    const res = await fetch(`${BASE_URL}/api/profiles`);
    if (!res.ok) throw new Error('Fehler beim Laden der Profile');
    return res.json();
  }

  async createProfile(name: string, icon = 'User', color = '#0A84FF', pin?: string): Promise<Profile> {
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

  async updateProfile(
    profileId: string,
    updates: { name?: string; icon?: string; color?: string; pin?: string; removePin?: boolean }
  ): Promise<{ success: boolean; hasPin: boolean }> {
    const res = await fetch(`${BASE_URL}/api/profiles/${encodeURIComponent(profileId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Fehler beim Aktualisieren des Profils');
    }
    return res.json();
  }

  async deleteProfile(profileId: string): Promise<void> {
    const res = await fetch(`${BASE_URL}/api/profiles/${encodeURIComponent(profileId)}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Fehler beim Löschen des Profils');
    }
  }

  async unlockProfile(profileId: string, pin: string): Promise<boolean> {
    const res = await fetch(`${BASE_URL}/api/profiles/${encodeURIComponent(profileId)}/unlock`, {
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

  async getProfileData(profileId: string): Promise<{
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

  async batchImportTransactions(
    profileId: string,
    transactions: Partial<Transaction>[],
    accountCheckpoint?: CsvMetadata
  ): Promise<BatchImportResult> {
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

  async createManualTransaction(profileId: string, transaction: Transaction): Promise<number | string> {
    const res = await fetch(`${BASE_URL}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId, transaction })
    });
    if (!res.ok) throw new Error('Fehler beim Anlegen der Buchung');
    const data = await res.json();
    return data.id;
  }

  async updateTransaction(id: number | string, transaction: Partial<Transaction>): Promise<void> {
    const res = await fetch(`${BASE_URL}/api/transactions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction })
    });
    if (!res.ok) throw new Error('Fehler beim Aktualisieren der Buchung');
  }

  async deleteTransaction(id: number | string): Promise<void> {
    const res = await fetch(`${BASE_URL}/api/transactions/${id}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error('Fehler beim Löschen der Buchung');
  }

  async updateAccountSettings(
    profileId: string,
    id: string,
    initialBalance?: number,
    initialBalanceDate?: string,
    checkpointBalance?: number | null,
    checkpointDate?: string | null
  ): Promise<void> {
    const res = await fetch(`${BASE_URL}/api/accounts/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId, initialBalance, initialBalanceDate, checkpointBalance, checkpointDate })
    });
    if (!res.ok) throw new Error('Fehler beim Aktualisieren des Kontos');
  }

  async createCategory(profileId: string, category: Partial<Category>): Promise<Category> {
    const res = await fetch(`${BASE_URL}/api/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId, category })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Fehler beim Speichern der Kategorie');
    }
    const data = await res.json();
    return data.category;
  }

  async deleteCategory(profileId: string, id: string): Promise<void> {
    const res = await fetch(`${BASE_URL}/api/categories/${encodeURIComponent(id)}?profileId=${encodeURIComponent(profileId)}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error('Fehler beim Löschen der Kategorie');
  }

  async createRule(profileId: string, rule: CategoryRule): Promise<void> {
    const res = await fetch(`${BASE_URL}/api/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId, rule })
    });
    if (!res.ok) throw new Error('Fehler beim Speichern der Regel');
  }

  async deleteRule(profileId: string, id: string): Promise<void> {
    const res = await fetch(`${BASE_URL}/api/rules/${encodeURIComponent(id)}?profileId=${encodeURIComponent(profileId)}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error('Fehler beim Löschen der Regel');
  }

  async loadStandardRules(profileId: string): Promise<RulePresetResult> {
    const res = await fetch(`${BASE_URL}/api/rules/defaults`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId })
    });
    if (!res.ok) throw new Error('Standard-Regeln konnten nicht geladen werden. Bitte erneut versuchen.');
    return res.json();
  }

  async exportBackup(profileId: string, includeAllProfiles = false): Promise<BackupPayload> {
    const res = await fetch(`${BASE_URL}/api/backup?profileId=${encodeURIComponent(profileId)}&allProfiles=${includeAllProfiles}`);
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'Fehler beim Exportieren des Backups');
    }
    return normalizeBackupPayload(await res.json());
  }

  validateBackup(payload: unknown): BackupValidationResult {
    return validateBackupPayload(payload);
  }

  async importBackup(profileId: string, payload: BackupPayload, mode: BackupImportMode = 'replace'): Promise<void> {
    const normalized = normalizeBackupPayload(payload);
    const res = await fetch(`${BASE_URL}/api/backup/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId, data: normalized, mode })
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'Fehler beim Wiederherstellen des Backups');
    }
  }

  async getRecoveryBackups(profileId: string): Promise<RecoveryBackup[]> {
    const res = await fetch(`/api/backup/recovery?profileId=${encodeURIComponent(profileId)}`);
    if (!res.ok) throw new Error('Wiederherstellungssicherungen konnten nicht geladen werden.');
    return (await res.json()).backups;
  }
  async exportRecoveryBackup(id: string, profileId: string): Promise<BackupPayload> {
    const res = await fetch(`/api/backup/recovery/${encodeURIComponent(id)}?profileId=${encodeURIComponent(profileId)}`);
    if (!res.ok) throw new Error('Sicherung konnte nicht geöffnet werden. Bitte alle betroffenen Profile entsperren.');
    return normalizeBackupPayload(await res.json());
  }

  async resetProfileData(profileId: string): Promise<void> {
    const res = await fetch(`${BASE_URL}/api/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId })
    });
    if (!res.ok) throw new Error('Fehler beim Zurücksetzen des Profils');
  }
}
