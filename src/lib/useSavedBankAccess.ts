import { useEffect, useState } from 'react';
import { comdirect } from '../data/comdirect.ts';
import { APP_UNLOCKED_EVENT } from '../platform/appAccess.ts';

/**
 * Whether a comdirect access is stored for this profile. Read-only query, no bank login.
 * `refreshKey` re-reads after the import dialog closed (access may have been saved or removed).
 * Any error (locked app, missing HTTPS, no PIN) counts as "not stored".
 */
export function useSavedBankAccess(profileId: string | undefined, enabled: boolean, refreshKey: unknown): boolean {
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!profileId || !enabled) { setSaved(false); return; }
    let active = true;
    const refresh = () => {
      comdirect('saved-access', profileId)
        .then(result => { if (active) setSaved(!!result.saved); })
        .catch(() => { if (active) setSaved(false); });
    };
    refresh(); window.addEventListener(APP_UNLOCKED_EVENT, refresh);
    return () => { active = false; window.removeEventListener(APP_UNLOCKED_EVENT, refresh); };
  }, [profileId, enabled, refreshKey]);
  return saved;
}
