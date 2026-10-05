/**
 * Display range. On an HDR monitor the browser shows this (SDR) canvas at the OS's "SDR
 * content brightness", which on most HDR setups is well above an SDR screen's white, so
 * sunlit white paint glares. 'hdr' lowers the tone-mapping exposure to compensate;
 * 'auto' (default) follows the `dynamic-range: high` media query.
 * Picked with `?display=auto|sdr|hdr` or in the options menu (saved in localStorage).
 */
export type DisplayMode = 'auto' | 'sdr' | 'hdr';

export const DISPLAY_MODES: DisplayMode[] = ['auto', 'sdr', 'hdr'];
/** Exposure multiplier used when rendering for an HDR display. */
export const HDR_EXPOSURE = 0.68;
const KEY = 'rally.display';
const EVENT = 'rally-display';

export function loadDisplayMode(): DisplayMode {
  let m: string | null = new URLSearchParams(location.search).get('display');
  if (!m) {
    try {
      m = localStorage.getItem(KEY);
    } catch {
      m = null;
    }
  }
  return DISPLAY_MODES.includes(m as DisplayMode) ? (m as DisplayMode) : 'auto';
}

export function saveDisplayMode(m: DisplayMode): void {
  try {
    localStorage.setItem(KEY, m);
  } catch {
    // storage unavailable - the choice just won't persist
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Whether the page is on an HDR display (false when the browser can't tell). */
export function isHdrDisplay(): boolean {
  return window.matchMedia?.('(dynamic-range: high)').matches ?? false;
}

/** The mode in effect ('auto' resolved against the display). */
export function resolveDisplayMode(): Exclude<DisplayMode, 'auto'> {
  const m = loadDisplayMode();
  if (m !== 'auto') return m;
  return isHdrDisplay() ? 'hdr' : 'sdr';
}

/** Multiplier for the environment's tone-mapping exposure. */
export function displayExposure(): number {
  return resolveDisplayMode() === 'hdr' ? HDR_EXPOSURE : 1;
}

/** Called when the display mode changes (options menu); returns an unsubscribe. */
export function onDisplayChange(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
