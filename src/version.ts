// Injected by vite.config.ts at build time — no hand-maintained version or date.
declare const __APP_VERSION__: string | undefined;
declare const __BUILD_TIME__: string | undefined;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';
const builtAt = typeof __BUILD_TIME__ === 'string' ? new Date(__BUILD_TIME__) : null;
/** Build time of the bundled web UI (shows whether a fresh bundle shipped). */
export const BUILD_DATE = builtAt && !Number.isNaN(builtAt.getTime())
  ? builtAt.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
  : 'Entwicklung';
