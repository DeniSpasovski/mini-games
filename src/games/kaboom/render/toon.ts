import {
  Color,
  DataTexture,
  Euler,
  FloatType,
  Matrix3,
  Matrix4,
  MeshStandardMaterial,
  NearestFilter,
  RGBAFormat,
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

/**
 * The marks go to the shader as a small float texture, a row per mark (texels: centre + cone flag, radii + blink
 * travel, cone end + zig amplitude, the three columns of the turn + zig teeth, colour, cut plane, rings, the minus
 * ellipsoid's centre and radii), so the program needs only a few uniforms on any GPU.
 */
const TEXELS = 11;

/** GLSL: the paint (`toonColor(p, w)`, `w` = the pixel's size in bind-pose units) and its texture (`toonTexture`). */
const FRAG = /* glsl */ `
  #define TOON_N ${TOON_MARKS}
  uniform highp sampler2D uToonMarks;
  uniform int uToonN;
  uniform vec3 uToonBase;
  uniform float uToonTex;
  uniform float uBlink;
  #define TM(k) texelFetch(uToonMarks, ivec2(k, i), 0)
  float toonDist(int i, vec3 p, out float along, out float axis) {
    vec4 t0 = TM(0);
    vec4 t1 = TM(1);
    if (t0.w > 0.5) {
      vec3 a = t0.xyz;
      vec3 ba = TM(2).xyz - a;
      float t = clamp(dot(p - a, ba) / dot(ba, ba), 0.0, 1.0);
      along = p.x + p.z;
      axis = dot(p - a, ba) / length(ba);
      return length(p - a - ba * t) - mix(t1.x, t1.y, t);
    }
    mat3 m = mat3(TM(3).xyz, TM(4).xyz, TM(5).xyz);
    vec3 q = m * (p - t0.xyz);
    along = q.x;
    axis = q.x;
    vec3 r = t1.xyz;
    float d = (length(q / r) - 1.0) * min(r.x, min(r.y, r.z));
    vec3 r2 = TM(10).xyz;
    if (r2.x > 0.0) {
      vec3 q2 = m * (p - TM(9).xyz);
      d = max(d, -(length(q2 / r2) - 1.0) * min(r2.x, min(r2.y, r2.z)));
    }
    vec4 cut = TM(7);
    return max(d, dot(q, cut.xyz) - cut.w - t1.w * uBlink);
  }
  vec3 toonColor(vec3 p, float w) {
    vec3 col = uToonBase;
    for (int i = 0; i < TOON_N; i++) {
      if (i >= uToonN) break;
      float along;
      float axis;
      float d = toonDist(i, p, along, axis);
      float zig = TM(2).w;
      if (zig > 0.0) d += zig * (abs(fract(along * TM(3).w) - 0.5) * 2.0 - 0.5);
      vec3 x = TM(8).xyz;
      if (x.x > 0.0) {
        float u = fract(axis * x.x + x.z);
        d = max(d, (abs(u - x.y * 0.5) - x.y * 0.5) / x.x);
      }
      col = mix(col, TM(6).rgb, 1.0 - smoothstep(-w, w, d));
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

/** The marks of a paint as the shader's float texture (`TEXELS` x `TOON_MARKS`). */
function marksTexture(paint: ToonPaint): DataTexture {
  const data = new Float32Array(TEXELS * TOON_MARKS * 4);
  const c = new Color();
  const m4 = new Matrix4();
  const m3 = new Matrix3();
  paint.marks.slice(0, TOON_MARKS).forEach((mk, i) => {
    const put = (k: number, x: number, y: number, z: number, w = 0) =>
      data.set([x, y, z, w], (i * TEXELS + k) * 4);
    if (mk.a && mk.b) {
      put(0, ...mk.a, 1);
      put(1, mk.ra ?? 0.05, mk.rb ?? 0.05, 1, mk.blink ?? 0);
      put(2, ...mk.b, mk.zig?.[0] ?? 0);
    } else {
      put(0, ...(mk.c ?? [0, 0, 0]), 0);
      put(1, ...(mk.r ?? [0.1, 0.1, 0.1]), mk.blink ?? 0);
      put(2, 0, 0, 0, mk.zig?.[0] ?? 0);
    }
    // world -> local: the transpose of the solid's rotation (Ry Rx Rz), stored by columns
    const [rx, ry, rz] = mk.rot ?? [0, 0, 0];
    m4.makeRotationFromEuler(new Euler(rx, ry, rz, 'YXZ'));
    const e = m3.setFromMatrix4(m4).transpose().elements;
    put(3, e[0], e[1], e[2], mk.zig?.[1] ?? 0);
    put(4, e[3], e[4], e[5]);
    put(5, e[6], e[7], e[8]);
    c.setHex(mk.color);
    put(6, c.r, c.g, c.b);
    put(7, ...(mk.cut ?? [0, 1, 0, 1e3]));
    put(8, mk.bands?.[0] ?? 0, mk.bands?.[1] ?? 0, mk.bands?.[2] ?? 0);
    if (mk.minus) {
      put(9, ...mk.minus.c);
      put(10, ...mk.minus.r);
    }
  });
  const tex = new DataTexture(data, TEXELS, TOON_MARKS, RGBAFormat, FloatType);
  tex.magFilter = tex.minFilter = NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * The body material of a toon critter: physically based like the arena (the level HDRI lights it), paint per pixel
 * (`vBind` = the bind-pose position). `userData.blink` (0 open .. 1 shut) closes the painted lids; `characters.ts` sets
 * it with each blink. `low`: no painted texture (Low quality, cheaper pixels).
 */
export function toonMaterial(
  paint: ToonPaint,
  low = false,
): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.62,
    metalness: 0,
  });
  const blink: IUniform<number> = { value: 0 };
  m.userData.blink = blink;
  const marks = marksTexture(paint);
  m.addEventListener('dispose', () => marks.dispose());
  const base = new Color().setHex(paint.base);
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uToonMarks: { value: marks },
      uToonN: { value: Math.min(TOON_MARKS, paint.marks.length) },
      uToonBase: { value: base },
      uToonTex: { value: low ? 0 : (paint.texture ?? 0) },
      uBlink: blink,
    });
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
        // the body: its paint (and texture) times the baked shading; rigid parts keep their own colour and skip the
        // paint (the pixel size is taken outside the branch: derivatives need every pixel of the quad)
        `#include <color_fragment>
        float toonW = max(length(fwidth(vBind)), 1e-4);
        if (vToon > 0.5)
          diffuseColor.rgb *= toonTexture(toonColor(vBind, toonW), vBind);`,
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
