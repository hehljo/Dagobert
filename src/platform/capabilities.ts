export interface PlatformCapabilities {
  isNative: boolean;
  isIOS: boolean;
  hasCloudKit: boolean;
  hasBiometrics: boolean;
  hasNativeFilesystem: boolean;
  hasShareSheet: boolean;
}

export function detectPlatform(): PlatformCapabilities {
  const isCapacitor = typeof window !== 'undefined' && !!(window as any).Capacitor?.isNativePlatform?.();
  const platform = isCapacitor ? (window as any).Capacitor.getPlatform() : 'web';
  const isIOS = platform === 'ios';

  return {
    isNative: isCapacitor,
    isIOS,
    hasCloudKit: isIOS,
    hasBiometrics: isIOS,
    hasNativeFilesystem: isCapacitor,
    hasShareSheet: typeof navigator !== 'undefined' && !!navigator.share
  };
}
