import {
  installMobileGuards as installGuards,
  onBackground,
} from '../../../shared/mobile-guards';

/** Menu lists and cards taller than the screen (overflow-y: auto in hole.css) may scroll. */
export const installMobileGuards = (): void =>
  installGuards('.hg-scroll, .hg-card');

export { onBackground };
