import { hash3, Rng } from '../../../shared/rng';
import { MAX_BENDS, explode, type BlastSink } from './blast';
import { movePlayer, overlapsCell, updateTntPass } from './movement';
import {
  COUNTDOWN_S,
  FUSE_BY_DIFFICULTY,
  MAX_PLAYERS,
  MAX_TNT,
  FALL_INTERVAL_S,
  MAX_POWER_LEVEL,
  ROUND_S,
  START_RANGE,
  START_TNT,
  SUDDEN_S,
  STEP,
} from './rules';
import { PowerUp, assignPowerUps } from './powerups';
import { SimState, type Player, type Tnt } from './state';
import {
  Terrain,
  type KaboomSim,
  type MapData,
  type MatchConfig,
  type PlayerInput,
  type SimEvent,
} from './types';

export type MapFactory = (round: number) => MapData;

export interface SimOptions {
  /** Seconds of 3-2-1 before players can move (default `COUNTDOWN_S`; tests use 0). */
  countdown?: number;
}

type PlacedEvent = { type: 'tntPlaced'; x: number; y: number; owner: number };
type ExplodedEvent = {
  type: 'tntExploded';
  x: number;
  y: number;
  owner: number;
  arms: [number, number, number, number];
  bends: number[];
  bendCount: number;
  chainDepth: number;
};
type BrokenEvent = { type: 'blockBroken'; x: number; y: number };
type FellEvent = { type: 'blockFell'; x: number; y: number };
type AppearedEvent = {
  type: 'itemAppeared';
  x: number;
  y: number;
  kind: number;
};
type TakenEvent = {
  type: 'itemTaken';
  x: number;
  y: number;
  kind: number;
  id: number;
};
type KoEvent = { type: 'playerKo'; id: number; byOwner: number };
type RoundEvent = { type: 'roundOver'; winner: number | null };
type MatchEvent = { type: 'matchOver'; winner: number | null };

/** Fixed pool of event objects handed out per tick: no allocation while playing. */
class Pool<T> {
  private readonly items: T[];
  private n = 0;
  constructor(size: number, make: () => T) {
    this.items = Array.from({ length: size }, make);
  }
  reset(): void {
    this.n = 0;
  }
  next(): T {
    // A pool never runs dry in a legal game (sizes are the per-tick maxima); reuse the last slot rather than crash.
    return this.items[Math.min(this.n++, this.items.length - 1)];
  }
}

/**
 * The simulation (DETAILS.md "Rules"): fixed step `STEP`, allocation-free `tick`, deterministic for a given config, map
 * factory and input stream. DOM-free.
 */
export class Sim implements KaboomSim {
  readonly config: MatchConfig;
  private readonly s: SimState;
  private readonly events: SimEvent[] = [];
  private readonly placed = new Pool<PlacedEvent>(MAX_PLAYERS, () => ({
    type: 'tntPlaced',
    x: 0,
    y: 0,
    owner: 0,
  }));
  private readonly exploded = new Pool<ExplodedEvent>(MAX_TNT, () => ({
    type: 'tntExploded',
    x: 0,
    y: 0,
    owner: 0,
    arms: [0, 0, 0, 0],
    bends: new Array<number>(MAX_BENDS * 4).fill(0),
    bendCount: 0,
    chainDepth: 0,
  }));
  private broken: Pool<BrokenEvent>;
  private readonly appeared = new Pool<AppearedEvent>(32, () => ({
    type: 'itemAppeared',
    x: 0,
    y: 0,
    kind: 0,
  }));
  private readonly taken = new Pool<TakenEvent>(MAX_PLAYERS, () => ({
    type: 'itemTaken',
    x: 0,
    y: 0,
    kind: 0,
    id: 0,
  }));
  private readonly fell = new Pool<FellEvent>(8, () => ({
    type: 'blockFell',
    x: 0,
    y: 0,
  }));
  /** Sudden death order: interior cells ring by ring from the outside, and how far along it is. */
  private spiral = new Int16Array(0);
  private fallIdx = 0;
  /** Seconds between walls: `FALL_INTERVAL_S`, faster on a big arena so the spiral is done before the round timer. */
  private fallEvery = FALL_INTERVAL_S;
  private readonly ko = new Pool<KoEvent>(MAX_PLAYERS, () => ({
    type: 'playerKo',
    id: 0,
    byOwner: -1,
  }));
  private readonly roundEv: RoundEvent = { type: 'roundOver', winner: null };
  private readonly matchEv: MatchEvent = { type: 'matchOver', winner: null };
  private readonly due = new Int16Array(MAX_TNT);
  private readonly countdownS: number;
  private readonly sink: BlastSink;

