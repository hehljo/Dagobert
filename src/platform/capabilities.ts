import { Capacitor } from '@capacitor/core';

export interface PlatformCapabilities {
  isNative: boolean;
  isIOS: boolean;
  hasCloudKit: boolean;
  hasBiometrics: boolean;
  hasNativeFilesystem: boolean;
  hasShareSheet: boolean;
}

export function detectPlatform(): PlatformCapabilities {
  const isNative = typeof window !== 'undefined' && Capacitor.isNativePlatform();
  const platform = typeof window !== 'undefined' ? Capacitor.getPlatform() : 'web';
  const isIOS = platform === 'ios';

  return {
    isNative,
    isIOS,
    hasCloudKit: isIOS,
    hasBiometrics: isIOS,
    hasNativeFilesystem: isNative,
    hasShareSheet: typeof navigator !== 'undefined' && !!navigator.share
  };
}
