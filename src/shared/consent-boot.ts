import { initConsent } from './consent';

/**
 * Runs before every page entry, after the host guard (rsbuild.config.ts ->
 * source.preEntry): shows the cookie banner or loads Google Analytics.
 */
if (typeof document !== 'undefined') initConsent();
