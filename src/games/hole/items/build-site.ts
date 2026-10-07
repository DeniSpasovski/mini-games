import type { Builder } from './build-small';
import type { Mesher } from './kit';
import {
  HEAP_COLORS,
  S,
  bar,
  barZ,
  beacon,
  ladder,
  pallet,
  railX,
  railZ,
  track,
  wheel,
} from './kit-site';

/**
 * Construction Site: materials, hand tools, crew, site furniture and heaps (mostly tiers 1-14).
 * Metres at the catalog size, pivot at the ground centre; machines run along X, workers and signs face +Z.
 */

/** Edible landscape: a lumpy dome and two side lumps, fitted to w x d x h. Variant = dirt / sand / gravel. */
function heap(
  m: Mesher,
  v: number,
  w: number,
  d: number,
  h: number,
  big = false,
) {
  const [c0, c1, c2] = HEAP_COLORS[v % 3];
  m.fitted(w, d, h, (q) => {
    q.ball(0, 0, 0, 1.0, 0.62, 0.9, c0, {
      half: true,
      jitter: 0.1,
      seed: 3 + v,
      seg: big ? 12 : 9,
      rings: big ? 8 : 6,
    });
    q.ball(0.48, 0, 0.22, 0.52, 0.42, 0.5, c1, {
      half: true,
      jitter: 0.14,
      seed: 5 + v,
      seg: 7,
      rings: 5,
    });
    q.ball(-0.42, 0, -0.28, 0.5, 0.36, 0.46, c2, {
      half: true,
      jitter: 0.14,
      seed: 9 + v,
      seg: 7,
      rings: 5,
    });
    if (big) {
      // a few boulders rolled off round the foot: reads as a worked spoil tip, not a hill
      for (const [x, z, r] of [
        [-1.02, 0.3, 0.07],
        [0.95, -0.45, 0.06],
        [-0.3, -0.95, 0.08],
      ])
        q.ball(x, 0, z, r, r * 0.9, r, S.rubble, {
          half: true,
          jitter: 0.2,
          seed: 13,
          seg: 6,
          rings: 4,
        });
    }
  });
}

/** Shipping container along X, `len` long, 2.44 x 2.6: corrugated sides, corner posts, doors at -X. */
function container(m: Mesher, len: number) {
  const W = 2.44;
  const H = 2.6;
  m.box(0, 0.05, 0, len - 0.16, H - 0.15, W - 0.12, S.white, { paint: true });
  for (const sz of [-1, 1]) {
    m.box(0, 0, (sz * (W - 0.1)) / 2, len, 0.15, 0.1, S.steelDark);
    m.box(0, H - 0.15, (sz * (W - 0.1)) / 2, len, 0.15, 0.1, S.steelDark);
    for (const sx of [-1, 1])
      m.box(
        (sx * (len - 0.12)) / 2,
        0,
        (sz * (W - 0.1)) / 2,
        0.12,
        H,
        0.1,
        S.steelDark,
      );
    // corrugation ribs, proud of the side
    const n = Math.max(3, Math.round(len / 0.7));
    for (let i = 1; i < n; i++)
      m.box(
        -len / 2 + (len * i) / n,
        0.15,
        (sz * (W - 0.1)) / 2,
        0.14,
        H - 0.3,
        0.06,
        S.white,
        {
          paint: true,
        },
      );
  }
  // doors with lock bars at the -X end
  m.box(-len / 2 + 0.02, 0.2, 0, 0.06, H - 0.4, W - 0.3, S.white, {
    paint: true,
  });
  for (const z of [-0.85, -0.35, 0.35, 0.85])
    m.box(-len / 2 - 0.02, 0.25, z, 0.04, H - 0.5, 0.05, S.steelDark);
}

