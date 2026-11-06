import type { BarrierRule, DropRails } from '../maps/shared/types';
import type { Road } from './road';

/**
 * Guard rails derived from the ground (MapDef.dropRails): on each side of the stage road, wherever the carved ground
 * falls more than `minDrop` m below the road within `within` m of the valley edge (the verge's outer edge) (a fill bank or a natural drop on the
 * valley side), a rusty / galvanised rail runs along the edge. Short gaps are bridged, short runs dropped, ends led in.
 * Rules the map lists itself (`barriers`: hand-placed, hairpin and OSM-mapped `barrier=guard_rail` rails) win: a derived
 * run never overlaps an explicit rule on the same side, and one ending within `gap` of it carries that rail on (its steel and
 * offset, no gap). Pure (no scene) so the world tests can run it.
 */

/** Sample spacing along the road (m). */
const STEP = 2;

export function dropRailRules(
  road: Road,
  /** Final (carved) ground height. */
  height: (x: number, z: number) => number,
  o: DropRails,
  explicit: readonly BarrierRule[],
  /** Verge width (m): the valley edge is where it ends. */
  shoulder = 0,
): BarrierRule[] {
  const within = o.within ?? 3;
  const gap = o.gap ?? 14;
  const minLength = o.minLength ?? 16;
  const lead = o.lead ?? 4;
  const lo = Math.max(0, o.from ?? 0);
  const hi = Math.min(road.length, o.to ?? road.length);
  const out: BarrierRule[] = [];
  for (const side of [1, -1] as const) {
    const name = side === 1 ? 'left' : 'right';
    // Explicit rules on this side (a 'both' rule counts on either).
    const taken = explicit
      .filter((r) => r.side === name || r.side === 'both')
      .map((r) => [r.from ?? 0, r.to ?? road.length, r] as const);
    const drop: boolean[] = [];
    for (let a = lo; a <= hi; a += STEP) {
      const p = road.at(a);
      if (road.bridgeAt(a)) {
        drop.push(false);
        continue;
      }
      let deepest = 0;
      for (let l = 0.5; l <= within + 1e-6; l += 0.5) {
        const lat = side * (p.halfWidth + shoulder + l);
        deepest = Math.max(
          deepest,
          p.y - height(p.x + p.tz * lat, p.z - p.tx * lat),
        );
      }
      drop.push(deepest > o.minDrop);
    }
    // Bridge gaps shorter than `gap`, keep runs at least `minLength`.
    const runs: [number, number][] = [];
    let start = -1;
    for (let i = 0; i <= drop.length; i++) {
      if (i < drop.length && drop[i]) {
        if (start < 0) start = i;
        continue;
      }
      if (start < 0) continue;
      const from = lo + start * STEP;
      const to = lo + (i - 1) * STEP;
      const prev = runs[runs.length - 1];
      if (prev && from - prev[1] <= gap) prev[1] = to;
      else runs.push([from, to]);
      start = -1;
    }
    for (const [f, t] of runs) {
      if (t - f < minLength) continue;
      let from = Math.max(lo, f - lead);
      let to = Math.min(hi, t + lead);
      // Cut out the explicit rules' spans (they win).
      const pieces: [number, number][] = [[from, to]];
      for (const [a, b] of taken)
        for (let k = pieces.length - 1; k >= 0; k--) {
          const [pf, pt] = pieces[k];
          if (b <= pf || a >= pt) continue;
          pieces.splice(
            k,
            1,
            ...(
              [
                [pf, a],
                [b, pt],
              ] as [number, number][]
            ).filter(([x, y]) => y - x >= minLength),
          );
        }
      for ([from, to] of pieces) {
        // A piece that ends within `gap` of a map rail on the same side carries it on: it butts onto that rail and
        // takes its steel and offset (one continuous rail, no colour change or step at the hand-over).
        const joins = taken.find(
          ([a, b]) => Math.abs(a - to) <= gap || Math.abs(from - b) <= gap,
        );
        if (joins) {
          const [a, b, rule] = joins;
          if (Math.abs(a - to) <= gap) to = a;
          if (Math.abs(from - b) <= gap) from = b;
          if (to - from < minLength) continue;
          out.push({
            kind: 'guardrail',
            side: name,
            offset: rule.offset,
            from: Math.round(from),
            to: Math.round(to),
            skipJunctions: rule.skipJunctions ?? o.skipJunctions ?? 4,
            rusty: rule.rusty ?? false,
          });
          continue;
        }
        out.push({
          kind: 'guardrail',
          side: name,
          offset: o.offset ?? 0.9,
          from: Math.round(from),
          to: Math.round(to),
          skipJunctions: o.skipJunctions ?? 4,
          rusty: o.rusty ?? true,
        });
      }
    }
  }
  return out;
}
