import {
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  LatheGeometry,
  Mesh,
  Shape,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import { Rng, hash3 } from '../../../../shared/rng';
import { boatAt, boatsGeometry } from '../boats';
import { ringPoints, treadY } from '../bowl';
import { Sea } from '../sea';
import { ROUGH } from '../materials';
import {
  box,
  flagstone,
  merge,
  part,
  rbox,
  rock,
  strut,
  woodCrateGeometry,
  type DecorParts,
} from '../parts';
import { shared, sharedValue } from './cache';
import type { FxTint, LevelTheme, SceneryCtx } from './theme';

/** Sea Deck palette (DETAILS.md "Levels"): pale weathered planks, dark iron, rope; the sea is blue-green and nothing on the deck is. */
const S = {
  plank: [0xd6c59b, 0xcdbb92, 0xc2ae84, 0xd0bd8f],
  deck: 0xc4b087,
  seam: 0x9a8760,
  beam: 0x6d5a3e,
  barrel: [0x8a5a2e, 0x7a4e26],
  hoop: 0x3a3d42,
  iron: 0x4a4d52,
  /** Painted iron of the bollards and capstans: weathered blue-grey, a darker cap, bare metal where it chipped. */
  paint: 0x7f939c,
  paintDark: 0x5b6a72,
  plate: 0x68747b,
  chip: 0xa7a59c,
  brass: 0xc29a4a,
  ironLight: 0x65686f,
  ironDark: 0x2c2e33,
  rope: 0xc9b58a,
  ropeDark: 0x7a6a4c,
  gap: 0x2a2219,
  nail: 0x45403a,
  crate: 0xc8955a,
  crateBand: 0x9a6b3a,
  crateDark: 0x6e4a28,
  cargo: 0xb97d44,
  cargoLid: 0x9c6a36,
  red: 0xd64a3a,
  white: 0xf0ece0,
  pot: 0x7a6a4a,
  net: 0x4f6b4a,
  skyTop: '#6fb1e4',
  skyMid: '#c6e3f3',
  skyLow: '#fbe3c4',
} as const;

const FX: FxTint = {
  // spray and foam instead of dust
  dustDark: [0.62, 0.72, 0.78],
  dustLight: [0.98, 1.0, 1.0],
  wood: [
    [0.78, 0.6, 0.38],
    [0.6, 0.45, 0.28],
    [0.86, 0.7, 0.5],
  ],
  scorch: [0.06, 0.05, 0.04],
};

// ------------------------------------------------------------------ platform

/** One tile = four planks with hairline gaps (the sea shows through when it falls). Top on y = 0. */
function plankTile(): BufferGeometry {
  // a dark bed under the planks: the gaps read as shadow, not as water (neighbouring beds meet; it sinks with its tile)
  const p: BufferGeometry[] = [
    part(box(1, 0.04, 1), S.gap, { y: -0.17, tint: 0, rough: ROUGH.wood }),
  ];
  const w = 0.232;
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * 0.2425;
    const lift = [0, -0.005, 0.004, -0.002][i];
    p.push(
      part(
        flagstone(
          [
            [-w / 2, -0.485],
            [w / 2, -0.485],
            [w / 2, 0.485],
            [-w / 2, 0.485],
          ],
          0.15,
          0.018,
        ),
        S.plank[i],
        { x, y: -0.15 + lift, tint: 0.12, rough: ROUGH.wood },
      ),
    );
    // a nail head near each end
    for (const z of [-0.42, 0.42])
      p.push(
        part(box(0.03, 0.012, 0.03), S.nail, {
          x: x + (i & 1 ? 0.04 : -0.04),
          z,
          y: lift + 0.003,
          tint: 0,
          rough: ROUGH.iron,
        }),
      );
  }
  return merge(p);
}

