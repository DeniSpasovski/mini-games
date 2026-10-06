import { Rng } from '../../../shared/rng';
import { FallState } from './fall';
import { moveSpeed } from './progression';
import type { Sim } from './sim';

/**
 * Greedy autopilot: heads for the best edible cluster (points per second of
 * travel). Used by F8 in game, the balance page and the tests.
 */
export interface BotSkill {
  /** Seconds between target decisions. */
  reaction: number;
  /** Fraction of full stick used. */
  speed: number;
  /** Random steering wobble (rad). */
  wobble: number;
}

export const BOT_SKILLS: Record<string, BotSkill> = {
  casual: { reaction: 1.4, speed: 0.7, wobble: 0.25 },
  good: { reaction: 0.6, speed: 0.92, wobble: 0.08 },
  perfect: { reaction: 0.25, speed: 1, wobble: 0 },
};

/** Longest lead (s): movers change their minds, so never aim further ahead than this. */
const MAX_LEAD = 1.5;

export class Bot {
  private target = -1;
  private nextThink = 0;
  private rng: Rng;
  private wob = 0;
  private aimPoint = { x: 0, z: 0, t: 0 };

  constructor(
    private sim: Sim,
    readonly skill: BotSkill = BOT_SKILLS.good,
    seed = 1,
  ) {
    this.rng = new Rng(seed);
  }

  /** World-space stick for this step. */
  control(dt: number): { x: number; z: number } {
    const { sim, skill } = this;
    const w = sim.world;
    const h = sim.hole;
    this.nextThink -= dt;
    if (
      this.nextThink <= 0 ||
      this.target < 0 ||
      w.state[this.target] !== FallState.Idle
    ) {
      this.target = this.choose();
      this.nextThink = skill.reaction;
      this.wob = (this.rng.next() - 0.5) * 2 * skill.wobble;
    }
    if (this.target < 0) return { x: 0, z: 0 };
    const aim = this.intercept(this.target);
    let dx = aim.x - h.x;
    let dz = aim.z - h.z;
    const dist = Math.hypot(dx, dz) || 1;
    dx /= dist;
    dz /= dist;
    const c = Math.cos(this.wob);
    const s = Math.sin(this.wob);
    const slow = Math.min(1, dist / 2); // ease in on the last metres
    return {
      x: (dx * c - dz * s) * skill.speed * slow,
      z: (dx * s + dz * c) * skill.speed * slow,
    };
  }

  /**
   * Where to steer for item `i`: its own position, or for a mover the point the hole can reach at the same
   * time it does (capped lead). Allocation-free: returns the shared `aimPoint`.
   */
  private intercept(i: number): { x: number; z: number; t: number } {
    const { sim, skill, aimPoint: p } = this;
    const w = sim.world;
    const h = sim.hole;
    const rx = w.x[i] - h.x;
    const rz = w.z[i] - h.z;
    const full = moveSpeed(h.diameter);
    const s = full * skill.speed;
    p.x = w.x[i];
    p.z = w.z[i];
    p.t = Math.hypot(rx, rz) / full;
    if (!w.isMover[i]) return p;
    const vx = w.mVx[i];
    const vz = w.mVz[i];
    const a = vx * vx + vz * vz - s * s;
    if ((vx === 0 && vz === 0) || a > -1e-6) return p;
    // |r + v t| = s t  ->  a t^2 + 2 (r.v) t + r.r = 0, a < 0: one positive root
    const b = rx * vx + rz * vz;
    const disc = b * b - a * (rx * rx + rz * rz);
    const t = (-b - Math.sqrt(disc)) / a;
    if (!(t > 0)) return p;
    p.t = t;
    const lead = Math.min(t, MAX_LEAD);
    p.x += vx * lead;
    p.z += vz * lead;
    return p;
  }

  private choose(): number {
    const { sim } = this;
    const w = sim.world;
    const h = sim.hole;
    const speed = moveSpeed(h.diameter);
    const reach = h.diameter * 0.45;
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < w.n; i++) {
      if (w.state[i] !== FallState.Idle || w.level[i] > h.level) continue;
      const dist = Math.hypot(w.x[i] - h.x, w.z[i] - h.z);
      const travel = w.isMover[i] ? this.intercept(i).t : dist / speed;
      let value = w.points[i];
      // cluster bonus: neighbours the hole would swallow on the way
      let neighbours = 0;
      if (dist < 120) {
        w.query(w.x[i], w.z[i], reach, (j) => {
          if (j !== i && w.state[j] === FallState.Idle && w.level[j] <= h.level)
            neighbours += w.points[j];
        });
      }
      value += neighbours * 0.6;
      const score = value / (travel + 1.5);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best >= 0) return best;
    // nothing edible: lean on the smallest thing that is too big
    let min = Infinity;
    for (let i = 0; i < w.n; i++) {
      if (w.state[i] !== FallState.Idle) continue;
      const d = Math.hypot(w.x[i] - h.x, w.z[i] - h.z) + w.level[i] * 5;
      if (d < min) {
        min = d;
        best = i;
      }
    }
    return best;
  }
}

export interface RunResult {
  score: number;
  level: number;
  eaten: number;
  pct: number;
  time: number;
  cleared: boolean;
  /** Level / score sampled every `sample` seconds. */
  timeline: { t: number; level: number; score: number }[];
}

/** Run a whole game headless with the bot (same Sim as the game). */
export function runBot(
  sim: Sim,
  skill: BotSkill = BOT_SKILLS.good,
  opts: { dt?: number; seed?: number; sample?: number } = {},
): RunResult {
  const dt = opts.dt ?? 1 / 30;
  const sample = opts.sample ?? 10;
  const bot = new Bot(sim, skill, opts.seed ?? 1);
  const timeline: RunResult['timeline'] = [];
  let nextSample = 0;
  while (!sim.over) {
    const c = bot.control(dt);
    sim.step(dt, c.x, c.z);
    sim.drainEvents();
    if (sim.time >= nextSample) {
      timeline.push({ t: sim.time, level: sim.hole.level, score: sim.score });
      nextSample += sample;
    }
  }
  return {
    score: sim.score,
    level: sim.hole.level,
    eaten: sim.itemsEaten,
    pct: sim.pointsEaten / sim.world.totalPoints,
    time: sim.time,
    cleared: sim.cleared,
    timeline,
  };
}
