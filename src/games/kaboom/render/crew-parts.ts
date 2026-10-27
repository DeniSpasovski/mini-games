import {
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  LatheGeometry,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bbox, merge, part } from './parts';

export { buildCritter, type CritterModel } from './critters';

/** Gear, TNT and pickups built from primitives (the critters themselves: `critters.ts`). Local space as the critters. */
const ball = (r: number) => new SphereGeometry(r, 12, 8);
const rbox = (w: number, h: number, d: number, r: number) =>
  new RoundedBoxGeometry(w, h, d, 2, r);

/**
 * Gear parts that keep their own paint instead of the team colour (reflective stripes, the hat's inner band): `aPlain`
 * = 1 on them, 0 elsewhere; `characters.ts` mixes the instance colour out where it is 1.
 */
const plainParts = new WeakSet<BufferGeometry>();
const plain = (g: BufferGeometry): BufferGeometry => {
  plainParts.add(g);
  return g;
};
function mergeGear(parts: BufferGeometry[]): BufferGeometry {
  for (const g of parts) {
    const n = g.getAttribute('position').count;
    g.setAttribute(
      'aPlain',
      new Float32BufferAttribute(
        new Float32Array(n).fill(plainParts.has(g) ? 1 : 0),
        1,
      ),
    );
  }
  return merge(parts);
}

/** An arc of tube (a strap, a rib, a hem): torus arc of `arc` radians centred on +y, in the xy plane. */
function arch(
  radius: number,
  tube: number,
  arc: number,
  seg = 18,
): BufferGeometry {
  return new TorusGeometry(radius, tube, 5, seg, arc).rotateZ(
    Math.PI / 2 - arc / 2,
  );
}

/**
 * Hard hat: a dome with a flat crown and a raised centre ridge, a thick chamfered brim running out into a front peak,
 * a lamp clip on the front and the dark suspension band underneath. White paint = tinted by the team colour per
 * instance.
 */
export function hatGeometry(): BufferGeometry {
  // brim profile (radius, height), lathed round: a thick slab with chamfered edges
  const brim = [
    [0.16, 0.016],
    [0.245, 0.006],
    [0.262, -0.004],
    [0.264, -0.022],
    [0.252, -0.032],
    [0.16, -0.022],
  ].map(([r, y]) => new Vector2(r, y));
  return mergeGear([
    part(
      new SphereGeometry(0.2, 16, 7, 0, Math.PI * 2, 0, Math.PI / 2),
      0xffffff,
      { sy: 0.78, tint: 0.02, smooth: true, cuts: [[0, 1, 0, 0.145]] },
    ),
    // the brim, stretched forward into a peak
    part(new LatheGeometry(brim, 24), 0xf0f0f0, {
      sz: 1.18,
      z: 0.03,
      tint: 0,
      edges: true,
    }),
    // the raised centre ridge, front to back
    part(arch(0.19, 0.026, Math.PI * 0.9).rotateY(Math.PI / 2), 0xe6e6e6, {
      sy: 0.8,
      tint: 0,
      edges: true,
    }),
    plain(
      part(bbox(0.07, 0.05, 0.03, 0.01), 0x3a3633, {
        y: 0.075,
        z: 0.19,
        tint: 0,
      }),
    ),
    plain(
      part(
        new TorusGeometry(0.19, 0.014, 4, 24).rotateX(Math.PI / 2),
        0x3a3633,
        { y: -0.004, tint: 0 },
      ),
    ),
  ]);
}

/**
 * Hi-vis vest: a shaped shell round the torso, open at the front (the belly shows), shoulder straps, a hem, two
 * pockets and two silver reflective stripes. Team colour per instance, the stripes stay silver.
 */
