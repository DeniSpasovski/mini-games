import { hash3, hashString, Rng } from '../../../shared/rng';
import type { CornerFansRule } from '../maps/shared/types';
import { newRoadQuery, type Road } from './road';
import type { ScatterInstance } from './scatter';

/** Assets a corner fan group uses (for the streamer's prewarm / view distance). */
export const CORNER_FAN_ASSETS = ['tape_post', 'spectator', 'fan_flag'];

/**
 * Fan groups on the INSIDE of tight corners along the whole stage (MapDef.cornerFans): a red / white tape line
 * just off the shoulder, spectators behind it facing the road and now and then a flag - small saturated spots
 * that make a stage look alive at speed. Deterministic from the map seed.
 *
 * Each `every` m window gets a group with probability `chance`, at its tightest point if that is tighter than
 * `maxRadius`. A group is skipped where a
 * side road joins on that side, on a bridge span, and every piece is dropped where `blocked(x, z)` (buildings,
 * paths, water, pads) or where it would stand on another leg of the stage road (hairpins).
 */
export function cornerFanInstances(
  road: Road,
  height: (x: number, z: number) => number,
  rule: CornerFansRule,
  seed: number,
  junctions: readonly { along: number; width: number; side: 1 | -1 }[],
  blocked: (x: number, z: number) => boolean,
): ScatterInstance[] {
  const out: ScatterInstance[] = [];
  const rng = new Rng(hash3(7, 3, 1, seed ^ hashString('corner-fans')));
  const rq = newRoadQuery();
  const every = rule.every ?? 70;
  const maxRadius = rule.maxRadius ?? 60;
  const from = rule.from ?? 150;
  const to = rule.to ?? road.length - 150;

  for (let a0 = from; a0 + every <= to; a0 += every) {
    // Draw every random number for the window first, so one rejected group does not reshuffle the rest.
    const take = rng.next();
    const len = rng.range(12, 26);
    const fans = rng.int(rule.fans?.[0] ?? 3, rule.fans?.[1] ?? 8);
    const flags = rng.next() < (rule.flagChance ?? 0.6) ? rng.int(1, 3) : 0;
    const sub = new Rng(hash3(Math.round(a0), 11, 5, seed));
    if (take > (rule.chance ?? 0.5)) continue;
    // The group stands at the apex: the tightest point of this window.
    let along = a0;
    let k = 0;
    for (let a = a0; a < a0 + every; a += 2) {
      const c = Math.abs(road.at(a).curvature);
      if (c > k) [k, along] = [c, a];
    }
    if (k < 1 / maxRadius) continue;
    const s = road.at(along);
    if (road.bridgeAt(along - len) || road.bridgeAt(along + len)) continue;
    // Inside of the corner (+ = left).
    const side: 1 | -1 = s.curvature > 0 ? 1 : -1;
    if (
      junctions.some(
        (j) =>
          j.side === side && Math.abs(j.along - along) < len + 12 + j.width / 2,
      )
    )
      continue;

    const place = (
      asset: string,
      da: number,
      off: number,
      variant: number,
      yaw = 0,
    ): void => {
      const p = road.at(along + da);
      const lat = side * (p.halfWidth + off);
      const x = p.x + p.tz * lat;
      const z = p.z - p.tx * lat;
      if (blocked(x, z)) return;
      // Not on (or right beside) another leg of the stage road.
      const q = road.query(x, z, rq);
      if (q.found && q.distance < q.halfWidth + Math.min(off, 3.5) - 0.2)
        return;
      const heading = Math.atan2(p.tx, p.tz);
      out.push({
        asset,
        variant,
        x,
        y: height(x, z),
        z,
        // +Z faces the road (local X runs along it), then `yaw`.
        rotY: heading + (side > 0 ? -Math.PI / 2 : Math.PI / 2) + yaw,
        scale: 1,
        tiltX: 0,
        tiltZ: 0,
      });
    };

    // Tape: posts 5.2 m apart (each carries 2.6 m of tape either way along its local X = along the road).
    const tapeOff = rule.tapeOffset ?? 3.5;
    const posts = Math.max(2, Math.round(len / 5.2) + 1);
    for (let i = 0; i < posts; i++)
      place('tape_post', (i / (posts - 1) - 0.5) * len, tapeOff, 0);
    // Fans behind the tape, loosely bunched, some a row further back.
    for (let i = 0; i < fans; i++)
      place(
        'spectator',
        (sub.next() - 0.5) * len * 0.9,
        tapeOff + 1.5 + sub.next() * 4,
        sub.int(0, 5),
        sub.range(-0.5, 0.5),
      );
    for (let i = 0; i < flags; i++)
      place(
        'fan_flag',
        (sub.next() - 0.5) * len * 0.8,
        tapeOff + 2 + sub.next() * 3,
        sub.int(0, 7),
        // Flies roughly along the road, either way.
        (sub.next() < 0.5 ? 0 : Math.PI) + sub.range(-0.6, 0.6),
      );
  }
  return out;
}
