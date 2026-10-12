import { Rng } from '../../../shared/rng';
import { DangerMap, NEVER } from './danger';
import { PowerUp } from './powerups';
import { FUSE_S, MAX_POWER_LEVEL, START_RANGE, START_TNT, STEP } from './rules';
import {
  Terrain,
  type Difficulty,
  type KaboomSim,
  type PlayerInput,
} from './types';

/** How a bot plays; difficulty only changes these numbers (DETAILS.md "Bots"). */
export interface BotParams {
  /** Seconds between two decisions (the reaction time). */
  thinkS: number;
  /** Chance per decision of a blunder: a short burst of random walking. */
  mistake: number;
  /** Worth of a blast that reaches the human, against 1 for a crate it breaks. */
  humanWeight: number;
  /** Worth of a blast that reaches another bot (they mostly leave each other alone: the human is the target). */
  botWeight: number;
  /** How much crates matter when picking a spot (hunters care less and go for the human sooner). */
  crateWeight: number;
  /** Fetch a power-up it can still use when it lies within this many steps. */
  itemRange: number;
  /** Walk towards the human only when they are within this many cells (Manhattan); farther away the bot roams and farms. */
  chaseRange: number;
  /** Drop TNT this close (cells) to the human even when they are not in the cross yet: it cuts their escape routes. */
  pressure: number;
  /** Look for TNT spots that leave the human no way out. */
  trap: boolean;
  /** Aim at where the human is heading, not where they stand. */
  lead: boolean;
  /** Seconds of safety margin around a flame window when judging a cell. */
  margin: number;
  /** A cell that burns within this many seconds counts as "in danger". */
  lookahead: number;
}

export const BOT_PARAMS: Record<Difficulty, BotParams> = {
  easy: {
    thinkS: 0.3,
    mistake: 0.14,
    humanWeight: 1.6,
    botWeight: 0.3,
    crateWeight: 1,
    chaseRange: 7,
    itemRange: 4,
    pressure: 0,
    trap: false,
    lead: false,
    margin: 0.04,
    lookahead: 1.6,
  },
  normal: {
    thinkS: 0.1,
    mistake: 0.03,
    humanWeight: 5,
    botWeight: 1,
    crateWeight: 0.8,
    chaseRange: 16,
    itemRange: 8,
    pressure: 1,
    trap: true,
    lead: false,
    margin: 0.15,
    lookahead: 3.5,
  },
  hard: {
    thinkS: 0.05,
    mistake: 0.004,
    humanWeight: 10,
    botWeight: 1.2,
    crateWeight: 0.4,
    chaseRange: 99,
    itemRange: 12,
    pressure: 3,
    trap: true,
    lead: true,
    margin: 0.22,
    lookahead: 99,
  },
};

const N4: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
/** How far (in cells) a bot looks for a place to blast from or to run to. */
const MAX_STEPS = 14;
/** Extra placement margin (s) per second the fuse is shorter than Easy's. */
const SLACK_PER_S = 0.3;
const PATH_MAX = MAX_STEPS + 2;

/**
 * Scratch shared by all bots of a sim (they think one after another): the danger map of this tick, which cells hold TNT or
 * enemies, and the buffers of the breadth-first search. Allocated once.
 */
class BotWorld {
  readonly danger = new DangerMap();
  /** Danger with one extra TNT: "what if I place it here?" */
  readonly danger2 = new DangerMap();
  tntCell = new Uint8Array(0);
  /** Worth of reaching the player standing on each cell (0 = nobody): the human counts most. */
  enemyAt = new Float32Array(0);
  dist = new Int16Array(0);
  prev = new Int16Array(0);
  queue = new Int16Array(0);
  stamp = -1;
  w = 0;
  h = 0;

  /** Refresh the per-tick facts (once per tick, however many bots think). */
  update(sim: KaboomSim, tick: number): void {
    if (this.stamp === tick) return;
    this.stamp = tick;
    const { w, h } = sim.map;
    if (this.w !== w || this.h !== h) {
      this.w = w;
      this.h = h;
      const n = w * h;
      this.tntCell = new Uint8Array(n);
      this.enemyAt = new Float32Array(n);
      this.dist = new Int16Array(n);
      this.prev = new Int16Array(n);
      this.queue = new Int16Array(n);
    }
    this.tntCell.fill(0);
    for (const t of sim.tnts) if (t.active) this.tntCell[t.y * w + t.x] = 1;
    this.danger.compute(sim);
  }

