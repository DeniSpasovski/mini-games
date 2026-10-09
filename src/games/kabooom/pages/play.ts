import { installThumbnailCapture } from '../../../shared/thumbnail';
import { KabooomGame } from '../game/kabooom-game';
import { installMobileGuards } from '../game/ios';
import '../game/kabooom.css';

installMobileGuards();
const root = document.getElementById('root')!;
const game = new KabooomGame(root);
installThumbnailCapture('kabooom', () => game.captureCanvas());
(window as unknown as { __kabooom: unknown }).__kabooom = {
  game,
  get sim() {
    return game.sim;
  },
  benchmark: (n = 240) => game.benchmark(n),
  advance: (s: number, fps = 30) => game.advance(s, fps),
  /** Dev: render at w x h and POST it to the dev server as screenshots/<name>.jpg (README shots). */
  screenshot: async (name: string, w = 1536, h = 864) => {
    const { saveScreenshot } = await import('../../../shared/thumbnail');
    return saveScreenshot('kabooom', name, game.captureAt(w, h));
  },
};
