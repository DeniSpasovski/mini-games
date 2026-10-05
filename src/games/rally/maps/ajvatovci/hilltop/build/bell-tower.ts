import { LatheGeometry, Matrix4, TorusGeometry, Vector2 } from 'three';
import { cross } from './church';
import {
  archOutline,
  rectOutline,
  type Local,
  type V2,
  type V3,
  type Wall,
} from './shapes';

/**
 * The bell tower north-west of the church (photo ref-56): three square tiers of rubble stone, each
 * narrower than the one below, open arches all round, a tiled skirt roof over the two lower tiers, a
 * tiled hipped roof and an iron cross on top; one bell hangs in the belfry. ~10.5 m to the cross.
 *
 * Local frame: centred on the OSM square, y up from the lawn.
 */
const FOOT = -0.8;
const STONE = '#ffffff';
const SILL = '#d9d2c6';
const BRONZE = '#8a6a3a';

interface Tier {
  half: number;
  y0: number;
  y1: number;
  depth: number;
  holes: (s: number) => V2[][];
}

const TIERS: Tier[] = [
  // Ground tier: one wide arch per side (a walk-through porch).
  {
    half: 1.75,
    y0: FOOT,
    y1: 2.95,
    depth: 0.45,
    holes: () => [archOutline(0, 0, 1.5, 2.45, 10)],
  },
  // Middle tier: two rows of two small arched openings per side.
  {
    half: 1.45,
    y0: 2.95,
    y1: 6.15,
    depth: 0.35,
    holes: () =>
      [-0.48, 0.48].flatMap((s) => [
        archOutline(s, 3.55, 0.42, 4.5),
        archOutline(s, 4.95, 0.42, 5.9),
      ]),
  },
  // Belfry: one tall arch per side, the bell inside.
  {
    half: 1.2,
    y0: 6.15,
    y1: 8.3,
    depth: 0.3,
    holes: () => [archOutline(0, 6.55, 0.95, 8.0, 10)],
  },
];

/** The four outer faces of a square tier (normals +x, +z, -x, -z). */
const faces = (half: number): Wall[] =>
  (
    [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ] as const
  ).map(([nx, nz]): Wall => ({ o: [nx * half, 0, nz * half], n: [nx, 0, nz] }));

/** A hipped skirt roof round a tier: from the wall at `top` out to `outer` at `eave`. */
function skirt(
  l: Local,
  inner: number,
  outer: number,
  top: number,
  eave: number,
): void {
  for (const w of faces(1)) {
    const r: V3 = [w.n[2], 0, -w.n[0]];
    const p = (half: number, s: number, y: number): V3 => [
      w.n[0] * half + r[0] * s,
      y,
      w.n[2] * half + r[2] * s,
    ];
    l.roof(
      [
        p(outer, -outer, eave),
        p(outer, outer, eave),
        p(inner, inner, top),
        p(inner, -inner, top),
      ],
      { trim: [0] },
    );
  }
}

export function buildBellTower(l: Local): void {
  for (const t of TIERS) {
    faces(t.half).forEach((w, k) => {
      l.panel('rubble', w, rectOutline(-t.half, t.y0, t.half, t.y1), STONE, {
        holes: t.holes(0),
        depth: t.depth,
        uOff: k * t.half * 2,
      });
    });
    // Floor slab over the tier below / ceiling of this one (seen through the arches).
    l.box(
      'paint',
      [-t.half + 0.02, t.y1 - 0.12, -t.half + 0.02],
      [t.half - 0.02, t.y1, t.half - 0.02],
      '#9c958a',
    );
    // Corner quoins: lighter cut stone up the four corners.
    for (const [sx, sz] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ])
      l.box(
        'ashlar',
        [
          sx * t.half - (sx > 0 ? 0.22 : -0.02),
          Math.max(t.y0, 0),
          sz * t.half - (sz > 0 ? 0.22 : -0.02),
        ],
        [
          sx * t.half + (sx > 0 ? 0.02 : -0.22),
          t.y1,
          sz * t.half + (sz > 0 ? 0.02 : -0.22),
        ],
        SILL,
      );
  }
  // Ground floor paving.
  l.box('paint', [-1.75, FOOT, -1.75], [1.75, 0.08, 1.75], '#b8b0a4');
  // Skirt roofs over the two lower tiers, the hipped roof on top.
  skirt(l, 1.45, 2.4, 3.35, 2.85);
  skirt(l, 1.2, 2.0, 6.5, 6.1);
  const top = 8.3;
  const eaveR = 1.6;
  for (const w of faces(1)) {
    const r: V3 = [w.n[2], 0, -w.n[0]];
    const p = (s: number): V3 => [
      w.n[0] * eaveR + r[0] * s,
      top - 0.15,
      w.n[2] * eaveR + r[2] * s,
    ];
    l.roof([p(-eaveR), p(eaveR), [0, top + 0.95, 0]], { trim: [0] });
  }
  cross(l, [0, top + 0.9, 0], 1.2, '#2b2b2b');

  // The bell on a beam across the belfry.
  l.box('paint', [-1.2, 7.72, -0.08], [1.2, 7.88, 0.08], '#4a3322');
  const bell = new LatheGeometry(
    [
      new Vector2(0.001, 0.62),
      new Vector2(0.12, 0.6),
      new Vector2(0.17, 0.5),
      new Vector2(0.19, 0.3),
      new Vector2(0.24, 0.12),
      new Vector2(0.31, 0.03),
      new Vector2(0.3, 0),
      new Vector2(0.25, 0.04),
      new Vector2(0.001, 0.08),
    ],
    14,
  );
  l.add('metal', bell, BRONZE, new Matrix4().makeTranslation(0, 7.08, 0));
  const lip = new TorusGeometry(0.3, 0.02, 4, 14);
  l.add(
    'metal',
    lip,
    BRONZE,
    new Matrix4()
      .makeTranslation(0, 7.1, 0)
      .multiply(new Matrix4().makeRotationX(Math.PI / 2)),
  );
}
