import {
  BufferAttribute,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  OctahedronGeometry,
  PlaneGeometry,
  type BufferGeometry,
} from 'three';
import { Rng } from '../../../../shared/rng';
import {
  cylindricalUV,
  displaceRadial,
  foliageNormals,
  merge,
  paint,
  planarUV,
  shade,
} from '../../engine/geo';
import { getMaterial, type MaterialId } from '../../engine/materials';
import type { AssetBuilder } from '../types';

/**
 * Trees / bushes / grass. All vegetation of a kind is ONE merged geometry with
 * vertex colours + the shared 'vegetation' material = one draw call per
 * (asset, variant, LOD) for any number of instances.
 */

/** Jagged-bottom cone layer for conifers. */
function coneLayer(
  rng: Rng,
  radius: number,
  height: number,
  segs: number,
  jag: number,
): BufferGeometry {
  const g = new ConeGeometry(radius, height, segs, 1, false);
  const p = g.getAttribute('position');
  const phase = rng.next() * 100;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y > -height / 2 + 1e-3) continue; // only the bottom ring + cap
    const x = p.getX(i);
    const z = p.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-3) continue;
    // Deterministic by angle so duplicated seam vertices move together.
    const a = Math.atan2(z, x);
    const k =
      1 +
      jag * Math.sin(a * 3 + phase) * 0.6 +
      jag * Math.sin(a * 7 + phase * 2) * 0.4;
    p.setXYZ(
      i,
      x * k,
      y - jag * height * 0.35 * (0.5 + 0.5 * Math.sin(a * 5 + phase)),
      z * k,
    );
  }
  return g;
}

export const pineTree: AssetBuilder = ({ seed, lod }) => {
  const rng = new Rng(seed);
  const spruce = seed % 2 === 0;
  const H = rng.range(10, 14);
  const parts: BufferGeometry[] = [];
  const trunkH = H * 0.92;
  // The far LOD is a single cone: the trunk is hidden inside it / sub-pixel.
  if (lod < 2) {
    const trunk = new CylinderGeometry(
      0.07,
      0.24,
      trunkH,
      lod === 0 ? 7 : 5,
      1,
      lod > 0,
    );
    trunk.translate(0, trunkH / 2, 0);
    parts.push(
      cylindricalUV(
        paint(trunk, spruce ? '#4a372a' : '#6b4630', rng, 0.05),
        0.4,
        2,
      ),
    );
  }

  const layers = [8, 4, 1][lod] ?? 1;
  const segs = [9, 6, 5][lod] ?? 5;
  const y0 = H * (spruce ? 0.1 : 0.38);
  const maxR = spruce ? rng.range(2.1, 2.7) : rng.range(1.9, 2.5);
  const span = H - y0;
  for (let k = 0; k < layers; k++) {
    const t = layers === 1 ? 0 : k / (layers - 1);
    const r = maxR * (1 - t) ** 0.85 + 0.35;
    const h = (span / layers) * (layers > 2 ? 2.4 : 1.6);
    const cone = coneLayer(rng, r, h, segs, lod === 0 ? 0.22 : 0.12);
    cone.rotateY(rng.next() * Math.PI);
    const y = y0 + span * t * 0.88 + h / 2;
    cone.translate(rng.range(-0.1, 0.1), y, rng.range(-0.1, 0.1));
    const g = paint(cone, spruce ? '#24402a' : '#2f4a28', rng, 0.12);
    foliageNormals(g, 0, 0, 0.55);
    planarUV(g, 0.9);
    // Fake AO: lower layers + undersides darker.
    shade(
      g,
      (_x, py) =>
        0.62 +
        0.38 *
          Math.min(1, (py - y0) / span + 0.25) *
          (py > y - h * 0.45 ? 1 : 0.75),
    );
    parts.push(g);
  }
  return {
    parts: [{ geometry: merge(parts), material: getMaterial('vegetation') }],
  };
};

