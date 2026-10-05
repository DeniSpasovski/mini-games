import { BoxGeometry, IcosahedronGeometry, Matrix4, Vector3 } from 'three';
import { SITE } from '../../layout';
import { lotFrame, type Build } from '../ctx';
import type { Frame } from '../kit';
import type { MatKey } from '../materials';
import { COLOR, type LotCtx } from './common';

/** The construction site: a site cabin, an excavator and a pile of sand on an all-gravel lot. */

const YELLOW = '#e3a712';
const IRON = '#2c2e31';
const SAND = '#cdbb8c';

/** The site office: a portable cabin with a door and windows. */
export function dressSite(ctx: LotCtx): void {
  const { shell } = ctx;
  for (const w of shell.walls) {
    const L = w.length;
    if (L < 4) continue;
    if (w.w.side === ctx.front) {
      w.doorway(w.w.span(0.6, 1.6), 2.0, {
        leaf: 'panel',
        color: '#5f7183',
        frame: COLOR.doorFrame,
      });
      w.window(w.w.span(2.4, 3.9), [1.0, 2.1], { frame: COLOR.doorFrame });
      w.window(w.w.span(4.6, 6.1), [1.0, 2.1], { frame: COLOR.doorFrame });
    } else {
      w.window(w.w.span(1.2, 2.7), [1.0, 2.1], { frame: COLOR.doorFrame });
      w.window(w.w.span(3.8, 5.3), [1.0, 2.1], { frame: COLOR.doorFrame });
    }
  }
  shell.finish();
}

/** Where a part goes: `world` puts the machine on the lot, `local` is relative to the machine. */
const piece = (
  f: Frame,
  world: Matrix4,
  mat: MatKey,
  color: string,
  size: [number, number, number],
  at: [number, number, number],
): void =>
  f.add(mat, new BoxGeometry(...size), color, {
    matrix: world.clone().multiply(new Matrix4().makeTranslation(...at)),
  });

/** A beam from `from` along the unit `dir`, `len` long, with a `w` x `h` section. */
const beam = (
  f: Frame,
  world: Matrix4,
  mat: MatKey,
  color: string,
  from: Vector3,
  dir: Vector3,
  len: number,
  w: number,
  h: number,
): void => {
  const middle = from.clone().addScaledVector(dir, len / 2);
  // lookAt points the matrix's +z along `eye` when the target is the origin.
  const rotation = new Matrix4().lookAt(
    dir,
    new Vector3(),
    new Vector3(0, 1, 0),
  );
  f.add(mat, new BoxGeometry(w, h, len), color, {
    matrix: world
      .clone()
      .multiply(new Matrix4().makeTranslation(middle.x, middle.y, middle.z))
      .multiply(rotation),
  });
};

/** A tracked excavator facing +z (local), about 8 m long with the bucket at the end of its arm. */
function excavator(f: Frame, world: Matrix4): void {
  // Tracks and the undercarriage.
  for (const x of [-1.35, 1.35]) {
    piece(f, world, 'paint', IRON, [0.9, 1.0, 4.0], [x, 0.5, 0]);
    piece(f, world, 'paint', '#4a4d51', [0.5, 0.12, 4.1], [x, 1.02, 0]);
  }
  piece(f, world, 'paint', '#3a3d40', [2.2, 0.5, 3.0], [0, 0.75, 0]);
  // The house: body, counterweight, engine hood.
  piece(f, world, 'paint', YELLOW, [2.5, 0.9, 3.1], [0, 1.5, -0.1]);
  piece(f, world, 'paint', IRON, [2.4, 1.1, 0.8], [0, 1.6, -1.85]);
  piece(f, world, 'paint', YELLOW, [1.2, 0.5, 1.6], [0.55, 2.2, -0.9]);
  // The cab on the left: frame, glass, roof.
  piece(f, world, 'paint', YELLOW, [1.2, 1.5, 1.4], [-0.75, 2.4, 0.7]);
  piece(f, world, 'glass', '#ffffff', [1.0, 1.0, 0.05], [-0.75, 2.55, 1.42]);
  piece(f, world, 'glass', '#ffffff', [0.05, 1.0, 1.0], [-1.37, 2.55, 0.7]);
  piece(f, world, 'paint', IRON, [1.3, 0.1, 1.5], [-0.75, 3.2, 0.7]);
  // Boom, arm, bucket and the ram under the boom.
  const base = new Vector3(0.2, 1.8, 1.5);
  const boomDir = new Vector3(0, Math.sin(0.7), Math.cos(0.7));
  beam(f, world, 'paint', YELLOW, base, boomDir, 4.6, 0.5, 0.6);
  const knee = base.clone().addScaledVector(boomDir, 4.6);
  const armDir = new Vector3(0, -Math.sin(0.95), Math.cos(0.95));
  beam(f, world, 'paint', YELLOW, knee, armDir, 2.6, 0.38, 0.45);
  const tip = knee.clone().addScaledVector(armDir, 2.6);
  beam(
    f,
    world,
    'metal',
    '#8d9296',
    new Vector3(0.2, 2.0, 2.0),
    new Vector3(0, 0.62, 0.78),
    2.5,
    0.16,
    0.16,
  );
  piece(
    f,
    world,
    'paint',
    IRON,
    [1.0, 0.8, 0.9],
    [0.2, tip.y - 0.35, tip.z + 0.05],
  );
  piece(
    f,
    world,
    'paint',
    '#8d9296',
    [1.0, 0.12, 0.25],
    [0.2, tip.y - 0.78, tip.z + 0.45],
  );
}

/** A lumpy mound of sand `radius` m across and `height` m high. */
function sandPile(
  f: Frame,
  at: [number, number],
  radius: number,
  height: number,
): void {
  const g = new IcosahedronGeometry(1, 3);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const lump =
      1 +
      0.08 * Math.sin(x * 5.3 + z * 2.1) +
      0.06 * Math.sin(z * 6.7 - x * 1.9);
    p.setXYZ(
      i,
      x * radius * lump,
      Math.pow(Math.max(y, 0), 1.25) * height * lump - 0.05,
      z * radius * lump,
    );
  }
  g.computeVertexNormals();
  f.add('leaf', g, SAND, {
    matrix: new Matrix4().makeTranslation(at[0], 0, at[1]),
  });
}

/** The excavator and the sand pile, each on a plane fitted to the ground under it. */
export function siteProps(b: Build): void {
  const square = (c: [number, number], half: number): [number, number][] =>
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([u, v]) => [c[0] + u * half, c[1] + v * half]);
  const [ex, ez] = SITE.excavator.at;
  excavator(
    lotFrame(b, square(SITE.excavator.at, 8), true),
    new Matrix4()
      .makeTranslation(ex, 0, ez)
      .multiply(new Matrix4().makeRotationY(SITE.excavator.heading)),
  );
  sandPile(
    lotFrame(b, square(SITE.pile.at, SITE.pile.radius + 1), true),
    SITE.pile.at,
    SITE.pile.radius,
    SITE.pile.height,
  );
}
