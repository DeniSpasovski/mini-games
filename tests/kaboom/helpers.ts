import { Sim } from '../../src/games/kaboom/sim/sim';
import {
  Terrain,
  type CellPos,
  type MapData,
  type MatchConfig,
  type PlayerInput,
} from '../../src/games/kaboom/sim/types';

/**
 * Map from ASCII rows: `#` hard, `x` crate, `.` empty, `0`-`7` empty + spawn of that player.
 * Rows must be equally long.
 */
export function mapFromAscii(rows: string[], seed = 1): MapData {
  const h = rows.length;
  const w = rows[0].length;
  const terrain = new Uint8Array(w * h);
  const spawns: CellPos[] = [];
  for (let y = 0; y < h; y++) {
    if (rows[y].length !== w) throw new Error(`row ${y} has another length`);
    for (let x = 0; x < w; x++) {
      const c = rows[y][x];
      if (c === '#') terrain[y * w + x] = Terrain.Hard;
      else if (c === 'x') terrain[y * w + x] = Terrain.Crate;
      else if (c >= '0' && c <= '7') spawns[Number(c)] = { x, y };
    }
  }
  return {
    sizeId: 's',
    w,
    h,
    seed,
    terrain,
    variant: new Uint8Array(w * h),
    spawns,
  };
}

export function config(over: Partial<MatchConfig> = {}): MatchConfig {
  return {
    seed: 1,
    size: 's',
    bots: 1,
    difficulty: 'normal',
    rounds: 1,
    critter: 'mole',
    ...over,
  };
}

/** A sim on an ASCII map, no countdown; every round replays the same map. */
export function simOn(
  rows: string[],
  over: Partial<MatchConfig> = {},
  countdown = 0,
): Sim {
  const map = mapFromAscii(rows);
  const bots = over.bots ?? 1;
  return new Sim(config({ ...over, bots }), () => map, { countdown });
}

export const IDLE: PlayerInput = { dx: 0, dy: 0, place: false };

/** Idle inputs for everybody, with `own` overriding players by id. */
export function inputs(
  n: number,
  own: Record<number, Partial<PlayerInput>> = {},
): PlayerInput[] {
  return Array.from({ length: n }, (_, i) => ({ ...IDLE, ...own[i] }));
}

/** Teleport a player (tests only: the views are read-only for the real game). */
export function put(sim: Sim, id: number, x: number, y: number): void {
  const p = sim.players[id] as { x: number; y: number; px: number; py: number };
  p.x = p.px = x;
  p.y = p.py = y;
}

/** Run `ticks` ticks, collecting the events (copied, since the sim reuses its objects). */
export function run(
  sim: Sim,
  ticks: number,
  inp: (tick: number) => ReturnType<typeof inputs>,
): { tick: number; event: string }[] {
  const out: { tick: number; event: string }[] = [];
  for (let t = 0; t < ticks; t++) {
    for (const e of sim.tick(inp(t)))
      out.push({ tick: t, event: JSON.stringify(e) });
  }
  return out;
}
