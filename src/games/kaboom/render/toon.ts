import {
  Color,
  Euler,
  Matrix3,
  Matrix4,
  MeshStandardMaterial,
  Vector3,
  Vector4,
  type IUniform,
} from 'three';
import type { V3 } from './sdf-body';

/**
 * Toon paint for a critter body (a cartoon-mascot look): flat graphic colour blocks with crisp edges, optionally a
 * painted texture (soft mottling and fur brush-strokes). The pattern is evaluated
 * per pixel from marks in the body's bind pose (`position` before skinning), so the edges stay sharp at any zoom and
 * ride the skin as it moves. Vertex colours carry only the shading (occlusion, warm above / cool below) and the rigid
 * parts' own paint (`aToon` = 0 there: eyes, noses, gloves, belt keep their colours).
 */
export interface ToonMark {
  /** Ellipsoid: centre, radii, turned by `rot` (z, then x, then y radians), like the body solids. */
  c?: V3;
  r?: V3;
  rot?: V3;
  /** Or a round cone from `a` (`ra`) to `b` (`rb`). */
  a?: V3;
  b?: V3;
  ra?: number;
  rb?: number;
  color: number;
  /** Zig-zag edge (fur tufts): amplitude and teeth per unit along the mark's local x. */
  zig?: readonly [number, number];
  /** Keep only the side under this plane (local frame, unscaled): `[nx, ny, nz, k]` cuts away where n.p > k. */
  cut?: readonly [number, number, number, number];
  /** Blinking moves the cut plane by this much when the eye is shut (painted lids). */
  blink?: number;
  /** Minus this ellipsoid (centre, radii; same turn): a crescent (a smile) from two ovals. */
  minus?: { c: V3; r: V3 };
  /**
   * Only in rings: `[per unit, share, phase]` along a cone (from `a`) or an ellipsoid's local x (ringed tails, paddle
   * scales).
   */
  bands?: readonly [number, number, number?];
}

export interface ToonPaint {
  /** Colour where no mark lies. */
  base: number;
  marks: readonly ToonMark[];
  /** Painted texture 0..1: soft colour mottling and fur strokes running down the body (0 = flat colour). */
  texture?: number;
}

/** Most marks one critter can have. */
export const TOON_MARKS = 32;

/** GLSL: the paint (`toonColor(p)`) and its texture (`toonTexture(p)`), `p` = bind-pose position. */
const FRAG = /* glsl */ `
  #define TOON_N ${TOON_MARKS}
  uniform int uToonN;
  uniform vec3 uToonBase;
  uniform float uToonTex;
  uniform float uBlink;
  uniform vec3 uTC2[TOON_N];
  uniform vec3 uTR2[TOON_N];
  uniform vec3 uTC[TOON_N];
  uniform vec3 uTR[TOON_N];
  uniform vec3 uTB[TOON_N];
  uniform mat3 uTM[TOON_N];
  uniform vec3 uTCol[TOON_N];
  // zig amplitude, zig frequency, cone (1) or ellipsoid (0), blink travel of the cut
  uniform vec4 uTZ[TOON_N];
  uniform vec4 uTCut[TOON_N];
  // rings: per unit, share, phase
  uniform vec3 uTX[TOON_N];
  float toonDist(int i, vec3 p, out float along, out float axis) {
    if (uTZ[i].z > 0.5) {
      vec3 a = uTC[i];
      vec3 ba = uTB[i] - a;
      float t = clamp(dot(p - a, ba) / dot(ba, ba), 0.0, 1.0);
      along = p.x + p.z;
      axis = dot(p - a, ba) / length(ba);
      return length(p - a - ba * t) - mix(uTR[i].x, uTR[i].y, t);
    }
    vec3 q = uTM[i] * (p - uTC[i]);
    along = q.x;
    axis = q.x;
    float d = (length(q / uTR[i]) - 1.0) * min(uTR[i].x, min(uTR[i].y, uTR[i].z));
    if (uTR2[i].x > 0.0) {
      vec3 q2 = uTM[i] * (p - uTC2[i]);
      d = max(d, -(length(q2 / uTR2[i]) - 1.0) * min(uTR2[i].x, min(uTR2[i].y, uTR2[i].z)));
    }
    return max(d, dot(q, uTCut[i].xyz) - uTCut[i].w - uTZ[i].w * uBlink);
  }
  vec3 toonColor(vec3 p) {
    vec3 col = uToonBase;
    for (int i = 0; i < TOON_N; i++) {
      if (i >= uToonN) break;
      float along;
      float axis;
      float d = toonDist(i, p, along, axis);
      if (uTZ[i].x > 0.0) d += uTZ[i].x * (abs(fract(along * uTZ[i].y) - 0.5) * 2.0 - 0.5);
      if (uTX[i].x > 0.0) {
        float u = fract(axis * uTX[i].x + uTX[i].z);
        d = max(d, (abs(u - uTX[i].y * 0.5) - uTX[i].y * 0.5) / uTX[i].x);
      }
      float w = max(fwidth(d), 1e-4);
      col = mix(col, uTCol[i], 1.0 - smoothstep(-w, w, d));
    }
    return col;
  }
  float toonHash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float toonNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(toonHash(i), toonHash(i + vec3(1, 0, 0)), f.x), mix(toonHash(i + vec3(0, 1, 0)), toonHash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(toonHash(i + vec3(0, 0, 1)), toonHash(i + vec3(1, 0, 1)), f.x), mix(toonHash(i + vec3(0, 1, 1)), toonHash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  // the painted texture on a colour: broad soft mottling (warm and cool), and fur strokes - streaks stretched along the
  // hair (down the body), each a little lighter at its tip
  vec3 toonTexture(vec3 col, vec3 p) {
    if (uToonTex <= 0.0) return col;
    float mott = toonNoise(p * 9.0) * 0.65 + toonNoise(p * 21.0) * 0.35 - 0.5;
    vec3 sp = p * vec3(62.0, 11.0, 62.0);
    float streak = toonNoise(sp) - 0.5;
    float tip = toonNoise(sp * vec3(0.5, 2.5, 0.5));
    float v = 1.0 + uToonTex * (0.3 * mott + 0.34 * streak + 0.1 * (tip - 0.5));
    vec3 warm = col * vec3(1.04, 1.0, 0.94);
    return mix(col, warm, uToonTex * clamp(mott + 0.5, 0.0, 1.0) * 0.6) * v;
  }
`;

