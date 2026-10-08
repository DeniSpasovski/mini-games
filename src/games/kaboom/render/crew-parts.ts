import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { CritterId } from '../sim/types';
import { merge, part } from './parts';

/**
 * The Boom Crew (DETAILS.md "Style"): eight chubby animal demolition workers built from primitives, one merged geometry
 * each with the paint in vertex colours. Local space: facing +z, standing on y = 0, about 1 cell tall, 0.35 cell radius.
 * The hard hat, the vest and the feet are separate instanced meshes (team-coloured / animated), see `characters.ts`.
 */
const ball = (r: number) => new SphereGeometry(r, 12, 8);
const rbox = (w: number, h: number, d: number, r: number) =>
  new RoundedBoxGeometry(w, h, d, 2, r);
const cone = (r: number, h: number, seg = 8) => new ConeGeometry(r, h, seg);

/** Tilt a +y primitive (cone) so it points along `dir`. */
function aim(
  geo: BufferGeometry,
  dx: number,
  dy: number,
  dz: number,
): BufferGeometry {
  const q = new Quaternion().setFromUnitVectors(
    new Vector3(0, 1, 0),
    new Vector3(dx, dy, dz).normalize(),
  );
  return geo.clone().applyQuaternion(q);
}

const EYE = 0x1b1b24;
const WHITE = 0xffffff;

interface Body {
  fur: number;
  belly: number;
  /** Head radius and height of its centre. */
  head?: number;
  headY?: number;
  eye?: number;
  eyeSpread?: number;
  /** Eye depth (z); default sits on the head sphere. */
  eyeZ?: number;
  /** Torso width / depth scale. */
  wide?: number;
  deep?: number;
  noEyes?: boolean;
}

/** The shared chubby body: torso, belly patch, head, eyes, arms. Critters add their own face and extras. */
function chubby(b: Body): BufferGeometry[] {
  const head = b.head ?? 0.27;
  const hy = b.headY ?? 0.72;
  const eye = b.eye ?? 0.045;
  const sp = b.eyeSpread ?? 0.1;
  const ez = b.eyeZ ?? head * 0.84;
  const wide = b.wide ?? 1;
  const deep = b.deep ?? 0.95;
  const p: BufferGeometry[] = [
    part(ball(0.3), b.fur, {
      y: 0.36,
      sx: wide,
      sy: 1.05,
      sz: deep,
      tint: 0.08,
    }),
    part(ball(0.25), b.belly, {
      y: 0.33,
      z: 0.1,
      sx: wide * 0.95,
      sy: 0.95,
      sz: 0.55,
      tint: 0.05,
    }),
    part(ball(head), b.fur, { y: hy, z: 0.03, tint: 0.08 }),
    part(ball(0.085), b.fur, {
      x: 0.31 * wide,
      y: 0.36,
      z: 0.04,
      sx: 0.85,
      sy: 1.25,
      sz: 0.85,
    }),
    part(ball(0.085), b.fur, {
      x: -0.31 * wide,
      y: 0.36,
      z: 0.04,
      sx: 0.85,
      sy: 1.25,
      sz: 0.85,
    }),
  ];
  if (!b.noEyes)
    for (const s of [-1, 1])
      p.push(
        part(ball(eye), EYE, {
          x: s * sp,
          y: hy + 0.04,
          z: ez,
          tint: 0,
        }),
        part(ball(eye * 0.35), WHITE, {
          x: s * sp + eye * 0.35,
          y: hy + 0.04 + eye * 0.45,
          z: ez + eye * 0.75,
          tint: 0,
        }),
      );
  return p;
}

export interface CritterModel {
  geometry: BufferGeometry;
  /** Where the hard hat sits (y of the brim) and how far it is pushed back. */
  hatY: number;
  /** Colour of the two feet. */
  foot: number;
}

