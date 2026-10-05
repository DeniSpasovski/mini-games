import { installThumbnailCapture } from '../../../shared/thumbnail';
import { HoleGame } from '../game/hole-game';
import { installMobileGuards } from '../game/ios';
import '../game/hole.css';

installMobileGuards();
const root = document.getElementById('root')!;
const game = new HoleGame(root);
installThumbnailCapture('hole', () => game.captureCanvas());
(window as unknown as { __hole: unknown }).__hole = {
  game,
  get sim() {
    return game.sim;
  },
  benchmark: (n = 240) => game.benchmark(n),
  advance: (s: number, fps = 30) => game.advance(s, fps),
  setLevel: (n: number) => game.sim.setLevel(n),
};