export function vestGeometry(): BufferGeometry {
  // the shell: a band of sphere round the torso (centre y 0.36), with a gap of OPEN radians at the front (+z)
  const OPEN = 0.62;
  const R = 0.352;
  const top = 0.92;
  const bottom = 1.96;
  const phi0 = Math.PI / 2 + OPEN / 2;
  const phiLen = Math.PI * 2 - OPEN;
  // cloth, not a barrel: soft vertical folds hanging from the shoulders, deeper towards the hem, fading out at the hems
  // and the front edges (the trims sit there); the stripes ride the same folds
  const drape = (g: BufferGeometry, r: number): BufferGeometry => {
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const t = Math.acos(Math.max(-1, Math.min(1, y / r)));
      let phi = Math.atan2(z, -x) - phi0;
      phi = ((phi % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const v = (t - top) / (bottom - top);
      const hems = Math.sin(Math.PI * Math.min(1, Math.max(0, v)));
      const edges = Math.min(1, phi / 0.3, (phiLen - phi) / 0.3);
      const fold =
        Math.sin(phi * 7 + Math.sin(phi * 3.1) * 0.8) * 0.65 +
        Math.sin(phi * 13 + 1.7) * 0.35;
      const k = 1 + 0.05 * fold * (0.35 + 0.65 * v) * hems * Math.max(0, edges);
      pos.setXYZ(i, x * k, y, z * k);
    }
    g.computeVertexNormals();
    return g;
  };
  const band = (t0: number, t1: number, r: number) =>
    drape(new SphereGeometry(r, 64, 10, phi0, phiLen, t0, t1 - t0), r);
  const yAt = (t: number, r = R) => 0.36 + Math.cos(t) * r * 1.05;
  const parts: BufferGeometry[] = [
    part(band(top, bottom, R), 0xffffff, {
      y: 0.36,
      sy: 1.05,
      sz: 0.97,
      tint: 0,
    }),
  ];
  // reflective stripes: thin bands a hair outside the shell
  for (const t of [1.33, 1.7])
    parts.push(
      plain(
        part(band(t - 0.055, t + 0.055, R + 0.004), 0xd9dde3, {
          y: 0.36,
          sy: 1.05,
          sz: 0.97,
          tint: 0,
        }),
      ),
    );
  // hems along the bottom and the top edge, piping down both sides of the opening
  for (const t of [bottom, top])
    parts.push(
      part(
        new TorusGeometry(Math.sin(t) * R, 0.012, 4, 32, phiLen)
          .rotateX(Math.PI / 2)
          .rotateY(phi0 + phiLen - Math.PI),
        0xeeeeee,
        { y: yAt(t), sz: 0.97, tint: 0 },
      ),
    );
  for (const phi of [phi0, phi0 + phiLen])
    parts.push(
      part(
        new TorusGeometry(R, 0.012, 4, 10, bottom - top)
          .rotateZ(Math.PI / 2 - bottom)
          .rotateY(Math.PI + phi),
        0xeeeeee,
        { y: 0.36, sy: 1.05, sz: 0.97, tint: 0 },
      ),
    );
  // shoulder straps from the front edge over the shoulder to the back
  for (const s of [-1, 1])
    parts.push(
      part(arch(0.3, 0.024, Math.PI * 0.62).rotateY(Math.PI / 2), 0xf4f4f4, {
        x: s * 0.13,
        y: 0.41,
        sx: 1.9,
        tint: 0,
      }),
    );
  // patch pockets either side of the opening
  for (const s of [-1, 1])
    parts.push(
      part(rbox(0.1, 0.08, 0.02, 0.008), 0xeaeaea, {
        x: s * 0.17,
        y: 0.31,
        z: 0.3,
        ry: s * 0.5,
        tint: 0,
      }),
    );
  return mergeGear(parts);
}

/**
 * Fan shirt (the crowd's sprites): a closed single-colour T-shirt with short sleeves, built on the vest's torso (`VEST_CY`
 * 0.36, radius 0.352) so the same per-critter fit applies. No stripes, hems or straps.
 */
export function fanShirtGeometry(): BufferGeometry {
  const R = 0.352;
  const top = 0.9;
  const bottom = 2.0;
  const parts: BufferGeometry[] = [
    part(
      new SphereGeometry(R, 30, 5, 0, Math.PI * 2, top, bottom - top),
      0xffffff,
      { y: 0.36, sy: 1.05, sz: 0.97, tint: 0 },
    ),
  ];
  // sleeves: short tapered tubes from the shoulder out and down, capped by a rounded shoulder
  for (const s of [-1, 1]) {
    const tilt = s * 0.95;
    const sleeve = new CylinderGeometry(0.1, 0.125, 0.2, 14, 1, true).rotateZ(
      tilt,
    );
    const cap = new SphereGeometry(0.1, 12, 8)
      .translate(0, 0.1, 0)
      .rotateZ(tilt);
    for (const g of [sleeve, cap])
      parts.push(part(g, 0xffffff, { x: s * 0.31, y: 0.46, tint: 0 }));
  }
  return mergeGear(parts);
}

/**
 * One work boot (instanced twice per player): a thin rubber sole, a round leather shaft with a padded collar, a rounded
 * toe and laces. It keeps its own paint (`aPlain`), the same for the whole crew.
 */
export function footGeometry(): BufferGeometry {
  const leather = 0x9c6838;
  const toe = 0x87552c;
  return mergeGear([
    // the sole: an oval following the footprint (round heel, round toe), tucked just inside the upper, its edge rounded
    plain(
      part(new SphereGeometry(1, 20, 8), 0x3b2e26, {
        y: 0.016,
        z: 0.04,
        sx: 0.056,
        sy: 0.03,
        sz: 0.1,
        tint: 0.03,
        smooth: true,
        cuts: [
          [0, -1, 0, 0.016],
          [0, 1, 0, 0.012],
        ],
      }),
    ),
    // the shaft, round and a little narrower at the top
    plain(
      part(new CylinderGeometry(0.052, 0.058, 0.1, 16), leather, {
        y: 0.074,
        z: -0.008,
        sz: 0.95,
        tint: 0.04,
      }),
    ),
    // the rounded toe
    plain(
      part(new SphereGeometry(1, 16, 10), toe, {
        y: 0.046,
        z: 0.07,
        sx: 0.06,
        sy: 0.042,
        sz: 0.075,
        tint: 0.04,
        smooth: true,
        cuts: [[0, -1, 0, 0.022]],
      }),
    ),
    // padded collar round the top
    plain(
      part(
        new TorusGeometry(0.052, 0.012, 6, 18).rotateX(Math.PI / 2),
        0x5e3c20,
        { y: 0.126, z: -0.008, sz: 0.95, tint: 0.03 },
      ),
    ),
    // laces up the front of the shaft
    ...[0.064, 0.088, 0.11].map((y) =>
      plain(
        part(bbox(0.044, 0.007, 0.01, 0.003), 0xe8dcc0, {
          y,
          z: 0.05,
          tint: 0,
        }),
      ),
    ),
  ]);
}

/**
 * Where a part samples the stick texture when it only wants its vertex colour: the plain white strip at its right
 * edge (`stickPaperTexture` in `tnt.ts`).
 */
const PLAIN_U = 0.99;
function plainUV<T extends BufferGeometry>(g: T): T {
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, PLAIN_U, 0.5);
  return g;
}

