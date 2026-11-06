import { BufferAttribute, BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TyreId } from '../../physics/tyres';
import type { TyreSize } from '../../physics/types';
import {
  blurred,
  pitchesFor,
  RUBBER,
  sampleTread,
  tread,
  treadU,
} from './tyre-tread';

export { treadDepth, treadRubber, pitchesFor } from './tyre-tread';

/**
 * Tyre geometry for every car (wheel space: axis X, outer face towards +X, radius in the YZ plane).
 *
 * Draw with `tyreMaterial(compound)` (tyre-tread.ts). Parts:
 *   - carcass: both sidewalls as a ring mesh, bead -> rim protector -> sidewall bulge -> shoulder. The bead starts behind
 *     the rim flange and leaves it at the flange's edge (`fit`, measured from the rim), so the tyre meets the rim with no
 *     gap whatever the rim model.
 *   - tread band: across the crown and over the shoulders, a whole number of pattern pitches around. Its UVs map the
 *     compound's tread (tyre-tread.ts: normal map + groove shading carry the blocks, sipes and slots); the band is also
 *     displaced by the tread smoothed to the mesh's spacing, so the pattern shows in the silhouette.
 *   - lettering ring (compounds only, its own group / material): a thin ring just off the outer sidewall carrying the
 *     printed wordmark, tyre name and compound colour band (tyre-sidewall.ts).
 * `dust` greys the rubber (old road cars). ~11-13k triangles per tyre (4 per car).
 */

const RIM_INCH = 0.0254 / 2; // rim diameter inch -> radius (m)
/** Half width of the tread band (fraction of the half section width): the band runs over the shoulders. */
const BAND = 0.9;
/** Crown half width (fraction of the half section width): flat inside, rounding down to the shoulder outside. */
const CROWN = 0.6;
/** Carcass rings around (smooth shaded: the silhouette error is ~0.2 mm). */
const CARCASS_SEGMENTS = 64;
/** Tread band: columns across, and the target ring spacing around (m). */
const BAND_COLUMNS = 22;
const BAND_RING_SPACING = 0.012;
/** Lettering band on the outer sidewall (fractions of the sidewall height above the flange), segments around, and
 * how far it sits off the rubber (m). */
const LETTER_R0 = 0.22;
const LETTER_R1 = 0.7;
const LETTER_SEGMENTS = 64;
const LETTER_LIFT = 0.0006;
/** Share of the groove depth the band is displaced by (the rest is the normal map's). */
const DISPLACE = 0.85;

/** Where the tyre leaves the rim: the flange's outer radius (m) and its outer face (fraction of the half width). */
export interface TyreFit {
  lipR: number;
  lipA: number;
}

export interface TyreOptions {
  /** Overall radius (m) - the physics wheel radius; the sidewall fills the gap above the rim. */
  radius: number;
  size: TyreSize;
  compound: TyreId | null;
  /** Road dust on sidewalls and in grooves (old road cars). */
  dust?: boolean;
  /** The rim's flange (measured with `rimLip`); default: a generic flange 6% above the bead seat at 0.8 of the half width. */
  fit?: TyreFit;
}

/** Rim bead radius (m) of a size. */
export const rimRadius = (s: TyreSize): number => s.rim * RIM_INCH;

/**
 * The flange of a rim geometry in wheel space (metres, after scaling): the largest radius on the outer half, and how far
 * out (x) that edge sits, as a fit for a tyre of half width `hw`. Null if the rim has nothing on the outer half.
 */
export function rimLip(rim: BufferGeometry, hw: number): TyreFit | null {
  const pos = rim.getAttribute('position');
  if (!pos) return null;
  let lipR = 0;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getX(i) < hw * 0.4) continue;
    lipR = Math.max(lipR, Math.hypot(pos.getY(i), pos.getZ(i)));
  }
  if (!lipR) return null;
  let x = -Infinity;
  for (let i = 0; i < pos.count; i++)
    if (Math.hypot(pos.getY(i), pos.getZ(i)) > lipR - 0.004)
      x = Math.max(x, pos.getX(i));
  return { lipR, lipA: x / hw };
}

/** Ring mesh: `thetas` around (radians, ascending), `prof` across. Closed around unless `open` (the last ring then
 * repeats the first at 2pi: a UV seam). */