function floor(w: number, h: number, pad: number): BufferGeometry {
  const hw = w / 2;
  const hh = h / 2;
  const shape = new Shape();
  shape.moveTo(-hw - pad, -hh - pad);
  shape.lineTo(hw + pad, -hh - pad);
  shape.lineTo(hw + pad, hh + pad);
  shape.lineTo(-hw - pad, hh + pad);
  shape.closePath();
  const hole = new Shape();
  hole.moveTo(-hw, -hh);
  hole.lineTo(-hw, hh);
  hole.lineTo(hw, hh);
  hole.lineTo(hw, -hh);
  hole.closePath();
  shape.holes.push(hole);
  const deck = new ExtrudeGeometry(shape, { depth: 0.22, bevelEnabled: false });
  deck.rotateX(-Math.PI / 2);
  deck.translate(0, -0.26, 0);
  const p: BufferGeometry[] = [part(deck, S.deck, { tint: 0.14 })];
  // seams across the margin every half metre
  for (let x = -hw - pad + 0.25; x < hw + pad; x += 0.5) {
    p.push(
      part(box(0.02, 0.01, pad - 0.05), S.seam, {
        x,
        y: -0.04,
        z: hh + pad / 2,
      }),
    );
    p.push(
      part(box(0.02, 0.01, pad - 0.05), S.seam, {
        x,
        y: -0.04,
        z: -hh - pad / 2,
      }),
    );
  }
  for (let z = -hh + 0.25; z < hh; z += 0.5) {
    p.push(
      part(box(pad - 0.05, 0.01, 0.02), S.seam, {
        x: hw + pad / 2,
        y: -0.04,
        z,
      }),
    );
    p.push(
      part(box(pad - 0.05, 0.01, 0.02), S.seam, {
        x: -hw - pad / 2,
        y: -0.04,
        z,
      }),
    );
  }
  return merge(p);
}

/** A barrel lying on its side, axis along x (rotate for the other edges). */
function floatBarrel(
  x: number,
  y: number,
  z: number,
  ry: number,
  k: number,
): BufferGeometry[] {
  const prof = [0, 0.3, 0.38, 0.4, 0.38, 0.3, 0].map(
    (r, i) => new Vector2(r, (i / 6 - 0.5) * 0.9),
  );
  const body = new LatheGeometry(prof, 10);
  body.rotateZ(Math.PI / 2);
  const out: BufferGeometry[] = [
    part(body, S.barrel[k % 2], { x, y, z, ry, tint: 0.2 }),
  ];
  for (const dx of [-0.25, 0.25])
    out.push(
      part(
        new CylinderGeometry(0.405, 0.405, 0.05, 10).rotateZ(Math.PI / 2),
        S.hoop,
        {
          x: 0,
          y: 0,
          z: 0,
        },
      )
        .translate(dx, 0, 0)
        .rotateY(ry)
        .translate(x, y, z),
    );
  return out;
}

/** What the raft rides on: barrels lashed round the rim (nothing under the tiles: a fallen tile leaves open water). */
function frame(w: number, h: number, pad: number): BufferGeometry {
  const hw = w / 2;
  const hh = h / 2;
  const p: BufferGeometry[] = [];
  let k = 0;
  for (let x = -hw - pad + 0.6; x <= hw + pad - 0.5; x += 0.95) {
    p.push(...floatBarrel(x, -0.66, hh + pad - 0.42, Math.PI / 2, k++));
    p.push(...floatBarrel(x, -0.66, -hh - pad + 0.42, Math.PI / 2, k++));
  }
  for (let z = -hh - pad + 1.5; z <= hh + pad - 1.4; z += 0.95) {
    p.push(...floatBarrel(hw + pad - 0.42, -0.66, z, 0, k++));
    p.push(...floatBarrel(-hw - pad + 0.42, -0.66, z, 0, k++));
  }
  return merge(p);
}

// ------------------------------------------------------------------ blocks

const torus = (r: number, tube: number, arc = Math.PI * 2) =>
  new TorusGeometry(r, tube, 6, 14, arc).rotateX(Math.PI / 2);

/** A coil of rope: `turns` real turns of a tube round the y axis from `y0` up `rise` per turn, radius `r`. */
function ropeCoil(
  r: number,
  y0: number,
  turns: number,
  rise: number,
  tube = 0.04,
): BufferGeometry {
  const pts: Vector3[] = [];
  const n = Math.round(turns * 16);
  for (let i = 0; i <= n; i++) {
    const a = (i / 16) * Math.PI * 2;
    pts.push(
      new Vector3(Math.cos(a) * r, y0 + (i / 16) * rise, Math.sin(a) * r),
    );
  }
  return new TubeGeometry(new CatmullRomCurve3(pts), n * 2, tube, 6, false);
}