/** Parts that sample the stick paper (the tubes); everything else in a TNT or pickup model takes the plain strip. */
const paperParts = new WeakSet<BufferGeometry>();

/** Merge a model that uses the stick texture: every part but the paper tubes samples its plain strip. */
function mergePaper(p: BufferGeometry[]): BufferGeometry {
  for (const g of p) if (!paperParts.has(g)) plainUV(g);
  return merge(p);
}

/** A dynamite stick standing on y0: a paper tube (textured: red wrap, seam, printed rings) and a crimped paper cap. */
function stick(
  x: number,
  z: number,
  h: number,
  r: number,
  turn: number,
  y0 = 0,
): BufferGeometry[] {
  const side = part(new CylinderGeometry(r, r, h, 18, 1, true), 0xffffff, {
    x,
    z,
    y: y0 + h / 2,
    ry: turn,
    tint: 0.02,
  });
  paperParts.add(side);
  // the crimped end: a low cone of folded paper, creases shaded round it
  const cap = plainUV(
    part(new ConeGeometry(r * 0.99, r * 0.4, 16, 1, true), 0xe8cf9c, {
      x,
      z,
      y: y0 + h + r * 0.2,
      ry: turn,
      tint: 0,
    }),
  );
  const pos = cap.getAttribute('position');
  const col = cap.getAttribute('color');
  for (let i = 0; i < pos.count; i++) {
    const a = Math.atan2(pos.getZ(i) - z, pos.getX(i) - x);
    const k = 0.84 + 0.16 * (0.5 + 0.5 * Math.cos(a * 8 + turn));
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
  }
  const bottom = plainUV(
    part(new CylinderGeometry(r, r, 0.006, 18), 0x7a2019, {
      x,
      z,
      y: y0 + 0.003,
      tint: 0,
    }),
  );
  return [side, cap, bottom];
}

