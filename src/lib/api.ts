import type { Profile, Account, Category, CategoryRule, Transaction, BankTemplate, CsvMetadata } from '../types/index.ts';
import { getRepository } from '../data/repository.ts';
import type { BackupPayload, BackupImportMode } from '../data/interfaces.ts';
import { ProfileLockedError } from '../data/webAdapter.ts';

export { ProfileLockedError };

export async function fetchProfiles(): Promise<Profile[]> {
  return getRepository().getProfiles();
}

export async function createProfile(name: string, icon: string = 'User', color: string = '#0A84FF', pin?: string): Promise<Profile> {
  return getRepository().createProfile(name, icon, color, pin);
}

export async function updateProfile(
  profileId: string,
  updates: { name?: string; icon?: string; color?: string; pin?: string; removePin?: boolean }
): Promise<{ success: boolean; hasPin: boolean }> {
  return getRepository().updateProfile(profileId, updates);
}

export async function updateProfilePin(
  profileId: string,
  pin: string | null
): Promise<{ success: boolean; hasPin: boolean }> {
  const result = await updateProfile(profileId, pin ? { pin } : { removePin: true });
  if (pin) {
    await unlockProfile(profileId, pin);
  }
  return result;
}

export async function unlockProfile(profileId: string, pin: string): Promise<boolean> {
  return getRepository().unlockProfile(profileId, pin);
}

export async function fetchProfileData(profileId: string): Promise<{
  profile: Profile;
  accounts: Account[];
  categories: Category[];
  rules: CategoryRule[];
  transactions: Transaction[];
  bankTemplates: BankTemplate[];
}> {
  return getRepository().getProfileData(profileId);
}

export async function batchImportTransactions(
  profileId: string,
  transactions: Partial<Transaction>[],
  accountCheckpoint?: CsvMetadata
): Promise<{ inserted: number; updated: number; duplicates: number }> {
  return getRepository().batchImportTransactions(profileId, transactions, accountCheckpoint);
}

export async function createManualTransaction(profileId: string, transaction: Transaction): Promise<number | string> {
  return getRepository().createManualTransaction(profileId, transaction);
}

export async function updateExistingTransaction(id: number | string, transaction: Partial<Transaction>): Promise<void> {
  return getRepository().updateTransaction(id, transaction);
}

export async function deleteExistingTransaction(id: number | string): Promise<void> {
  return getRepository().deleteTransaction(id);
}

export async function updateAccountSettings(
  profileId: string,
  id: string,
  initialBalance?: number,
  initialBalanceDate?: string,
  checkpointBalance?: number | null,
  checkpointDate?: string | null
): Promise<void> {
  return getRepository().updateAccountSettings(profileId, id, initialBalance, initialBalanceDate, checkpointBalance, checkpointDate);
}

export async function createCategoryRule(profileId: string, rule: CategoryRule): Promise<void> {
  return getRepository().createRule(profileId, rule);
}

export async function loadStandardCategoryRules(profileId: string): Promise<{ inserted: number; updated: number }> {
  return getRepository().loadStandardRules(profileId);
}

export async function deleteCategoryRule(id: string): Promise<void> {
  return getRepository().deleteRule('privat', id);
}

export async function deleteCategoryRuleScoped(profileId: string, id: string): Promise<void> {
  return getRepository().deleteRule(profileId, id);
}

export async function createCategory(profileId: string, category: Partial<Category>): Promise<Category> {
  return getRepository().createCategory(profileId, category);
}

export async function deleteCategory(profileId: string, id: string): Promise<void> {
  return getRepository().deleteCategory(profileId, id);
}

export async function exportProfileBackup(profileId: string, includeAllProfiles = false): Promise<BackupPayload> {
  return getRepository().exportBackup(profileId, includeAllProfiles);
}

export async function importProfileBackup(profileId: string, data: BackupPayload, mode: BackupImportMode = 'replace'): Promise<void> {
  return getRepository().importBackup(profileId, data, mode);
}

export async function resetProfileData(profileId: string): Promise<void> {
  return getRepository().resetProfileData(profileId);
}
