/** An asset level the streamer wants built (`LodSpec.lazy`). */
export interface Want {
  /** Bucket key (`asset:variant:lod`): one entry per level. */
  key: string;
  asset: string;
  variant: number;
  lod: number;
  /** Metres before the nearest instance needs the level (<= 0: it is needed now). */
  slack: number;
}

/**
 * The costly levels (people close up) the streamer builds ahead of the camera, the most urgent first. A rebuild job calls
 * `want` for every level it would like and `swap` when it is done: what it did not ask for again is no longer in range.
 */
export class BuildQueue {
  private waiting = new Map<string, Want>();
  private asked = new Map<string, Want>();

  get size(): number {
    return this.waiting.size;
  }

  /** Asked for by the running rebuild (the nearest instance counts). */
  want(w: Want): void {
    const old = this.asked.get(w.key);
    if (!old || w.slack < old.slack) this.asked.set(w.key, w);
  }

  /** A rebuild finished: its wishes replace the waiting ones. */
  swap(): void {
    this.waiting = this.asked;
    this.asked = new Map();
  }

  /** The most urgent waiting level that is needed at `slack` or less, still waiting. */
  next(slack: number): Want | null {
    let best: Want | null = null;
    for (const w of this.waiting.values())
      if (w.slack <= slack && (!best || w.slack < best.slack)) best = w;
    return best;
  }

  /** Takes a level off the queue (it is being built). */
  done(w: Want): void {
    this.waiting.delete(w.key);
  }
}

/** What `evictions` weighs: one built `lazy` level held by the streamer. */
export interface Held {
  key: string;
  bytes: number;
  /** Rebuild count at its last use (the streamer's `commits`). */
  used: number;
  /** No instance draws it now. */
  idle: boolean;
}

/**
 * Levels to drop when the built ones hold more than `budget` bytes: the idle ones not used for `grace` rebuilds,
 * least recently used first, until the rest is under 3/4 of the budget (so it does not run every pass).
 */
export function evictions(
  held: Held[],
  now: number,
  budget: number,
  grace: number,
): string[] {
  let total = held.reduce((n, h) => n + h.bytes, 0);
  if (total <= budget) return [];
  const out: string[] = [];
  const old = held
    .filter((h) => h.idle && now - h.used > grace)
    .sort((a, b) => a.used - b.used);
  for (const h of old) {
    if (total <= budget * 0.75) break;
    out.push(h.key);
    total -= h.bytes;
  }
  return out;
}