/** A mushroom cap: lathed, a bold overhang with a rounded lip. */
function capLathe(r: number, h: number): LatheGeometry {
  const prof = [
    [0, h],
    [r * 0.7, h],
    [r * 0.93, h * 0.9],
    [r, h * 0.62],
    [r * 0.97, h * 0.3],
    [r * 0.8, 0.0],
    [r * 0.6, 0.0],
  ]
    .reverse()
    .map(([x, y]) => new Vector2(x, y));
  return new LatheGeometry(prof, 18);
}

/**
 * Hard block 0: a painted iron mooring bollard on a riveted plate, a bold mushroom cap with chipped paint on its rim,
 * three real turns of rope round its neck and the tail lying on the deck.
 */
function bollard(): BufferGeometry {
  const col = [
    [0.33, 0.1],
    [0.3, 0.3],
    [0.27, 0.55],
    [0.28, 0.72],
    [0.31, 0.8],
  ].map(([x, y]) => new Vector2(x, y));
  const p: BufferGeometry[] = [
    part(rbox(0.9, 0.1, 0.9, 0.035, 2), S.plate, {
      y: 0.05,
      rough: ROUGH.iron,
    }),
    part(new LatheGeometry(col, 18), S.paint, {
      smooth: true,
      tint: 0.08,
      rough: ROUGH.paint,
    }),
    part(capLathe(0.42, 0.2), S.paintDark, {
      y: 0.8,
      smooth: true,
      tint: 0.06,
      rough: ROUGH.paint,
    }),
    // worn bare iron where ropes rub the rim
    part(
      new TorusGeometry(0.415, 0.018, 4, 18, 2.2).rotateX(Math.PI / 2),
      S.chip,
      {
        y: 0.87,
        ry: 0.6,
        tint: 0,
        rough: ROUGH.iron,
      },
    ),
    part(ropeCoil(0.32, 0.28, 3, 0.085), S.rope, {
      tint: 0.2,
      rough: ROUGH.rope,
    }),
    // the tail: down off the coil and along the deck
    part(
      new TubeGeometry(
        new CatmullRomCurve3([
          new Vector3(0.32, 0.535, 0),
          new Vector3(0.36, 0.3, 0.12),
          new Vector3(0.38, 0.13, 0.3),
          new Vector3(0.3, 0.12, 0.42),
        ]),
        12,
        0.04,
        6,
      ),
      S.rope,
      { tint: 0.2, rough: ROUGH.rope },
    ),
  ];
  for (const [x, z] of [
    [-0.36, -0.36],
    [0.36, -0.36],
    [-0.36, 0.36],
    [0.36, 0.36],
  ])
    p.push(
      part(
        new SphereGeometry(0.03, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2),
        S.paintDark,
        {
          x,
          z,
          y: 0.1,
          tint: 0,
          rough: ROUGH.iron,
        },
      ),
    );
  return merge(p);
}

/**
 * Hard block 1: a painted capstan: a waisted drum with whelps (vertical ribs) for the rope to grip, a domed head with
 * square sockets for the bars, and a coil of anchor chain at its foot.
 */
