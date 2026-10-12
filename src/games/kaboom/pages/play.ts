import { installThumbnailCapture } from '../../../shared/thumbnail';
import { KaboomGame } from '../game/kaboom-game';
import { installMobileGuards } from '../game/ios';
import '../game/kaboom.css';

installMobileGuards();
const root = document.getElementById('root')!;
const game = new KaboomGame(root);
installThumbnailCapture('kaboom', () => game.captureCanvas());
(window as unknown as { __kaboom: unknown }).__kaboom = {
  game,
  get sim() {
    return game.sim;
  },
  benchmark: (n = 240) => game.benchmark(n),
  advance: (s: number, fps = 30) => game.advance(s, fps),
  /** Dev: render at w x h and POST it to the dev server as screenshots/<name>.jpg (README shots). */
  screenshot: async (name: string, w = 1536, h = 864) => {
    const { saveScreenshot } = await import('../../../shared/thumbnail');
    return saveScreenshot('kaboom', name, game.captureAt(w, h));
  },
};