export const birchTree: AssetBuilder = ({ seed, lod }) => {
  const rng = new Rng(seed);
  const H = rng.range(8, 11);
  const parts: BufferGeometry[] = [];
  if (lod < 2) {
    const trunk = new CylinderGeometry(
      0.06,
      0.15,
      H * 0.85,
      lod === 0 ? 6 : 4,
      lod === 0 ? 3 : 1,
      lod > 0,
    );
    trunk.translate(0, (H * 0.85) / 2, 0);
    const tg = paint(trunk, '#d9d6cc', rng, 0.04);
    // Black birch marks via vertex colour bands.
    shade(tg, (_x, y) => (Math.sin(y * 7.3 + seed) > 0.85 ? 0.3 : 1));
    parts.push(cylindricalUV(tg, 0.6, 2));
  }
  const clumps = [7, 3, 1][lod] ?? 1;
  const detail = lod === 0 ? 1 : 0;
  for (let i = 0; i < clumps; i++) {
    const r = clumps === 1 ? 2.6 : rng.range(1.3, 2.0);
    const g =
      lod >= 2
        ? new OctahedronGeometry(r, 0)
        : new IcosahedronGeometry(r, detail);
    const ph = rng.next() * 10;
    displaceRadial(
      g,
      (x, y, z) =>
        Math.sin(x * 2.1 + ph) * Math.sin(y * 1.7 + z * 2.3) * 0.28 * r,
    );
    g.scale(1, 0.85, 1);
    const a = rng.next() * Math.PI * 2;
    const d = clumps === 1 ? 0 : rng.range(0.4, 1.4);
    g.translate(Math.cos(a) * d, H * rng.range(0.62, 0.9), Math.sin(a) * d);
    const cg = paint(g, rng.pick(['#6c8a37', '#7c9640', '#5f7e33']), rng, 0.1);
    foliageNormals(cg, 0, 0, 0.8);
    planarUV(cg, 0.8);
    shade(cg, (_x, y) => 0.7 + 0.3 * Math.min(1, (y - H * 0.5) / (H * 0.5)));
    parts.push(cg);
  }
  return {
    parts: [{ geometry: merge(parts), material: getMaterial('vegetation') }],
  };
};

const makeBush =
  (colors: string[], flatten: number): AssetBuilder =>
  ({ seed, lod }) => {
    const rng = new Rng(seed);
    const parts: BufferGeometry[] = [];
    const clumps = lod === 0 ? rng.int(3, 5) : 1;
    for (let i = 0; i < clumps; i++) {
      // The far LOD is one bigger blob instead of a cluster.
      const r = rng.range(0.45, 0.85) * (lod === 0 ? 1 : 1.5);
      const g = new IcosahedronGeometry(r, lod === 0 ? 1 : 0);
      const ph = rng.next() * 10;
      displaceRadial(
        g,
        (x, y, z) => Math.sin(x * 4 + ph) * Math.sin(y * 3 + z * 4) * 0.25 * r,
      );
      g.scale(1, flatten, 1);
      g.translate(rng.range(-0.5, 0.5), r * 0.55, rng.range(-0.5, 0.5));
      const cg = paint(g, rng.pick(colors), rng, 0.12);
      foliageNormals(cg, 0, 0, 0.9);
      planarUV(cg, 1.5);
      shade(cg, (_x, y) => 0.6 + 0.4 * Math.min(1, y / 0.9));
      parts.push(cg);
    }
    return {
      parts: [{ geometry: merge(parts), material: getMaterial('vegetation') }],
    };
  };

export const bush = makeBush(['#3f5f2a', '#4d6b30', '#56702f'], 0.75);

/** Mediterranean hill scrub (juniper / blackthorn / Christ's thorn): dark olive, low and wide. */
export const scrubBush = makeBush(
  ['#3a4526', '#434d2a', '#4a4f2c', '#353f24'],
  0.6,
);

