import {
  installMobileGuards as installGuards,
  onBackground,
} from '../../../shared/mobile-guards';

/** Elements that may still scroll on touch (menu lists, tall cards; WP7 adds them). */
export const installMobileGuards = (): void =>
  installGuards('.kb-scroll, .kb-card');

export { onBackground };
