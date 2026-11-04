import type { CloudKitSyncStatus } from '../data/interfaces.ts';

export function syncStatusLabel(status: CloudKitSyncStatus | null): string {
  if (!status) return 'Status nicht verfügbar';
  if (status.errorMessage || status.state === 'error') return 'Fehler';
  if (!status.enabled) return 'Deaktiviert';
  if (status.conflictsCount) return 'Änderungen prüfen';
  if (status.state === 'syncing') return 'Synchronisiert…';
  if (status.state === 'offline') return 'Offline';
  if (status.iCloudAccountStatus !== 'available') return 'iCloud nicht verfügbar';
  if (status.pendingChangesCount > 0) return 'Änderungen ausstehend';
  return status.state === 'idle' ? 'Bereit' : 'Wird vorbereitet';
}