export const grassTuft: AssetBuilder = ({ seed }) => {
  const rng = new Rng(seed);
  const parts: BufferGeometry[] = [];
  const w = rng.range(0.8, 1.1);
  const h = rng.range(0.38, 0.55);
  for (let i = 0; i < 3; i++) {
    const g = new PlaneGeometry(w, h);
    g.translate(0, h / 2, 0);
    g.rotateY((i * Math.PI) / 3 + rng.next() * 0.3);
    const pg = paint(g, rng.pick(['#c8d0a0', '#b8c48c', '#d8d0a0']));
    // Normals straight up: grass is lit like the ground under it (no dark backfaces).
    const n = pg.getAttribute('normal') as BufferAttribute;
    for (let k = 0; k < n.count; k++) n.setXYZ(k, 0, 1, 0);
    // Darker at the roots.
    shade(pg, (_x, y) => 0.55 + 0.45 * Math.min(1, y / h));
    parts.push(pg);
  }
  return {
    parts: [{ geometry: merge(parts), material: getMaterial('foliage_card') }],
  };
};

/** Round clumped canopy on a short trunk (shared by fruit trees and oaks). */
function broadleaf(
  rng: Rng,
  lod: number,
  o: {
    height: number;
    trunkTop: number;
    trunkR: number;
    crownR: number;
    flatten: number;
    clumps: number;
    colors: string[];
    bark: string;
    lean?: number;
    /** Crown clumps at LOD1 (default 3): orchards use 1 - thousands of rows in the 90-400 m band. */
    lod1Clumps?: number;
  },
): BufferGeometry {
  const parts: BufferGeometry[] = [];
  // Far LOD: tall trunks vanish (sub-pixel), short ones (orchards) keep a 3-sided stub.
  if (lod < 2 || o.trunkTop <= 2) {
    const trunk = new CylinderGeometry(
      o.trunkR * 0.55,
      o.trunkR,
      o.trunkTop,
      lod === 0 ? 6 : lod === 1 ? 4 : 3,
      1,
      lod > 0,
    );
    trunk.translate(0, o.trunkTop / 2, 0);
    parts.push(cylindricalUV(paint(trunk, o.bark, rng, 0.06), 0.5, 1.5));
  }
  if (lod === 0) {
    // A few main branches into the crown.
    for (let i = 0; i < 3; i++) {
      const L = o.crownR * rng.range(0.7, 1.1);
      const br = new CylinderGeometry(o.trunkR * 0.25, o.trunkR * 0.5, L, 4);
      br.translate(0, L / 2, 0);
      br.rotateZ(rng.range(0.5, 0.9));
      br.rotateY((i / 3) * Math.PI * 2 + rng.next());
      br.translate(0, o.trunkTop * 0.92, 0);
      parts.push(cylindricalUV(paint(br, o.bark, rng, 0.06), 0.5, 1));
    }
  }
  const clumps =
    lod === 0
      ? o.clumps
      : lod === 1
        ? Math.min(o.lod1Clumps ?? 3, o.clumps)
        : 1;
  const cy = o.trunkTop + (o.height - o.trunkTop) * 0.5;
  for (let i = 0; i < clumps; i++) {
    const r = clumps === 1 ? o.crownR : o.crownR * rng.range(0.5, 0.72);
    const g =
      lod >= 2
        ? new OctahedronGeometry(r, 0)
        : new IcosahedronGeometry(r, lod === 0 ? 1 : 0);
    const ph = rng.next() * 10;
    displaceRadial(
      g,
      (x, y, z) =>
        Math.sin(x * 2.3 + ph) * Math.sin(y * 1.9 + z * 2.1) * 0.25 * r,
    );
    g.scale(1, o.flatten, 1);
    const a = rng.next() * Math.PI * 2;
    const d = clumps === 1 ? 0 : o.crownR * rng.range(0.25, 0.55);
    g.translate(
      Math.cos(a) * d + (o.lean ?? 0),
      cy + rng.range(-0.25, 0.3) * (o.height - o.trunkTop) * 0.5,
      Math.sin(a) * d,
    );
    const cg = paint(g, rng.pick(o.colors), rng, 0.1);
    foliageNormals(cg, 0, 0, 0.8);
    planarUV(cg, 0.8);
    shade(
      cg,
      (_x, y) =>
        0.62 +
        0.38 *
          Math.min(1, Math.max(0, (y - o.trunkTop) / (o.height - o.trunkTop))),
    );
    parts.push(cg);
  }
  return merge(parts);
}

