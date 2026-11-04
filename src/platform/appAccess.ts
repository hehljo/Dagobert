export const APP_UNLOCKED_EVENT = 'dagobertAppUnlocked';
export const APP_LOCKED_EVENT = 'dagobertAppLocked';

export function isAppLockedError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'APP_LOCKED';
}
