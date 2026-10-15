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

export function isSecureContext(): boolean {
  if (typeof window === 'undefined') return false;
  return window.isSecureContext || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

export function isPasskeySupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    isSecureContext() &&
    typeof window.PublicKeyCredential !== 'undefined'
  );
}

/**
 * Pure JavaScript SHA-256 implementation.
 * Guarantees working PIN hashing even over plain HTTP where crypto.subtle is undefined.
 */
function sha256Pure(ascii: string): string {
  function rightRotate(value: number, amount: number) {
    return (value >>> amount) | (value << (32 - amount));
  }
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  const lengthProperty = 'length';
  let i = 0, j = 0;
  let result = '';
  const words: number[] = [];
  const asciiBitLength = ascii[lengthProperty] * 8;
  const hash: number[] = [];
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
    const oldHash = hash.slice(0, 8);
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

export async function hashPin(pin: string): Promise<string> {
  const salt = pin + '_dagobert_salt';
  // Check if Web Crypto subtle is supported in current context
  if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
    try {
      const msgUint8 = new TextEncoder().encode(salt);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Fallback to pure JS
    }
  }
  return sha256Pure(salt);
}

export async function registerPasskey(userName: string = 'User'): Promise<string> {
  if (!isPasskeySupported()) {
    throw new Error('Passkeys (WebAuthn) erfordern zwingend eine HTTPS-Verbindung (z.B. über Tailscale HTTPS oder Reverse Proxy).');
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
      authenticatorAttachment: 'platform',
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