function capstan(): BufferGeometry {
  const drum = [
    [0.38, 0.12],
    [0.33, 0.24],
    [0.29, 0.45],
    [0.31, 0.64],
    [0.36, 0.7],
  ].map(([x, y]) => new Vector2(x, y));
  const p: BufferGeometry[] = [
    part(rbox(0.95, 0.12, 0.95, 0.04, 2), S.plate, {
      y: 0.06,
      rough: ROUGH.iron,
    }),
    part(new LatheGeometry(drum, 16), S.paint, {
      smooth: true,
      tint: 0.08,
      rough: ROUGH.paint,
    }),
    part(capLathe(0.44, 0.22), S.paintDark, {
      y: 0.68,
      smooth: true,
      tint: 0.06,
      rough: ROUGH.paint,
    }),
    part(
      new TorusGeometry(0.435, 0.018, 4, 18, 1.8).rotateX(Math.PI / 2),
      S.chip,
      {
        y: 0.78,
        ry: 2.4,
        tint: 0,
        rough: ROUGH.iron,
      },
    ),
    part(
      new SphereGeometry(0.16, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2),
      S.brass,
      {
        y: 0.9,
        sy: 0.6,
        tint: 0,
        rough: ROUGH.iron,
      },
    ),
    part(torus(0.42, 0.06), S.ironDark, { y: 0.15, rough: ROUGH.iron }),
    part(torus(0.4, 0.06), S.hoop, { y: 0.23, ry: 0.3, rough: ROUGH.iron }),
  ];
  // whelps round the drum
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    p.push(
      part(rbox(0.07, 0.42, 0.07, 0.02), S.paint, {
        x: Math.cos(a) * 0.3,
        z: Math.sin(a) * 0.3,
        y: 0.45,
        ry: -a,
        rough: ROUGH.paint,
      }),
    );
  }
  // bar sockets: dark square holes round the head
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.26;
    p.push(
      part(box(0.09, 0.08, 0.04), S.gap, {
        x: Math.cos(a) * 0.43,
        z: Math.sin(a) * 0.43,
        y: 0.8,
        ry: Math.PI / 2 - a,
        tint: 0,
        paint: 0,
      }),
    );
  }
  return merge(p);
}

/** Crate 1: a cargo barrel with iron hoops and a dark lid. */
function cargoBarrel(): BufferGeometry {
  const prof = [0, 0.3, 0.37, 0.39, 0.37, 0.3, 0].map(
    (r, i) => new Vector2(i === 0 || i === 6 ? 0 : r, 0.1 + (i / 6) * 0.78),
  );
  return merge([
    part(new LatheGeometry(prof, 12), S.cargo, { tint: 0.14 }),
    part(new CylinderGeometry(0.29, 0.29, 0.04, 12), S.cargoLid, { y: 0.89 }),
    part(new CylinderGeometry(0.33, 0.33, 0.05, 12), S.hoop, { y: 0.26 }),
    part(new CylinderGeometry(0.385, 0.385, 0.05, 12), S.hoop, { y: 0.49 }),
    part(new CylinderGeometry(0.33, 0.33, 0.05, 12), S.hoop, { y: 0.72 }),
  ]);
}

// ------------------------------------------------------------------ decor