  /**
   * Mark where living players stand with what a blast on them is worth to `self`: the human (`focus`) counts `humanWeight`,
   * other bots `botWeight`; a hunter also marks the cell the human is heading to (`lead`).
   */
  markPlayers(
    sim: KaboomSim,
    self: number,
    focus: number,
    params: BotParams,
  ): void {
    const { w, h } = this;
    this.enemyAt.fill(0);
    for (const p of sim.players) {
      if (p.id === self || p.state !== 'alive') continue;
      const weight = p.id === focus ? params.humanWeight : params.botWeight;
      const cx = Math.floor(p.x);
      const cy = Math.floor(p.y);
      this.enemyAt[cy * w + cx] += weight;
      if (p.id === focus && params.lead && p.moving) {
        const ax = cx + Math.round(Math.cos(p.facing));
        const ay = cy + Math.round(Math.sin(p.facing));
        if (ax >= 0 && ay >= 0 && ax < w && ay < h)
          this.enemyAt[ay * w + ax] += weight * 0.7;
      }
    }
  }

  /**
   * Breadth-first search from `start` over free cells, time-aware: a cell is entered only if it is not burning when the
   * bot would get there (`danger`), so every path found is safe to walk.
   */
  bfs(
    sim: KaboomSim,
    danger: DangerMap,
    start: number,
    speed: number,
    margin: number,
  ): void {
    const { w, h, dist, prev, queue } = this;
    dist.fill(-1);
    dist[start] = 0;
    prev[start] = -1;
    queue[0] = start;
    let head = 0;
    let tail = 1;
    while (head < tail) {
      const i = queue[head++];
      const d = dist[i];
      if (d >= MAX_STEPS) continue;
      const x = i % w;
      const y = (i - x) / w;
      for (const [dx, dy] of N4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (dist[n] >= 0 || sim.terrain[n] !== Terrain.Empty || this.tntCell[n])
          continue;
        // the bot is inside the cell for about 1 / speed seconds around its arrival time
        if (danger.unsafe(n, (d + 1) / speed, margin + 0.5 / speed)) continue;
        dist[n] = d + 1;
        prev[n] = i;
        queue[tail++] = n;
      }
    }
  }

  /** Is standing on `i` from `t` seconds on harmless (never burns, or already burnt out)? */
  safeAfter(danger: DangerMap, i: number, t: number, margin: number): boolean {
    return danger.start[i] >= NEVER || t - margin > danger.end[i];
  }
}

/** What dropping a TNT of `range` on cell `(x, y)` would be worth: crates it breaks and enemies it reaches. */
function blastValue(
  sim: KaboomSim,
  enemyAt: Float32Array,
  x: number,
  y: number,
  range: number,
  crateWeight: number,
): number {
  const { w, h } = sim.map;
  let value = enemyAt[y * w + x];
  for (const [dx, dy] of N4) {
    for (let k = 1; k <= range; k++) {
      const cx = x + dx * k;
      const cy = y + dy * k;
      if (cx < 0 || cy < 0 || cx >= w || cy >= h) break;
      const i = cy * w + cx;
      const t = sim.terrain[i];
      if (t === Terrain.Hard) break;
      if (t === Terrain.Crate) {
        value += crateWeight;
        break;
      }
      value += enemyAt[i];
    }
  }
  return value;
}

/**
 * One bot's brain. Every `thinkS` seconds (staggered per bot) it looks at the danger map and decides: run from flames,
 * drop a TNT where it is worth it and it can still get away, walk to the best spot to blast from, or wander. Between
 * decisions it just follows its path with one input per tick. All the "can I get away" reasoning goes through
 * `DangerMap`, which also knows about chains.
 */
class BotBrain {
  private readonly path = new Int16Array(PATH_MAX);
  private pathLen = 0;
  private pathPos = 0;
  private nextThink: number;
  private blunderUntil = -1;
  private blunderDx = 0;
  private blunderDy = 0;
  private target = -1;
  /** Cell the bot is running to while in danger (-1 = none). */
  private escapeGoal = -1;
  private approachGoal = -1;
  private wanderGoal = -1;
  private wanderUntil = 0;
  private placeNext = false;
  private lastX = 0;
  private lastY = 0;
  private lastCheck = 0;
  private wantsMove = false;
  /** Cells the bot gave up placing on (seconds until it may try again). */
  private ban = new Float32Array(0);

