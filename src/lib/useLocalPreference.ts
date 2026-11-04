import { useCallback, useSyncExternalStore } from 'react';

const CHANGED_EVENT = 'dagobert-local-preference-changed';
const subscribe = (listener: () => void) => {
  window.addEventListener('storage', listener);
  window.addEventListener(CHANGED_EVENT, listener);
  return () => {
    window.removeEventListener('storage', listener);
    window.removeEventListener(CHANGED_EVENT, listener);
  };
};

/** Raw localStorage value that re-renders on same-tab and cross-tab changes. */
export function useLocalPreferenceRaw(key: string): string | null {
  const snapshot = useCallback(() => {
    try { return localStorage.getItem(key); } catch { return null; }
  }, [key]);
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

/** Throws `message` when the device refuses the write. */
export function writeLocalPreference(key: string, value: unknown, message: string): void {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { throw new Error(message); }
  window.dispatchEvent(new Event(CHANGED_EVENT));
}
