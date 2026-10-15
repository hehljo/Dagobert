import React, { useState, useEffect } from 'react';
import { Lock, Fingerprint, KeyRound, AlertCircle } from 'lucide-react';
import { getSecurityConfig, verifyPasskey, hashPin } from '../lib/passkey.ts';

interface LockScreenProps {
  onUnlock: () => void;
}

export const LockScreen: React.FC<LockScreenProps> = ({ onUnlock }) => {
  const [config] = useState(getSecurityConfig());
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
    setErrorMsg(null);
    if (!config.pinHash) {
      onUnlock();
      return;
    }

    const hashed = await hashPin(pin);
    if (hashed === config.pinHash) {
      onUnlock();
    } else {
      setErrorMsg('Falsche PIN. Bitte erneut versuchen.');
      setPin('');
    }
  };

  // Auto trigger passkey if enabled
  useEffect(() => {
    if (config.type === 'passkey') {
      handlePasskeyAuth();
    }
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900 text-white selection:bg-ios-tint">
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
                  config.type = 'pin';
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
              disabled={pin.length < 4}
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