  constructor(
    readonly id: number,
    private readonly params: BotParams,
    private readonly rng: Rng,
    /** The human slot the bot hunts (-1 = none: it goes for the nearest enemy). */
    private readonly focus: number = -1,
  ) {
    this.nextThink = id * 3;
  }

  reset(tick: number): void {
    this.pathLen = this.pathPos = 0;
    this.target = -1;
    this.escapeGoal = this.approachGoal = this.wanderGoal = -1;
    this.blunderUntil = -1;
    this.placeNext = false;
    this.nextThink = tick + this.id * 3;
    this.ban.fill(0);
  }

  /** Write this tick's input into `out`. */
  act(sim: KaboomSim, world: BotWorld, tick: number, out: PlayerInput): void {
    out.dx = out.dy = 0;
    out.place = false;
    const p = sim.players[this.id];
    if (p.state !== 'alive' || sim.countdown > 0 || sim.over) return;
    const now = tick * STEP;

    if (tick >= this.nextThink) {
      world.update(sim, tick);
      this.think(sim, world, now);
      this.nextThink =
        tick +
        Math.max(
          1,
          Math.round((this.params.thinkS + this.rng.range(0, 0.03)) / STEP),
        );
    }

    if (this.placeNext) {
      out.place = true;
      this.placeNext = false;
    }
    if (now < this.blunderUntil) {
      out.dx = this.blunderDx;
      out.dy = this.blunderDy;
      return;
    }
    this.follow(sim, p.x, p.y, out);
  }

  private think(sim: KaboomSim, world: BotWorld, now: number): void {
    const { w } = sim.map;
    const { params } = this;
    const p = sim.players[this.id];
    if (this.ban.length !== w * sim.map.h)
      this.ban = new Float32Array(w * sim.map.h);

    // stuck detection: had a path for a second and went nowhere -> a short random walk
    if (now - this.lastCheck >= 1) {
      if (
        this.wantsMove &&
        Math.hypot(p.x - this.lastX, p.y - this.lastY) < 0.05
      )
        this.blunder(now, 0.4, sim, world);
      this.lastX = p.x;
      this.lastY = p.y;
      this.lastCheck = now;
    }
    if (now < this.blunderUntil) return;
    if (this.rng.chance(params.mistake)) {
      this.blunder(now, 0.35, sim, world);
      return;
    }
    this.decide(sim, world, now);
    this.wantsMove = this.pathLen > 0;
  }