/** Margin decor: lantern poles at the corners, coiled rope, crab pots with floats, lifebuoys, a net, a flag. */
function decor(w: number, h: number, pad: number): DecorParts {
  const p: BufferGeometry[] = [];
  const bulbs: BufferGeometry[] = [];
  const hw = w / 2;
  const hh = h / 2;
  const r = new Rng(hash3(w, h, 0x5ea, 4));
  const frontZ = hh + pad * 0.5;
  const backZ = -hh - pad * 0.5;
  const sideX = hw + pad * 0.5;

  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = sx * sideX;
      const z = sz * frontZ;
      p.push(
        part(rbox(0.16, 1.3, 0.16, 0.03), S.iron, { x, z, y: 0.65 }),
        part(rbox(0.34, 0.06, 0.34, 0.02), S.ironLight, { x, z, y: 1.34 }),
        part(rbox(0.34, 0.02, 0.34, 0.01), S.ironLight, { x, z, y: 1.02 }),
        part(torus(0.12, 0.03), S.rope, { x, z, y: 0.4 }),
      );
      bulbs.push(
        part(rbox(0.2, 0.26, 0.2, 0.05), 0xffd27a, { x, z, y: 1.17, tint: 0 }),
      );
    }

  // coils of rope and a net heap
  for (const [x, z] of [
    [-hw * 0.45, frontZ],
    [hw * 0.35, backZ],
  ] as const)
    for (let i = 0; i < 4; i++)
      p.push(
        part(torus(0.3 - i * 0.02, 0.07), S.rope, {
          x,
          z,
          y: 0.07 + i * 0.1,
          tint: 0.2,
        }),
      );
  p.push(
    part(rock(0.45, 1), S.net, {
      x: hw * 0.55,
      z: frontZ,
      y: 0.16,
      sx: 1.4,
      sy: 0.38,
      lumpy: 0.07,
      tint: 0.2,
    }),
  );

  // crab pots with red floats
  for (const [x, z, ry] of [
    [-sideX, -hh * 0.3, 0.2],
    [-sideX + 0.1, hh * 0.15, -0.3],
    [sideX, hh * 0.45, 0.4],
  ] as const) {
    p.push(
      part(rbox(0.56, 0.36, 0.44, 0.06), S.pot, {
        x,
        z,
        y: 0.2,
        ry,
        tint: 0.2,
      }),
    );
    p.push(part(box(0.5, 0.04, 0.04), S.beam, { x, z, y: 0.38, ry }));
    p.push(
      part(new SphereGeometry(0.1, 8, 6), S.red, {
        x: x + 0.2,
        z: z + 0.2,
        y: 0.12,
      }),
    );
  }

  // two lifebuoys on posts at the sides, a flag pole at the back
  for (const [x, z] of [
    [sideX, -hh * 0.3],
    [-sideX, hh * 0.5],
  ] as const) {
    p.push(part(box(0.08, 1.0, 0.08), S.beam, { x, z, y: 0.5 }));
    for (let k = 0; k < 4; k++)
      p.push(
        part(
          new TorusGeometry(0.24, 0.07, 6, 6, Math.PI / 2)
            .rotateZ((k * Math.PI) / 2)
            .rotateY(Math.PI / 2),
          k % 2 ? S.white : S.red,
          {
            x,
            z,
            y: 0.7,
          },
        ),
      );
  }
  // the story prop: a ship's mast at the back, a furled sail on its yard, a crow's nest, shrouds down to the deck and
  // a pennant at the top
  {
    const x0 = -hw * 0.6;
    const z0 = backZ;
    const top = 5.2;
    const mast = [
      [0.13, 0],
      [0.12, 2],
      [0.095, 4],
      [0.07, top],
    ].map(([x, y]) => new Vector2(x, y));
    p.push(
      part(rbox(0.5, 0.14, 0.5, 0.04), S.paintDark, {
        x: x0,
        z: z0,
        y: 0.07,
        rough: ROUGH.paint,
      }),
      part(new LatheGeometry(mast, 10), S.beam, {
        x: x0,
        z: z0,
        smooth: true,
        rough: ROUGH.wood,
      }),
      part(new SphereGeometry(0.1, 8, 5), S.paintDark, {
        x: x0,
        z: z0,
        y: top + 0.04,
        rough: ROUGH.paint,
      }),
      // the yard and the sail furled along it
      part(
        strut([x0 - 1.5, 3.3, z0 + 0.12], [x0 + 1.5, 3.3, z0 + 0.12], 0.05, 6),
        S.beam,
        { rough: ROUGH.wood },
      ),
      part(
        strut(
          [x0 - 1.35, 3.2, z0 + 0.16],
          [x0 + 1.35, 3.2, z0 + 0.16],
          0.1,
          8,
          0.1,
        ),
        S.white,
        {
          tint: 0.08,
          rough: ROUGH.rope,
        },
      ),
      // the crow's nest: a little railed platform
      part(new CylinderGeometry(0.4, 0.34, 0.08, 12), S.beam, {
        x: x0,
        z: z0,
        y: 4.1,
        rough: ROUGH.wood,
      }),
      part(torus(0.4, 0.03), S.beam, {
        x: x0,
        z: z0,
        y: 4.42,
        rough: ROUGH.wood,
      }),
      part(
        new TorusGeometry(0.39, 0.12, 3, 12)
          .rotateX(Math.PI / 2)
          .scale(1, 2, 1),
        S.white,
        {
          x: x0,
          z: z0,
          y: 4.25,
          tint: 0.05,
          rough: ROUGH.rope,
        },
      ),
    );
    // shrouds: from under the crow's nest down to the deck's back corners and out to its sides, a few ratlines
    for (const sx of [-1, 1]) {
      const foot: [number, number, number] = [x0 + sx * 2.4, 0.05, z0 - 0.2];
      const head: [number, number, number] = [x0 + sx * 0.12, 4.05, z0];
      p.push(
        part(strut(head, foot, 0.018), S.ropeDark, {
          tint: 0,
          rough: ROUGH.rope,
        }),
        part(
          strut(
            [x0 + sx * 0.1, top - 0.1, z0],
            [x0 + sx * 1.45, 3.3, z0 + 0.12],
            0.014,
          ),
          S.ropeDark,
          {
            tint: 0,
            rough: ROUGH.rope,
          },
        ),
      );
      for (let k = 1; k <= 5; k++) {
        const t = k / 6;
        const y = 0.05 + t * 4;
        const x = foot[0] + (head[0] - foot[0]) * t;
        p.push(
          part(
            strut(
              [x, y, z0 - 0.2 * (1 - t)],
              [x0 + (x - x0) * 0.4, y, z0 - 0.2 * (1 - t)],
              0.012,
              4,
            ),
            S.ropeDark,
            {
              tint: 0,
              rough: ROUGH.rope,
            },
          ),
        );
      }
    }
    // the pennant, two-coloured, streaming out from the masthead
    p.push(
      part(
        new ConeGeometry(0.16, 1.1, 3).rotateZ(Math.PI / 2).scale(1, 1, 0.12),
        S.red,
        {
          x: x0 + 0.6,
          z: z0,
          y: top - 0.15,
          tint: 0,
          rough: ROUGH.rope,
        },
      ),
    );
  }
  for (let i = 0; i < 6; i++)
    bulbs.push(
      part(
        new SphereGeometry(0.04, 6, 4),
        [0xffffff, 0xffd27a, 0x9fd8ff][i % 3],
        {
          x: r.range(-hw, hw),
          z: frontZ + r.range(-0.3, 0.3),
          y: 0.04,
          tint: 0,
        },
      ),
    );
  return { body: merge(p), bulbs: merge(bulbs) };
}

