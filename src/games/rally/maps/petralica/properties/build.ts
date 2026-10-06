import { Group, Matrix4, Vector2 } from 'three';
import type { World } from '../../../world/world';
import { Bucket, Frame } from '../../ajvatovci/start-row/build/kit';
import { meshFence } from '../../ajvatovci/start-row/build/props';
import {
  fenceRuns,
  GATES,
  gateEnds,
  SLEEPER,
  TANK,
  TANK_PAIRS,
  tankBase,
} from './layout';

/**
 * Geometry of the hazelnut farm (see index.ts): chain-link mesh on small square concrete posts (the common farm
 * fence of the region), and plank gates - varnished slats on a steel frame between two concrete pillars - all draped
 * on the terrain. World coordinates (the kit frame with origin 0, 0).
 */

/** Top of the chain-link mesh (m). */
export const FENCE_TOP = 1.5;
const POST = '#cfcac0';
const PILLAR = '#d6d2c9';
const PLANK = '#b5652a';
const STEEL = '#4a4c4f';
const COPPER = '#c97d48';
const COPPER_DARK = '#8a4c2a';
const SLEEPER_GREY = '#a9a59c';

/** The run with extra points so no piece is longer than `step` m (the mesh is draped at its points only). */
function densify(run: [number, number][], step: number): Vector2[] {
  const out = [new Vector2(run[0][0], run[0][1])];
  for (let i = 1; i < run.length; i++) {
    const [ax, az] = run[i - 1];
    const [bx, bz] = run[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 1; k <= n; k++)
      out.push(new Vector2(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n));
  }
  return out;
}

export function* buildProperties(world: World): Generator<void, Group> {
  const ground = world.analytic;
  const bucket = new Bucket();
  const f = new Frame(bucket, 'farm', undefined, { x: 0, z: 0 });
  const lift = (x: number, z: number) => ground.height(x, z);

  for (const run of fenceRuns()) {
    meshFence(f, densify(run, 3), {
      bottom: 0.05,
      top: FENCE_TOP,
      post: POST,
      postTop: FENCE_TOP + 0.15,
      square: true,
      even: true,
      lift,
    });
    yield;
  }

  for (const g of GATES) {
    const [a, b] = gateEnds(g);
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    const y = Math.min(lift(...a), lift(...b));
    // Local frame: x along the gate from pillar a, y up, z across.
    const m = new Matrix4()
      .makeTranslation(a[0], y, a[1])
      .multiply(new Matrix4().makeRotationY(Math.atan2(-dz, dx)));
    const o = { matrix: m };
    // Pillars, standing outside the opening.
    for (const px of [-0.15, len + 0.15])
      f.box(
        'paint',
        [px - 0.15, -0.3, -0.15],
        [px + 0.15, 2.05, 0.15],
        PILLAR,
        o,
      );
    // Two leaves: steel frame, vertical planks with small gaps.
    const half = len / 2;
    for (const x0 of [0.05, half + 0.02]) {
      const x1 = x0 + half - 0.07;
      for (const yy of [0.35, 1.35])
        f.box('metal', [x0, yy, -0.03], [x1, yy + 0.06, 0.03], STEEL, o);
      f.box('metal', [x0, 0.1, -0.025], [x0 + 0.05, 1.75, 0.025], STEEL, o);
      f.box('metal', [x1 - 0.05, 0.1, -0.025], [x1, 1.75, 0.025], STEEL, o);
      for (let x = x0 + 0.07; x + 0.09 < x1 - 0.05; x += 0.115)
        f.box('paint', [x, 0.12, 0.03], [x + 0.09, 1.72, 0.055], PLANK, o);
    }
    yield;
  }

  // Copper water tanks, two per pair, on two concrete sleepers (symmetrical about the pair centre).
  for (const pair of TANK_PAIRS) {
    const base = tankBase(pair, lift);
    // Local frame: x along the tanks, z across, y = 0 at the sleeper tops (three's rotation is clockwise from +x).
    const o = {
      matrix: new Matrix4()
        .makeTranslation(pair.x, base, pair.z)
        .multiply(new Matrix4().makeRotationY(-pair.yaw)),
    };
    const L = TANK.length / 2;
    const W = TANK.width + TANK.gap / 2 + SLEEPER.overhang;
    for (const u of [-SLEEPER.at, SLEEPER.at])
      f.box(
        'paint',
        [u - SLEEPER.length / 2, -1, -W],
        [u + SLEEPER.length / 2, 0, W],
        SLEEPER_GREY,
        o,
      );
    for (const side of [-1, 1]) {
      const z0 = side < 0 ? -TANK.gap / 2 - TANK.width : TANK.gap / 2;
      const z1 = z0 + TANK.width;
      f.box('paint', [-L, 0, z0], [L, TANK.height, z1], COPPER, o);
      // Seam bands and a hatch on top, an outlet at each end.
      for (const u of [-L / 2, L / 2])
        f.box(
          'metal',
          [u - 0.04, -0.005, z0 - 0.01],
          [u + 0.04, TANK.height + 0.01, z1 + 0.01],
          COPPER_DARK,
          o,
        );
      const zc = (z0 + z1) / 2;
      f.box(
        'metal',
        [-0.25, TANK.height, zc - 0.25],
        [0.25, TANK.height + 0.08, zc + 0.25],
        COPPER_DARK,
        o,
      );
      for (const end of [-1, 1])
        f.box(
          'metal',
          [end * L - (end > 0 ? 0 : 0.12), 0.2, zc - 0.05],
          [end * L + (end > 0 ? 0.12 : 0), 0.3, zc + 0.05],
          STEEL,
          o,
        );
    }
    yield;
  }

  // Untextured keys only: the plain group material skips the start-row lot texture array.
  return bucket.build('properties', { plain: true });
}