  /** The plan: flee, blast, walk to the best spot, or roam. */
  private decide(sim: KaboomSim, world: BotWorld, now: number): void {
    const { w } = sim.map;
    const { params } = this;
    const p = sim.players[this.id];
    // every decision starts from scratch: a plan made a moment ago may lead into a blast by now
    this.pathLen = this.pathPos = 0;
    const ci = Math.floor(p.y) * w + Math.floor(p.x);
    const { danger } = world;
    const focus =
      this.focus >= 0 && sim.players[this.focus]?.state === 'alive'
        ? this.focus
        : -1;
    world.markPlayers(sim, this.id, focus, params);
    world.bfs(sim, danger, ci, p.speed, params.margin);
    const inDanger =
      danger.start[ci] <= params.lookahead && danger.end[ci] >= 0;

    if (inDanger) {
      this.escape(world, p.speed);
      return;
    }
    this.escapeGoal = -1;

    // an enemy close by with no way out of the blast: drop it, if I can get away myself
    if (
      params.trap &&
      p.tntLeft > 0 &&
      !world.tntCell[ci] &&
      this.enemyNear(sim, p, 6, focus) &&
      this.canGetAway(sim, world, ci, p)
    ) {
      const trapped = this.trapsEnemy(sim, world, ci, p, focus);
      world.bfs(sim, danger, ci, p.speed, params.margin); // the checks above reused the search buffers
      if (trapped) {
        this.placeNext = true;
        this.pathLen = 0;
        return;
      }
    }

    // a power-up within reach that I can still use: go and get it
    const item = this.findItem(sim, world, p);
    if (item >= 0) {
      this.target = -1;
      this.setPath(world, item);
      return;
    }

    // best place to drop a TNT from, near enough to walk to
    let best = -1;
    let bestScore = 0;
    const { dist } = world;
    for (let i = 0; i < dist.length; i++) {
      if (dist[i] < 0 || world.tntCell[i] || this.ban[i] > now) continue;
      // never plan to stand where a blast is already due: it may be a dead end by then
      if (danger.start[i] < NEVER) continue;
      const x = i % w;
      const y = (i - x) / w;
      let value = blastValue(
        sim,
        world.enemyAt,
        x,
        y,
        p.range,
        params.crateWeight,
      );
      // pressure: TNT right beside the human takes away their room even before they are in the cross
      if (
        focus >= 0 &&
        params.pressure > 0 &&
        Math.abs(x + 0.5 - sim.players[focus].x) +
          Math.abs(y + 0.5 - sim.players[focus].y) <=
          params.pressure
      )
        value += params.humanWeight * 0.4;
      if (value <= 0) continue;
      const score = value - dist[i] * 0.45 + (i === this.target ? 0.6 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }

    if (best === ci) {
      if (p.tntLeft > 0 && this.canGetAway(sim, world, ci, p)) {
        this.placeNext = true;
        this.pathLen = 0;
      } else {
        this.ban[ci] = now + 2;
      }
      return;
    }
    if (best >= 0) {
      this.target = best;
      this.setPath(world, best);
      return;
    }
    this.target = -1;
    this.approachEnemy(sim, world, ci, now, focus);
  }

  /** The nearest power-up (not in a blast) within `itemRange` steps that this bot is not yet maxed out on, or -1. */
  private findItem(
    sim: KaboomSim,
    world: BotWorld,
    p: { maxTnt: number; range: number },
  ): number {
    const { dist, danger } = world;
    let best = -1;
    let bestD = this.params.itemRange + 1;
    for (let i = 0; i < dist.length; i++) {
      if (dist[i] <= 0 || dist[i] >= bestD) continue;
      const kind = sim.items[i];
      if (kind < 0 || danger.start[i] < NEVER) continue;
      const room =
        kind === PowerUp.Dynamites
          ? p.maxTnt - START_TNT < MAX_POWER_LEVEL
          : p.range - START_RANGE < MAX_POWER_LEVEL;
      if (!room) continue;
      best = i;
      bestD = dist[i];
    }
    return best;
  }

  /** Would a TNT of mine on `ci` leave me a way out in time? (danger map with it added) */
  private canGetAway(
    sim: KaboomSim,
    world: BotWorld,
    ci: number,
    p: { x: number; y: number; range: number; speed: number },
  ): boolean {
    const { w } = sim.map;
    const x = ci % w;
    const y = (ci - x) / w;
    world.danger2.compute(sim, { x, y, range: p.range });
    // a short fuse leaves less slack for a second TNT while others burn: ask for more room
    const margin = this.params.margin + (FUSE_S - sim.fuseS) * SLACK_PER_S;
    world.bfs(sim, world.danger2, ci, p.speed, margin);
    const { dist } = world;
    for (let i = 0; i < dist.length; i++)
      if (
        dist[i] > 0 &&
        world.safeAfter(world.danger2, i, dist[i] / p.speed, margin)
      )
        return true;
    return false;
  }

  private enemyNear(
    sim: KaboomSim,
    p: { x: number; y: number },
    cells: number,
    focus: number,
  ): boolean {
    for (const q of sim.players)
      if (
        q.id !== this.id &&
        q.state === 'alive' &&
        (focus < 0 || q.id === focus) &&
        Math.abs(q.x - p.x) + Math.abs(q.y - p.y) <= cells
      )
        return true;
    return false;
  }

  /**
   * With my TNT on `ci` (`danger2` already has it): does a nearby enemy in its blast have no cell to run to in time?
   * (The new TNT counts as a wall for them too.)
   */
  private trapsEnemy(
    sim: KaboomSim,
    world: BotWorld,
    ci: number,
    p: { x: number; y: number },
    focus: number,
  ): boolean {
    const { w } = sim.map;
    const { danger2 } = world;
    world.tntCell[ci] = 1;
    let trapped = false;
    for (const q of sim.players) {
      if (
        q.id === this.id ||
        q.state !== 'alive' ||
        (focus >= 0 && q.id !== focus) ||
        Math.abs(q.x - p.x) + Math.abs(q.y - p.y) > 7
      )
        continue;
      const ec = Math.floor(q.y) * w + Math.floor(q.x);
      if (danger2.start[ec] >= NEVER) continue; // not in the blast at all
      world.bfs(sim, danger2, ec, q.speed, 0.1);
      let escapes = false;
      for (let i = 0; i < world.dist.length && !escapes; i++)
        if (
          world.dist[i] > 0 &&
          world.safeAfter(danger2, i, world.dist[i] / q.speed, 0.1)
        )
          escapes = true;
      if (!escapes) trapped = true;
    }
    world.tntCell[ci] = 0;
    return trapped;
  }

  /** Run to the nearest cell that is safe from now on (or the one that burns last when nothing is). */
  private escape(world: BotWorld, speed: number): void {
    const { dist } = world;
    const { danger } = world;
    let best = -1;
    let bestD = 1e9;
    let fallback = -1;
    let fallbackBuffer = -1e9;
    for (let i = 0; i < dist.length; i++) {
      if (dist[i] <= 0) continue;
      const t = dist[i] / speed;
      if (world.safeAfter(danger, i, t, this.params.margin)) {
        // nearest safe cell; a cell we are already running to wins ties (no dithering between two equal exits)
        const d =
          dist[i] +
          (danger.start[i] >= NEVER ? 0 : 3) -
          (i === this.escapeGoal ? 1.5 : 0);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      } else {
        const buffer = danger.start[i] - t;
        if (buffer > fallbackBuffer) {
          fallbackBuffer = buffer;
          fallback = i;
        }
      }
    }
    const goal = best >= 0 ? best : fallback;
    this.escapeGoal = goal;
    this.target = -1;
    if (goal < 0) {
      this.pathLen = 0; // boxed in: nowhere to go
      return;
    }
    this.setPath(world, goal);
  }

  /** Nothing worth blasting in reach: walk towards the nearest enemy, or roam. */
  private approachEnemy(
    sim: KaboomSim,
    world: BotWorld,
    ci: number,
    now: number,
    focus: number,
  ): void {
    const { w } = sim.map;
    const p = sim.players[this.id];
    // the human first; with no human (menu background, autopilot) the nearest enemy
    let enemy = focus;
    let enemyD =
      enemy >= 0
        ? Math.abs(sim.players[enemy].x - p.x) +
          Math.abs(sim.players[enemy].y - p.y)
        : 1e9;
    if (enemy < 0)
      for (const q of sim.players) {
        if (q.id === this.id || q.state !== 'alive') continue;
        const d = Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
        if (d < enemyD) {
          enemyD = d;
          enemy = q.id;
        }
      }
    const { dist } = world;
    let best = -1;
    let bestD = 1e9;
    if (enemy >= 0) {
      const e = sim.players[enemy];
      for (let i = 0; i < dist.length; i++) {
        if (dist[i] < 0 || i === ci || world.danger.start[i] < NEVER) continue;
        const x = i % w;
        const y = (i - x) / w;
        // the goal we already walk to wins ties: no dithering between two equally good cells
        const d =
          Math.abs(x + 0.5 - e.x) +
          Math.abs(y + 0.5 - e.y) -
          (i === this.approachGoal ? 1.2 : 0);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    if (best >= 0 && bestD < enemyD && enemyD <= this.params.chaseRange) {
      this.approachGoal = best;
      this.wanderGoal = -1;
    } else {
      // as close as it can get: roam, keeping one goal for a few seconds
      this.approachGoal = -1;
      const keep =
        this.wanderGoal >= 0 &&
        now < this.wanderUntil &&
        dist[this.wanderGoal] > 0 &&
        world.danger.start[this.wanderGoal] >= NEVER;
      if (!keep) {
        const pick: number[] = [];
        for (let i = 0; i < dist.length && pick.length < 24; i++)
          if (
            dist[i] > 2 &&
            dist[i] < 8 &&
            world.danger.start[i] >= NEVER &&
            this.rng.chance(0.2)
          )
            pick.push(i);
        this.wanderGoal = pick.length
          ? pick[this.rng.int(0, pick.length - 1)]
          : -1;
        this.wanderUntil = now + 3;
      }
      best = this.wanderGoal;
    }
    if (best < 0) {
      this.pathLen = 0;
      return;
    }
    this.setPath(world, best);
  }

  /** Copy the BFS route to `goal` into `path` (cells after the start, in walking order). */
  private setPath(world: BotWorld, goal: number): void {
    let n = 0;
    const tmp = this.path;
    for (
      let i = goal;
      i >= 0 && world.prev[i] >= 0 && n < PATH_MAX;
      i = world.prev[i]
    )
      tmp[n++] = i;
    // reverse in place
    for (let a = 0, b = n - 1; a < b; a++, b--) {
      const t = tmp[a];
      tmp[a] = tmp[b];
      tmp[b] = t;
    }
    this.pathLen = n;
    this.pathPos = 0;
  }

  /** A short random walk, but only towards free cells that no blast is due on. */
  private blunder(
    now: number,
    seconds: number,
    sim: KaboomSim,
    world: BotWorld,
  ): void {
    this.blunderUntil = now + seconds;
    this.pathLen = 0;
    const { w, h } = sim.map;
    const p = sim.players[this.id];
    const cx = Math.floor(p.x);
    const cy = Math.floor(p.y);
    let n = 0;
    let pickDx = 0;
    let pickDy = 0;
    for (const [dx, dy] of N4) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = y * w + x;
      if (sim.terrain[i] !== Terrain.Empty || world.tntCell[i]) continue;
      if (world.danger.start[i] < NEVER) continue;
      // reservoir pick among the safe directions
      if (this.rng.int(0, n++) === 0) {
        pickDx = dx;
        pickDy = dy;
      }
    }
    this.blunderDx = pickDx;
    this.blunderDy = pickDy;
  }

  /** One axis at a time towards the next path cell, lining up with its lane first. */
  private follow(sim: KaboomSim, x: number, y: number, out: PlayerInput): void {
    const { w } = sim.map;
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    while (
      this.pathPos < this.pathLen &&
      this.path[this.pathPos] === cy * w + cx
    )
      this.pathPos++;
    if (this.pathPos >= this.pathLen) return;
    const t = this.path[this.pathPos];
    const tx = t % w;
    const ty = (t - tx) / w;
    const horizontal = tx !== cx;
    const perpErr = horizontal ? ty + 0.5 - y : tx + 0.5 - x;
    if (
      Math.abs(perpErr) > 0.2 &&
      Math.abs(horizontal ? tx - cx : ty - cy) <= 1
    ) {
      // line up with the lane first
      if (horizontal) out.dy = Math.sign(perpErr);
      else out.dx = Math.sign(perpErr);
      return;
    }
    if (horizontal) out.dx = Math.sign(tx + 0.5 - x) || Math.sign(tx - cx);
    else out.dy = Math.sign(ty + 0.5 - y) || Math.sign(ty - cy);
  }
}

/**
 * Drives every bot of a sim: call `inputs()` once per sim tick and pass the result to `sim.tick`. Slot 0 is the human
 * (pass their input) unless `botIds` includes it (autopilot / attract mode). Deterministic for a given seed.
 */
export class BotController {
  private readonly world = new BotWorld();
  private readonly brains: BotBrain[];
  private tick = 0;
  private round = 0;

  constructor(
    private readonly sim: KaboomSim,
    difficulty: Difficulty,
    seed: number,
    botIds: readonly number[] = sim.players
      .filter((p) => p.isBot)
      .map((p) => p.id),
    /** The human the bots hunt; default: the first player that is not a bot (none when every player is). */
    humanId: number = sim.players.find((p) => !botIds.includes(p.id))?.id ?? -1,
  ) {
    const params = BOT_PARAMS[difficulty];
    this.brains = botIds.map(
      (id) =>
        new BotBrain(id, params, new Rng(seed * 131 + id * 977 + 5), humanId),
    );
  }

  /** Fill `out` (one entry per player) with this tick's inputs and return it. */
  inputs(out: PlayerInput[], human?: PlayerInput): PlayerInput[] {
    const sim = this.sim;
    if (sim.round !== this.round) {
      this.round = sim.round;
      for (const b of this.brains) b.reset(this.tick);
    }
    for (let i = 0; i < sim.players.length; i++) {
      const o = (out[i] ??= { dx: 0, dy: 0, place: false });
      o.dx = o.dy = 0;
      o.place = false;
    }
    if (human && out[0]) {
      out[0].dx = human.dx;
      out[0].dy = human.dy;
      out[0].place = human.place;
    }
    for (const b of this.brains) b.act(sim, this.world, this.tick, out[b.id]);
    this.tick++;
    return out;
  }
}
