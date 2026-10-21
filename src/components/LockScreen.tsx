import React, { useState, useEffect } from 'react';
import { Lock, Fingerprint, KeyRound, AlertCircle } from 'lucide-react';
import { getSecurityConfig, saveSecurityConfig, verifyPasskey, hashPin } from '../lib/passkey.ts';

// Legacy hash fallback function for smooth migration of PINs created in previous session
function hashLegacyPin(pin: string): string {
  function rightRotate(value: number, amount: number) {
    return (value >>> amount) | (value << (32 - amount));
  }
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  const lengthProperty = 'length';
  let i = 0, j = 0;
  let result = '';
  const words: number[] = [];
  let ascii = pin.trim() + '_dagobert_salt';
  const asciiBitLength = ascii[lengthProperty] * 8;
  let hash: number[] = [];
  const k: number[] = [];
  let primeCounter = 0;
  const isComposite: Record<number, number> = {};

  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 313; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  ascii += '\x80';
  while ((ascii[lengthProperty] % 64) - 56) ascii += '\x00';
  for (i = 0; i < ascii[lengthProperty]; i++) {
    j = ascii.charCodeAt(i);
    if (j >> 8) return '';
    words[i >> 2] |= j << ((3 - (i % 4)) * 8);
  }
  words[words[lengthProperty]] = (asciiBitLength / maxWord) | 0;
  words[words[lengthProperty]] = asciiBitLength | 0;

  for (j = 0; j < words[lengthProperty]; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash;
    hash = hash.slice(0, 8);
    for (i = 0; i < 64; i++) {
      const w15 = w[i - 15] || 0;
      const w2 = w[i - 2] || 0;
      const s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
      const s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
      const ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
      const maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
      const temp1 =
        hash[7] +
        (rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25)) +
        ch +
        k[i] +
        (w[i] = i < 16 ? w[i] || 0 : ((w[i - 16] || 0) + s0 + (w[i - 7] || 0) + s1) | 0);
      const temp2 = (rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22)) + maj;

      hash[7] = hash[6];
      hash[6] = hash[5];
      hash[5] = hash[4];
      hash[4] = (hash[4] + temp1) | 0;
      hash[3] = hash[2];
      hash[2] = hash[1];
      hash[1] = hash[0];
      hash[0] = (temp1 + temp2) | 0;
    }
    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  for (i = 0; i < 8; i++) {
    for (j = 3; j >= 0; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }
  return result;
}


interface LockScreenProps {
  onUnlock: () => void;
}

export const LockScreen: React.FC<LockScreenProps> = ({ onUnlock }) => {
  const [config, setConfig] = useState(getSecurityConfig);
  const [pin, setPin] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const handlePasskeyAuth = async () => {
    setIsAuthenticating(true);
    setErrorMsg(null);
    try {
      const ok = await verifyPasskey(config.credentialId);
      if (ok) {
        onUnlock();
      } else {
        setErrorMsg('Passkey-Authentifizierung fehlgeschlagen.');
      }
    } catch {
      setErrorMsg('Authentifizierung abgebrochen oder nicht verfügbar.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isAuthenticating) return;
    setErrorMsg(null);

    // Security check: Must have a valid stored PIN hash
    if (!config.pinHash || config.pinHash.trim().length === 0) {
      setErrorMsg('Sicherheits-Konfiguration unvollständig. Bitte PIN neu anlegen.');
      return;
    }

    setIsAuthenticating(true);
    try {
      const hashed = await hashPin(pin);
      const legacyHashed = hashLegacyPin(pin);

      if (hashed === config.pinHash || legacyHashed === config.pinHash) {
        // Preserve PINs saved by the earlier local app lock.
        if (legacyHashed === config.pinHash && hashed !== config.pinHash) {
          saveSecurityConfig({ ...config, pinHash: hashed });
        }
        onUnlock();
      } else {
        setErrorMsg('Falsche PIN. Bitte erneut versuchen.');
        setPin('');
      }
    } catch {
      setErrorMsg('PIN konnte nicht geprüft werden. Bitte erneut versuchen.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  // Auto trigger passkey if enabled
  useEffect(() => {
    if (config.type === 'passkey') {
      handlePasskeyAuth();
    }
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 glass-lock-screen text-white selection:bg-ios-tint">
      <div className="w-full max-w-sm text-center space-y-6">
        {/* App Icon */}
        <div className="w-16 h-16 rounded-3xl bg-neutral-800 border border-neutral-700 flex items-center justify-center mx-auto shadow-2xl shadow-ios-tint/10">
          <Lock className="w-8 h-8 text-ios-tint" />
        </div>

        <div>
          <h1 className="text-xl font-bold tracking-tight">Dagobert gesperrt</h1>
          <p className="text-xs text-ios-gray mt-1">
            {config.type === 'passkey'
              ? 'Mit Touch ID, Face ID oder Passkey entsperren'
              : 'Gib deine PIN ein, um fortzufahren'}
          </p>
        </div>

        {errorMsg && (
          <div className="p-3 bg-ios-red/10 border border-ios-red/20 rounded-2xl flex items-center justify-center space-x-2 text-ios-red text-xs">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Passkey Button */}
        {config.type === 'passkey' ? (
          <div className="space-y-4 pt-2">
            <button
              onClick={handlePasskeyAuth}
              disabled={isAuthenticating}
              className="w-full py-4 px-4 rounded-2xl bg-ios-tint text-white font-semibold text-sm shadow-lg hover:brightness-110 active:scale-95 disabled:opacity-50 transition-all flex items-center justify-center space-x-2.5 min-h-[48px]"
            >
              <Fingerprint className="w-5 h-5" />
              <span>{isAuthenticating ? 'Prüfe Biometrie...' : 'Mit Passkey entsperren'}</span>
            </button>

            {config.pinHash && (
              <button
                onClick={() => {
                  setConfig(current => ({ ...current, type: 'pin' }));
                }}
                className="text-xs text-ios-gray hover:text-white transition-colors"
              >
                Stattdessen PIN verwenden
              </button>
            )}
          </div>
        ) : (
          /* PIN Input Form */
          <form onSubmit={handlePinSubmit} className="space-y-4 pt-2">
            <div className="relative">
              <KeyRound className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-ios-gray" />
              <input
                type="password"
                aria-label="App-PIN"
                inputMode="numeric"
                autoComplete="current-password"
                maxLength={6}
                autoFocus
                placeholder="PIN eingeben"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                className="w-full pl-11 pr-4 py-3 bg-neutral-800 border border-neutral-700 rounded-2xl text-center text-lg tracking-widest font-mono outline-none focus:ring-2 focus:ring-ios-tint"
              />
            </div>

            <button
              type="submit"
              disabled={pin.length < 4 || isAuthenticating}
              className="w-full py-3.5 rounded-2xl bg-ios-tint text-white font-semibold text-sm shadow-md hover:brightness-110 active:scale-95 disabled:opacity-40 transition-all min-h-[48px]"
            >
              Entsperren
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
