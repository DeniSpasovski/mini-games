import { CylinderGeometry, Vector2 } from 'three';
import { WEST, px16 } from '../../trace';
import type { Corner } from '../../frame';
import { placeAt } from '../ctx';
import { Shell, type Wall } from '../wall';
import { COLOR, ribbon, type LotCtx } from './common';
import { bar, gableRoof, propFrame } from './east-end';
import { canopy } from './north-offices';

/**
 * The west end of the row, between north 1 and the roundabout (user's Street View screenshots, 2026-10-04,
 * traced on `ref-16`): the small car service next to north 1, a gravel car park, and the factory on the corner.
 * Every sign is plain (the real ones carry business names).
 */

const PANEL = '#c9cdd0';
const WHITE_FRAME = '#eef0ef';

/** Two rows of three-pane windows every `pitch` m along a wall, and small ground-floor windows. */
function windowRows(w: Wall, pitch = 6.2, ground = true): void {
  const L = w.length;
  for (let u = 2.6; u + 2.6 < L - 1.5; u += pitch) {
    for (const y of [
      [4.5, 5.6],
      [7.7, 8.8],
    ] as [number, number][])
      w.window([u, u + 2.6], y, {
        frame: WHITE_FRAME,
        panes: 3,
        sill: false,
        depth: 0.1,
      });
    if (ground)
      w.window([u + 0.4, u + 2.2], [1.7, 2.4], {
        frame: WHITE_FRAME,
        panes: 3,
        sill: false,
        depth: 0.08,
      });
  }
}

/** Vertical panel seams and a horizontal joint, the look of the sandwich-panel halls. */
function seams(w: Wall, h: number, color: string, pitch = 6.2): void {
  for (let u = pitch; u < w.length - 0.5; u += pitch)
    w.paint([u - 0.03, u + 0.03], [0.9, h], [0, 0.05], color);
  w.paint([0, w.length], [h - 0.12, h + 0.05], [-0.02, 0.08], '#b4b8ba');
}

// ----- west 3: the factory on the corner -----

/** The red and white lattice mast in its own fenced corner: three legs, braces, splayed red feet, antennas. */
function mast(ctx: LotCtx, at: Corner, heading: number): void {
  const w = propFrame(ctx, at, heading);
  const H = 32;
  const legs: [number, number][] = [0, 1, 2].map((k) => {
    const a = (k * Math.PI * 2) / 3;
    return [Math.cos(a) * 0.7, Math.sin(a) * 0.7];
  });
  const band = (y: number) => (Math.floor(y / 4) % 2 ? '#f2f1ed' : '#c8322b');
  const step = 1.6;
  for (let y = 4; y < H; y += step) {
    const c = band(y);
    for (let k = 0; k < 3; k++) {
      const [u0, w0] = legs[k];
      const [u1, w1] = legs[(k + 1) % 3];
      bar(w, [u0, y, w0], [u0, y + step, w0], 0.1, c, 'metal');
      bar(w, [u0, y, w0], [u1, y + step, w1], 0.05, c, 'metal');
      bar(w, [u0, y + step, w0], [u1, y + step, w1], 0.05, c, 'metal');
    }
  }
  // The splayed red feet down to a concrete base, and the cabinet beside it.
  for (const [u, d] of [
    [2.6, 2.6],
    [-2.6, 2.6],
    [2.6, -2.6],
    [-2.6, -2.6],
  ]) {
    bar(w, [u, 0.3, d], [u * 0.22, 4, d * 0.22], 0.22, '#c8322b', 'metal');
    w.box(
      'concrete',
      [u - 0.4, u + 0.4],
      [-0.2, 0.3],
      [d - 0.4, d + 0.4],
      '#bdb9b0',
    );
  }
  w.box('paint', [3.4, 5.4], [0, 2.1], [-1.2, 0.2], '#6f7a5c');
  // Antenna panels and dishes near the top.
  for (const [u, d] of legs) {
    w.box(
      'paint',
      [u - 0.2, u + 0.2],
      [H - 3, H - 0.6],
      [d - 0.08, d + 0.08],
      '#e9e9e6',
    );
    w.box(
      'paint',
      [u - 0.25, u + 0.25],
      [H - 7, H - 6.4],
      [d - 0.25, d + 0.25],
      '#dcdcd8',
    );
  }
  bar(w, [0, H, 0], [0, H + 2, 0], 0.08, '#c9cdd0', 'metal');
}