/** The TNT fuse: a cord rising from the middle of the bundle and curling forward (the spark rides it, `fusePoint`). */
const FUSE = new CatmullRomCurve3([
  new Vector3(0, 0.5, -0.02),
  new Vector3(0, 0.59, -0.02),
  new Vector3(0.035, 0.67, 0.0),
  new Vector3(0.09, 0.71, 0.035),
]);

/** Point `t` of the fuse (0 = where it enters the bundle, 1 = its tip), in TNT space. */
export function fusePoint(t: number, out: Vector3): Vector3 {
  return FUSE.getPoint(Math.min(1, Math.max(0, t)), out);
}

/** Stick radius of a placed TNT. */
const STICK_R = 0.11;

/**
 * Where the sticks of a TNT stand, by blast level (index 0 = level 1): one stick at level 1, two at level 2 ... five at
 * level 5 - you can read how far a TNT will blow from how fat it is.
 */
export const TNT_LAYOUTS: readonly (readonly (readonly [number, number])[])[] =
  [
    [[0, 0]],
    [
      [-0.115, 0],
      [0.115, 0],
    ],
    [
      [-0.14, 0.05],
      [0.14, 0.05],
      [0, -0.075],
    ],
    [
      [-0.115, 0.1],
      [0.115, 0.1],
      [-0.115, -0.1],
      [0.115, -0.1],
    ],
    [
      [-0.22, 0.07],
      [0, 0.07],
      [0.22, 0.07],
      [-0.11, -0.11],
      [0.11, -0.11],
    ],
  ];

/** Tag every vertex of `g` with the TNT layout it belongs to (`aLayout`: level 1-5, 0 = shared by all). */
function layout<T extends BufferGeometry>(g: T, level: number): T {
  const n = g.getAttribute('position').count;
  g.setAttribute(
    'aLayout',
    new Float32BufferAttribute(new Float32Array(n).fill(level), 1),
  );
  return g;
}

/** Bounds of a layout's sticks (x and z, the stick radius included). */
function layoutBounds(level: number): {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
} {
  const sticks = TNT_LAYOUTS[level - 1];
  const xs = sticks.map((s) => s[0]);
  const zs = sticks.map((s) => s[1]);
  return {
    x0: Math.min(...xs) - STICK_R,
    x1: Math.max(...xs) + STICK_R,
    z0: Math.min(...zs) - STICK_R,
    z1: Math.max(...zs) + STICK_R,
  };
}

/**
 * TNT bundles for all five blast levels in one geometry (`aLayout` says which level a vertex belongs to; the TNT
 * renderer shows only the one matching each TNT's level): paper sticks with crimped caps, two turns of twine round the
 * bundle, and one shared curling fuse. The paper label is a separate mesh (it shows the count). Sticks sample the
 * shared stick texture; every other part its plain strip.
 */
export function tntBodyGeometry(): BufferGeometry {
  const p: BufferGeometry[] = [];
  TNT_LAYOUTS.forEach((sticks, li) => {
    const level = li + 1;
    sticks.forEach(([x, z], k) => {
      // the back sticks a touch taller: a bundle, not a block
      const h = z < 0 ? 0.52 : 0.5;
      for (const g of stick(x, z, h, STICK_R, k * 2.1 + level * 0.7))
        p.push(layout(g, level));
    });
    const b = layoutBounds(level);
    const rx = (b.x1 - b.x0) / 2 + 0.006;
    const rz = (b.z1 - b.z0) / 2 + 0.006;
    for (const y of [0.115, 0.425])
      p.push(
        layout(
          plainUV(
            part(
              new TorusGeometry(rx, 0.011, 5, 36).rotateX(Math.PI / 2),
              0x8f6c45,
              { y, z: (b.z0 + b.z1) / 2, sz: rz / rx, tint: 0.08 },
            ),
          ),
          level,
        ),
      );
  });
  p.push(
    layout(
      plainUV(
        part(new TubeGeometry(FUSE, 20, 0.014, 6), 0x3a2c22, { tint: 0.1 }),
      ),
      0,
    ),
    layout(
      plainUV(part(ball(0.028), 0x2a1f18, { z: -0.02, y: 0.5, tint: 0 })),
      0,
    ),
  );
  return merge(p);
}

/**
 * The paper label round the sticks, one per blast level (`aLayout`), each sized to its bundle. Its UVs show one digit
 * of a 3-cell atlas on every side (shifted per instance), cropped to the front's proportions so the digit stays round.
 */
