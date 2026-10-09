import { Rng } from '../../src/shared/rng';
import { generateMap } from '../../src/games/kabooom/map/generate';
import { MAP_SIZES } from '../../src/games/kabooom/map/sizes';
import { BotController } from '../../src/games/kabooom/sim/bot';
import { ROUND_S, STEP, SUDDEN_S } from '../../src/games/kabooom/sim/rules';
import { Sim } from '../../src/games/kabooom/sim/sim';
import type {
  Difficulty,
  MapSizeId,
  PlayerInput,
} from '../../src/games/kabooom/sim/types';

export interface RoundStats {
  ticks: number;
  /** Winner id, or null for a draw / timeout. */
  winner: number | null;
  timedOut: boolean;
  placed: number;
  /** KOs by the player's own TNT. */
  selfKos: number;
  kos: number;
  /** Total cells walked per player. */
  walked: number[];
  cratesBroken: number;
  /** Seconds into the round when the human (slot 0) was knocked out by a bot's TNT before sudden death; null if not. */
  humanKoBySec: number | null;
}

/** Who plays slot 0: another bot (every player is a bot), a human who stands still, or one who wanders about. */
export type Human = 'bot' | 'idle' | 'wander';

/** Play one round and report what happened. */
export function playRound(
  size: MapSizeId,
  players: number,
  difficulty: Difficulty,
  seed: number,
  human: Human = 'bot',
): RoundStats {
  const map = generateMap({ size, seed });
  const sim = new Sim(
    { seed, size, bots: players - 1, difficulty, rounds: 1, critter: 'mole' },
    () => map,
    { countdown: 0 },
  );
  const ids = sim.players.map((p) => p.id);
  const botIds = human === 'bot' ? ids : ids.filter((id) => id !== 0);
  const bots = new BotController(sim, difficulty, seed, botIds);
  const inputs: PlayerInput[] = [];
  const humanIn: PlayerInput = { dx: 0, dy: 0, place: false };
  const rng = new Rng(seed * 7 + 3);
  let wanderUntil = 0;
  const stats: RoundStats = {
    ticks: 0,
    winner: null,
    timedOut: false,
    placed: 0,
    selfKos: 0,
    kos: 0,
    walked: ids.map(() => 0),
    cratesBroken: 0,
    humanKoBySec: null,
  };
  const last = sim.players.map((p) => ({ x: p.x, y: p.y }));
  const limit = Math.ceil((ROUND_S + 2) / STEP);
  for (let t = 0; t < limit && !sim.over; t++) {
    if (human === 'wander' && t >= wanderUntil) {
      // a new direction every 0.4-1.2 s, sometimes standing still
      const d = rng.int(0, 4);
      humanIn.dx = [1, -1, 0, 0, 0][d];
      humanIn.dy = [0, 0, 1, -1, 0][d];
      wanderUntil = t + rng.int(24, 72);
    }
    for (const e of sim.tick(
      bots.inputs(inputs, human === 'bot' ? undefined : humanIn),
    )) {
      if (e.type === 'tntPlaced') stats.placed++;
      else if (e.type === 'blockBroken') stats.cratesBroken++;
      else if (e.type === 'playerKo') {
        stats.kos++;
        if (e.byOwner === e.id) stats.selfKos++;
        if (e.id === 0 && e.byOwner > 0 && sim.time < ROUND_S - SUDDEN_S)
          stats.humanKoBySec = sim.time;
      } else if (e.type === 'roundOver') stats.winner = e.winner;
    }
    sim.players.forEach((p, i) => {
      stats.walked[i] += Math.hypot(p.x - last[i].x, p.y - last[i].y);
      last[i].x = p.x;
      last[i].y = p.y;
    });
    stats.ticks = t + 1;
  }
  stats.timedOut = sim.time >= ROUND_S - 1e-6;
  return stats;
}

export const maxPlayers = (size: MapSizeId): number =>
  MAP_SIZES[size].maxPlayers;