export function dressFactory(ctx: LotCtx): void {
  const { shell, h, f, plot } = ctx;
  for (const w of shell.walls) {
    const L = w.length;
    w.plinth('#b5b2aa', 0.9);
    seams(w, h, '#b9bdc0');
    const n = w.w.normal;
    // The long front facing the junction (south-west): a wide window band, a dark door, a plain red sign.
    if (n.x < -0.3 && n.y > 0.3) {
      for (let u = 2; u + 4.6 < L - 2; u += 6.2) {
        if (u > L * 0.55 && u < L * 0.55 + 6) continue;
        w.applied([u, u + 4.6], [3.1, 4.8], 0.02, {
          frame: WHITE_FRAME,
          across: 1.15,
        });
      }
      w.doorway([L * 0.55, L * 0.55 + 4.4], 4.6, {
        leaf: 'none',
        room: 6,
        frame: '#3c4043',
      });
      // A plain red sign (blocks of uneven width) high up near the west end.
      let u = 3;
      for (let k = 0; k < 6; k++) {
        const wd = 0.9 + ((k * 7) % 3) * 0.2;
        w.box('paint', [u, u + wd], [h - 3.4, h - 1.6], [0.05, 0.3], '#d0312c');
        u += wd + 0.25;
      }
      continue;
    }
    if (L > 10) windowRows(w);
  }
  shell.finish();

  // The roof cyclone (a cream cone on a plinth box) and a chimney pipe near the south-east end.
  const c = plot.corners.map(([x, z]) => new Vector2(x, z));
  const mid = c
    .reduce((s, p) => s.add(p), new Vector2())
    .divideScalar(c.length);
  const towardSE = c[2].clone().sub(mid).multiplyScalar(0.35).add(mid);
  f.box(
    'panel',
    [towardSE.x - 3, h, towardSE.y - 3],
    [towardSE.x + 3, h + 2.2, towardSE.y + 3],
    PANEL,
  );
  f.add(
    'paint',
    new CylinderGeometry(1.5, 0.9, 1.8, 12).translate(0, 1, 0),
    '#e8e1cf',
    {
      matrix: placeAt(towardSE.x, h + 2.2, towardSE.y),
    },
  );
  f.add(
    'paint',
    new CylinderGeometry(0.4, 1.5, 1.6, 12).translate(0, 2.7, 0),
    '#e8e1cf',
    {
      matrix: placeAt(towardSE.x, h + 2.2, towardSE.y),
    },
  );
  const chim = mid.clone().lerp(c[3], 0.4);
  f.add(
    'metal',
    new CylinderGeometry(0.25, 0.25, 3, 8).translate(0, 1.5, 0),
    '#a9adb0',
    {
      matrix: placeAt(chim.x, h, chim.y),
    },
  );
  f.add(
    'metal',
    new CylinderGeometry(0.45, 0.1, 0.35, 8).translate(0, 3.15, 0),
    '#3a3e41',
    {
      matrix: placeAt(chim.x, h, chim.y),
    },
  );

  // The white block north of the hall, and the long wing north-east of it.
  const a = plot.annex!;
  const north = new Shell(
    f,
    a.corners,
    a.height,
    { mat: 'panel', tint: a.walls! },
    { mat: 'roofing', tint: a.roof! },
  );
  for (const w of north.walls) {
    seams(w, a.height, '#cfd2d4');
    w.plinth('#b5b2aa', 0.6);
    if (w.length > 12)
      ribbon(w, [2, w.length - 2], {
        width: 2.4,
        pitch: 5.5,
        y: [a.height - 3, a.height - 1.9],
      });
  }
  north.finish();
  for (const m of plot.more ?? []) {
    const wing = new Shell(
      f,
      m.corners,
      m.height,
      { mat: 'panel', tint: '#dfe1e2' },
      { mat: 'roofing', tint: '#e6e7e6' },
    );
    for (const w of wing.walls) {
      seams(w, m.height, '#cdd0d2');
      w.plinth('#b5b2aa', 0.6);
      if (w.length > 12)
        ribbon(w, [2, w.length - 2], {
          width: 2,
          pitch: 6,
          y: [m.height - 2.6, m.height - 1.7],
        });
    }
    wing.finish();
  }
}

// ----- west 2: the gravel car park -----