/** Orchard / garden fruit tree (apple, plum, cherry): short trunk, wide round crown. */
export const fruitTree: AssetBuilder = ({ seed, lod }) => {
  const rng = new Rng(seed);
  const H = rng.range(3.4, 4.8);
  const geometry = broadleaf(rng, lod, {
    height: H,
    trunkTop: rng.range(0.9, 1.3),
    trunkR: 0.11,
    crownR: rng.range(1.5, 2.1),
    flatten: 0.78,
    clumps: 5,
    colors: ['#5d7a2e', '#6b8435', '#557030', '#728a3a'],
    bark: '#5a4636',
    lod1Clumps: 1,
  });
  return { parts: [{ geometry, material: getMaterial('vegetation') }] };
};

/** Field / gully oak: broad irregular crown, the common broadleaf on Macedonian hills. */
export const oakTree: AssetBuilder = ({ seed, lod }) => {
  const rng = new Rng(seed);
  const H = rng.range(7, 11);
  const geometry = broadleaf(rng, lod, {
    height: H,
    trunkTop: H * rng.range(0.32, 0.42),
    trunkR: 0.26,
    crownR: rng.range(2.8, 4),
    flatten: 0.72,
    clumps: 7,
    colors: ['#4c6428', '#566e2c', '#465d26', '#5f7431'],
    bark: '#4f4236',
    lean: rng.range(-0.4, 0.4),
  });
  return { parts: [{ geometry, material: getMaterial('vegetation') }] };
};

/** Lombardy poplar: tall narrow column, planted along canals, roads and field edges. */
export const poplarTree: AssetBuilder = ({ seed, lod }) => {
  const rng = new Rng(seed);
  const H = rng.range(15, 22);
  const parts: BufferGeometry[] = [];
  if (lod < 2) {
    const trunk = new CylinderGeometry(
      0.1,
      0.32,
      H * 0.9,
      lod === 0 ? 6 : 4,
      1,
      lod > 0,
    );
    trunk.translate(0, (H * 0.9) / 2, 0);
    parts.push(cylindricalUV(paint(trunk, '#7b7568', rng, 0.05), 0.5, 3));
  }
  const n = [9, 4, 1][lod] ?? 1;
  const R = rng.range(1.4, 1.9);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const y = H * (0.2 + 0.72 * t);
    // Spindle: widest a third of the way up.
    const r =
      R *
      (n === 1
        ? 1
        : Math.max(0.35, Math.sin(Math.PI * (0.15 + 0.8 * (1 - t) ** 0.8))));
    const g =
      lod >= 2
        ? new OctahedronGeometry(1, 0)
        : new IcosahedronGeometry(1, lod === 0 ? 1 : 0);
    const ph = rng.next() * 10;
    displaceRadial(
      g,
      (x, yy, z) => Math.sin(x * 5 + ph) * Math.sin(yy * 4 + z * 5) * 0.12,
    );
    // Overlapping slices -> one continuous column.
    const hh = n === 1 ? H * 0.42 : (H * 1.25) / n;
    g.scale(r, hh, r);
    g.translate(rng.range(-0.15, 0.15), y, rng.range(-0.15, 0.15));
    const cg = paint(g, rng.pick(['#3e5426', '#44592a', '#3a4f22']), rng, 0.08);
    foliageNormals(cg, 0, 0, 0.7);
    planarUV(cg, 0.8);
    shade(cg, (_x, yy) => 0.65 + 0.35 * Math.min(1, yy / H));
    parts.push(cg);
  }
  return {
    parts: [{ geometry: merge(parts), material: getMaterial('vegetation') }],
  };
};

/**
 * Crossed grass cards (same construction as grass_tuft) where the card TEXTURE carries
 * the colour; the near-white vertex colours only vary it a little.
 */
