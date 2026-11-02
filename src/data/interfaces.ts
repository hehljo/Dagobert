import type {
  Profile,
  Account,
  Category,
  CategoryRule,
  Transaction,
  BankTemplate,
  CsvMetadata
} from '../types/index.ts';

export interface BatchImportResult {
  inserted: number;
  updated: number;
  duplicates: number;
}

export interface RulePresetResult {
  inserted: number;
  updated: number;
}

export interface CloudKitSyncStatus {
  enabled: boolean;
  state: 'idle' | 'syncing' | 'offline' | 'error' | 'disabled';
  lastSyncAt: string | null;
  pendingChangesCount: number;
  errorMessage: string | null;
  iCloudAccountStatus: 'available' | 'noAccount' | 'restricted' | 'couldNotDetermine';
}

export interface BackupPayload {
  format: 'dagobert_backup';
  schemaVersion: number;
  exportedAt: string;
  sourcePlatform: 'docker' | 'ios' | 'web';
  profileId: string;
  profileName: string;
  profiles?: Profile[]; // Optional when multi-profile backup
  accounts: Account[];
  categories: Category[];
  rules: CategoryRule[];
  transactions: Transaction[];
  bankTemplates: BankTemplate[];
}

export interface BackupValidationResult {
  valid: boolean;
  error?: string;
  summary?: {
    profilesCount: number;
    accountsCount: number;
    categoriesCount: number;
    rulesCount: number;
    transactionsCount: number;
    templatesCount: number;
    dateRange?: { min: string; max: string };
  };
}

export type BackupImportMode = 'replace' | 'merge' | 'new_profile';

export interface IDagobertRepository {
  // Profiles
  getProfiles(): Promise<Profile[]>;
  createProfile(name: string, icon?: string, color?: string, pin?: string): Promise<Profile>;
  updateProfile(profileId: string, updates: { name?: string; icon?: string; color?: string; pin?: string; removePin?: boolean }): Promise<{ success: boolean; hasPin: boolean }>;
  deleteProfile(profileId: string): Promise<void>;
  unlockProfile(profileId: string, pin: string): Promise<boolean>;

  // Profile Data
  getProfileData(profileId: string): Promise<{
    profile: Profile;
    accounts: Account[];
    categories: Category[];
    rules: CategoryRule[];
    transactions: Transaction[];
    bankTemplates: BankTemplate[];
  }>;

  // Transactions
  batchImportTransactions(profileId: string, transactions: Partial<Transaction>[], accountCheckpoint?: CsvMetadata): Promise<BatchImportResult>;
  createManualTransaction(profileId: string, transaction: Transaction): Promise<number | string>;
  updateTransaction(id: number | string, transaction: Partial<Transaction>): Promise<void>;
  deleteTransaction(id: number | string): Promise<void>;

  // Accounts
  updateAccountSettings(
    profileId: string,
    id: string,
    initialBalance?: number,
    initialBalanceDate?: string,
    checkpointBalance?: number | null,
    checkpointDate?: string | null
  ): Promise<void>;

  // Categories
  createCategory(profileId: string, category: Partial<Category>): Promise<Category>;
  deleteCategory(profileId: string, id: string): Promise<void>;

  // Rules
  createRule(profileId: string, rule: CategoryRule): Promise<void>;
  deleteRule(profileId: string, id: string): Promise<void>;
  loadStandardRules(profileId: string): Promise<RulePresetResult>;

  // Backup & Reset
  exportBackup(profileId: string, includeAllProfiles?: boolean): Promise<BackupPayload>;
  validateBackup(payload: unknown): BackupValidationResult;
  importBackup(profileId: string, payload: BackupPayload, mode?: BackupImportMode): Promise<void>;
  resetProfileData(profileId: string): Promise<void>;

  // CloudKit Sync (Optional/iOS-only, stubbed on Web)
  getSyncStatus?(): Promise<CloudKitSyncStatus>;
  setSyncEnabled?(enabled: boolean): Promise<void>;
  triggerSync?(): Promise<void>;

  // Biometrics & Device Security (Optional/iOS-only, stubbed on Web)
  authenticateBiometrics?(reason?: string): Promise<boolean>;
  canUseBiometrics?(): Promise<boolean>;
}