/** The car park has no building of its own: its plot building is a pair of big rubbish containers by the back. */
export function dressCarPark(ctx: LotCtx): void {
  const [c0, c1, c2] = ctx.plot.corners.map(([x, z]) => new Vector2(x, z));
  const along = c1.clone().sub(c0);
  const mid = c0.clone().lerp(c2, 0.5);
  const w = propFrame(ctx, [mid.x, mid.y], Math.atan2(-along.y, along.x));
  for (const u of [-0.8, 0.8]) {
    w.box('metal', [u - 0.7, u + 0.7], [0.2, 1.3], [-0.55, 0.55], '#9aa0a3');
    w.box('metal', [u - 0.75, u + 0.75], [1.3, 1.42], [-0.6, 0.6], '#868c90');
    for (const d of [-0.45, 0.45])
      w.box(
        'paint',
        [u + d - 0.08, u + d + 0.08],
        [0, 0.2],
        [-0.4, 0.4],
        '#1f2124',
      );
  }
}

// ----- the mast lot -----

/** The mast stands on its plot's base square (the building footprint); the lot fence is the compound fence. */
export function dressMast(ctx: LotCtx): void {
  const [c0, c1, c2] = ctx.plot.corners.map(([x, z]) => new Vector2(x, z));
  const along = c1.clone().sub(c0);
  const mid = c0.clone().lerp(c2, 0.5);
  mast(ctx, [mid.x, mid.y], Math.atan2(-along.y, along.x));
}

// ----- the trailer park by the junction -----

/** The brick sign booth of the economic zone: brick walls, a slab roof, a big plain sign board above it. */
export function dressTrailerPark(ctx: LotCtx): void {
  const { shell, h } = ctx;
  for (const w of shell.walls) {
    const L = w.length;
    w.plinth('#8e8a82', 0.25);
    w.coping('#d9d6cf', 0.15, 0.25);
    for (let y = 0.35; y < h - 0.2; y += 0.3)
      w.paint([0, L], [y - 0.01, y + 0.01], [0, 0.015], '#c9b9a8');
    if (w.w.side === ctx.front)
      w.doorway([L * 0.3, L * 0.3 + 0.9], 2, {
        leaf: 'panel',
        color: '#c9cdd0',
        frame: '#8e9396',
      });
  }
  shell.finish();
  // The sign board on posts above the roof, facing the street: white, a grey border, no lettering.
  const w = shell.side(ctx.front)!;
  const L = w.length;
  for (const u of [0.4, L - 0.6])
    w.box('metal', [u, u + 0.12], [h, h + 1.0], [-0.6, -0.48], '#7d8286');
  w.box('paint', [-0.2, L + 0.2], [h + 0.6, h + 2.4], [-0.5, -0.38], '#7d8286');
  w.panel('paint', [-0.1, L + 0.1], [h + 0.7, h + 2.3], -0.375, '#f4f3ef');
  w.panel('paint', [0.4, L - 0.4], [h + 1.6, h + 1.75], -0.37, '#c9cdd0');
}

// ----- the electric substation -----

const CONCRETE_POLE = '#b9b5ac';

