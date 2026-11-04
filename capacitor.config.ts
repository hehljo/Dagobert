import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'de.lupfa.dagobert',
  appName: 'Dagobert',
  webDir: 'dist',
  loggingBehavior: 'none',
  bundledWebRuntime: false,
  ios: {
    // CSS owns the safe areas; UIKit must not add the same insets a second time.
    contentInset: 'never',
    preferredContentMode: 'mobile',
    scheme: 'App'
  }
};

export default config;