export const SITE_BUILDERS: Record<string, Builder> = {
  // ---------------------------------------------------------------- tier 1
  brick(m) {
    m.box(0, 0, 0, 0.24, 0.072, 0.12, S.brick, { paint: true });
    for (const s of [-1, 1])
      m.box(s * 0.055, 0.072, 0, 0.07, 0.008, 0.05, 0x7a3a2a);
  },
  concrete_block(m) {
    m.box(0, 0, 0, 0.4, 0.19, 0.2, S.concrete);
    for (const s of [-1, 1])
      m.box(s * 0.095, 0.19, 0, 0.13, 0.01, 0.12, 0x5f5d58);
  },
  hard_hat(m) {
    m.box(0, 0, 0.01, 0.3, 0.02, 0.22, S.white, { paint: true });
    m.ball(0, 0.02, -0.005, 0.125, 0.14, 0.105, S.white, {
      half: true,
      paint: true,
    });
  },
  paint_bucket(m) {
    m.cyl(0, 0, 0, 0.14, 0.15, 0.32, 10, S.white, { paint: true, caps: false });
    m.cyl(0, 0.32, 0, 0.15, 0.148, 0.03, 10, S.light);
    for (const s of [-1, 1])
      m.box(s * 0.135, 0.24, 0, 0.02, 0.115, 0.02, S.dark);
    m.box(0, 0.345, 0, 0.29, 0.015, 0.02, S.dark);
    m.box(0.06, 0.18, 0.148, 0.08, 0.12, 0.012, S.white);
  },
  jerrycan(m) {
    m.box(0, 0, 0, 0.36, 0.38, 0.18, S.white, { paint: true });
    for (const s of [-1, 1])
      m.box(0, 0.12, s * 0.095, 0.26, 0.03, 0.012, 0x6a2a20);
    for (const x of [-0.13, -0.02])
      m.box(x, 0.38, 0, 0.03, 0.05, 0.05, S.white, { paint: true });
    m.box(-0.075, 0.43, 0, 0.16, 0.03, 0.05, S.white, { paint: true });
    m.cyl(0.11, 0.38, 0, 0.03, 0.025, 0.08, 6, S.black);
  },
  road_cone(m) {
    m.box(0, 0, 0, 0.4, 0.04, 0.4, S.rubber);
    m.cyl(0, 0.04, 0, 0.15, 0.025, 0.68, 8, S.hivis);
    const r = (y: number) => 0.15 - (0.125 * (y - 0.04)) / 0.68 + 0.008;
    m.cyl(0, 0.34, 0, r(0.34), r(0.46), 0.12, 8, S.white);
    m.cyl(0, 0.54, 0, r(0.54), r(0.62), 0.08, 8, S.white);
  },
  toolbox(m) {
    m.box(0, 0, 0, 0.5, 0.17, 0.24, S.white, { paint: true });
    m.box(0, 0.17, 0, 0.49, 0.04, 0.23, S.steelDark);
    m.box(0, 0.12, 0.125, 0.06, 0.05, 0.012, S.chrome);
    for (const s of [-1, 1])
      m.box(s * 0.12, 0.21, 0, 0.03, 0.04, 0.03, S.black);
    m.box(0, 0.24, 0, 0.27, 0.02, 0.035, S.black);
  },
  worker(m) {
    // faces +Z: boots, trousers, hi-vis vest with a reflective band, arms, head, hard hat
    for (const s of [-1, 1]) {
      m.box(s * 0.09, 0, 0.03, 0.14, 0.1, 0.24, S.black);
      m.box(s * 0.09, 0.1, 0, 0.13, 0.72, 0.17, S.darkBlue);
      m.box(s * 0.215, 0.86, 0, 0.07, 0.5, 0.12, S.white, { paint: true });
      m.box(s * 0.215, 0.76, 0, 0.065, 0.1, 0.08, S.skin);
    }
    m.box(0, 0.82, 0, 0.36, 0.56, 0.22, S.white, { paint: true });
    m.box(0, 1.0, 0, 0.372, 0.06, 0.232, S.reflect);
    m.box(0, 1.38, 0, 0.18, 0.2, 0.18, S.skin);
    m.box(0, 1.58, 0.01, 0.24, 0.03, 0.26, S.yellow);
    m.box(0, 1.61, 0, 0.2, 0.15, 0.2, S.yellow, { taper: 0.7 });
  },
  cement_bag(m) {
    m.box(0, 0, 0, 0.6, 0.12, 0.4, 0xd9cfb8, { taper: 0.92 });
    m.box(0, 0.12, 0, 0.12, 0.02, 0.34, S.red);
  },
  oil_drum(m) {
    m.cyl(0, 0, 0, 0.29, 0.29, 0.86, 10, S.white, { paint: true });
    for (const y of [0.28, 0.56])
      m.cyl(0, y, 0, 0.3, 0.3, 0.035, 10, S.white, {
        paint: true,
        caps: false,
      });
    m.cyl(0, 0.86, 0, 0.27, 0.27, 0.02, 10, S.steelDark);
    m.box(0.15, 0.88, 0, 0.05, 0.015, 0.05, S.dark);
  },
  hazard_sign(m) {
    for (const s of [-1, 1]) {
      m.box(s * 0.26, 0, 0, 0.1, 0.06, 0.4, S.rubber);
      m.box(s * 0.26, 0.06, 0, 0.04, 0.5, 0.04, S.galv);
    }
    m.box(0, 0.5, 0, 0.62, 0.6, 0.03, S.red);
    m.box(0, 0.56, 0.02, 0.5, 0.46, 0.012, S.white);
    m.box(0, 0.72, 0.03, 0.06, 0.22, 0.01, S.black);
    m.box(0, 0.62, 0.03, 0.06, 0.06, 0.01, S.black);
  },
  sandbag(m) {
    m.box(0, 0.02, 0, 0.62, 0.11, 0.36, 0xcdb58a);
    m.box(0, 0, 0, 0.54, 0.16, 0.3, 0xcdb58a);
  },
  temp_light(m) {
    m.box(0, 0, 0, 0.6, 0.25, 0.6, S.concrete);
    m.box(0, 0.25, 0, 0.08, 2.65, 0.08, S.galv);
    m.box(0, 2.0, 0.08, 0.3, 0.75, 0.2, S.black);
    m.cyl(0, 2.62, 0.19, 0.075, 0.075, 0.02, 8, S.red, {
      axis: 'z',
      glow: true,
    });
    m.cyl(0, 2.4, 0.19, 0.075, 0.075, 0.02, 8, 0x8a6a1a, { axis: 'z' });
    m.cyl(0, 2.18, 0.19, 0.075, 0.075, 0.02, 8, 0x2a5a2a, { axis: 'z' });
    m.xf(
      0,
      3.05,
      0,
      () => m.box(0, 0, 0, 0.55, 0.03, 0.5, S.darkBlue),
      0,
      -0.35,
      0,
    );
  },
  heap_xs(m, v, w, d, h) {
    heap(m, v, w, d, h);
  },
  sledgehammer(m) {
    m.box(0.33, 0, 0, 0.18, 0.1, 0.1, S.steelDark);
    m.box(-0.1, 0.03, 0, 0.7, 0.04, 0.04, S.timber);
    m.box(-0.39, 0.025, 0, 0.12, 0.05, 0.05, S.black);
  },
  // ---------------------------------------------------------------- tier 2
  plate_compactor(m) {
    m.box(0.05, 0, 0, 0.86, 0.08, 0.52, S.steelDark);
    m.box(0.43, 0.02, 0, 0.06, 0.1, 0.5, S.steelDark);
    m.box(0.05, 0.08, 0, 0.5, 0.32, 0.4, S.yellow);
    m.box(0.05, 0.4, 0, 0.4, 0.12, 0.34, S.red);
    for (const s of [-1, 1])
      bar(m, -0.1, 0.35, -0.46, 0.96, s * 0.17, 0.04, 0.04, S.dark);
    m.box(-0.46, 0.94, 0, 0.05, 0.05, 0.44, S.black);
  },
  kerb_stack(m) {
    let y = pallet(m, 0.98, 0.62);
    for (let layer = 0; layer < 3; layer++, y += 0.12)
      for (const z of [-0.225, -0.075, 0.075, 0.225])
        m.box(
          0,
          y,
          z,
          0.96,
          0.12,
          0.14,
          layer % 2 ? S.concreteLight : S.concrete,
          {
            taper: 0.88,
          },
        );
  },
  shovel(m) {
    m.box(0.39, 0, 0, 0.22, 0.03, 0.24, S.steel);
    m.box(0.25, 0.01, 0, 0.08, 0.045, 0.06, S.steelDark);
    m.box(-0.1, 0.02, 0, 0.66, 0.035, 0.035, S.timber);
    m.box(-0.46, 0, 0, 0.08, 0.1, 0.12, S.black);
  },
  rebar_bundle(m) {
    for (const z of [-0.1125, -0.0375, 0.0375, 0.1125])
      m.box(0, 0, z, 1.0, 0.07, 0.06, S.rust);
    for (const z of [-0.075, 0, 0.075])
      m.box(0, 0.07, z, 0.96, 0.07, 0.06, 0x8a4a2e);
    for (const x of [-0.3, 0.3]) m.box(x, 0, 0, 0.03, 0.16, 0.3, S.black);
  },
  barricade(m) {
    for (const x of [-0.45, 0.45]) {
      barZ(m, -0.25, 0, 0, 0.92, x, 0.05, 0.05, S.galv);
      barZ(m, 0.25, 0, 0, 0.92, x, 0.05, 0.03, S.galv);
    }
    for (const [y, hh] of [
      [0.7, 0.2],
      [0.35, 0.14],
    ]) {
      m.box(0, y, 0.035, 1.04, hh, 0.025, S.white);
      for (const x of [-0.36, -0.06, 0.24])
        m.box(x, y + 0.02, 0.052, 0.14, hh - 0.04, 0.01, S.white, {
          paint: true,
        });
    }
    m.box(-0.4, 0.9, 0.035, 0.08, 0.1, 0.06, S.beacon, { glow: true });
  },
  // ---------------------------------------------------------------- tier 3
  brick_pallet(m) {
    const y = pallet(m, 1.18, 1.0);
    m.box(0, y, 0, 1.1, 0.8, 0.94, S.white, { paint: true });
    for (let k = 1; k <= 4; k++)
      m.box(0, y + k * 0.16, 0, 1.112, 0.012, 0.95, S.mortar);
    for (const x of [-0.3, 0.3]) m.box(x, y, 0, 0.04, 0.82, 0.97, S.white);
  },
  generator(m) {
    for (const s of [-1, 1])
      m.box(0, 0, s * 0.3, 1.16, 0.08, 0.08, S.steelDark);
    m.box(0, 0.08, 0, 1.0, 0.6, 0.6, S.white, { paint: true });
    m.box(0.3, 0.3, 0.305, 0.25, 0.22, 0.012, S.dark);
    m.box(-0.2, 0.25, -0.305, 0.4, 0.2, 0.012, S.dark);
    m.cyl(-0.35, 0.68, 0.15, 0.04, 0.04, 0.1, 6, S.black);
    m.box(0, 0.68, 0, 0.5, 0.05, 0.06, S.dark);
  },
  cement_mixer(m, _v, w, d, h) {
    m.fitted(w, d, h, (m) => {
      wheel(m, -0.4, 0.33, 0.18, 0.08);
      wheel(m, -0.4, -0.33, 0.18, 0.08);
      m.box(-0.1, 0.18, 0, 0.7, 0.08, 0.6, S.steelDark);
      m.box(0.35, 0, 0, 0.06, 0.26, 0.5, S.steelDark);
      m.box(-0.35, 0.26, 0, 0.3, 0.28, 0.3, S.steelDark);
      m.box(0, 0.26, 0, 0.1, 0.45, 0.1, S.steelDark);
      m.xf(
        0.05,
        0.75,
        0,
        () => {
          m.cyl(0, -0.3, 0, 0.32, 0.36, 0.3, 10, S.white, {
            paint: true,
            caps: false,
          });
          m.cyl(0, 0, 0, 0.36, 0.2, 0.32, 10, S.white, {
            paint: true,
            caps: false,
          });
          m.cyl(0, 0.32, 0, 0.2, 0.17, 0.06, 10, S.dark);
        },
        0,
        0,
        -0.5,
      );
    });
  },
  water_barrier(m) {
    m.box(0, 0, 0, 1.2, 0.3, 0.48, S.white, { paint: true });
    m.box(0, 0.3, 0, 1.14, 0.45, 0.3, S.white, { paint: true, taper: 0.8 });
    m.cyl(0.3, 0.75, 0, 0.05, 0.05, 0.07, 6, S.white);
  },
  ibc_tank(m) {
    m.box(0, 0, 0, 1.2, 0.14, 1.0, S.steelDark);
    m.box(0, 0.14, 0, 1.1, 0.94, 0.9, S.plastic);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        m.box(sx * 0.575, 0.14, sz * 0.475, 0.03, 0.98, 0.03, S.galv);
    for (const sz of [-1, 1])
      for (const x of [-0.2, 0.2])
        m.box(x, 0.14, sz * 0.475, 0.03, 0.98, 0.03, S.galv);
    for (const y of [0.5, 0.82, 1.09]) {
      for (const sz of [-1, 1])
        m.box(0, y, sz * 0.475, 1.18, 0.03, 0.03, S.galv);
      for (const sx of [-1, 1])
        m.box(sx * 0.575, y, 0, 0.03, 0.03, 0.98, S.galv);
    }
    m.cyl(0, 1.08, 0, 0.1, 0.1, 0.08, 8, S.white);
  },
  portaloo(m) {
    m.box(0, 0, 0, 1.2, 0.1, 1.2, S.dark);
    m.box(0, 0.1, 0, 1.14, 1.95, 1.14, S.white, { paint: true });
    m.box(0, 2.05, 0, 1.2, 0.12, 1.2, S.white);
    m.box(0, 2.17, 0, 1.0, 0.13, 1.0, S.white, { taper: 0.6 });
    m.box(0, 0.18, 0.58, 0.78, 1.75, 0.025, S.white, { paint: true });
    m.box(0.3, 1.0, 0.6, 0.04, 0.12, 0.02, S.dark);
    m.box(0, 1.6, 0.6, 0.18, 0.1, 0.012, S.white);
    for (const s of [-1, 1])
      m.box(s * 0.576, 1.75, 0, 0.012, 0.12, 0.6, S.dark);
    m.cyl(-0.4, 2.12, -0.4, 0.05, 0.05, 0.18, 6, S.dark);
  },
  // ---------------------------------------------------------------- tier 4
  block_pallet(m) {
    const y = pallet(m, 1.3, 1.1);
    m.box(0, y, 0, 1.2, 0.84, 1.0, S.concrete);
    for (let k = 1; k <= 3; k++)
      m.box(0, y + k * 0.21, 0, 1.212, 0.012, 1.012, S.concreteDark);
    for (const x of [-0.4, 0, 0.4])
      for (const z of [-0.25, 0.25])
        m.box(x, y + 0.84, z, 0.13, 0.02, 0.12, 0x5f5d58);
  },
  gas_cage(m) {
    m.box(0, 0, 0, 1.3, 0.06, 0.8, S.steelDark);
    const cols = [S.red, S.blue, S.grey, S.orange];
    [-0.45, -0.15, 0.15, 0.45].forEach((x, i) => {
      m.cyl(x, 0.06, 0, 0.12, 0.12, 1.3, 6, cols[i], { caps: false });
      m.ball(x, 1.36, 0, 0.12, 0.1, 0.12, cols[i], { half: true });
      m.box(x, 1.44, 0, 0.05, 0.1, 0.05, S.chrome);
    });
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        m.box(sx * 0.635, 0.06, sz * 0.385, 0.03, 1.54, 0.03, S.galv);
    for (const sz of [-1, 1])
      m.box(0, 1.57, sz * 0.385, 1.3, 0.03, 0.03, S.galv);
    for (const sx of [-1, 1])
      m.box(sx * 0.635, 1.57, 0, 0.03, 0.03, 0.8, S.galv);
    for (const sz of [-1, 1])
      m.box(0, 0.06, sz * 0.39, 1.24, 1.5, 0.01, S.galv, { glass: true });
  },
  tarp_pallet(m) {
    const y = pallet(m, 1.3, 1.06);
    m.box(0, y, 0, 1.24, 0.86, 1.0, S.white, { paint: true });
    m.box(0, 0.2, 0, 1.36, 0.7, 1.08, S.white, { paint: true });
    m.box(0, 1.0, 0, 1.1, 0.1, 0.8, S.white, { paint: true, taper: 0.7 });
    for (const x of [-0.35, 0.35]) m.box(x, y, 0, 0.03, 0.97, 1.12, S.yellow);
  },
  wheelbarrow(m) {
    wheel(m, 0.55, 0, 0.18, 0.1);
    for (const s of [-1, 1]) {
      bar(m, 0.5, 0.2, -0.7, 0.5, s * 0.22, 0.04, 0.04, S.steelDark);
      m.box(-0.25, 0, s * 0.2, 0.04, 0.32, 0.04, S.steelDark);
      m.box(-0.64, 0.47, s * 0.22, 0.12, 0.05, 0.05, S.black);
    }
    m.box(0.05, 0.3, 0, 0.75, 0.34, 0.46, S.white, {
      paint: true,
      taper: 1.38,
    });
  },
  // ---------------------------------------------------------------- tier 5
  manhole_rings(m) {
    m.cyl(0, 0, 0, 0.75, 0.75, 0.6, 12, S.concrete);
    m.cyl(0, 0.62, 0, 0.73, 0.73, 0.6, 12, S.concrete);
    m.cyl(0, 1.22, 0, 0.58, 0.58, 0.03, 12, S.dark);
    m.box(0.25, 1.25, 0.1, 0.9, 0.05, 0.9, S.concreteLight);
  },
  scaffold_tower(m) {
    const a = 0.72;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        m.box(sx * 0.7, 0, sz * 0.7, 0.12, 0.15, 0.08, S.black);
        m.box(sx * a, 0.15, sz * a, 0.05, 4.05, 0.05, S.galv);
      }
    for (const y of [0.4, 1.4, 2.4, 3.4, 4.1]) {
      for (const sz of [-1, 1]) m.box(0, y, sz * a, 1.44, 0.04, 0.04, S.galv);
      for (const sx of [-1, 1]) m.box(sx * a, y, 0, 0.04, 0.04, 1.44, S.galv);
    }
    for (let i = 0; i < 3; i++)
      for (const sz of [-1, 1])
        bar(
          m,
          -a * (i % 2 ? -1 : 1),
          0.45 + i,
          a * (i % 2 ? -1 : 1),
          1.38 + i,
          sz * (a + 0.045),
          0.035,
          0.03,
          S.galv,
        );
    for (const y of [2.44, 3.44]) m.box(0, y, 0, 1.38, 0.05, 1.38, S.ply);
    for (const sz of [-1, 1])
      m.box(0, 3.49, sz * 0.66, 1.38, 0.15, 0.03, S.hivis);
  },
  cable_drum(m) {
    for (const s of [-1, 1]) {
      m.cyl(0, 0.8, s * 0.45, 0.8, 0.8, 0.1, 12, S.timber, { axis: 'z' });
      m.cyl(0, 0.8, s * 0.52, 0.12, 0.12, 0.04, 8, S.steel, { axis: 'z' });
    }
    m.cyl(0, 0.8, 0, 0.55, 0.55, 0.78, 12, S.orange, { axis: 'z' });
    for (const s of [-1, 1])
      m.box(s * 0.55, 0, 0, 0.2, 0.12, 0.9, S.timberDark);
  },
  mini_dumper(m) {
    for (const s of [-1, 1]) track(m, -0.05, s * 0.3, 1.3, 0.28, 0.2);
    m.box(-0.05, 0.28, 0, 1.2, 0.18, 0.6, S.steelDark);
    m.box(0.35, 0.46, 0, 0.62, 0.42, 0.62, S.white, {
      paint: true,
      taper: 1.25,
    });
    m.box(-0.45, 0.46, 0, 0.4, 0.35, 0.5, S.white, { paint: true });
    for (const s of [-1, 1])
      bar(m, -0.55, 0.8, -0.78, 1.28, s * 0.2, 0.04, 0.04, S.black);
    m.box(-0.62, 0.95, 0, 0.1, 0.12, 0.3, S.dark);
  },
  // ---------------------------------------------------------------- tier 6
  excavator_bucket(m) {
    m.box(0.0, 0, 0, 1.2, 0.08, 1.12, S.steelDark);
    m.box(-0.66, 0, 0, 0.12, 1.0, 1.12, S.steelDark);
    m.box(-0.35, 0.92, 0, 0.6, 0.08, 1.12, S.steelDark);
    for (const s of [-1, 1])
      m.box(-0.1, 0, s * 0.58, 1.2, 0.95, 0.04, S.machine);
    m.box(0.6, 0, 0, 0.2, 0.1, 1.12, S.steel);
    for (const z of [-0.45, -0.22, 0, 0.22, 0.45])
      m.box(0.8, 0, z, 0.2, 0.06, 0.1, S.steel);
    for (const s of [-1, 1])
      m.box(-0.4, 1.0, s * 0.2, 0.4, 0.1, 0.06, S.steelDark);
  },
  walk_roller(m) {
    for (const x of [-0.45, 0.45])
      m.cyl(x, 0.28, 0, 0.28, 0.28, 0.8, 10, S.steel, { axis: 'z' });
    m.box(0, 0.42, 0, 1.3, 0.18, 0.6, S.white, { paint: true });
    m.box(0.05, 0.6, 0, 0.5, 0.3, 0.4, S.dark);
    for (const s of [-1, 1])
      bar(m, -0.6, 0.6, -0.9, 1.1, s * 0.2, 0.04, 0.04, S.black);
    m.box(-0.9, 1.08, 0, 0.05, 0.05, 0.48, S.black);
  },
  light_tower(m) {
    m.box(0, 0.35, 0, 1.6, 0.9, 1.0, S.white, { paint: true });
    for (const s of [-1, 1]) wheel(m, 0, s * 0.55, 0.3, 0.16);
    m.box(0.85, 0.3, 0, 0.3, 0.08, 0.1, S.dark);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        m.box(sx * 0.7, 0, sz * 0.42, 0.1, 0.4, 0.1, S.dark);
    m.box(-0.3, 1.25, 0, 0.14, 4.45, 0.14, S.galv);
    m.box(-0.3, 5.7, 0, 0.12, 0.1, 1.2, S.dark);
    for (const z of [-0.45, -0.15, 0.15, 0.45]) {
      m.box(-0.22, 5.8, z, 0.16, 0.35, 0.26, S.dark);
      m.box(-0.135, 5.84, z, 0.012, 0.27, 0.2, S.lamp, { glow: true });
    }
    m.box(0.3, 0.6, 0.505, 0.4, 0.3, 0.012, S.dark);
  },
  lumber_bundle(m) {
    for (const x of [-0.6, 0.6]) m.box(x, 0, 0, 0.1, 0.1, 1.0, S.timberDark);
    for (let i = 0; i < 3; i++)
      for (const [j, z] of [-0.4, -0.2, 0, 0.2, 0.4].entries())
        m.box(
          0,
          0.1 + i * 0.23,
          z,
          1.9,
          0.22,
          0.18,
          (i + j) % 2 ? S.timber : 0xd4a971,
        );
    for (const x of [-0.5, 0.5]) m.box(x, 0.1, 0, 0.03, 0.7, 1.0, S.steel);
  },
  formwork_stack(m) {
    for (const x of [-0.6, 0.6]) m.box(x, 0, 0, 0.1, 0.1, 1.1, S.timberDark);
    for (let i = 0; i < 6; i++) {
      const y = 0.1 + i * 0.15;
      m.box(0, y, 0, 1.85, 0.12, 1.05, i % 2 ? S.red : S.yellow);
      m.box(0, y + 0.12, 0, 1.75, 0.012, 0.95, S.ply);
    }
  },
  // ---------------------------------------------------------------- tier 7
  heap_s(m, v, w, d, h) {
    heap(m, v, w, d, h);
  },
  compressor(m) {
    m.box(0.1, 0.35, 0, 1.4, 0.75, 1.2, S.white, { paint: true });
    m.box(0.1, 1.1, 0, 1.3, 0.2, 1.1, S.white, { paint: true, taper: 0.85 });
    for (const s of [-1, 1]) wheel(m, 0.1, s * 0.56, 0.3, 0.14);
    m.box(-0.75, 0.3, 0, 0.6, 0.08, 0.1, S.dark);
    m.box(-0.98, 0, 0, 0.08, 0.3, 0.08, S.dark);
    m.box(0.81, 0.5, 0, 0.012, 0.4, 0.8, S.dark);
    m.cyl(0.4, 0.75, 0.62, 0.15, 0.15, 0.06, 8, S.black, { axis: 'z' });
  },
  jersey_barrier(m) {
    m.box(0, 0, 0, 2.2, 0.08, 0.6, S.concrete);
    m.box(0, 0.08, 0, 2.2, 0.22, 0.46, S.concrete);
    m.box(0, 0.3, 0, 2.2, 0.52, 0.2, S.concrete);
    for (const s of [-1, 1])
      m.box(s * 0.8, 0.6, 0.106, 0.1, 0.08, 0.012, S.red);
  },
  rebar_cage(m) {
    for (const x of [-1.0, -0.5, 0, 0.5, 1.0]) {
      m.box(x, 0, 0, 0.03, 0.03, 0.8, S.rust);
      m.box(x, 0.77, 0, 0.03, 0.03, 0.8, S.rust);
      for (const s of [-1, 1]) m.box(x, 0, s * 0.385, 0.03, 0.8, 0.03, S.rust);
    }
    for (const [y, z] of [
      [0.03, -0.35],
      [0.03, 0.35],
      [0.03, 0],
      [0.73, -0.35],
      [0.73, 0.35],
    ])
      m.box(0, y, z, 2.2, 0.04, 0.04, 0x8a4a2e);
  },
  // ---------------------------------------------------------------- tier 8
  concrete_pipes(m) {
    for (const s of [-1, 1]) {
      m.cyl(0, 0.6, s * 0.55, 0.55, 0.55, 2.4, 12, S.concrete, { axis: 'x' });
      for (const e of [-1, 1])
        m.cyl(e * 1.21, 0.6, s * 0.55, 0.42, 0.42, 0.02, 12, S.dark, {
          axis: 'x',
        });
    }
    for (const x of [-0.8, 0.8]) m.box(x, 0, 0, 0.15, 0.12, 2.0, S.timberDark);
  },
  scissor_lift(m) {
    m.box(0, 0.15, 0, 2.3, 0.35, 1.0, S.white, { paint: true });
    for (const x of [-0.85, 0.85])
      for (const s of [-1, 1]) wheel(m, x, s * 0.42, 0.2, 0.14);
    for (let k = 0; k < 3; k++)
      for (const s of [-1, 1]) {
        const y = 0.5 + k * 0.2;
        bar(m, -0.9, y, 0.9, y + 0.2, s * 0.42, 0.06, 0.05, S.steelDark);
        bar(m, 0.9, y, -0.9, y + 0.2, s * 0.35, 0.06, 0.05, S.steelDark);
      }
    m.box(0, 1.1, 0, 2.4, 0.1, 1.1, S.white, { paint: true });
    for (const s of [-1, 1]) railX(m, -1.15, 1.15, s * 0.52, 1.2, 1.1, S.white);
    for (const s of [-1, 1]) railZ(m, s * 1.15, -0.5, 0.5, 1.2, 1.1, S.white);
    m.box(0.9, 1.2, 0.3, 0.2, 0.5, 0.15, S.dark);
  },
  mini_excavator(m) {
    for (const s of [-1, 1]) track(m, -0.15, s * 0.42, 1.6, 0.35, 0.3);
    m.box(-1.05, 0.05, 0, 0.12, 0.35, 1.2, S.white, { paint: true });
    m.box(-0.15, 0.35, 0, 1.0, 0.12, 0.8, S.steelDark);
    m.box(-0.2, 0.5, 0, 1.0, 0.55, 1.0, S.white, { paint: true });
    m.box(-0.62, 0.5, 0, 0.2, 0.5, 0.98, S.dark);
    for (const x of [-0.6, -0.05])
      for (const z of [-0.05, 0.45]) m.box(x, 1.05, z, 0.05, 1.1, 0.05, S.dark);
    m.box(-0.32, 2.15, 0.2, 0.7, 0.06, 0.6, S.dark);
    m.box(-0.35, 1.05, 0.2, 0.4, 0.3, 0.4, S.black);
    bar(m, 0.2, 0.9, 0.9, 2.28, -0.25, 0.16, 0.14, S.white, { paint: true });
    bar(m, 0.9, 2.3, 1.18, 0.6, -0.25, 0.12, 0.1, S.white, { paint: true });
    m.box(1.15, 0.1, -0.25, 0.25, 0.4, 0.4, S.steelDark);
  },
  skid_steer(m) {
    for (const x of [-0.5, 0.5])
      for (const s of [-1, 1]) wheel(m, x, s * 0.62, 0.32, 0.26);
    m.box(-0.1, 0.25, 0, 1.6, 0.75, 1.0, S.white, { paint: true });
    m.box(0, 1.0, 0, 0.9, 0.9, 0.9, S.cab);
    m.box(0.0, 1.15, 0, 0.94, 0.7, 0.94, S.glassDark);
    beacon(m, -0.2, 1.9, 0);
    for (const s of [-1, 1])
      bar(m, -0.8, 1.6, 0.9, 0.7, s * 0.56, 0.14, 0.1, S.white, {
        paint: true,
      });
    m.box(1.1, 0.02, 0, 0.4, 0.55, 1.6, S.steelDark);
    m.box(-0.905, 0.4, 0, 0.012, 0.5, 0.8, S.dark);
  },
  pipe_stack(m) {
    for (const x of [-0.9, 0.9]) m.box(x, 0, 0, 0.12, 0.1, 1.6, S.timberDark);
    const rows: [number, number[]][] = [
      [0.27, [-0.54, -0.18, 0.18, 0.54]],
      [0.57, [-0.36, 0, 0.36]],
      [0.87, [-0.18, 0.18]],
    ];
    for (const [y, zs] of rows)
      for (const z of zs)
        m.cyl(0, y, z, 0.17, 0.17, 2.5, 8, S.hivis, { axis: 'x' });
  },
  // ---------------------------------------------------------------- tier 9
  site_forklift(m) {
    for (const s of [-1, 1]) {
      wheel(m, 0.4, s * 0.5, 0.3, 0.22);
      wheel(m, -0.85, s * 0.5, 0.25, 0.2);
    }
    m.box(-0.3, 0.2, 0, 1.8, 0.8, 1.0, S.white, { paint: true });
    m.box(-1.35, 0.2, 0, 0.3, 0.9, 1.06, S.dark);
    for (const x of [0.35, -0.85])
      for (const s of [-1, 1])
        m.box(x, 1.0, s * 0.45, 0.06, 1.15, 0.06, S.dark);
    m.box(-0.25, 2.15, 0, 1.3, 0.05, 1.0, S.dark);
    m.box(-0.4, 1.0, 0, 0.4, 0.4, 0.45, S.black);
    for (const s of [-1, 1])
      m.box(0.68, 0.15, s * 0.3, 0.1, 2.0, 0.1, S.steelDark);
    m.box(0.78, 0.15, 0, 0.08, 0.6, 0.8, S.steelDark);
    for (const s of [-1, 1])
      m.box(1.15, 0.12, s * 0.25, 0.7, 0.05, 0.12, S.steelDark);
  },
  road_plate(m) {
    m.box(0, 0, 0, 3.0, 0.05, 1.6, S.steelDark);
    for (const x of [-1.2, 1.2]) m.box(x, 0.05, 0, 0.12, 0.03, 0.12, S.steel);
    for (const x of [-0.8, -0.4, 0, 0.4, 0.8])
      m.box(x, 0.05, 0, 0.04, 0.008, 1.4, S.steel);
  },
  container_10(m) {
    container(m, 3.0);
  },
  compact_roller(m) {
    m.cyl(0.95, 0.5, 0, 0.5, 0.5, 1.3, 10, S.steel, { axis: 'z' });
    for (const s of [-1, 1]) wheel(m, -0.9, s * 0.5, 0.45, 0.35);
    m.box(0.9, 0.85, 0, 0.6, 0.35, 1.38, S.white, { paint: true });
    m.box(-0.75, 0.45, 0, 1.4, 0.75, 1.1, S.white, { paint: true });
    m.box(0.2, 0.6, 0, 0.4, 0.3, 0.4, S.dark);
    for (const x of [-0.95, -0.3])
      for (const s of [-1, 1]) m.box(x, 1.2, s * 0.5, 0.06, 1.15, 0.06, S.dark);
    m.box(-0.62, 2.35, 0, 0.9, 0.05, 1.15, S.dark);
    m.box(-0.7, 1.2, 0, 0.4, 0.4, 0.45, S.black);
  },
  // ---------------------------------------------------------------- tier 10
  sign_board(m) {
    for (const s of [-1, 1]) {
      m.box(s * 1.4, 0, 0, 0.3, 0.12, 0.6, S.concrete);
      m.box(s * 1.4, 0.12, 0, 0.12, 2.68, 0.12, S.galv);
    }
    m.box(0, 1.0, 0.09, 3.3, 1.7, 0.05, S.white);
    m.box(0, 2.3, 0.122, 3.1, 0.32, 0.015, S.darkBlue);
    [S.blue, S.blue, S.yellow, S.red].forEach((c, i) =>
      m.box(-1.05 + i * 0.7, 1.15, 0.122, 0.5, 0.5, 0.015, c),
    );
    for (const y of [1.8, 1.95]) m.box(0, y, 0.122, 2.6, 0.08, 0.015, S.dark);
  },
  skip_bin(m) {
    m.box(0, 0.05, 0, 2.6, 1.15, 1.4, S.white, { paint: true, taper: 1.29 });
    for (const x of [-0.9, 0.9]) m.box(x, 0, 0, 0.15, 0.08, 1.2, S.dark);
    m.ball(-0.3, 1.2, 0, 0.9, 0.25, 0.6, S.rubble, {
      half: true,
      jitter: 0.2,
      seed: 4,
    });
    m.ball(0.6, 1.2, 0.1, 0.6, 0.2, 0.5, S.brick, {
      half: true,
      jitter: 0.2,
      seed: 6,
    });
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        m.box(sx * 1.55, 0.75, sz * 0.6, 0.1, 0.15, 0.1, S.dark);
    bar(m, 0.8, 1.15, 1.6, 1.42, -0.3, 0.06, 0.2, S.timber);
  },
  site_dumper(m) {
    for (const x of [0.85, -0.95])
      for (const s of [-1, 1]) wheel(m, x, s * 0.68, 0.55, 0.42);
    m.box(-0.1, 0.45, 0, 2.6, 0.4, 0.9, S.steelDark);
    m.box(0.95, 0.85, 0, 1.4, 0.75, 1.6, S.white, { paint: true, taper: 1.12 });
    m.box(-1.05, 0.85, 0, 1.2, 0.6, 1.0, S.white, { paint: true });
    for (const s of [-1, 1])
      m.box(-0.35, 0.85, s * 0.5, 0.08, 1.8, 0.08, S.dark);
    m.box(-0.35, 2.6, 0, 0.1, 0.1, 1.08, S.dark);
    m.box(-0.6, 1.45, 0, 0.45, 0.45, 0.5, S.black);
    m.box(-0.15, 1.45, 0, 0.1, 0.35, 0.3, S.dark);
  },
  fence_panel(m) {
    for (const s of [-1, 1]) {
      m.box(s * 1.6, 0, 0, 0.3, 0.14, 0.7, S.dark);
      m.box(s * 1.7, 0.08, 0, 0.05, 1.92, 0.05, S.galv);
    }
    m.box(0, 1.95, 0, 3.45, 0.05, 0.05, S.galv);
    m.box(0, 0.12, 0, 3.4, 0.05, 0.05, S.galv);
    m.box(0, 0.17, 0, 3.35, 1.78, 0.012, S.galv, { glass: true });
    m.box(0, 1.0, 0.034, 3.3, 0.25, 0.01, S.hivis);
  },
  // ---------------------------------------------------------------- tier 11
  heap_m(m, v, w, d, h) {
    heap(m, v, w, d, h);
  },
  water_bowser(m) {
    m.box(-0.15, 0.5, 0, 2.8, 0.2, 1.2, S.steelDark);
    for (const x of [-0.3, 0.55])
      for (const s of [-1, 1]) wheel(m, x, s * 0.72, 0.4, 0.26);
    m.cyl(-0.1, 1.4, 0, 0.75, 0.75, 3.0, 12, S.blue, { axis: 'x' });
    m.box(1.7, 0.45, 0, 0.6, 0.1, 0.12, S.dark);
    m.cyl(-0.1, 2.12, 0, 0.25, 0.25, 0.08, 8, S.dark);
    m.box(-1.65, 0.9, 0.3, 0.1, 0.12, 0.12, S.steel);
  },
  steel_beams(m) {
    for (const x of [-1.4, 1.4]) m.box(x, 0, 0, 0.15, 0.1, 1.4, S.timberDark);
    for (const x of [-1.2, 1.2]) m.box(x, 0.4, 0, 0.1, 0.15, 1.4, S.timberDark);
    const beam = (y: number, z: number) => {
      m.box(0, y, z, 4.1, 0.03, 0.28, S.primer);
      m.box(0, y + 0.03, z, 4.1, 0.24, 0.03, S.primer);
      m.box(0, y + 0.27, z, 4.1, 0.03, 0.28, S.primer);
    };
    for (const z of [-0.5, -0.17, 0.17, 0.5]) beam(0.1, z);
    for (const z of [-0.33, 0, 0.33]) beam(0.55, z);
  },
  // ---------------------------------------------------------------- tier 12
  trench_box(m) {
    for (const s of [-1, 1]) {
      m.box(0, 0, s * 1.05, 4.4, 2.4, 0.3, S.blue);
      for (const x of [-1.8, -0.9, 0, 0.9, 1.8])
        m.box(x, 0, s * 1.21, 0.12, 2.36, 0.03, S.darkBlue);
    }
    for (const x of [-1.4, 1.4])
      for (const y of [0.8, 1.9])
        m.cyl(x, y, 0, 0.1, 0.1, 1.82, 8, S.steel, { axis: 'z' });
  },
  fuel_tank(m) {
    m.box(0, 0, 0, 4.3, 2.0, 1.9, S.darkGreen);
    m.box(0, 2.0, 0, 4.1, 0.15, 1.7, S.darkGreen, { taper: 0.9 });
    m.box(1.4, 0.6, 0.97, 0.8, 0.9, 0.06, S.grey);
    ladder(m, -1.6, 0.985, 0, 2.15);
    m.xf(
      0,
      1.5,
      0.958,
      () => m.box(0, -0.2, 0, 0.4, 0.4, 0.012, S.orange),
      0,
      0,
      Math.PI / 4,
    );
    m.cyl(-1.8, 2.1, 0.5, 0.05, 0.05, 0.1, 6, S.dark);
  },
  tandem_roller(m) {
    for (const x of [-1.55, 1.55]) {
      m.cyl(x, 0.6, 0, 0.6, 0.6, 1.7, 12, S.steel, { axis: 'z' });
      m.box(x, 1.0, 0, 1.0, 0.4, 1.8, S.white, { paint: true });
    }
    m.box(0, 0.8, 0, 2.2, 1.0, 1.5, S.white, { paint: true });
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        m.box(sx * 0.6, 1.8, sz * 0.65, 0.07, 1.12, 0.07, S.dark);
    m.box(0, 2.92, 0, 1.6, 0.08, 1.6, S.dark);
    m.box(0, 1.8, 0, 0.5, 0.45, 0.5, S.black);
    m.box(0.45, 1.8, 0, 0.12, 0.5, 0.4, S.dark);
  },
  // ---------------------------------------------------------------- tier 13 / 14
  lumber_stack(m) {
    for (const x of [-2, 0, 2]) m.box(x, 0, 0, 0.15, 0.12, 1.4, S.timberDark);
    for (let i = 0; i < 4; i++) {
      const y = 0.12 + i * 0.32;
      for (const [j, z] of [-0.51, -0.17, 0.17, 0.51].entries())
        m.box(0, y, z, 5.2, 0.27, 0.32, (i + j) % 2 ? S.timber : 0xd4a971);
      if (i < 3)
        for (const x of [-1.5, 0, 1.5])
          m.box(x, y + 0.27, 0, 0.1, 0.05, 1.38, S.timberDark);
    }
  },
  container_20(m) {
    container(m, 6.06);
  },
  site_cabin(m) {
    for (const s of [-1, 1]) m.box(0, 0, s * 0.9, 6.0, 0.15, 0.2, S.dark);
    m.box(0, 0.15, 0, 5.9, 2.4, 2.4, S.white, { paint: true });
    m.box(0, 2.55, 0, 6.0, 0.15, 2.5, S.grey);
    for (const x of [-0.6, 0.8, 2.2])
      m.box(x, 1.1, 1.205, 1.0, 0.8, 0.02, S.glassDark);
    for (const x of [-1.6, 1.6])
      m.box(x, 1.1, -1.205, 1.0, 0.8, 0.02, S.glassDark);
    m.box(-2.2, 0.2, 1.205, 0.9, 2.0, 0.02, S.steelDark);
    m.box(-2.2, 0, 1.33, 1.0, 0.15, 0.16, S.steel);
    m.box(-2.97, 1.6, 0.4, 0.06, 0.5, 0.6, S.light);
  },
  office_cabins(m) {
    for (let k = 0; k < 2; k++) {
      const y = k * 2.75;
      m.box(0, y, -0.25, 6.6, 0.12, 2.5, S.dark);
      m.box(0, y + 0.12, -0.25, 6.5, 2.45, 2.4, k ? S.cream : S.white);
      m.box(0, y + 2.57, -0.25, 6.6, 0.12, 2.5, S.grey);
      for (const x of [-2.2, -0.6, 1.0])
        m.box(x, y + 1.05, 0.955, 1.0, 0.8, 0.02, S.glassDark);
      m.box(2.4, y + 0.17, 0.955, 0.9, 2.0, 0.02, S.steelDark);
    }
    m.box(0, 2.69, 1.25, 6.6, 0.08, 0.5, S.galv);
    railX(m, -3.3, 3.3, 1.47, 2.77, 1.0, S.galv);
    bar(m, -3.3, 0.1, -1.0, 2.7, 1.25, 0.12, 0.6, S.galv);
    for (const x of [-3.2, 3.2]) m.box(x, 0, 1.25, 0.1, 2.69, 0.1, S.galv);
    m.box(0, 5.44, -0.25, 3.0, 0.36, 0.1, S.hivis);
  },
  // ---------------------------------------------------------------- heaps
  heap_l(m, v, w, d, h) {
    heap(m, v, w, d, h);
  },
  heap_xl(m, v, w, d, h) {
    heap(m, v, w, d, h, true);
  },
  heap_xxl(m, v, w, d, h) {
    heap(m, v, w, d, h, true);
  },
  spoil_mountain(m, v, w, d, h) {
    heap(m, v, w, d, h, true);
  },
  mining_tyre(m) {
    // a spare haul-truck tyre standing on its tread, chocked with a timber block
    m.cyl(0, 2.0, 0, 1.94, 1.94, 1.5, 16, S.rubber, { axis: 'z' });
    for (let i = 0; i < 16; i++)
      m.xf(
        0,
        2.0,
        0,
        () => m.box(0, 1.9, 0, 0.42, 0.1, 1.42, S.dark),
        0,
        0,
        ((i + 0.5) / 16) * Math.PI * 2,
      );
    m.cyl(0, 2.0, 0.77, 1.05, 1.05, 0.04, 12, S.steelDark, { axis: 'z' });
    m.cyl(0, 2.0, 0.8, 0.45, 0.45, 0.06, 10, S.machine, { axis: 'z' });
    for (const s of [-1, 1]) m.box(s * 1.6, 0, 0, 0.5, 0.35, 1.4, S.timberDark);
  },
  cement_silo(m) {
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        m.box(sx * 1.25, 0, sz * 1.25, 0.6, 0.12, 0.6, S.concrete);
        m.box(sx * 1.25, 0.12, sz * 1.25, 0.18, 5.0, 0.18, S.steelDark);
      }
    for (const sz of [-1, 1])
      bar(m, -1.16, 0.5, 1.16, 3.4, sz * 1.25, 0.1, 0.08, S.steelDark);
    for (const sx of [-1, 1])
      barZ(m, -1.16, 3.4, 1.16, 0.5, sx * 1.25, 0.1, 0.08, S.steelDark);
    m.cyl(0, 2.6, 0, 0.3, 1.78, 2.5, 12, S.galv);
    m.cyl(0, 5.1, 0, 1.78, 1.78, 11.9, 12, S.galv);
    for (const y of [8.0, 11.5, 14.6])
      m.cyl(0, y, 0, 1.81, 1.81, 0.12, 12, S.steelDark, { caps: false });
    m.cyl(0, 17.0, 0, 1.78, 1.45, 0.4, 12, S.galv);
    m.box(0.5, 17.4, -0.4, 0.8, 0.5, 0.7, S.steelDark);
    railX(m, -1.1, 1.1, 0.9, 17.4, 0.6, S.hivis, 0.05);
    ladder(m, -0.6, 1.86, 5.1, 17.4, S.galv, 0.5);
    m.cyl(-1.92, 0.2, 0, 0.08, 0.08, 16.9, 6, S.galv);
    m.box(-0.45, 0, 0, 0.9, 1.4, 0.5, S.machine);
  },
};