const toLinear = (hex: number, out = new Vector3()): Vector3 => {
  const c = new Color().setHex(hex);
  return out.set(c.r, c.g, c.b);
};

/** The uniforms of a paint (`FRAG` reads them). */
function toonUniforms(
  paint: ToonPaint,
  blink: IUniform<number>,
): Record<string, IUniform> {
  const n = Math.min(TOON_MARKS, paint.marks.length);
  const C = Array.from({ length: TOON_MARKS }, () => new Vector3());
  const R = Array.from({ length: TOON_MARKS }, () => new Vector3(1, 1, 1));
  const B = Array.from({ length: TOON_MARKS }, () => new Vector3());
  const M = Array.from({ length: TOON_MARKS }, () => new Matrix3());
  const Col = Array.from({ length: TOON_MARKS }, () => new Vector3());
  const Z = Array.from({ length: TOON_MARKS }, () => new Vector4());
  const Cut = Array.from(
    { length: TOON_MARKS },
    () => new Vector4(0, 1, 0, 1e3),
  );
  const X = Array.from({ length: TOON_MARKS }, () => new Vector3());
  const C2 = Array.from({ length: TOON_MARKS }, () => new Vector3());
  const R2 = Array.from({ length: TOON_MARKS }, () => new Vector3());
  const m4 = new Matrix4();
  paint.marks.slice(0, n).forEach((mk, i) => {
    toLinear(mk.color, Col[i]);
    if (mk.a && mk.b) {
      C[i].fromArray(mk.a);
      B[i].fromArray(mk.b);
      R[i].set(mk.ra ?? 0.05, mk.rb ?? 0.05, 1);
      Z[i].z = 1;
    } else {
      C[i].fromArray(mk.c ?? [0, 0, 0]);
      R[i].fromArray(mk.r ?? [0.1, 0.1, 0.1]);
      const [x, y, z] = mk.rot ?? [0, 0, 0];
      // world -> local: the transpose of the solid's rotation (Ry Rx Rz)
      m4.makeRotationFromEuler(new Euler(x, y, z, 'YXZ'));
      M[i].setFromMatrix4(m4).transpose();
    }
    if (mk.zig) {
      Z[i].x = mk.zig[0];
      Z[i].y = mk.zig[1];
    }
    if (mk.cut) Cut[i].fromArray(mk.cut);
    Z[i].w = mk.blink ?? 0;
    if (mk.bands) X[i].set(mk.bands[0], mk.bands[1], mk.bands[2] ?? 0);
    if (mk.minus) {
      C2[i].fromArray(mk.minus.c);
      R2[i].fromArray(mk.minus.r);
    }
  });
  return {
    uToonN: { value: n },
    uToonBase: { value: toLinear(paint.base) },
    uToonTex: { value: paint.texture ?? 0 },
    uBlink: blink,
    uTC2: { value: C2 },
    uTR2: { value: R2 },
    uTC: { value: C },
    uTR: { value: R },
    uTB: { value: B },
    uTM: { value: M },
    uTCol: { value: Col },
    uTZ: { value: Z },
    uTCut: { value: Cut },
    uTX: { value: X },
  };
}

/**
 * The body material of a toon critter: physically based like the arena (the level HDRI lights it), paint per pixel
 * (`vBind` = the bind-pose position). `userData.blink` (0 open .. 1 shut) closes the painted lids; `characters.ts` sets
 * it with each blink.
 */
export function toonMaterial(paint: ToonPaint): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.62,
    metalness: 0,
  });
  const blink: IUniform<number> = { value: 0 };
  m.userData.blink = blink;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, toonUniforms(paint, blink));
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aToon;\nvarying float vToon;\nvarying vec3 vBind;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvToon = aToon;\nvBind = position;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying float vToon;\nvarying vec3 vBind;\n${FRAG}`,
      )
      .replace(
        '#include <color_fragment>',
        // the body: its paint (and texture) times the baked shading; rigid parts keep their own colour
        `#include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, toonTexture(toonColor(vBind), vBind) * diffuseColor.rgb, vToon);`,
      )
      .replace(
        '#include <opaque_fragment>',
        // a soft warm rim sets the critter off the floor behind it
        `float toonRim = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));
        outgoingLight += vec3(1.0, 0.94, 0.84) * pow(toonRim, 4.0) * 0.18;
        #include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => 'kaboom-toon';
  return m;
}
