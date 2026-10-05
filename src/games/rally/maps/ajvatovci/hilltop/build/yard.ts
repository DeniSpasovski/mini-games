import { Matrix4, Vector2 } from 'three';
import type { Bucket } from '../../start-row/build/kit';
import {
  benches,
  COURTYARD,
  DRIVE_WIDTH,
  drivePoints,
  FENCE,
  fencePillars,
  FLOWER_BEDS,
  FORECOURT,
  gateLeaves,
  PARKING,
  TENTS,
  WALL,
  wallPieces,
} from '../yard';
import { buildBed, buildBench, buildTent } from './furniture';
import { Local } from './shapes';

/**
 * The monastery courtyard (see ../yard.ts): the paved drive draped on the ground, the low concrete wall
 * round the courtyard (one box per piece, level
 * on its highest ground: stepped down the slope, with a coping), the front fence (block base, pillars, iron
 * railing with arched panels, the open gate) and the furniture (marquees, benches, flower beds).
 */
const IRON = '#232426';

export function buildYard(
  bucket: Bucket,
  ground: (x: number, z: number) => number,
): void {
  const cx = COURTYARD.reduce((s, p) => s + p[0], 0) / COURTYARD.length;
  const cz = COURTYARD.reduce((s, p) => s + p[1], 0) / COURTYARD.length;
  // World-aligned frame at the courtyard's centre, y absolute.
  const l = new Local(bucket, 'yard', { x: cx, z: cz, yaw: 0 }, 0);
  // Gravel car park outside the gate, the asphalt apron in front of the gate on top of it.
  for (const [key, poly, color] of [
    ['gravel', PARKING, '#d9d2c4'],
    ['patchAsphalt', FORECOURT, '#b8b6b0'],
  ] as const)
    l.frame.polygon(
      key,
      poly.map(([x, z]) => new Vector2(x - cx, z - cz)),
      0.04,
      color,
      { lift: (sx, sz) => ground(sx + cx, sz + cz), step: 1.5 },
    );
  // The lawn is the terrain's own grass (a decal of the darker lot grass texture looked like a dark
  // carpet); the grass tufts are fixed instances (../index.ts). Paved drive draped along its centre line.
  l.frame.sweep(
    'patchPavers',
    drivePoints().map(([x, z]) => new Vector2(x - cx, z - cz)),
    [
      [-DRIVE_WIDTH / 2, 0.05],
      [DRIVE_WIDTH / 2, 0.05],
    ],
    '#d4d0c8',
    { lift: (sx, sz) => ground(sx + cx, sz + cz) },
  );

  const at = (x: number, z: number, angle: number) =>
    new Matrix4()
      .makeTranslation(x - cx, 0, z - cz)
      .multiply(new Matrix4().makeRotationY(-angle));

  // Walls and the front fence's block base, its railing.
  for (const p of wallPieces(ground)) {
    const m = at(p.x, p.z, p.angle);
    const h = p.length / 2;
    if (!p.front) {
      const t = WALL.thickness / 2;
      l.box('wall', [-h, p.y0, -t], [h, p.y1 - 0.04, t], '#c9c5bc', m);
      l.box(
        'wall',
        [-h - 0.02, p.y1 - 0.04, -t - 0.03],
        [h + 0.02, p.y1, t + 0.03],
        '#d8d4cc',
        m,
      );
      continue;
    }
    // Block base (split-face blocks: the stone texture tinted grey), a flat coping.
    l.box('ashlar', [-h, p.y0, -0.17], [h, p.y1 - 0.05, 0.17], '#c4c3be', m);
    l.box('wall', [-h, p.y1 - 0.05, -0.2], [h, p.y1, 0.2], '#d6d3cc', m);
    // Railing: bottom rail, bars rising to an arched top rail, spear tips.
    const r0 = p.y1 + 0.08;
    const top = (s: number) =>
      p.y1 + FENCE.rail - 0.14 + 0.14 * Math.sin((Math.PI * (s + h)) / (2 * h));
    l.box('metal', [-h, r0, -0.02], [h, r0 + 0.04, 0.02], IRON, m);
    l.box('metal', [-h, p.y1 + 0.42, -0.015], [h, p.y1 + 0.45, 0.015], IRON, m);
    const bars = Math.max(2, Math.round((2 * h - 0.4) / 0.13));
    for (let i = 0; i <= bars; i++) {
      const s = -h + 0.2 + ((2 * h - 0.4) * i) / bars;
      l.box(
        'metal',
        [s - 0.011, p.y1, -0.011],
        [s + 0.011, top(s) + 0.06, 0.011],
        IRON,
        m,
      );
    }
    const seg = 8;
    for (let i = 0; i < seg; i++) {
      const s0 = -h + 0.2 + ((2 * h - 0.4) * i) / seg;
      const s1 = -h + 0.2 + ((2 * h - 0.4) * (i + 1)) / seg;
      const y0 = top(s0);
      const y1 = top(s1);
      const len = Math.hypot(s1 - s0, y1 - y0);
      l.box(
        'metal',
        [-len / 2, -0.02, -0.018],
        [len / 2, 0.02, 0.018],
        IRON,
        m
          .clone()
          .multiply(
            new Matrix4()
              .makeTranslation((s0 + s1) / 2, (y0 + y1) / 2, 0)
              .multiply(
                new Matrix4().makeRotationZ(Math.atan2(y1 - y0, s1 - s0)),
              ),
          ),
      );
    }
  }
  // Pillars (block, a cap; the gate posts taller with a ball on top).
  for (const p of fencePillars(ground)) {
    const m = at(p.x, p.z, p.angle);
    const w = p.gate ? 0.27 : 0.22;
    l.box('ashlar', [-w, p.y0, -w], [w, p.y1 - 0.07, w], '#c8c7c2', m);
    l.box(
      'wall',
      [-w - 0.04, p.y1 - 0.07, -w - 0.04],
      [w + 0.04, p.y1, w + 0.04],
      '#d8d5ce',
      m,
    );
    if (p.gate)
      l.box('metal', [-0.07, p.y1, -0.07], [0.07, p.y1 + 0.14, 0.07], IRON, m);
  }
  // The open gate leaves (frame, bars, an arched top).
  for (const g of gateLeaves()) {
    const m = at(g.x, g.z, g.angle);
    const h = g.length / 2;
    const y = ground(g.x, g.z);
    const top = (s: number) =>
      y + 1.75 + 0.3 * Math.sin((Math.PI * (s + h)) / (2 * h));
    l.box('metal', [-h, y + 0.1, -0.025], [h, y + 0.16, 0.025], IRON, m);
    l.box('metal', [-h, y + 0.9, -0.02], [h, y + 0.94, 0.02], IRON, m);
    for (const s of [-h, h])
      l.box(
        'metal',
        [s - 0.03, y + 0.1, -0.03],
        [s + 0.03, top(s), 0.03],
        IRON,
        m,
      );
    const bars = Math.round((2 * h) / 0.12);
    for (let i = 1; i < bars; i++) {
      const s = -h + (2 * h * i) / bars;
      l.box(
        'metal',
        [s - 0.011, y + 0.1, -0.011],
        [s + 0.011, top(s) + 0.07, 0.011],
        IRON,
        m,
      );
    }
  }

  // Furniture.
  for (const t of TENTS)
    buildTent(new Local(bucket, 'yard', t, ground(t.x, t.z)));
  for (const b of benches())
    buildBench(new Local(bucket, 'yard', b, ground(b.x, b.z)));
  FLOWER_BEDS.forEach(([x, z], i) =>
    buildBed(
      new Local(bucket, 'yard', { x, z, yaw: i * 0.7 }, ground(x, z)),
      i,
    ),
  );
}
