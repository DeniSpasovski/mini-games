import { BASE_SPEED, MAX_TNT, START_RANGE, START_TNT } from './rules';
import {
  CRITTERS,
  type CritterId,
  type MapData,
  type PlayerState as PlayerStatus,
  type PlayerView,
  type TntView,
} from './types';

/** Mutable player record; the outside world only sees it as a `PlayerView`. */
export class Player implements PlayerView {
  state: PlayerStatus = 'alive';
  x = 0;
  y = 0;
  px = 0;
  py = 0;
  facing = 0;
  moving = false;
  tntLeft = START_TNT;
  range = START_RANGE;
  speed = BASE_SPEED;
  wins = 0;
  /** Axis of the last move (0 = x, 1 = y): breaks ties on diagonal input. */
  axis: 0 | 1 = 0;

  constructor(
    readonly id: number,
    readonly critter: CritterId,
    readonly isBot: boolean,
  ) {}

  /** Back to the start of a round on a spawn cell (wins are kept). */
  resetForRound(sx: number, sy: number): void {
    this.state = 'alive';
    this.x = this.px = sx + 0.5;
    this.y = this.py = sy + 0.5;
    this.facing = Math.PI / 2;
    this.moving = false;
    this.tntLeft = START_TNT;
    this.range = START_RANGE;
    this.speed = BASE_SPEED;
    this.axis = 0;
  }
}

/** One slot of the fixed TNT pool. `pass` = bitmask of players who may still walk through it (they stood on it when placed). */
export class Tnt implements TntView {
  active = false;
  x = 0;
  y = 0;
  owner = 0;
  fuse = 0;
  range = 0;
  /** 0 = lit by its own fuse; n = n links down a chain. */
  depth = 0;
  pass = 0;
}

/** Everything the sim mutates: live grid, flames, TNT pool, players. Allocated once per match, refilled per round. */
export class SimState {
  w = 0;
  h = 0;
  map!: MapData;
  terrain = new Uint8Array(0);
  /** Seconds of flame left per cell. */
  flame = new Float32Array(0);
  /** Player whose TNT lit the flame (for the KO credit), -1 = none. */
  flameOwner = new Int8Array(0);
  /** TNT pool slot per cell, -1 = none. */
  tntAt = new Int16Array(0);
  readonly tnts: Tnt[] = Array.from({ length: MAX_TNT }, () => new Tnt());
  readonly players: Player[];

  constructor(playerCount: number, humanCritter: CritterId) {
    const others = CRITTERS.filter((c) => c !== humanCritter);
    this.players = Array.from({ length: playerCount }, (_, i) =>
      i === 0
        ? new Player(0, humanCritter, false)
        : new Player(i, others[(i - 1) % others.length], true),
    );
  }

  /** Load a round's map: copy the terrain, clear flames and TNT, put the players on their spawns. */
  load(map: MapData): void {
    const n = map.w * map.h;
    if (this.w * this.h !== n) {
      this.flame = new Float32Array(n);
      this.flameOwner = new Int8Array(n);
      this.tntAt = new Int16Array(n);
      this.terrain = new Uint8Array(n);
    }
    this.map = map;
    this.w = map.w;
    this.h = map.h;
    this.terrain.set(map.terrain);
    this.flame.fill(0);
    this.flameOwner.fill(-1);
    this.tntAt.fill(-1);
    for (const t of this.tnts) {
      t.active = false;
      t.pass = 0;
    }
    for (const p of this.players) {
      const s = map.spawns[p.id];
      if (!s) throw new Error(`map has no spawn for player ${p.id}`);
      p.resetForRound(s.x, s.y);
    }
  }

  /** First free pool slot, or -1. */
  freeSlot(): number {
    for (let i = 0; i < this.tnts.length; i++)
      if (!this.tnts[i].active) return i;
    return -1;
  }
}