  time = 0;
  countdown: number;
  round = 0;
  over = false;
  matchOver = false;
  /** Winner of the match once `matchOver` (null = tie). */
  matchWinner: number | null = null;

  constructor(
    config: MatchConfig,
    private readonly makeMap: MapFactory,
    options: SimOptions = {},
  ) {
    this.config = config;
    this.countdownS = options.countdown ?? COUNTDOWN_S;
    this.countdown = this.countdownS;
    this.s = new SimState(1 + config.bots, config.critter, config.color ?? 0);
    this.s.load(makeMap(0));
    this.buildSpiral();
    this.assignItems();
    this.broken = new Pool<BrokenEvent>(this.s.w * this.s.h, () => ({
      type: 'blockBroken',
      x: 0,
      y: 0,
    }));
    this.sink = {
      blockBroken: (x, y) => {
        const e = this.broken.next();
        e.x = x;
        e.y = y;
        this.events.push(e);
        // a power-up hidden in the crate drops where it stood
        const s = this.s;
        const i = y * s.w + x;
        const kind = s.hidden[i];
        if (kind >= 0) {
          s.hidden[i] = -1;
          s.items[i] = kind;
          const a = this.appeared.next();
          a.x = x;
          a.y = y;
          a.kind = kind;
          this.events.push(a);
        }
      },
      tntExploded: (t, arms, bends, bendCount) => {
        const e = this.exploded.next();
        e.x = t.x;
        e.y = t.y;
        e.owner = t.owner;
        e.arms[0] = arms[0];
        e.arms[1] = arms[1];
        e.arms[2] = arms[2];
        e.arms[3] = arms[3];
        for (let k = 0; k < bendCount * 4; k++) e.bends[k] = bends[k];
        e.bendCount = bendCount;
        e.chainDepth = t.depth;
        this.events.push(e);
      },
    };
  }

  get map(): MapData {
    return this.s.map;
  }
  get players() {
    return this.s.players;
  }
  get tnts() {
    return this.s.tnts;
  }
  get terrain(): Uint8Array {
    return this.s.terrain;
  }
  /** Power-up on each cell (`PowerUp` kind or -1). */
  get fuseS(): number {
    return FUSE_BY_DIFFICULTY[this.config.difficulty];
  }

  get items(): Int8Array {
    return this.s.items;
  }
  /** Power-ups still inside their crates (tests, the map viewer, never the UI: players must not see them). */
  get hiddenItems(): Int8Array {
    return this.s.hidden;
  }

  get flame(): Float32Array {
    return this.s.flame;
  }

  /** Recolour the teams live (the setup's colour picker over the menu's background match). */
  setTeamColor(color: number): void {
    this.s.setTeamColor(color);
  }

  /**
   * Bench a player or bring them back (the setup's bot count over the menu's background match). Benched = `out` at
   * once, no KO, not counted for the round; back = alive on their spawn. Stays that way across rounds.
   */
  setPresent(id: number, present: boolean): void {
    const p = this.s.players[id];
    if (!p || p.present === present) return;
    p.present = present;
    if (!present) {
      p.state = 'out';
      p.moving = false;
      return;
    }
    const sp = this.s.map.spawns[id];
    if (sp) p.resetForRound(sp.x, sp.y);
  }

  /** Start the next round on a fresh map; no-op once the match is over. */
  nextRound(): void {
    if (this.matchOver) return;
    this.round++;
    this.s.load(this.makeMap(this.round));
    this.buildSpiral();
    this.assignItems();
    this.time = 0;
    this.countdown = this.countdownS;
    this.over = false;
  }

