import { describe, expect, it } from 'vitest';
import type { CloudKitSyncStatus } from '../data/interfaces.ts';
import { syncStatusLabel } from '../lib/syncStatus.ts';

const ready: CloudKitSyncStatus = { enabled: true, state: 'idle', lastSyncAt: null,
  pendingChangesCount: 0, conflictsCount: 0, errorMessage: null, iCloudAccountStatus: 'available' };

describe('iCloud status', () => {
  it.each([
    [ready, 'Bereit'],
    [{ ...ready, pendingChangesCount: 1 }, 'Änderungen ausstehend'],
    [{ ...ready, conflictsCount: 1 }, 'Änderungen prüfen'],
    [{ ...ready, errorMessage: 'Speicher voll' }, 'Fehler'],
    [{ ...ready, iCloudAccountStatus: 'noAccount' }, 'iCloud nicht verfügbar'],
    [{ ...ready, enabled: false }, 'Deaktiviert'],
    [{ ...ready, state: 'disabled' }, 'Wird vorbereitet'],
    [null, 'Status nicht verfügbar'],
  ] as const)('only displays ready for an available account without pending work: %s', (status, expected) => {
    expect(syncStatusLabel(status)).toBe(expected);
  });
});
