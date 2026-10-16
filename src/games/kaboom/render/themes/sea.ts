import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  LatheGeometry,
  Mesh,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
} from 'three';
import { Rng, hash3 } from '../../../../shared/rng';
import { boatAt, boatsGeometry } from '../boats';
import { ringPoints, treadY } from '../bowl';
import { Sea } from '../sea';
import {
  box,
  merge,
  part,
  rbox,
  rock,
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
  ironLight: 0x65686f,
  ironDark: 0x2c2e33,
  rope: 0xc9b58a,
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
  const p: BufferGeometry[] = [];
  for (let i = 0; i < 4; i++)
    p.push(
      part(box(0.232, 0.2, 0.97), S.plank[i], {
        x: (i - 1.5) * 0.2425,
        y: -0.1,
        tint: 0.12,
      }),
    );
  return merge(p);
}

/** The margin round the playing field: a plank deck with a hole where the tiles go, plank seams drawn on it. */
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

/** What the raft rides on: dark stringers under the deck (seen through a hole), barrels lashed round the rim. */
function frame(w: number, h: number, pad: number): BufferGeometry {
  const hw = w / 2;
  const hh = h / 2;
  const p: BufferGeometry[] = [];
  for (let y = 0; y <= h; y++)
    p.push(
      part(box(w + 0.1, 0.12, 0.13), S.beam, { z: y - hh, y: -0.3, tint: 0.2 }),
    );
  for (let x = 0; x <= w; x++)
    p.push(
      part(box(0.13, 0.12, h + 0.1), S.beam, {
        x: x - hw,
        y: -0.42,
        tint: 0.2,
      }),
    );
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

/** Hard block 0: an iron mooring bollard on a riveted plate, rope wound round its neck. */
function bollard(): BufferGeometry {
  return merge([
    part(rbox(0.92, 0.1, 0.92, 0.03), S.ironDark, { y: 0.05 }),
    part(new CylinderGeometry(0.3, 0.36, 0.8, 10), S.iron, {
      y: 0.5,
      tint: 0.1,
    }),
    part(new CylinderGeometry(0.42, 0.34, 0.16, 10), S.ironLight, { y: 0.98 }),
    part(torus(0.35, 0.05), S.rope, { y: 0.34, tint: 0.2 }),
    part(torus(0.34, 0.05), S.rope, { y: 0.5, tint: 0.2 }),
    part(torus(0.33, 0.05), S.rope, { y: 0.66, tint: 0.2 }),
  ]);
}

/** Hard block 1: a capstan with spokes and a coil of anchor chain at its foot. */
function capstan(): BufferGeometry {
  const p: BufferGeometry[] = [
    part(rbox(0.95, 0.1, 0.95, 0.03), S.ironDark, { y: 0.05 }),
    part(new CylinderGeometry(0.34, 0.4, 0.7, 10), S.iron, {
      y: 0.45,
      tint: 0.1,
    }),
    part(new CylinderGeometry(0.46, 0.46, 0.1, 10), S.ironLight, { y: 0.85 }),
    part(torus(0.42, 0.07), S.ironDark, { y: 0.15 }),
    part(torus(0.4, 0.07), S.hoop, { y: 0.24 }),
  ];
  for (let i = 0; i < 4; i++)
    p.push(
      part(box(0.86, 0.07, 0.07), S.rope, {
        y: 0.97,
        ry: (i * Math.PI) / 4,
        tint: 0.15,
      }),
    );
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
  p.push(part(box(0.07, 2.6, 0.07), S.beam, { x: 0, z: backZ, y: 1.3 }));
  p.push(part(box(0.7, 0.4, 0.02), S.red, { x: 0.36, z: backZ, y: 2.4 }));
  p.push(part(box(0.7, 0.14, 0.021), S.white, { x: 0.36, z: backZ, y: 2.4 }));
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
    keyIntensity: 2.4,
    sky: 0xbfdcf5,
    ground: 0x4a8aa0,
    fill: 1.3,
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