  tick(inputs: readonly PlayerInput[]): readonly SimEvent[] {
    const s = this.s;
    const events = this.events;
    events.length = 0;
    this.placed.reset();
    this.exploded.reset();
    this.broken.reset();
    this.fell.reset();
    this.appeared.reset();
    this.taken.reset();
    this.ko.reset();

    for (const p of s.players) {
      p.px = p.x;
      p.py = p.y;
    }

    let running = false;
    if (this.countdown > 0) {
      this.countdown = Math.max(0, this.countdown - STEP);
    } else if (!this.over) {
      running = true;
      this.time += STEP;
    }

    for (const p of s.players) {
      const input = inputs[p.id];
      if (!running || p.state !== 'alive' || !input) {
        p.moving = false;
        continue;
      }
      movePlayer(s, p, input.dx, input.dy);
      if (input.place) this.place(p.id);
    }
    updateTntPass(s);
    if (running)
      for (const p of s.players) if (p.state === 'alive') this.collect(p);

    const flame = s.flame;
    for (let i = 0; i < flame.length; i++)
      if (flame[i] > 0) flame[i] = Math.max(0, flame[i] - STEP);

    // Fuses first, then explode in slot order: a blast only sets fuses, so a chain never resolves inside one tick.
    let dueN = 0;
    for (let i = 0; i < s.tnts.length; i++) {
      const t = s.tnts[i];
      if (!t.active) continue;
      t.fuse -= STEP;
      if (t.fuse <= 0) this.due[dueN++] = i;
    }
    for (let k = 0; k < dueN; k++) {
      const t = s.tnts[this.due[k]];
      if (t.active) explode(s, t, this.sink);
    }

    if (running) this.dropWalls();

    for (const p of s.players) {
      if (p.state !== 'alive') continue;
      const i = Math.floor(p.y) * s.w + Math.floor(p.x);
      if (flame[i] <= 0) continue;
      p.state = 'ko';
      p.moving = false;
      const e = this.ko.next();
      e.id = p.id;
      e.byOwner = s.flameOwner[i];
      events.push(e);
    }

    if (!this.over && running) this.checkRoundEnd();
    return events;
  }

  private place(id: number): void {
    const p = this.s.players[id];
    if (p.tntLeft <= 0) return;
    this.plantTnt(Math.floor(p.x), Math.floor(p.y), id);
  }

  /**
   * Put a TNT on cell (x, y) for `owner` (the normal `place` input goes through here). Also the scenario / test / bench
   * helper: it does not check the owner's TNT count. Returns false when the cell is taken, not empty ground, or the pool is full.
   */
  plantTnt(
    x: number,
    y: number,
    owner: number,
    range = this.s.players[owner].range,
    fuse = this.fuseS,
  ): boolean {
    const s = this.s;
    const p = s.players[owner];
    const i = y * s.w + x;
    if (s.tntAt[i] >= 0 || s.terrain[i] !== Terrain.Empty) return false;
    const slot = s.freeSlot();
    if (slot < 0) return false;
    const t: Tnt = s.tnts[slot];
    t.active = true;
    t.x = x;
    t.y = y;
    t.owner = owner;
    t.fuse = fuse;
    t.range = range;
    t.depth = 0;
    t.pass = 0;
    for (const q of s.players)
      if (q.state === 'alive' && overlapsCell(q.x, q.y, x, y))
        t.pass |= 1 << q.id;
    s.tntAt[i] = slot;
    p.tntLeft = Math.max(0, p.tntLeft - 1);
    const e = this.placed.next();
    e.x = x;
    e.y = y;
    e.owner = owner;
    this.events.push(e);
    return true;
  }

  get suddenDeath(): boolean {
    return this.time >= ROUND_S - SUDDEN_S;
  }

  /** Decide which crates hide a power-up this round (seeded: same match = same drops). */
  private assignItems(): void {
    const s = this.s;
    const rng = new Rng(hash3(this.config.seed, this.round, 0x9a, 0x50));
    s.hidden.set(assignPowerUps(s.map, s.players.length, rng));
  }

  /** Pick up the power-up under the player, unless that kind is already at its top level (it stays for others). */
  private collect(p: Player): void {
    const s = this.s;
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    const i = y * s.w + x;
    const kind = s.items[i];
    if (kind < 0) return;
    if (kind === PowerUp.Dynamites) {
      if (p.maxTnt - START_TNT >= MAX_POWER_LEVEL) return;
      p.maxTnt++;
      p.tntLeft++;
    } else {
      if (p.range - START_RANGE >= MAX_POWER_LEVEL) return;
      p.range++;
    }
    s.items[i] = -1;
    const e = this.taken.next();
    e.x = x;
    e.y = y;
    e.kind = kind;
    e.id = p.id;
    this.events.push(e);
  }

