import { registerPlugin } from '@capacitor/core';
import type {
  IDagobertRepository,
  BatchImportResult,
  RulePresetResult,
  BackupPayload,
  BackupValidationResult,
  BackupImportMode,
  SyncConflict,
  RecoveryBackup,
  CloudKitSyncStatus
} from './interfaces.ts';
import type { IncomingDocument } from './interfaces.ts';
import type { PluginListenerHandle } from '@capacitor/core';
import { planRulesImport, type RulesPackage, type RulesImportResult } from './rulesPackage.ts';
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
import { PROFILE_DEFAULTS } from './defaults.ts';
import { ProfileLockedError } from './webAdapter.ts';

interface DagobertNativePluginInterface {
  importRulesPackage(options: { profileId: string; categories: Category[]; rules: CategoryRule[]; expectedCategories: Category[]; expectedRules: CategoryRule[] }): Promise<{ categoriesAdded: number; rulesAdded: number }>;
  getIncomingDocuments(): Promise<{ documents: IncomingDocument[] }>;
  readIncomingDocument(options: { id: string }): Promise<IncomingDocument & { base64: string }>;
  acknowledgeIncomingDocument(options: { id: string }): Promise<{ success: boolean }>;
  addListener(event: 'documentInboxChanged', listener: () => void): Promise<PluginListenerHandle>;
  getProfiles(options: { defaults: typeof PROFILE_DEFAULTS }): Promise<{ profiles: Profile[] }>;
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

  getDeviceSecurity(): Promise<{ enabled: boolean }>;
  getAppLockState(): Promise<{ unlocked: boolean }>;
  setAppLockEnabled(options: { enabled: boolean }): Promise<{ enabled: boolean }>;
  shareBackup(options: { json: string; kind?: 'rules' }): Promise<{ completed: boolean }>;
  getConflicts(): Promise<{ conflicts: SyncConflict[] }>;
  resolveConflict(options: { id: string; version: number }): Promise<{ success: boolean }>;
  getRecoveryBackups(): Promise<{ backups: RecoveryBackup[] }>;
  exportRecoveryBackup(options: { id: string }): Promise<{ backup: BackupPayload }>;
  canUseBiometrics(): Promise<{ available: boolean }>;
  authenticateBiometrics(options?: { reason?: string }): Promise<{ success: boolean }>;
}

export const DagobertNativePlugin = registerPlugin<DagobertNativePluginInterface>('DagobertPlugin');

export class NativeDagobertRepository implements IDagobertRepository {
  async importRulesPackage(profileId: string, payload: RulesPackage): Promise<RulesImportResult> {
    const current = await this.getProfileData(profileId);
    const plan = planRulesImport(payload, current.categories, current.rules);
    const added = await DagobertNativePlugin.importRulesPackage({ profileId, categories: plan.categories, rules: plan.rules,
      expectedCategories: current.categories, expectedRules: current.rules });
    return { ...added, unchanged: plan.unchanged };
  }
  async shareRulesPackage(payload: RulesPackage): Promise<void> {
    await DagobertNativePlugin.shareBackup({ json: JSON.stringify(payload, null, 2), kind: 'rules' });
  }
  async getIncomingDocuments(): Promise<IncomingDocument[]> { return (await DagobertNativePlugin.getIncomingDocuments()).documents; }
  async readIncomingDocument(id: string): Promise<IncomingDocument & { base64: string }> { return DagobertNativePlugin.readIncomingDocument({ id }); }
  async acknowledgeIncomingDocument(id: string): Promise<void> { await DagobertNativePlugin.acknowledgeIncomingDocument({ id }); }
  async onIncomingDocumentsChanged(listener: () => void): Promise<() => void> {
    const handle = await DagobertNativePlugin.addListener('documentInboxChanged', listener);
    return () => { void handle.remove(); };
  }
  async getProfiles(): Promise<Profile[]> {
    const res = await DagobertNativePlugin.getProfiles({ defaults: PROFILE_DEFAULTS });
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
    try { return await DagobertNativePlugin.getProfileData({ profileId }); }
    catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'PROFILE_LOCKED') throw new ProfileLockedError();
      throw error;
    }
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
    const normalized = normalizeBackupPayload(res.backup);
    normalized.format = BACKUP_FORMAT_IDENTIFIER;
    normalized.schemaVersion = CURRENT_BACKUP_SCHEMA_VERSION;
    normalized.sourcePlatform = 'ios';
    return normalized;
  }

  validateBackup(payload: unknown): BackupValidationResult {
    return validateBackupPayload(payload);
  }

  async importBackup(profileId: string, payload: BackupPayload, mode: BackupImportMode = 'replace'): Promise<void> {
    const normalized = normalizeBackupPayload(payload);
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

  async getDeviceSecurity(): Promise<{ enabled: boolean }> { return DagobertNativePlugin.getDeviceSecurity(); }
  async getAppLockState(): Promise<{ unlocked: boolean }> { return DagobertNativePlugin.getAppLockState(); }
  async setAppLockEnabled(enabled: boolean): Promise<void> { await DagobertNativePlugin.setAppLockEnabled({ enabled }); }
  async shareBackup(payload: BackupPayload): Promise<void> { await DagobertNativePlugin.shareBackup({ json: JSON.stringify(payload, null, 2) }); }
  async getConflicts(): Promise<SyncConflict[]> { return (await DagobertNativePlugin.getConflicts()).conflicts; }
  async resolveConflict(id: string, version: number): Promise<void> { await DagobertNativePlugin.resolveConflict({ id, version }); }
  async getRecoveryBackups(): Promise<RecoveryBackup[]> { return (await DagobertNativePlugin.getRecoveryBackups()).backups; }
  async exportRecoveryBackup(id: string): Promise<BackupPayload> { return normalizeBackupPayload((await DagobertNativePlugin.exportRecoveryBackup({ id })).backup); }

  async canUseBiometrics(): Promise<boolean> {
    const res = await DagobertNativePlugin.canUseBiometrics();
    return res.available;
  }

  async authenticateBiometrics(reason?: string): Promise<boolean> {
    const res = await DagobertNativePlugin.authenticateBiometrics({ reason });
    return res.success;
  }
}
