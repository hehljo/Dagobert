import { registerPlugin } from '@capacitor/core';
import type {
  IDagobertRepository,
  BatchImportResult,
  RulePresetResult,
  BackupPayload,
  BackupValidationResult,
  BackupImportMode,
  CloudKitSyncStatus
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
import { validateBackupPayload, normalizeBackupPayload, CURRENT_BACKUP_SCHEMA_VERSION, BACKUP_FORMAT_IDENTIFIER } from './backupSchema.ts';
import standardRules from '../lib/standardRules.json';

interface DagobertNativePluginInterface {
  getProfiles(): Promise<{ profiles: Profile[] }>;
  createProfile(options: { name: string; icon?: string; color?: string; pin?: string }): Promise<Profile>;
  updateProfile(options: { profileId: string; name?: string; icon?: string; color?: string; pin?: string; removePin?: boolean }): Promise<{ success: boolean; hasPin: boolean }>;
  deleteProfile(options: { profileId: string }): Promise<{ success: boolean }>;
  unlockProfile(options: { profileId: string; pin: string }): Promise<{ success: boolean }>;

  getProfileData(options: { profileId: string }): Promise<{
    profile: Profile;
    accounts: Account[];
    categories: Category[];
    rules: CategoryRule[];
    transactions: Transaction[];
    bankTemplates: BankTemplate[];
  }>;

  batchImportTransactions(options: {
    profileId: string;
    transactions: Partial<Transaction>[];
    accountCheckpoint?: CsvMetadata;
  }): Promise<BatchImportResult>;

  createManualTransaction(options: { profileId: string; transaction: Transaction }): Promise<{ id: string }>;
  updateTransaction(options: { id: string; transaction: Partial<Transaction> }): Promise<{ success: boolean }>;
  deleteTransaction(options: { id: string }): Promise<{ success: boolean }>;

  updateAccountSettings(options: {
    profileId: string;
    id: string;
    initialBalance?: number;
    initialBalanceDate?: string;
    checkpointBalance?: number | null;
    checkpointDate?: string | null;
  }): Promise<{ success: boolean }>;

  createCategory(options: { profileId: string; category: Partial<Category> }): Promise<{ category: Category }>;
  deleteCategory(options: { profileId: string; id: string }): Promise<{ success: boolean }>;

  createRule(options: { profileId: string; rule: CategoryRule }): Promise<{ success: boolean }>;
  deleteRule(options: { profileId: string; id: string }): Promise<{ success: boolean }>;
  loadStandardRules(options: { profileId: string; standardRulesJson: string }): Promise<RulePresetResult>;

  exportBackup(options: { profileId: string; includeAllProfiles?: boolean }): Promise<{ backup: BackupPayload }>;
  importBackup(options: { profileId: string; data: BackupPayload; mode?: string }): Promise<{ success: boolean }>;
  resetProfileData(options: { profileId: string }): Promise<{ success: boolean }>;

  getSyncStatus(): Promise<CloudKitSyncStatus>;
  setSyncEnabled(options: { enabled: boolean }): Promise<{ enabled: boolean }>;
  triggerSync(): Promise<{ success: boolean }>;

  canUseBiometrics(): Promise<{ available: boolean }>;
  authenticateBiometrics(options?: { reason?: string }): Promise<{ success: boolean }>;
}

export const DagobertNativePlugin = registerPlugin<DagobertNativePluginInterface>('DagobertPlugin');

export class NativeDagobertRepository implements IDagobertRepository {
  async getProfiles(): Promise<Profile[]> {
    const res = await DagobertNativePlugin.getProfiles();
    return res.profiles;
  }

  async createProfile(name: string, icon?: string, color?: string, pin?: string): Promise<Profile> {
    return DagobertNativePlugin.createProfile({ name, icon, color, pin });
  }

  async updateProfile(
    profileId: string,
    updates: { name?: string; icon?: string; color?: string; pin?: string; removePin?: boolean }
  ): Promise<{ success: boolean; hasPin: boolean }> {
    return DagobertNativePlugin.updateProfile({ profileId, ...updates });
  }

  async deleteProfile(profileId: string): Promise<void> {
    await DagobertNativePlugin.deleteProfile({ profileId });
  }

  async unlockProfile(profileId: string, pin: string): Promise<boolean> {
    const res = await DagobertNativePlugin.unlockProfile({ profileId, pin });
    return res.success;
  }

  async getProfileData(profileId: string): Promise<{
    profile: Profile;
    accounts: Account[];
    categories: Category[];
    rules: CategoryRule[];
    transactions: Transaction[];
    bankTemplates: BankTemplate[];
  }> {
    return DagobertNativePlugin.getProfileData({ profileId });
  }

  async batchImportTransactions(
    profileId: string,
    transactions: Partial<Transaction>[],
    accountCheckpoint?: CsvMetadata
  ): Promise<BatchImportResult> {
    return DagobertNativePlugin.batchImportTransactions({
      profileId,
      transactions,
      accountCheckpoint
    });
  }

  async createManualTransaction(profileId: string, transaction: Transaction): Promise<number | string> {
    const res = await DagobertNativePlugin.createManualTransaction({ profileId, transaction });
    return res.id;
  }

  async updateTransaction(id: number | string, transaction: Partial<Transaction>): Promise<void> {
    await DagobertNativePlugin.updateTransaction({ id: String(id), transaction });
  }

  async deleteTransaction(id: number | string): Promise<void> {
    await DagobertNativePlugin.deleteTransaction({ id: String(id) });
  }

  async updateAccountSettings(
    profileId: string,
    id: string,
    initialBalance?: number,
    initialBalanceDate?: string,
    checkpointBalance?: number | null,
    checkpointDate?: string | null
  ): Promise<void> {
    await DagobertNativePlugin.updateAccountSettings({
      profileId,
      id,
      initialBalance,
      initialBalanceDate,
      checkpointBalance,
      checkpointDate
    });
  }

  async createCategory(profileId: string, category: Partial<Category>): Promise<Category> {
    const res = await DagobertNativePlugin.createCategory({ profileId, category });
    return res.category;
  }

  async deleteCategory(profileId: string, id: string): Promise<void> {
    await DagobertNativePlugin.deleteCategory({ profileId, id });
  }

  async createRule(profileId: string, rule: CategoryRule): Promise<void> {
    await DagobertNativePlugin.createRule({ profileId, rule });
  }

  async deleteRule(profileId: string, id: string): Promise<void> {
    await DagobertNativePlugin.deleteRule({ profileId, id });
  }

  async loadStandardRules(profileId: string): Promise<RulePresetResult> {
    return DagobertNativePlugin.loadStandardRules({
      profileId,
      standardRulesJson: JSON.stringify(standardRules)
    });
  }

  async exportBackup(profileId: string, includeAllProfiles = false): Promise<BackupPayload> {
    const res = await DagobertNativePlugin.exportBackup({ profileId, includeAllProfiles });
    const normalized = normalizeBackupPayload(res.backup, profileId);
    normalized.format = BACKUP_FORMAT_IDENTIFIER;
    normalized.schemaVersion = CURRENT_BACKUP_SCHEMA_VERSION;
    normalized.sourcePlatform = 'ios';
    return normalized;
  }

  validateBackup(payload: unknown): BackupValidationResult {
    return validateBackupPayload(payload);
  }

  async importBackup(profileId: string, payload: BackupPayload, mode: BackupImportMode = 'replace'): Promise<void> {
    const normalized = normalizeBackupPayload(payload, profileId);
    await DagobertNativePlugin.importBackup({ profileId, data: normalized, mode });
  }

  async resetProfileData(profileId: string): Promise<void> {
    await DagobertNativePlugin.resetProfileData({ profileId });
  }

  async getSyncStatus(): Promise<CloudKitSyncStatus> {
    return DagobertNativePlugin.getSyncStatus();
  }

  async setSyncEnabled(enabled: boolean): Promise<void> {
    await DagobertNativePlugin.setSyncEnabled({ enabled });
  }

  async triggerSync(): Promise<void> {
    await DagobertNativePlugin.triggerSync();
  }

  async canUseBiometrics(): Promise<boolean> {
    const res = await DagobertNativePlugin.canUseBiometrics();
    return res.available;
  }

  async authenticateBiometrics(reason?: string): Promise<boolean> {
    const res = await DagobertNativePlugin.authenticateBiometrics({ reason });
    return res.success;
  }
}
