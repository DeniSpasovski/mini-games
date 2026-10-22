/** Line icons (24 px grid, `currentColor`) for the Season and Time of day dropdowns of Select stage. */
const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const SUN_RAYS =
  'M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8';

export const SEASON_ICONS: Record<string, string> = {
  spring: svg(
    '<path d="M12 21v-8"/><path d="M12 14c0-4.5-3.5-6.8-8-6.8 0 4.8 3.2 7.6 8 6.8z"/><path d="M12 12c0-3.8 2.8-6 8-6 0 4.8-3 6.6-8 6z"/>',
  ),
  summer: svg(`<circle cx="12" cy="12" r="4"/><path d="${SUN_RAYS}"/>`),
  autumn: svg(
    '<path d="M5 19C5 10.5 11 4.5 20 4c0 9-6 15-15 15z"/><path d="M5 19l9-9"/>',
  ),
};

export const TIME_ICONS: Record<string, string> = {
  early: svg(
    '<path d="M3 19h18"/><path d="M7 19a5 5 0 0 1 10 0"/><path d="M12 4v4M10 6l2-2 2 2M4.6 11.6l1.5 1.5M19.4 11.6l-1.5 1.5"/>',
  ),
  midday: svg(`<circle cx="12" cy="12" r="3.5"/><path d="${SUN_RAYS}"/>`),
  afternoon: svg(
    '<path d="M3 20h18"/><circle cx="12" cy="13" r="4"/><path d="M12 4.5v2M4.9 8.5l1.5 1.5M19.1 8.5L17.6 10M2.5 13H4.5M19.5 13h2"/>',
  ),
  evening: svg(
    '<path d="M3 19h18"/><path d="M7 19a5 5 0 0 1 10 0"/><path d="M12 8V4M10 6l2 2 2-2M4.6 11.6l1.5 1.5M19.4 11.6l-1.5 1.5"/>',
  ),
  night: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
};
