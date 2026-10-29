import { hash3, hashString, Rng } from '../../../shared/rng';
import {
  SPECTATOR_SEATED_COUNT,
  SPECTATOR_SEATED_FROM,
  SPECTATOR_VARIANTS,
} from '../assets/catalog';
import type { CornerFansRule, Country } from '../maps/shared/types';
import { flagVariant } from './fan-variants';
import { newRoadQuery, type Road } from './road';
import type { ScatterInstance } from './scatter';
import { splitRuns, tapeRun } from './tape';

/** Assets a corner fan group uses (for the streamer's prewarm / view distance). */
export const CORNER_FAN_ASSETS = [
  'tape_post',
  'tape_span',
  'spectator',
  'visitor',
  'marshal',
  'photographer',
  'fan_flag',
];

/** Assets that are people: kept out of houses and off other carriageways (world.ts). */
export const PEOPLE_ASSETS: readonly string[] = [
  'spectator',
  'visitor',
  'marshal',
  'photographer',
];

/**
 * How rich a stage looks is capped: people are the costly part of a scene (triangles close up, a person built per
 * look), and a few spots read as well as many at speed.
 */
const DEFAULT_FANS: [number, number] = [2, 5];
/** Photographers beside the tape of a corner group (min, max). */
const SHOOTERS: [number, number] = [1, 2];
/** Photographers at each end of the stage (ten are drawn, so the random stream stays; only this many are placed). */
const END_PHOTOGRAPHERS = 5;