export function tntBandGeometry(): BufferGeometry {
  const H = 0.17;
  const bands: BufferGeometry[] = [];
  for (let level = 1; level <= TNT_LAYOUTS.length; level++) {
    const b = layoutBounds(level);
    const w = b.x1 - b.x0 + 0.03;
    const d = b.z1 - b.z0 + 0.03;
    const g = new RoundedBoxGeometry(w, H, d, 3, Math.min(0.07, d / 2 - 0.01));
    g.translate((b.x0 + b.x1) / 2, 0.27, (b.z0 + b.z1) / 2);
    // the atlas cell is 3 : 1; a narrower label shows the middle of it
    const crop = Math.min(1, w / H / 3);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++)
      uv.setX(i, 0.5 + (uv.getX(i) - 0.5) * crop);
    bands.push(layout(g, level));
  }
  const merged = mergeGeometries(bands, false);
  if (!merged) throw new Error('kaboom: could not merge the TNT labels');
  for (const g of bands) g.dispose();
  return merged;
}

/** One little bundle of dynamite sticks standing on the floor, for the power-up models. */
function stickBundle(
  cx: number,
  cz: number,
  sticks: [number, number, number][],
  r: number,
): BufferGeometry[] {
  const p: BufferGeometry[] = [];
  sticks.forEach(([x, z, h], i) =>
    p.push(...stick(cx + x, cz + z, h, r, i * 2.3 + cx * 7, 0.05)),
  );
  return p;
}

/**
 * Power-up "more dynamites": TWO full bundles side by side on a cyan pad, each with its band and fuse - it looks like more
 * dynamite to carry. Local space like the other models: centred, standing on y = 0.
 */
export function dynamitesItemGeometry(): BufferGeometry {
  const p: BufferGeometry[] = [
    part(new CylinderGeometry(0.47, 0.47, 0.05, 20), 0x38c6ff, {
      y: 0.025,
      tint: 0.04,
    }),
    // a floating gem: this is a pickup, not a lit TNT
    part(new OctahedronGeometry(0.12, 0), 0x9af0ff, {
      y: 0.98,
      sy: 1.5,
      tint: 0,
    }),
  ];
  for (const cx of [-0.18, 0.18]) {
    p.push(
      ...stickBundle(
        cx,
        0,
        [
          [-0.065, 0.02, 0.34],
          [0.065, 0.02, 0.34],
          [0, -0.05, 0.36],
        ],
        0.06,
      ),
      part(new BoxGeometry(0.24, 0.1, 0.17), 0xf3dfae, {
        x: cx,
        y: 0.24,
        tint: 0.03,
      }),
      part(new CylinderGeometry(0.012, 0.012, 0.12, 5), 0x3b2f2a, {
        x: cx,
        z: -0.02,
        y: 0.5,
        tint: 0,
      }),
      part(ball(0.025), 0xffc247, { x: cx, z: -0.02, y: 0.57, tint: 0 }),
    );
  }
  return mergePaper(p);
}

/**
 * Power-up "more sticks": ONE fat bundle of seven sticks tied with a golden band, on a gold pad - the dynamite itself got
 * bigger. A different silhouette and colour from the dynamites pickup so the two read apart at a glance.
 */
export function sticksItemGeometry(): BufferGeometry {
  const ring: [number, number, number][] = [[0, 0, 0.52]];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ring.push([Math.cos(a) * 0.125, Math.sin(a) * 0.125, 0.44]);
  }
  return mergePaper([
    part(new CylinderGeometry(0.47, 0.47, 0.05, 20), 0xffb020, {
      y: 0.025,
      tint: 0.04,
    }),
    part(new OctahedronGeometry(0.12, 0), 0xffe27a, {
      y: 1.02,
      sy: 1.5,
      tint: 0,
    }),
    ...stickBundle(0, 0, ring, 0.07),
    part(new CylinderGeometry(0.235, 0.235, 0.08, 18), 0xffc22e, {
      y: 0.24,
      tint: 0.05,
    }),
    part(new CylinderGeometry(0.012, 0.012, 0.14, 5), 0x3b2f2a, {
      y: 0.66,
      tint: 0,
    }),
    part(ball(0.028), 0xffc247, { y: 0.74, tint: 0 }),
  ]);
}
