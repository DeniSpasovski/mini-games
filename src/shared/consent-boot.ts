import { initConsent } from './consent';
import { registerOffline } from './offline';

/**
 * Runs before every page entry, after the host guard (rsbuild.config.ts ->
 * source.preEntry): shows the cookie banner or loads Google Analytics, then registers the offline service worker.
 */
if (typeof document !== 'undefined') {
  initConsent();
  registerOffline();
}