const VISITOR_VARIANTS = 48;
const MARSHAL_VARIANTS = 24;
const PHOTOGRAPHER_VARIANTS = 24;

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
  ends: { start?: number; finish: number } | undefined,
  country: Country,
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
    const fans = rng.int(
      rule.fans?.[0] ?? DEFAULT_FANS[0],
      rule.fans?.[1] ?? DEFAULT_FANS[1],
    );
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
      push = true,
    ): { x: number; z: number } | null => {
      const p = road.at(along + da);
      const lat = side * (p.halfWidth + off);
      const x = p.x + p.tz * lat;
      const z = p.z - p.tx * lat;
      if (blocked(x, z)) return null;
      // Not on (or right beside) another leg of the stage road.
      const q = road.query(x, z, rq);
      if (q.found && q.distance < q.halfWidth + Math.min(off, 3.5) - 0.2)
        return null;
      if (!push) return { x, z };
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
      return { x, z };
    };

    // Tape: posts about 5 m apart along the whole group, tape tied from each to the next (a blocked post splits
    // the line; a post left alone is dropped).
    const tapeOff = rule.tapeOffset ?? 3.5;
    const posts = Math.max(2, Math.round(len / 5) + 1);
    const slots = Array.from({ length: posts }, (_, i) =>
      place('tape_post', (i / (posts - 1) - 0.5) * len, tapeOff, 0, 0, false),
    );
    for (const run of splitRuns(slots)) out.push(...tapeRun(run, height));
    // The mix (its own stream, so the fan spots below stay where they were): visitors, a marshal, a photographer.
    const mix = new Rng(hash3(Math.round(a0), 13, 7, seed));
    // Fans behind the tape, loosely bunched, some a row further back.
    for (let i = 0; i < fans; i++) {
      const da = (sub.next() - 0.5) * len * 0.9;
      const off = tapeOff + 1.5 + sub.next() * 4;
      // About one in five sits or squats at the roadside.
      const seated = sub.next() < 0.2;
      const variant = seated
        ? SPECTATOR_SEATED_FROM + sub.int(0, SPECTATOR_SEATED_COUNT - 1)
        : sub.int(0, SPECTATOR_VARIANTS - 1);
      const yaw = sub.range(-0.5, 0.5);
      // About a third are visitors in everyday clothes (seated ones stay fans).
      const pickVisitor = mix.next() < 0.35;
      const pickFlag = mix.next() < 0.45;
      const flagFan = flagVariant(country, mix.next());
      if (seated) place('spectator', da, off, variant, yaw);
      else if (pickFlag) place('spectator', da, off, flagFan, yaw);
      else if (pickVisitor)
        place('visitor', da, off, mix.int(0, VISITOR_VARIANTS - 1), yaw);
      else place('spectator', da, off, variant, yaw);
    }
    // A marshal at the tape, most groups, at one end; a photographer a little further along, on some.
    if (mix.next() < 0.7)
      place(
        'marshal',
        (mix.next() < 0.5 ? -0.5 : 0.5) * len * 0.8,
        tapeOff + 0.4,
        mix.int(0, MARSHAL_VARIANTS - 1),
        mix.range(-0.3, 0.3),
      );
    const shooters = mix.int(SHOOTERS[0], SHOOTERS[1]);
    for (let i = 0; i < shooters; i++)
      place(
        'photographer',
        mix.range(-0.45, 0.45) * len,
        tapeOff + 0.6 + mix.next() * 2.5,
        mix.int(0, PHOTOGRAPHER_VARIANTS - 1),
        mix.range(-0.4, 0.4),
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

  // Marshals at every side-road intersection along the stage: one each side of the mouth, facing the road.
  const jrng = new Rng(hash3(7, 3, 2, seed ^ hashString('junction-marshals')));
  for (const j of junctions) {
    if (j.width < 2.5 || j.along < from - 100 || j.along > to + 100) continue;
    const p0 = j.along;
    const pick = jrng.int(0, MARSHAL_VARIANTS - 1);
    const pick2 = jrng.int(0, MARSHAL_VARIANTS - 1);
    for (const [k, v] of [
      [-1, pick],
      [1, pick2],
    ] as const) {
      const a = p0 + k * (j.width / 2 + 1.8);
      if (road.bridgeAt(a)) continue;
      const p = road.at(a);
      const lat = j.side * (p.halfWidth + 3.2);
      const x = p.x + p.tz * lat;
      const z = p.z - p.tx * lat;
      if (blocked(x, z)) continue;
      const q = road.query(x, z, rq);
      if (q.found && q.distance < q.halfWidth + 3) continue;
      out.push({
        asset: 'marshal',
        variant: v,
        x,
        y: height(x, z),
        z,
        rotY:
          Math.atan2(p.tx, p.tz) +
          (j.side > 0 ? -Math.PI / 2 : Math.PI / 2) +
          jrng.range(-0.3, 0.3),
        scale: 1,
        tiltX: 0,
        tiltZ: 0,
      });
    }
  }

  // Photographers at the start line and at the finish, both sides of the road.
  const erng = new Rng(hash3(7, 3, 3, seed ^ hashString('end-photographers')));
  // (A line without its own photographers still draws its numbers, so the other line stays where it was.)
  for (const at of ends ? [ends.start, ends.finish] : [])
    for (let i = 0; i < 10; i++) {
      const a = (at ?? 0) + erng.range(-14, 10);
      const side: 1 | -1 = i % 2 === 0 ? 1 : -1;
      const off = 3.4 + erng.next() * 3.5;
      const variant = erng.int(0, PHOTOGRAPHER_VARIANTS - 1);
      const yaw = erng.range(-0.4, 0.4);
      if (at === undefined || i >= END_PHOTOGRAPHERS) continue;
      if (a < 0 || a > road.length || road.bridgeAt(a)) continue;
      const p = road.at(a);
      const lat = side * (p.halfWidth + off);
      const x = p.x + p.tz * lat;
      const z = p.z - p.tx * lat;
      if (blocked(x, z)) continue;
      const q = road.query(x, z, rq);
      if (q.found && q.distance < q.halfWidth + 3) continue;
      out.push({
        asset: 'photographer',
        variant,
        x,
        y: height(x, z),
        z,
        rotY:
          Math.atan2(p.tx, p.tz) +
          (side > 0 ? -Math.PI / 2 : Math.PI / 2) +
          yaw,
        scale: 1,
        tiltX: 0,
        tiltZ: 0,
      });
    }
  return out;
}