  /** Interior cells ring by ring from the outside (clockwise from the top-left), skipping what is already a hard block. */
  private buildSpiral(): void {
    const { w, h, terrain } = this.s;
    const order: number[] = [];
    const rings = Math.ceil(Math.min(w, h) / 2);
    for (let r = 1; r < rings; r++) {
      const x0 = r;
      const y0 = r;
      const x1 = w - 1 - r;
      const y1 = h - 1 - r;
      if (x1 < x0 || y1 < y0) break;
      const ring: number[] = [];
      for (let x = x0; x <= x1; x++) ring.push(y0 * w + x);
      for (let y = y0 + 1; y <= y1; y++) ring.push(y * w + x1);
      if (y1 > y0) for (let x = x1 - 1; x >= x0; x--) ring.push(y1 * w + x);
      if (x1 > x0) for (let y = y1 - 1; y > y0; y--) ring.push(y * w + x0);
      for (const i of ring) if (terrain[i] !== Terrain.Hard) order.push(i);
    }
    this.spiral = Int16Array.from(order);
    this.fallIdx = 0;
    this.fallEvery = Math.min(
      FALL_INTERVAL_S,
      (SUDDEN_S - 3) / Math.max(1, order.length),
    );
  }

  /** Time (since GO) at which spiral cell `k` lands. */
  private fallTime(k: number): number {
    return ROUND_S - SUDDEN_S + k * this.fallEvery;
  }

  upcomingFalls(
    horizonS: number,
    cells: Int16Array,
    secs: Float32Array,
  ): number {
    let n = 0;
    for (
      let k = this.fallIdx;
      k < this.spiral.length && n < cells.length;
      k++
    ) {
      const t = this.fallTime(k) - this.time;
      if (t > horizonS) break;
      cells[n] = this.spiral[k];
      secs[n++] = Math.max(0, t);
    }
    return n;
  }

  /** Sudden death: walls land on schedule. A wall flattens a crate, removes a TNT and knocks out whoever stands under it. */
  private dropWalls(): void {
    const s = this.s;
    while (
      this.fallIdx < this.spiral.length &&
      this.time >= this.fallTime(this.fallIdx)
    ) {
      const i = this.spiral[this.fallIdx++];
      if (s.terrain[i] === Terrain.Hard) continue;
      s.terrain[i] = Terrain.Hard;
      s.flame[i] = 0;
      s.items[i] = -1;
      s.hidden[i] = -1;
      const j = s.tntAt[i];
      if (j >= 0) {
        s.tnts[j].active = false;
        s.tntAt[i] = -1;
        const owner = s.players[s.tnts[j].owner];
        if (owner) owner.tntLeft = Math.min(owner.maxTnt, owner.tntLeft + 1);
      }
      const x = i % s.w;
      const y = (i - x) / s.w;
      const e = this.fell.next();
      e.x = x;
      e.y = y;
      this.events.push(e);
      for (const p of s.players) {
        if (
          p.state !== 'alive' ||
          Math.floor(p.x) !== x ||
          Math.floor(p.y) !== y
        )
          continue;
        p.state = 'ko';
        p.moving = false;
        const k = this.ko.next();
        k.id = p.id;
        k.byOwner = -1;
        this.events.push(k);
      }
    }
  }

  private checkRoundEnd(): void {
    const players = this.s.players;
    let alive = 0;
    let present = 0;
    let last = -1;
    for (const p of players) {
      if (p.present) present++;
      if (p.state === 'alive') {
        alive++;
        last = p.id;
      }
    }
    if (present > 1 && alive <= 1) this.endRound(alive === 1 ? last : null);
    else if (this.time >= ROUND_S) this.endRound(null);
  }

  private endRound(winner: number | null): void {
    this.over = true;
    const players = this.s.players;
    if (winner !== null) players[winner].wins++;
    this.roundEv.winner = winner;
    this.events.push(this.roundEv);

    const need = Math.floor(this.config.rounds / 2) + 1;
    let best = -1;
    let leader: number | null = null;
    for (const p of players) {
      if (p.wins > best) {
        best = p.wins;
        leader = p.id;
      } else if (p.wins === best) leader = null;
    }
    if (best >= need || this.round + 1 >= this.config.rounds) {
      this.matchOver = true;
      this.matchWinner = best > 0 ? leader : null;
      this.matchEv.winner = this.matchWinner;
      this.events.push(this.matchEv);
    }
  }
}