// ------------------------------------------------------------------ scenery

function scenery(ctx: SceneryCtx) {
  const { w, h, hx, hz, flat, quality } = ctx;
  const sea = new Sea(hx, hz, quality.name === 'low');
  const boats = new Mesh(
    shared(`sea-boats${w}x${h}`, () => boatsGeometry(hx, hz)),
    flat,
  );
  return {
    objects: [sea.mesh, boats],
    update: (t: number) => sea.update(t),
    ripple: (x: number, z: number, t: number) => sea.ripple(x, z, t),
    dispose: () => sea.dispose(),
  };
}

/** Level 3: a plank raft floating out at sea, moored barges for stands; in sudden death the deck falls into the sea. */
export const SEA_THEME: LevelTheme = {
  id: 'sea',
  sky: [S.skyTop, S.skyMid, S.skyLow],
  light: {
    key: 0xffe9c8,
    keyIntensity: 2.5,
    sky: 0xbfdcf5,
    ground: 0x4a8aa0,
    fill: 1.3,
    env: 0.2,
  },
  fx: FX,
  warnColor: 0xff5a2a,
  fall: 'tile',
  wallVariants: [],
  tiles: {
    colors: S.plank,
    geometry: plankTile,
    vertexColors: true,
    rotate: true,
    tint(_x, _y, r, out) {
      out.setScalar(r.range(0.9, 1.05));
      out.multiply(new Color(0xffffff).lerp(new Color(0xf4e8d0), r.next()));
    },
  },
  hard: [bollard, capstan],
  crate: [
    () =>
      woodCrateGeometry({
        crate: S.crate,
        band: S.crateBand,
        dark: S.crateDark,
      }),
    cargoBarrel,
  ],
  floor,
  decor,
  platformExtras: ({ w, h, flat }) => [
    new Mesh(
      sharedValue(`sea-frame${w}x${h}`, () => frame(w, h, 1.9)),
      flat,
    ),
  ],
  scenery,
  crowd: {
    ring: ringPoints,
    height: (tier) => treadY(tier),
    seat: (i, n) => boatAt(i, n),
  },
  motion(t, quality, out) {
    if (quality.name === 'low') {
      out.y = out.rx = out.rz = 0;
      return;
    }
    out.y = 0.04 * Math.sin(t * 0.9) + 0.02 * Math.sin(t * 1.7 + 2);
    out.rx = 0.011 * Math.sin(t * 0.7 + 1);
    out.rz = 0.014 * Math.sin(t * 0.55);
  },
};