function colouredGrass(
  material: MaterialId,
  height: [number, number],
  colors: string[],
): AssetBuilder {
  return ({ seed }) => {
    const rng = new Rng(seed);
    const parts: BufferGeometry[] = [];
    const w = rng.range(0.7, 1.05);
    const h = rng.range(height[0], height[1]);
    for (let i = 0; i < 3; i++) {
      const g = new PlaneGeometry(w, h);
      g.translate(0, h / 2, 0);
      g.rotateY((i * Math.PI) / 3 + rng.next() * 0.3);
      const pg = paint(g, rng.pick(colors));
      const nrm = pg.getAttribute('normal') as BufferAttribute;
      for (let k = 0; k < nrm.count; k++) nrm.setXYZ(k, 0, 1, 0);
      shade(pg, (_x, y) => 0.6 + 0.4 * Math.min(1, y / h));
      parts.push(pg);
    }
    return {
      parts: [{ geometry: merge(parts), material: getMaterial(material) }],
    };
  };
}

/** Dry summer grass (golden). */
export const dryGrass = colouredGrass(
  'foliage_card_dry',
  [0.45, 0.7],
  ['#ffffff', '#f1eadb', '#e6dcc4', '#fff6e4'],
);

/** Fresh spring grass (bright green), for maps with a green `groundTint`. */
export const springGrass = colouredGrass(
  'foliage_card_spring',
  [0.3, 0.5],
  ['#ffffff', '#eef3dc', '#f6f2d4', '#e4eecf'],
);

/**
 * Austrian black pine (Pinus nigra): straight trunk, flat-topped umbrella crown of a few dark clumps, the pine
 * of the Macedonian hill plantations (the conical `pine_tree` is a spruce / Scots pine).
 */
export const blackPine: AssetBuilder = ({ seed, lod }) => {
  const rng = new Rng(seed);
  const H = rng.range(9, 13);
  const parts: BufferGeometry[] = [];
  const trunkH = H * 0.9;
  const trunk = new CylinderGeometry(
    0.1,
    0.3,
    trunkH,
    lod === 0 ? 7 : 5,
    1,
    lod > 0,
  );
  trunk.translate(0, trunkH / 2, 0);
  parts.push(cylindricalUV(paint(trunk, '#5b4331', rng, 0.06), 0.5, 3));
  const clumps = [5, 3, 1][lod] ?? 1;
  for (let i = 0; i < clumps; i++) {
    const t = clumps === 1 ? 0.5 : i / (clumps - 1);
    const r = clumps === 1 ? 2.8 : rng.range(1.7, 2.7) * (1 - 0.35 * t);
    const g = new IcosahedronGeometry(r, lod === 0 ? 1 : 0);
    const ph = rng.next() * 10;
    displaceRadial(
      g,
      (x, y, z) =>
        Math.sin(x * 2.4 + ph) * Math.sin(y * 2.1 + z * 2.6) * 0.28 * r,
    );
    g.scale(1.15, 0.42, 1.15);
    const a = rng.next() * Math.PI * 2;
    const d = clumps === 1 ? 0 : rng.range(0.4, 1.6) * (1 - 0.5 * t);
    g.translate(
      Math.cos(a) * d,
      H * (0.66 + 0.3 * t) + rng.range(-0.2, 0.2),
      Math.sin(a) * d,
    );
    const cg = paint(g, rng.pick(['#26402a', '#2d4a2e', '#223a26']), rng, 0.1);
    foliageNormals(cg, 0, 0, 0.75);
    planarUV(cg, 0.8);
    shade(cg, (_x, y) => 0.62 + 0.38 * Math.min(1, y / H));
    parts.push(cg);
  }
  return {
    parts: [{ geometry: merge(parts), material: getMaterial('vegetation') }],
  };
};

