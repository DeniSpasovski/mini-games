import { walkBlast, type BlastVisitor } from './blast';
import { CHAIN_DELAY_S, FLAME_S, MAX_TNT } from './rules';
import { Terrain, type KabooomSim } from './types';

export const NEVER = 1e9;

/** A TNT that is not on the field yet, to ask "what if I place one here?" (bots). */
export interface HypotheticalTnt {
  x: number;
  y: number;
  range: number;
}

/**
 * Per-cell danger: `start[i]` = seconds until the cell starts burning (0 = burning now, `NEVER` = safe), `end[i]` = when
 * its last flame goes out. Chains are followed in time order, with crates that earlier blasts clear (so a later blast
 * reaches further). Reusable buffers: call `compute` as often as needed, it allocates nothing after the first call.
 */
export class DangerMap {
  start = new Float32Array(0);
  end = new Float32Array(0);
  private terrain = new Uint8Array(0);
  private readonly fuse = new Float32Array(MAX_TNT + 1);
  private readonly done = new Uint8Array(MAX_TNT + 1);
  private readonly tx = new Int16Array(MAX_TNT + 1);
  private readonly ty = new Int16Array(MAX_TNT + 1);
  private readonly tr = new Int16Array(MAX_TNT + 1);
  private cellTnt = new Int16Array(0);
  private readonly fallCells = new Int16Array(40);
  private readonly fallSecs = new Float32Array(40);

  compute(sim: KabooomSim, extra?: HypotheticalTnt): void {
    const { w, h } = sim.map;
    const n = w * h;
    if (this.start.length !== n) {
      this.start = new Float32Array(n);
      this.end = new Float32Array(n);
      this.terrain = new Uint8Array(n);
      this.cellTnt = new Int16Array(n);
    }
    const { start, end, terrain, cellTnt } = this;
    terrain.set(sim.terrain);
    cellTnt.fill(-1);
    for (let i = 0; i < n; i++) {
      const f = sim.flame[i];
      start[i] = f > 0 ? 0 : NEVER;
      end[i] = f > 0 ? f : 0;
    }

    // walls about to land (sudden death): dangerous from then on, for good
    const falls = sim.upcomingFalls(4, this.fallCells, this.fallSecs);
    for (let k = 0; k < falls; k++) {
      const c = this.fallCells[k];
      if (this.fallSecs[k] < start[c]) start[c] = this.fallSecs[k];
      end[c] = NEVER;
    }

    let count = 0;
    for (const t of sim.tnts) {
      if (!t.active) continue;
      this.add(count++, t.x, t.y, t.range, t.fuse, w);
    }
    if (extra) this.add(count++, extra.x, extra.y, extra.range, sim.fuseS, w);

    for (let pass = 0; pass < count; pass++) {
      let pick = -1;
      for (let i = 0; i < count; i++)
        if (!this.done[i] && (pick < 0 || this.fuse[i] < this.fuse[pick]))
          pick = i;
      if (pick < 0) break;
      this.done[pick] = 1;
      this.burn(pick, w, h);
    }
  }

  private add(
    slot: number,
    x: number,
    y: number,
    range: number,
    fuse: number,
    w: number,
  ): void {
    this.tx[slot] = x;
    this.ty[slot] = y;
    this.tr[slot] = range;
    this.fuse[slot] = Math.max(0, fuse);
    this.done[slot] = 0;
    this.cellTnt[y * w + x] = slot;
  }

  private mark(i: number, t: number): void {
    if (t < this.start[i]) this.start[i] = t;
    if (t + FLAME_S > this.end[i]) this.end[i] = t + FLAME_S;
  }

  /** The TNT burning in `burn` (slot and its time), for the visitor. */
  private slot = 0;
  private at = 0;
  /** The same walk as the real blast (`walkBlast`): corners from level 4 included, so bots see what really burns. */
  private readonly visitor: BlastVisitor = {
    burn: (i) => {
      this.mark(i, this.at);
      if (this.terrain[i] === Terrain.Crate) {
        this.terrain[i] = Terrain.Empty;
        return true;
      }
      const j = this.cellTnt[i];
      if (j >= 0 && j !== this.slot) {
        if (!this.done[j] && this.fuse[j] > this.at + CHAIN_DELAY_S)
          this.fuse[j] = this.at + CHAIN_DELAY_S;
        return true;
      }
      return false;
    },
  };

  private burn(slot: number, w: number, h: number): void {
    this.slot = slot;
    this.at = this.fuse[slot];
    walkBlast(
      this.terrain,
      w,
      h,
      this.tx[slot],
      this.ty[slot],
      this.tr[slot],
      this.visitor,
    );
  }

  /** Would standing on cell `i` at time `at` (seconds from now) hurt? Includes a `margin` of seconds either side. */
  unsafe(i: number, at: number, margin = 0.15): boolean {
    return at + margin >= this.start[i] && at - margin <= this.end[i];
  }
}