const BUILDERS: Record<CritterId, () => CritterModel> = {
  mole() {
    const fur = 0x6f7491;
    const pink = 0xf2a3a8;
    const p = chubby({ fur, belly: 0x8b90ab, eye: 0.028, eyeSpread: 0.13 });
    p.push(
      part(ball(0.13), pink, {
        y: 0.67,
        z: 0.27,
        sx: 1,
        sy: 0.85,
        sz: 1.35,
        tint: 0.05,
      }),
      part(ball(0.055), 0xd9777f, { y: 0.69, z: 0.41, tint: 0 }),
      part(rbox(0.15, 0.13, 0.13, 0.04), pink, { x: 0.35, y: 0.29, z: 0.1 }),
      part(rbox(0.15, 0.13, 0.13, 0.04), pink, { x: -0.35, y: 0.29, z: 0.1 }),
    );
    for (const s of [-1, 1])
      for (const k of [-1, 0, 1])
        p.push(
          part(aim(cone(0.018, 0.08, 5), 0, 0, 1), 0xfff0e0, {
            x: s * 0.35 + k * 0.045,
            y: 0.27,
            z: 0.19,
            tint: 0,
          }),
        );
    return { geometry: merge(p), hatY: 0.93, foot: pink };
  },

  badger() {
    const fur = 0x4d4d57;
    const p = chubby({ fur, belly: 0x6a6a76 });
    p.push(
      part(ball(0.24), 0xf1efe9, {
        y: 0.74,
        z: 0.08,
        sx: 0.4,
        sy: 0.95,
        sz: 1.0,
        tint: 0.03,
      }),
      part(ball(0.12), 0xf1efe9, {
        x: 0.14,
        y: 0.68,
        z: 0.15,
        sx: 0.5,
        sy: 1,
        sz: 1.1,
      }),
      part(ball(0.12), 0xf1efe9, {
        x: -0.14,
        y: 0.68,
        z: 0.15,
        sx: 0.5,
        sy: 1,
        sz: 1.1,
      }),
      part(aim(cone(0.09, 0.22), 0, 0, 1), 0x2b2b33, { y: 0.66, z: 0.3 }),
      part(ball(0.05), 0x15151b, { y: 0.66, z: 0.42, tint: 0 }),
      part(ball(0.075), fur, { x: 0.18, y: 0.93, z: -0.02 }),
      part(ball(0.075), fur, { x: -0.18, y: 0.93, z: -0.02 }),
      part(ball(0.04), 0xf1efe9, { x: 0.18, y: 0.95, z: 0.03 }),
      part(ball(0.04), 0xf1efe9, { x: -0.18, y: 0.95, z: 0.03 }),
    );
    return { geometry: merge(p), hatY: 0.95, foot: 0x2b2b33 };
  },

  beaver() {
    const fur = 0x9c6c3c;
    const dark = 0x5b3a1f;
    const p = chubby({ fur, belly: 0xc79a66 });
    p.push(
      part(ball(0.11), 0xd6a877, { y: 0.64, z: 0.25, sx: 1.1, sy: 0.9, sz: 1 }),
      part(ball(0.045), 0x2a1a10, { y: 0.69, z: 0.35, tint: 0 }),
      part(rbox(0.045, 0.085, 0.025, 0.01), 0xfffbe8, {
        x: 0.026,
        y: 0.57,
        z: 0.34,
      }),
      part(rbox(0.045, 0.085, 0.025, 0.01), 0xfffbe8, {
        x: -0.026,
        y: 0.57,
        z: 0.34,
      }),
      part(ball(0.065), dark, { x: 0.2, y: 0.9, z: -0.02 }),
      part(ball(0.065), dark, { x: -0.2, y: 0.9, z: -0.02 }),
      // paddle tail with a crosshatch
      part(rbox(0.3, 0.05, 0.4, 0.02), dark, { y: 0.14, z: -0.46, tint: 0.1 }),
    );
    for (const k of [-0.12, 0, 0.12])
      p.push(
        part(rbox(0.3, 0.012, 0.025, 0.005), 0x3a2412, {
          y: 0.17,
          z: -0.46 + k,
          tint: 0,
        }),
      );
    return { geometry: merge(p), hatY: 0.93, foot: dark };
  },

  hedgehog() {
    const face = 0xebcfa6;
    const quill = 0x5e4630;
    const p = chubby({ fur: face, belly: 0xf6e4c8, head: 0.25, headY: 0.68 });
    p.push(
      part(aim(cone(0.085, 0.22), 0, -0.1, 1), face, { y: 0.63, z: 0.29 }),
      part(ball(0.045), 0x2a1c14, { y: 0.63, z: 0.4, tint: 0 }),
      part(ball(0.06), face, { x: 0.18, y: 0.88, z: 0 }),
      part(ball(0.06), face, { x: -0.18, y: 0.88, z: 0 }),
    );
    // quills over the back and the top of the head (a fibonacci fan on the rear half-sphere)
    const n = 34;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const polar = Math.acos(1 - t * 1.25); // from the top, over the back
      const az = i * 2.399963 + 3.14159; // golden angle, centred on the back (-z)
      const d = new Vector3(
        Math.sin(polar) * Math.sin(az) * 0.9,
        Math.cos(polar) * 0.9 + 0.15,
        Math.sin(polar) * Math.cos(az) * 0.9 - 0.25,
      ).normalize();
      const r = 0.33;
      p.push(
        part(aim(cone(0.05, 0.24, 5), d.x, d.y, d.z), quill, {
          x: d.x * r,
          y: 0.45 + d.y * r * 1.05,
          z: d.z * r - 0.04,
          tint: 0.12,
        }),
      );
    }
    return { geometry: merge(p), hatY: 0.9, foot: 0xc79a6a };
  },

  armadillo() {
    const skin = 0xb7a2a6;
    const shell = 0x8d7f86;
    const p = chubby({
      fur: skin,
      belly: 0xd6c5c7,
      head: 0.24,
      headY: 0.68,
      wide: 0.95,
    });
    p.push(
      part(ball(0.34), shell, {
        y: 0.42,
        z: -0.07,
        sx: 1,
        sy: 0.88,
        sz: 1.08,
        tint: 0.07,
      }),
      part(aim(cone(0.1, 0.32), 0, -0.05, 1), skin, { y: 0.64, z: 0.3 }),
      part(ball(0.04), 0x4a3a3e, { y: 0.63, z: 0.46, tint: 0 }),
      part(aim(cone(0.055, 0.18, 6), 0.15, 1, 0), skin, {
        x: 0.13,
        y: 0.92,
        z: -0.04,
      }),
      part(aim(cone(0.055, 0.18, 6), -0.15, 1, 0), skin, {
        x: -0.13,
        y: 0.92,
        z: -0.04,
      }),
      part(aim(cone(0.07, 0.4, 6), 0, 0.15, -1), skin, { y: 0.2, z: -0.5 }),
    );
    for (const [y, r] of [
      [0.32, 0.33],
      [0.42, 0.34],
      [0.52, 0.31],
    ] as const)
      p.push(
        part(
          new TorusGeometry(r, 0.022, 6, 22).rotateX(Math.PI / 2),
          0x6f6269,
          { y, z: -0.07, sx: 1, sz: 1.08, tint: 0.05 },
        ),
      );
    return { geometry: merge(p), hatY: 0.9, foot: 0x6f6269 };
  },

  raccoon() {
    const fur = 0x8d909c;
    const dark = 0x2c2c35;
    const p = chubby({ fur, belly: 0xc3c5cd });
    p.push(
      part(ball(0.27), dark, {
        y: 0.77,
        z: 0.0,
        sx: 1.0,
        sy: 0.3,
        sz: 0.7,
        tint: 0,
      }),
      part(ball(0.12), 0xe9e9ee, {
        y: 0.65,
        z: 0.24,
        sx: 1,
        sy: 0.85,
        sz: 1.1,
      }),
      part(ball(0.04), dark, { y: 0.67, z: 0.35, tint: 0 }),
      part(aim(cone(0.085, 0.15, 6), 0.3, 1, 0), fur, {
        x: 0.16,
        y: 0.96,
        z: 0,
      }),
      part(aim(cone(0.085, 0.15, 6), -0.3, 1, 0), fur, {
        x: -0.16,
        y: 0.96,
        z: 0,
      }),
    );
    // ringed tail curling up behind
    const ring = [0xb9bcc6, dark, 0xb9bcc6, dark, 0xb9bcc6];
    ring.forEach((c, i) =>
      p.push(
        part(ball(0.1 - i * 0.008), c, {
          y: 0.2 + i * 0.075,
          z: -0.36 - i * 0.07,
          tint: 0.04,
        }),
      ),
    );
    return { geometry: merge(p), hatY: 0.95, foot: dark };
  },

  capybara() {
    const fur = 0xa97c50;
    const p = chubby({
      fur,
      belly: 0xc9a173,
      head: 0.22,
      headY: 0.7,
      wide: 1.1,
      deep: 1.0,
      eye: 0.04,
      eyeSpread: 0.14,
      eyeZ: 0.315,
    });
    p.push(
      part(rbox(0.46, 0.38, 0.44, 0.14), fur, { y: 0.7, z: 0.1, tint: 0.07 }),
      part(rbox(0.32, 0.22, 0.2, 0.08), 0x7d583a, { y: 0.62, z: 0.34 }),
      part(ball(0.025), 0x24150d, { x: 0.06, y: 0.66, z: 0.44, tint: 0 }),
      part(ball(0.025), 0x24150d, { x: -0.06, y: 0.66, z: 0.44, tint: 0 }),
      part(ball(0.05), 0x7d583a, { x: 0.18, y: 0.91, z: 0.02 }),
      part(ball(0.05), 0x7d583a, { x: -0.18, y: 0.91, z: 0.02 }),
    );
    return { geometry: merge(p), hatY: 0.93, foot: 0x7d583a };
  },

  otter() {
    const fur = 0x7b5b46;
    const cream = 0xead4b6;
    const p = chubby({ fur, belly: cream, head: 0.25, headY: 0.7, deep: 1.1 });
    p.push(
      part(ball(0.14), cream, { y: 0.63, z: 0.22, sx: 1.1, sy: 0.9, sz: 1 }),
      part(ball(0.045), 0x20140e, { y: 0.67, z: 0.34, tint: 0 }),
      part(ball(0.055), 0x5b4332, { x: 0.18, y: 0.9, z: -0.02 }),
      part(ball(0.055), 0x5b4332, { x: -0.18, y: 0.9, z: -0.02 }),
      part(aim(cone(0.09, 0.55, 8), 0, 0.12, -1), fur, {
        y: 0.22,
        z: -0.55,
        tint: 0.08,
      }),
    );
    for (const s of [-1, 1])
      for (const k of [-1, 0, 1])
        p.push(
          part(new BoxGeometry(0.1, 0.008, 0.008), 0xfffaf0, {
            x: s * 0.17,
            y: 0.62 + k * 0.025,
            z: 0.3,
            ry: s * k * 0.25,
            tint: 0,
          }),
        );
    return { geometry: merge(p), hatY: 0.93, foot: 0x5b4332 };
  },
};