function ringMesh(
  thetas: number[],
  prof: { r: number; a: number }[],
  vertex: (
    i: number,
    k: number,
  ) => { r: number; c: [number, number, number]; uv?: [number, number] },
  /** Profile runs around the section the other way (the carcass: inner shoulder -> beads -> outer shoulder). */
  flip = false,
  open = false,
): BufferGeometry {
  const n = thetas.length;
  const m = prof.length;
  const pos = new Float32Array(n * m * 3);
  const col = new Float32Array(n * m * 3);
  const uv = new Float32Array(n * m * 2);
  for (let i = 0; i < n; i++) {
    const cs = Math.cos(thetas[i]);
    const sn = Math.sin(thetas[i]);
    for (let k = 0; k < m; k++) {
      const v = vertex(i, k);
      const o = (i * m + k) * 3;
      pos[o] = prof[k].a;
      pos[o + 1] = v.r * cs;
      pos[o + 2] = v.r * sn;
      col.set(v.c, o);
      if (v.uv) uv.set(v.uv, (i * m + k) * 2);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < (open ? n - 1 : n); i++) {
    const i1 = (i + 1) % n;
    for (let k = 0; k < m - 1; k++) {
      const a = i * m + k;
      const b = i1 * m + k;
      const c = i * m + k + 1;
      const d = i1 * m + k + 1;
      // Outward facing for a profile running from -x to +x.
      if (flip) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Average the normals of an open ring's seam ring (`rings`) and its first ring (they are the same points). */
function seamNormals(g: BufferGeometry, rings: number, m: number): void {
  const n = g.getAttribute('normal') as BufferAttribute;
  for (let k = 0; k < m; k++) {
    const a = k;
    const z = rings * m + k;
    const x = n.getX(a) + n.getX(z);
    const y = n.getY(a) + n.getY(z);
    const w = n.getZ(a) + n.getZ(z);
    const l = Math.hypot(x, y, w) || 1;
    n.setXYZ(a, x / l, y / l, w / l);
    n.setXYZ(z, x / l, y / l, w / l);
  }
}

/**
 * Make the band's edges and the carcass's shoulders one surface. The carcass has fewer segments around than the band
 * has rings, so its edge is a polygon of chords while the band's edge is (nearly) round: the sliver between them showed
 * as a hairline of sky. The band's edge vertices go onto the carcass's chords, and both edges get the same normals (the
 * average of the two), so there is no crack and no crease in the shading.
 */
function closeShoulders(
  carcass: BufferGeometry,
  band: BufferGeometry,
  segments: number,
  rings: number,
  cm: number,
  bm: number,
): void {
  const cp = carcass.getAttribute('position') as BufferAttribute;
  const cn = carcass.getAttribute('normal') as BufferAttribute;
  const bp = band.getAttribute('position') as BufferAttribute;
  const bn = band.getAttribute('normal') as BufferAttribute;
  const seg = (Math.PI * 2) / segments;
  // Normal in the section plane (radial, axial) of a vertex.
  const sectional = (p: BufferAttribute, n: BufferAttribute, j: number) => {
    const r = Math.hypot(p.getY(j), p.getZ(j)) || 1;
    return {
      nr: (n.getY(j) * p.getY(j) + n.getZ(j) * p.getZ(j)) / r,
      na: n.getX(j),
    };
  };
  // Each side: carcass profile index, band profile index.
  for (const [ck, bk] of [
    [0, 0],
    [cm - 1, bm - 1],
  ]) {
    const c = sectional(cp, cn, ck);
    const b = sectional(bp, bn, bk);
    let nr = c.nr + b.nr;
    let na = c.na + b.na;
    const l = Math.hypot(nr, na) || 1;
    nr /= l;
    na /= l;
    const set = (p: BufferAttribute, n: BufferAttribute, j: number) => {
      const y = p.getY(j);
      const z = p.getZ(j);
      const r = Math.hypot(y, z) || 1;
      n.setXYZ(j, na, (nr * y) / r, (nr * z) / r);
    };
    for (let i = 0; i <= segments; i++) set(cp, cn, i * cm + ck);
    for (let i = 0; i <= rings; i++) {
      const j = i * bm + bk;
      const y = bp.getY(j);
      const z = bp.getZ(j);
      // Onto the carcass chord this ring's angle falls in.
      const phi = Math.atan2(z, y);
      const off = phi - (Math.floor(phi / seg) + 0.5) * seg;
      const s = Math.cos(seg / 2) / Math.cos(off);
      bp.setY(j, y * s);
      bp.setZ(j, z * s);
      set(bp, bn, j);
    }
  }
  cp.needsUpdate = true;
  bp.needsUpdate = true;
}

/** Rubber colour relative to the material's (RUBBER: the tyre materials carry the base colour, so dust can tint it),
 * `dust` (0..1) greys it. */
function rubber(base: number, dust: number): [number, number, number] {
  return [
    (base + 0.028 * dust) / RUBBER,
    (base * 0.98 + 0.024 * dust) / RUBBER,
    (base * 1.04 + 0.019 * dust) / RUBBER,
  ];
}

/** Carcass rubber and its dust on `dust` tyres: 0.55..1 (noise, which averages 0.5). */
const CARCASS_RUBBER = 0.016;
const CARCASS_DUST_MEAN = 0.775;
/**
 * How much brighter (per channel, on average) the baked dust leaves a `dust` tyre's carcass than a clean one. The
 * per-car road dust (`dustyTyre`) divides its colour by it: the vertex colours multiply the material colour, so the
 * carcass then lands on the dust colour like a clean tyre's does, not up to twice it (near white).
 */
export const BAKED_DUST_GAIN: readonly [number, number, number] = (() => {
  const dusty = rubber(CARCASS_RUBBER, CARCASS_DUST_MEAN);
  const clean = rubber(CARCASS_RUBBER, 0);
  return [dusty[0] / clean[0], dusty[1] / clean[1], dusty[2] / clean[2]];
})();

export function buildTyre(o: TyreOptions): BufferGeometry {
  const R = o.radius;
  const hw = o.size.width / 2;
  const bead = rimRadius(o.size);
  const fit = o.fit ?? { lipR: bead * 1.06, lipA: 0.8 };
  const lipR = Math.min(Math.max(fit.lipR, bead), bead + (R - bead) * 0.45);
  const lipA = Math.min(Math.max(fit.lipA, 0.55), 0.96);
  const h = R - lipR;
  // Shoulder: how far the band's edge sits below the crown.
  const drop = Math.min(0.022, (R - bead) * 0.2);
  const surface = (aFrac: number) => {
    const x = Math.max(0, (Math.abs(aFrac) - CROWN) / (BAND - CROWN));
    return R - drop * x * x;
  };
  const noise = (phi: number, k: number) =>
    0.5 + 0.3 * Math.sin(phi * 3 + k * 1.7) + 0.2 * Math.sin(phi * 7 - k);

  // --- carcass (both sidewalls) ----------------------------------------------------------------------------------
  // Outer half profile, bead -> shoulder (radius, axial fraction). The bead sits behind the flange, leaves it at the
  // flange's edge, the rim protector rib bulges out just above it, the lettering sits on the widest part.
  // The first ring closes across the inside of the tyre: a few mm outside the rim barrel (which sits at `bead`), never on
  // it, or the two fight in depth and the barrel shows stripes between the spokes.
  const seat = Math.min(bead + 0.004, (bead + lipR - 0.003) / 2);
  const side: { r: number; a: number }[] = [
    { r: seat, a: lipA - 0.12 },
    { r: lipR - 0.003, a: lipA - 0.03 },
    { r: lipR + 0.002, a: lipA + 0.005 },
    { r: lipR + 0.07 * h, a: lipA + 0.62 * (1 - lipA) },
    { r: lipR + 0.13 * h, a: lipA + 0.8 * (1 - lipA) },
    { r: lipR + 0.2 * h, a: lipA + 0.76 * (1 - lipA) },
    { r: lipR + 0.33 * h, a: 0.985 },
    { r: lipR + 0.38 * h, a: 0.994 },
    { r: lipR + 0.46 * h, a: 0.996 },
    { r: lipR + 0.54 * h, a: 0.992 },
    { r: lipR + 0.62 * h, a: 0.985 },
    { r: lipR + 0.78 * h, a: 0.955 },
    { r: R - drop * 1.6, a: 0.915 },
    // meets the tread band's edge exactly (the band is not displaced there): no crack, no lip catching the light
    { r: R - drop, a: BAND },
  ];
  const carcassProf = [
    ...[...side].reverse().map((p) => ({ r: p.r, a: -p.a * hw })),
    ...side.map((p) => ({ r: p.r, a: p.a * hw })),
  ];
  // Open ring (a seam ring at 2pi) so the lettering ring's UVs can share the layout.
  const carcassT = Array.from(
    { length: CARCASS_SEGMENTS + 1 },
    (_, i) => (i / CARCASS_SEGMENTS) * Math.PI * 2,
  );
  const carcass = ringMesh(
    carcassT,
    carcassProf,
    (i, k) => ({
      r: carcassProf[k].r,
      c: rubber(
        CARCASS_RUBBER,
        o.dust ? 0.55 + 0.45 * noise(carcassT[i], k) : 0,
      ),
    }),
    true,
    true,
  );
  carcass.computeVertexNormals();
  seamNormals(carcass, CARCASS_SEGMENTS, carcassProf.length);

  // --- tread band ------------------------------------------------------------------------------------------------
  // A whole number of pitches around (u across the tread, v in pitches); rings ~BAND_RING_SPACING apart, a whole number
  // per pitch, and a seam ring repeating the first (v = pitches).
  const t = o.compound ? tread(o.compound) : null;
  const pitches = o.compound ? pitchesFor(o.compound, R) : 1;
  const perPitch = t
    ? Math.max(3, Math.round((Math.PI * 2 * R) / pitches / BAND_RING_SPACING))
    : CARCASS_SEGMENTS;
  const rings = pitches * perPitch;
  const bandT = Array.from(
    { length: rings + 1 },
    (_, i) => (i / rings) * Math.PI * 2,
  );
  const across = Array.from(
    { length: BAND_COLUMNS + 1 },
    (_, k) => (k / BAND_COLUMNS) * 2 - 1,
  );
  const bandProf = across.map((b) => ({
    r: surface(b * BAND),
    a: b * BAND * hw,
  }));
  // Displacement: the tread smoothed over the mesh's own spacing (no aliasing), scaled so the highest point is the
  // crown (R) and the lowest DISPLACE of the groove depth below it.
  let relief: Float32Array | null = null;
  const m = across.length;
  if (t) {
    const ry = Math.max(1, Math.round(t.rows / perPitch / 2));
    const rx = Math.max(1, Math.round((t.cols / BAND_COLUMNS) * 0.5));
    const soft = blurred(t, rx, ry);
    // One pitch of vertex samples (the rest repeat it).
    const one = new Float32Array(perPitch * m);
    for (let i = 0; i < perPitch; i++)
      for (let k = 0; k < m; k++)
        one[i * m + k] = sampleTread(t, soft, across[k], i / perPitch);
    let lo = Infinity;
    let hi = -Infinity;
    // Range over the crown (the shoulders sit lower anyway): its highest block is the overall radius.
    one.forEach((v, j) => {
      if (Math.abs(across[j % m]) * BAND > CROWN) return;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    });
    const span = Math.max(1e-6, hi - lo);
    relief = one.map(
      (v) => Math.max(0, Math.min(1, (hi - v) / span)) * t.depth * DISPLACE,
    );
  }
  const band = ringMesh(
    bandT,
    bandProf,
    (i, k) => {
      const phi = bandT[i];
      const b = across[k];
      const dust = o.dust ? 0.4 * noise(phi, k) : 0;
      return {
        r: bandProf[k].r,
        c: rubber(0.022, dust),
        uv: t ? [treadU(b), i / perPitch] : [0, 0],
      };
    },
    false,
    true,
  );
  // Normals of the smooth band (the normal map adds the pattern).
  band.computeVertexNormals();
  seamNormals(band, rings, m);
  if (relief) {
    const pos = band.getAttribute('position') as BufferAttribute;
    for (let i = 0; i <= rings; i++)
      for (let k = 0; k < m; k++) {
        const b = across[k];
        // Fades out at the band's edges (they tuck over the carcass).
        const edge = Math.min(1, (1 - Math.abs(b)) / 0.1);
        const d = relief[(i % perPitch) * m + k] * edge;
        const j = i * m + k;
        const r = Math.hypot(pos.getY(j), pos.getZ(j));
        const s = (r - d) / r;
        pos.setY(j, pos.getY(j) * s);
        pos.setZ(j, pos.getZ(j) * s);
      }
  }
  closeShoulders(carcass, band, CARCASS_SEGMENTS, rings, carcassProf.length, m);
  const tyre = mergeGeometries([carcass, band], false)!;
  carcass.dispose();
  band.dispose();
  if (!o.compound) return tyre;

  // --- lettering ring ------------------------------------------------------------------------------------------
  // A thin ring just off the outer sidewall over the lettering band (LETTER_R0..LETTER_R1 of the sidewall height),
  // u around (mirrored: the prints read left to right seen from outside), v across. Drawn with `sidewallMaterial`.
  const at = (r: number) => {
    for (let i = 1; i < side.length; i++)
      if (side[i].r >= r) {
        const p = side[i - 1];
        const q = side[i];
        return p.a + ((q.a - p.a) * (r - p.r)) / (q.r - p.r);
      }
    return side[side.length - 1].a;
  };
  const r0 = lipR + LETTER_R0 * h;
  const r1 = lipR + LETTER_R1 * h;
  const letterProf = Array.from({ length: 7 }, (_, k) => {
    const r = r0 + ((r1 - r0) * k) / 6;
    return { r, a: Math.min(hw, at(r) * hw + LETTER_LIFT) };
  });
  const letterT = Array.from(
    { length: LETTER_SEGMENTS + 1 },
    (_, i) => (i / LETTER_SEGMENTS) * Math.PI * 2,
  );
  const letters = ringMesh(
    letterT,
    letterProf,
    (i, k) => ({
      r: letterProf[k].r,
      c: [1, 1, 1],
      uv: [1 - i / LETTER_SEGMENTS, k / 6],
    }),
    true,
    true,
  );
  letters.computeVertexNormals();
  seamNormals(letters, LETTER_SEGMENTS, letterProf.length);
  const out = mergeGeometries([tyre, letters], true)!;
  tyre.dispose();
  letters.dispose();
  return out;
}
