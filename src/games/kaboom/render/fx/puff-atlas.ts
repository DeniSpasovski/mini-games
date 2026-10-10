import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  UnsignedByteType,
} from 'three';
import { Noise2D } from '../../../../shared/noise';

/** Frames per side of the puff flipbook (FRAMES x FRAMES frames, read left-to-right, bottom-to-top). */
export const PUFF_FRAMES = 4;
const FRAME_PX = 64;

let shared: DataTexture | null = null;

/**
 * The one texture every soft FX sprite reads (fire, smoke, dust, flames, scorch): a flipbook of a billowy puff that
 * dissolves frame by frame. R = density, G = a fake light from the top-left (lit bumps on smoke), B = a second, finer
 * noise (scorch edges). Built once from seeded noise, shared by every `Fx` (a round change costs nothing).
 */
export function puffAtlas(): DataTexture {
  if (shared) return shared;
  const n = PUFF_FRAMES;
  const size = n * FRAME_PX;
  const data = new Uint8Array(size * size * 4);
  const noise = new Noise2D(4242);
  const dens = new Float32Array(FRAME_PX * FRAME_PX);
  for (let f = 0; f < n * n; f++) {
    const fx = (f % n) * FRAME_PX;
    const fy = Math.floor(f / n) * FRAME_PX;
    const erode = (f / (n * n - 1)) * 0.78;
    const ox = f * 0.11;
    const oy = f * 0.07;
    for (let y = 0; y < FRAME_PX; y++)
      for (let x = 0; x < FRAME_PX; x++) {
        const u = ((x + 0.5) / FRAME_PX) * 2 - 1;
        const v = ((y + 0.5) / FRAME_PX) * 2 - 1;
        const r = Math.hypot(u, v);
        // a lumpy outline: the radius itself wobbles with the angle
        const a = Math.atan2(v, u);
        const rim =
          0.82 + 0.12 * noise.noise2(Math.cos(a) * 1.6 + ox, Math.sin(a) * 1.6);
        const fall = Math.max(0, 1 - r / rim);
        // billows: low-frequency noise, domain-warped so the lumps curl like a cauliflower, not static grain
        const wu = u + 0.35 * noise.noise2(u * 1.3 + ox, v * 1.3 + 20);
        const wv = v + 0.35 * noise.noise2(u * 1.3 - 20, v * 1.3 + oy);
        let nz = 0;
        let amp = 0.55;
        let fr = 1.5;
        for (let o = 0; o < 4; o++) {
          nz +=
            amp * noise.noise2(wu * fr + ox + o * 9.1, wv * fr + oy - o * 3.7);
          amp *= 0.42;
          fr *= 2.1;
        }
        const body = Math.pow(fall, 0.55) * (0.72 + 0.55 * nz);
        let d = Math.max(0, Math.min(1, (body - erode) * 2.1));
        // always zero at the frame border, so mipmaps never bleed between frames
        if (r > 0.97) d = 0;
        dens[y * FRAME_PX + x] = d;
      }
    for (let y = 0; y < FRAME_PX; y++)
      for (let x = 0; x < FRAME_PX; x++) {
        const d = dens[y * FRAME_PX + x];
        // light from the top-left: brighter where the density falls away towards the light
        const lx = Math.max(0, x - 3);
        const ly = Math.min(FRAME_PX - 1, y + 3);
        const toward = dens[ly * FRAME_PX + lx];
        const lit = Math.max(0, Math.min(1, 0.6 + (d - toward) * 1.6));
        const fine =
          0.5 + 0.5 * noise.noise2((fx + x) * 0.19, (fy + y) * 0.19 + 50);
        const o = ((fy + y) * size + fx + x) * 4;
        data[o] = Math.round(d * 255);
        data[o + 1] = Math.round(lit * 255);
        data[o + 2] = Math.round(fine * 255);
        data[o + 3] = 255;
      }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.needsUpdate = true;
  shared = tex;
  return tex;
}

/** GLSL: `puff(uv, k)` = density of the flipbook at life fraction `k` (two frames blended), `.g` = fake light. */
export const PUFF_GLSL = /* glsl */ `
  uniform sampler2D uPuff;
  vec2 puffAt(vec2 uv, float k) {
    float last = ${PUFF_FRAMES * PUFF_FRAMES - 1}.0;
    float f = clamp(k, 0.0, 1.0) * last;
    float f0 = floor(f);
    float f1 = min(f0 + 1.0, last);
    float n = ${PUFF_FRAMES}.0;
    vec2 c0 = vec2(mod(f0, n), floor(f0 / n));
    vec2 c1 = vec2(mod(f1, n), floor(f1 / n));
    vec2 a = texture2D(uPuff, (c0 + uv) / n).rg;
    vec2 b = texture2D(uPuff, (c1 + uv) / n).rg;
    return mix(a, b, fract(f));
  }
  // white-hot -> yellow -> orange -> deep red -> soot, by temperature t in [0, 1]
  vec3 fireRamp(float t) {
    vec3 c = mix(vec3(0.22, 0.05, 0.03), vec3(0.85, 0.2, 0.05), smoothstep(0.0, 0.3, t));
    c = mix(c, vec3(1.0, 0.55, 0.12), smoothstep(0.25, 0.55, t));
    c = mix(c, vec3(1.0, 0.86, 0.42), smoothstep(0.5, 0.8, t));
    return mix(c, vec3(1.0, 0.98, 0.9), smoothstep(0.8, 1.0, t));
  }
`;
