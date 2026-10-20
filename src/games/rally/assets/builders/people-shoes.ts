import { BONE, BONES, RIGS, type BodyModel } from './people-body';
import { cellUV, SHOE, SOLE } from './people-parts';
import { normals, solid, type Surf } from './people-surf';
import type { ShoeKind } from './people-looks';

/**
 * Shoes. The base bodies end at the ankle (no feet), so a shoe is a loft built round the foot's axis: rings along the
 * foot (heel to toe) of a squared ellipse, an upper over a thicker sole, and for boots a shaft round the shin. Each
 * rides its foot bone, so it pitches with the stride.
 */

interface Shape {
  /** Foot length, widest width (m). */
  length: number;
  width: number;
  /** Upper height above the sole at the heel, the instep and the toe (m). */
  heel: number;
  instep: number;
  toe: number;
  sole: number;
  /** Collar round the ankle: radius and top above the sole (m); a boot's shaft is the same with a taller top. */
  collarR: number;
  collarTop: number;
}

const KINDS: Record<ShoeKind, Shape> = {
  sneaker: {
    length: 0.27,
    width: 0.1,
    heel: 0.06,
    instep: 0.088,
    toe: 0.046,
    sole: 0.026,
    collarR: 0.052,
    collarTop: 0.093,
  },
  shoe: {
    length: 0.275,
    width: 0.094,
    heel: 0.054,
    instep: 0.076,
    toe: 0.04,
    sole: 0.022,
    collarR: 0.05,
    collarTop: 0.093,
  },
  boot: {
    length: 0.285,
    width: 0.106,
    heel: 0.07,
    instep: 0.096,
    toe: 0.056,
    sole: 0.032,
    collarR: 0.064,
    collarTop: 0.17,
  },
  flat: {
    length: 0.25,
    width: 0.086,
    heel: 0.04,
    instep: 0.054,
    toe: 0.032,
    sole: 0.012,
    collarR: 0.05,
    collarTop: 0.093,
  },
};

const sgn = (x: number): number => (x < 0 ? -1 : 1);

/** A grid of rings (stations along z) x (points round), as a surface on `bone`. */
function loft(
  stations: number,
  ring: number,
  at: (s: number, r: number) => [number, number, number],
  bone: number,
  color: string,
  cell: number,
  uvOf: (s: number, r: number, p: [number, number, number]) => [number, number],
): Surf {
  const n = (stations + 1) * ring;
  const pos = new Float32Array(n * 3);
  const w = new Float32Array(n * BONES);
  const uv = new Float32Array(n * 2);
  for (let k = 0; k <= stations; k++)
    for (let j = 0; j < ring; j++) {
      const i = k * ring + j;
      const p = at(k / stations, j / ring);
      pos.set(p, i * 3);
      w[i * BONES + bone] = 1;
      const [fu, fv] = uvOf(k / stations, j / ring, p);
      const [u, v] = cellUV(cell, fu, fv);
      uv[i * 2] = u;
      uv[i * 2 + 1] = v;
    }
  const idx: number[] = [];
  for (let k = 0; k < stations; k++)
    for (let j = 0; j < ring; j++) {
      const a = k * ring + j;
      const b = k * ring + ((j + 1) % ring);
      idx.push(a, a + ring, b, b, a + ring, b + ring);
    }
  const s: Surf = {
    n,
    idx,
    a: {
      pos,
      nor: new Float32Array(n * 3),
      w,
      arm: new Float32Array(n),
      uv,
      color: solid(n, color),
    },
  };
  s.a.nor = normals(s);
  return s;
}

/** Winding so the faces look outwards (the loft rings run round the foot's axis). */
function outwards(
  s: Surf,
  axis: (i: number) => [number, number, number],
): Surf {
  let sum = 0;
  for (let i = 0; i < s.n; i++) {
    const c = axis(i);
    sum +=
      s.a.nor[i * 3] * (s.a.pos[i * 3] - c[0]) +
      s.a.nor[i * 3 + 1] * (s.a.pos[i * 3 + 1] - c[1]) +
      s.a.nor[i * 3 + 2] * (s.a.pos[i * 3 + 2] - c[2]);
  }
  if (sum >= 0) return s;
  const idx = s.idx.slice();
  for (let q = 0; q < idx.length; q += 3)
    [idx[q + 1], idx[q + 2]] = [idx[q + 2], idx[q + 1]];
  const out = { ...s, idx };
  out.a = { ...out.a, nor: normals(out) };
  return out;
}

const sstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The pair of shoes, in the rest frame (pelvis origin) of a model, on the foot bones. */
export function shoesOf(
  m: BodyModel,
  kind: ShoeKind,
  upper: string,
  soleColor: string,
  hi = true,
): Surf[] {
  const rig = RIGS[m];
  const k = KINDS[kind];
  const out: Surf[] = [];
  // The legs end in a stump a few cm above the floor: the shoe covers it, its sole is on the floor (y = 0 in the model).
  const ground = -rig.hip;
  const ax = rig.ankleJ[0];
  const az = rig.ankleJ[2];
  const heelZ = az - 0.06;
  // The ankle's ellipse in the base mesh (centre z, x and z radii as a share of the collar radius).
  const ank =
    m === 'male'
      ? { z: -0.015, x: 0.78, d: 1.1 }
      : { z: -0.004, x: 0.68, d: 0.95 };
  const stations = hi ? 14 : 7;
  const ring = hi ? 16 : 8;
  // Stations bunch up at the heel and the toe, where the plan curves fastest.
  const sp = (st: number): number => (1 - Math.cos(st * Math.PI)) / 2;
  for (const sd of [1, -1]) {
    const bone = sd > 0 ? BONE.footL : BONE.footR;
    const cx = ax * sd;
    // Plan and height along the foot (s: 0 heel -> 1 toe): a rounded plan, the upper rising to the instep.
    const prof = (s: number): { w: number; h: number; zc: number } => {
      const t = s * 2 - 1;
      const round = Math.sqrt(
        Math.max(0, 1 - Math.pow(Math.abs(t), s > 0.5 ? 3.2 : 2.4)),
      );
      const w = k.width * (0.62 + 0.38 * sstep(0, 0.55, s)) * round;
      const rise = k.heel + (k.instep - k.heel) * sstep(0, 0.42, s);
      const h =
        (rise + (k.toe - k.instep) * sstep(0.42, 1, s)) *
        Math.sqrt(Math.max(0.0025, 1 - Math.pow(Math.abs(t), 6)));
      return { w: Math.max(w, 0.001), h, zc: heelZ + k.length * s };
    };
    // Upper: a dome, flat under, from the sole's top.
    const dome = loft(
      stations,
      ring,
      (st, r) => {
        const p = prof(sp(st));
        const th = r * Math.PI * 2;
        const c = Math.cos(th);
        const sn = Math.sin(th);
        return [
          cx + sgn(c) * Math.pow(Math.abs(c), 0.6) * (p.w / 2),
          ground + k.sole + (sn > 0 ? p.h * Math.pow(sn, 0.75) : 0),
          p.zc,
        ];
      },
      bone,
      upper,
      SHOE,
      (st, r) => [st, 1 - Math.abs(Math.sin(r * Math.PI * 2))],
    );
    out.push(
      outwards(dome, (i) => [
        cx,
        ground + k.sole + 0.02,
        dome.a.pos[i * 3 + 2],
      ]),
    );
    // Sole: a rounded-rectangle section (right wall down, floor, left wall up, back over the top).
    const sole = loft(
      stations,
      ring,
      (st, r) => {
        const p = prof(sp(st));
        const hw = p.w / 2 + 0.004;
        const q = r * 4;
        const seg = Math.floor(q);
        const f = q - seg;
        const [dx, y] = [
          [hw, k.sole * (1 - f)],
          [hw * (1 - 2 * f), 0],
          [-hw, k.sole * f],
          [-hw * (1 - 2 * f), k.sole],
        ][seg];
        return [cx + dx, ground + y, p.zc];
      },
      bone,
      soleColor,
      SOLE,
      (st, r) => [st, r],
    );
    out.push(
      outwards(sole, (i) => [cx, ground + k.sole / 2, sole.a.pos[i * 3 + 2]]),
    );
    // Collar (a boot: the shaft) round the ankle, flared a little at the top.
    const y0 = ground + k.sole + 0.03;
    const y1 = ground + k.collarTop;
    const shaft = loft(
      hi ? 4 : 2,
      ring,
      (st, r) => {
        const th = r * Math.PI * 2;
        const rad = k.collarR * (1.12 - 0.18 * st);
        // (a boot's shaft is wider than the ankle: its radii are the full ones)
        // The ankle is narrower than it is deep.
        return [
          cx + Math.sin(th) * rad * ank.x,
          y0 + (y1 - y0) * st,
          ank.z + Math.cos(th) * rad * ank.d,
        ];
      },
      bone,
      upper,
      SHOE,
      (st, r) => [r, 1 - st],
    );
    out.push(outwards(shaft, () => [cx, 0, az]));
    if (kind !== 'boot') {
      // A lip turned in over the collar's mouth, so the base mesh's ragged ankle end is never seen from above.
      const lip = loft(
        1,
        ring,
        (st, r) => {
          const th = r * Math.PI * 2;
          const rad = k.collarR * 1.05 * (1 - 0.3 * st);
          return [
            cx + Math.sin(th) * rad * ank.x,
            y1 - 0.003 * st,
            ank.z + Math.cos(th) * rad * ank.d,
          ];
        },
        bone,
        upper,
        SHOE,
        (st, r) => [r, st],
      );
      out.push(outwards(lip, () => [cx, y1 - 0.05, ank.z]));
    }
  }
  return out;
}