/** Juniper / cypress-like dark conical shrub (hill slopes, cemeteries): 2-3.5 m, dense. */
export const juniper: AssetBuilder = ({ seed, lod }) => {
  const rng = new Rng(seed);
  const parts: BufferGeometry[] = [];
  const layers = [3, 2, 1][lod] ?? 1;
  const H = rng.range(2.2, 3.6);
  for (let i = 0; i < layers; i++) {
    const t = layers === 1 ? 0 : i / (layers - 1);
    const r =
      (layers === 1 ? 0.9 : 1.05 * (1 - 0.55 * t)) * rng.range(0.9, 1.15);
    const h = layers === 1 ? H : (H / layers) * 1.7;
    const g = new ConeGeometry(r, h, lod === 0 ? 8 : 5, 1, false);
    displaceRadial(
      g,
      (x, y, z) => Math.sin(x * 6 + y * 3 + seed) * Math.sin(z * 5) * 0.08,
    );
    g.translate(0, (layers === 1 ? 0 : t * H * 0.55) + h / 2, 0);
    const cg = paint(g, rng.pick(['#2c4a3c', '#314f40', '#274236']), rng, 0.1);
    foliageNormals(cg, 0, 0, 0.5);
    planarUV(cg, 0.9);
    shade(cg, (_x, y) => 0.6 + 0.4 * Math.min(1, y / H));
    parts.push(cg);
  }
  return {
    parts: [{ geometry: merge(parts), material: getMaterial('vegetation') }],
  };
};

/** Walnut / mulberry: the big round yard tree of the villages, dense dark crown on a thick trunk. */
export const walnutTree: AssetBuilder = ({ seed, lod }) => {
  const rng = new Rng(seed);
  const H = rng.range(8, 12);
  const geometry = broadleaf(rng, lod, {
    height: H,
    trunkTop: H * rng.range(0.25, 0.32),
    trunkR: 0.32,
    crownR: rng.range(4, 5.4),
    flatten: 0.82,
    clumps: 8,
    colors: ['#46652a', '#3f5d27', '#4d6c2e', '#3a5724'],
    bark: '#5a4a3b',
    lean: rng.range(-0.3, 0.3),
  });
  return { parts: [{ geometry, material: getMaterial('vegetation') }] };
};

/** Willow: pale grey-green crown with long drooping curtains, the tree of the canals and drains. */
export const willowTree: AssetBuilder = ({ seed, lod }) => {
  const rng = new Rng(seed);
  const H = rng.range(7, 10);
  const parts: BufferGeometry[] = [];
  parts.push(
    broadleaf(rng, lod, {
      height: H,
      trunkTop: H * 0.3,
      trunkR: 0.3,
      crownR: rng.range(3.2, 4.2),
      flatten: 0.7,
      clumps: 6,
      colors: ['#88a24a', '#7c9a45', '#93a950'],
      bark: '#5b5040',
      lean: rng.range(-0.5, 0.5),
    }),
  );
  if (lod < 2) {
    // Drooping curtains hanging from the crown edge.
    const n = lod === 0 ? 10 : 5;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng.next() * 0.3;
      const d = rng.range(1.9, 3.1);
      const g = new IcosahedronGeometry(0.55, 0);
      g.scale(1, 3.2, 1);
      g.translate(Math.cos(a) * d, H * 0.52, Math.sin(a) * d);
      const cg = paint(g, rng.pick(['#9db253', '#8fa84d']), rng, 0.08);
      foliageNormals(cg, 0, 0, 0.4);
      planarUV(cg, 0.8);
      shade(cg, (_x, y) => 0.7 + 0.3 * Math.min(1, y / H));
      parts.push(cg);
    }
  }
  return {
    parts: [{ geometry: merge(parts), material: getMaterial('vegetation') }],
  };
};

/** Tall golden reed cards (canal and drain banks). */
export const reeds = colouredGrass(
  'foliage_card_dry',
  [1.3, 2.1],
  ['#f1e6c4', '#e6d9b0', '#d9ca9a', '#f6eccf'],
);

/** Tall dry weeds / thistles (field margins, ditches): between grass and reeds. */
export const tallWeeds = colouredGrass(
  'foliage_card_dry',
  [0.8, 1.35],
  ['#e6dcc4', '#d9c9a5', '#efe4c8', '#cdbd95'],
);