export function buildCritter(id: CritterId): CritterModel {
  return BUILDERS[id]();
}

/** Hard hat: dome, brim, front peak and a ridge. White paint = tinted by the team colour per instance. */
export function hatGeometry(): BufferGeometry {
  return merge([
    part(
      new SphereGeometry(0.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      0xffffff,
      { y: 0.0, sy: 0.9, tint: 0.03 },
    ),
    part(new CylinderGeometry(0.255, 0.255, 0.035, 18), 0xe6e6e6, {
      y: 0.005,
      tint: 0,
    }),
    part(rbox(0.2, 0.03, 0.14, 0.012), 0xe6e6e6, {
      y: 0.008,
      z: 0.24,
      tint: 0,
    }),
    part(rbox(0.05, 0.05, 0.34, 0.02), 0xcfcfcf, { y: 0.17, tint: 0 }),
  ]);
}

/** Hi-vis vest: a band round the belly, a bib and a back panel (team colour per instance). */
export function vestGeometry(): BufferGeometry {
  return merge([
    part(new TorusGeometry(0.31, 0.045, 8, 22).rotateX(Math.PI / 2), 0xffffff, {
      y: 0.28,
      sz: 0.97,
      tint: 0,
    }),
    part(rbox(0.24, 0.2, 0.05, 0.02), 0xffffff, { y: 0.38, z: 0.27, tint: 0 }),
    part(rbox(0.26, 0.28, 0.05, 0.02), 0xffffff, {
      y: 0.44,
      z: -0.26,
      tint: 0,
    }),
    part(rbox(0.06, 0.04, 0.5, 0.015), 0xf3f3f3, { x: 0.1, y: 0.62, tint: 0 }),
    part(rbox(0.06, 0.04, 0.5, 0.015), 0xf3f3f3, { x: -0.1, y: 0.62, tint: 0 }),
  ]);
}

/** One foot (instanced twice per player, coloured per critter). */
export function footGeometry(): BufferGeometry {
  return part(rbox(0.16, 0.09, 0.24, 0.04), 0xffffff, {
    y: 0.045,
    z: 0.03,
    tint: 0,
  });
}

/** TNT bundle: three red sticks, caps and a fuse wire. The paper band is a separate mesh (it shows the count). */
export function tntBodyGeometry(): BufferGeometry {
  const p: BufferGeometry[] = [];
  for (const [x, z, h] of [
    [-0.15, 0.02, 0.5],
    [0.15, 0.02, 0.5],
    [0, -0.06, 0.52],
  ] as const) {
    p.push(
      part(new CylinderGeometry(0.115, 0.115, h, 14), 0xd8362f, {
        x,
        z,
        y: h / 2,
        tint: 0.07,
      }),
      part(new CylinderGeometry(0.095, 0.095, 0.03, 14), 0xf4d9a8, {
        x,
        z,
        y: h + 0.012,
        tint: 0,
      }),
    );
  }
  p.push(
    part(new CylinderGeometry(0.014, 0.014, 0.2, 6), 0x3b2f2a, {
      z: -0.02,
      y: 0.62,
      tint: 0,
    }),
    part(ball(0.03), 0x3b2f2a, { z: -0.02, y: 0.52, tint: 0 }),
  );
  return merge(p);
}

/** The band round the sticks: its UVs show one digit of a 3-cell atlas on every side (UVs are shifted per instance). */
export function tntBandGeometry(): BufferGeometry {
  return rbox(0.5, 0.2, 0.3, 0.02).translate(0, 0.27, 0);
}
