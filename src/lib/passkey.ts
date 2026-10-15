/**
 * Passkey (WebAuthn) & App Lock Security Module
 */

export interface SecurityConfig {
  enabled: boolean;
  type: 'passkey' | 'pin';
  credentialId?: string;
  pinHash?: string;
  lastUnlocked?: number;
}

const STORAGE_KEY = 'dagobert_security_config';

export function getSecurityConfig(): SecurityConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Ignore error
  }
  return { enabled: false, type: 'pin' };
}

export function saveSecurityConfig(config: SecurityConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function isPasskeySupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof window.PublicKeyCredential !== 'undefined'
  );
}

// Simple fast SHA-256 for PIN storage
export async function hashPin(pin: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(pin + '_dagobert_salt');
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function registerPasskey(userName: string = 'User'): Promise<string> {
  if (!isPasskeySupported()) {
    throw new Error('WebAuthn / Passkeys werden in diesem Browser oder ohne HTTPS nicht unterstützt.');
  }

  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);

  const userId = new Uint8Array(16);
  crypto.getRandomValues(userId);

  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge,
    rp: {
      name: 'Dagobert Finance',
      id: window.location.hostname
    },
    user: {
      id: userId,
      name: userName,
      displayName: userName
    },
    pubKeyCredParams: [
      { alg: -7, type: 'public-key' },  // ES256
      { alg: -257, type: 'public-key' } // RS256
    ],
    authenticatorSelection: {
      authenticatorAttachment: 'platform', // FaceID, TouchID, Windows Hello
      userVerification: 'required',
      residentKey: 'preferred'
    },
    timeout: 60000
  };

  const credential = await navigator.credentials.create({ publicKey }) as PublicKeyCredential;
  if (!credential) throw new Error('Passkey-Erstellung abgebrochen');

  const rawIdBase64 = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
  return rawIdBase64;
}

export async function verifyPasskey(credentialIdBase64?: string): Promise<boolean> {
  if (!isPasskeySupported()) return false;

  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);

  const options: PublicKeyCredentialRequestOptions = {
    challenge,
    timeout: 60000,
    userVerification: 'required',
    rpId: window.location.hostname
  };

  if (credentialIdBase64) {
    const rawId = Uint8Array.from(atob(credentialIdBase64), c => c.charCodeAt(0));
    options.allowCredentials = [{
      type: 'public-key',
      id: rawId
    }];
  }

  const assertion = await navigator.credentials.get({ publicKey: options });
  return !!assertion;
}