export function dressSubstation(ctx: LotCtx): void {
  const { shell, h, plot, f } = ctx;
  // The small house by the road: white render, a door, windows, a gabled roof.
  for (const w of shell.walls) {
    const L = w.length;
    w.plinth('#9b9a95', 0.35);
    if (w.w.side === 'e' || w.w.side === ctx.front)
      w.window([L * 0.55, L * 0.55 + 1.2], [1, 2.1], {
        frame: WHITE_FRAME,
        panes: 2,
      });
    if (w.w.side === 'e')
      w.doorway([L * 0.2, L * 0.2 + 1], 2.1, {
        leaf: 'panel',
        color: '#8a8f92',
        frame: '#6d7276',
      });
  }
  gableRoof(shell, ctx.front as 's', h, 1.4, plot.roof, 0.4);
  shell.finish();

  // Switchgear rows (long grey cabinets with doors) and transformers (radiator fins, bushings on top).
  (plot.more ?? []).forEach((m, i) => {
    const gear = new Shell(
      f,
      m.corners,
      m.height,
      { mat: 'panel', tint: '#a7adb1' },
      { mat: 'roofing', tint: '#9ba1a5' },
    );
    for (const w of gear.walls) {
      const L = w.length;
      w.plinth('#8e8a82', 0.2);
      if (i < 2) {
        for (let u = 0.3; u + 0.8 < L; u += 1.1)
          w.panel(
            'paint',
            [u, u + 0.8],
            [0.3, m.height - 0.3],
            0.01,
            '#b6bcc0',
          );
      } else {
        for (let u = 0.4; u < L - 0.3; u += 0.35)
          w.box(
            'metal',
            [u, u + 0.08],
            [0.4, m.height - 0.5],
            [0, 0.35],
            '#8f969a',
          );
      }
    }
    gear.finish();
    if (i >= 2) {
      const c = m.corners.map(([x, z]) => new Vector2(x, z));
      const mid = c
        .reduce((s2, p) => s2.add(p), new Vector2())
        .divideScalar(c.length);
      for (const o of [-0.8, 0, 0.8])
        f.add(
          'paint',
          new CylinderGeometry(0.12, 0.18, 1.3, 8).translate(o, 0.65, 0),
          '#d9d6cf',
          { matrix: placeAt(mid.x, m.height, mid.y) },
        );
    }
  });

  // A line of portal gantries: two concrete poles and a crossbeam each, insulator strings, wires between them.
  const [a, b] = WEST.substation.gantry.map(
    ([x, y]) => new Vector2(...px16(x, y)),
  );
  const dir = b.clone().sub(a);
  const len = dir.length();
  const w = propFrame(ctx, [a.x, a.y], Math.atan2(-dir.y, dir.x));
  const n = 5;
  const H = 9;
  for (let k = 0; k < n; k++) {
    const u = (len * k) / (n - 1);
    for (const d of [-3, 3])
      w.box(
        'concrete',
        [u - 0.18, u + 0.18],
        [0, H],
        [d - 0.18, d + 0.18],
        CONCRETE_POLE,
      );
    w.box(
      'concrete',
      [u - 0.15, u + 0.15],
      [H - 1.1, H - 0.8],
      [-3.4, 3.4],
      CONCRETE_POLE,
    );
    for (const d of [-2, 0, 2])
      w.box(
        'paint',
        [u - 0.06, u + 0.06],
        [H - 2, H - 1.1],
        [d - 0.06, d + 0.06],
        '#6d7d8a',
      );
  }
  for (const d of [-2, 0, 2])
    bar(w, [0, H - 2, d], [len, H - 2, d], 0.025, '#3a3e41', 'metal');
  // Lamp posts beside the gantries.
  const side = new Vector2(dir.y, -dir.x).normalize();
  for (const t of [0.15, 0.85]) {
    const p = a.clone().lerp(b, t).addScaledVector(side, -14);
    f.add(
      'metal',
      new CylinderGeometry(0.06, 0.09, 6, 8).translate(0, 3, 0),
      '#9aa0a3',
      { matrix: placeAt(p.x, 0, p.y) },
    );
    f.box(
      'paint',
      [p.x - 0.25, 6, p.y - 0.15],
      [p.x + 0.25, 6.15, p.y + 0.15],
      '#dcdcd8',
    );
  }
}

// ----- west 1: the car service -----

export function dressCarService(ctx: LotCtx): void {
  const { shell, h, plot } = ctx;
  for (const w of shell.walls) {
    const L = w.length;
    w.plinth('#8e8a82', 0.4);
    if (w.w.side === ctx.front) {
      // Open across most of the front, cars and a lift inside the dark workshop.
      w.doorway([1, L - 1], 3.6, { leaf: 'none', room: 9, frame: '#5d6164' });
      w.paint([0.95, L - 0.95], [3.6, 3.9], [0, 0.15], '#e9eae8');
      continue;
    }
    for (let u = 0.6; u < L; u += 0.6)
      w.paint([u - 0.02, u + 0.02], [0.4, h], [0, 0.04], '#b2b6b8');
    if (w.w.side === 'w')
      canopy(w, [0.5, L - 0.5], h - 0.4, 3.6, 0.4, '#c3c7c8', '#5d6164');
  }
  gableRoof(shell, ctx.front as 's', h, 1.5, plot.roof, 0.35);
  shell.finish();

  // The small office: rendered walls, a green gabled roof, a door and windows.
  const a = plot.annex!;
  const office = new Shell(
    ctx.f,
    a.corners,
    a.height,
    { mat: 'render', tint: a.walls! },
    { mat: 'sheet', tint: a.roof! },
  );
  for (const w of office.walls) {
    const L = w.length;
    w.plinth('#8e8a82', 0.3);
    if (w.w.side === ctx.front) {
      w.doorway([L * 0.2, L * 0.2 + 0.95], 2.1, {
        leaf: 'panel',
        color: '#6b6f72',
        frame: '#4a4e52',
      });
      w.window([L * 0.55, L * 0.55 + 1.4], [1, 2.2], {
        frame: COLOR.doorFrame,
        panes: 2,
      });
    }
  }
  gableRoof(office, ctx.front as 's', a.height, 1.1, a.roof!, 0.4);
  office.finish();
}
