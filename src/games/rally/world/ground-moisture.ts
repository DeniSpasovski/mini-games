import { DataTexture, LinearFilter, RedFormat, UnsignedByteType } from 'three';
import { newPathQuery } from './real-data';
import { newLakeQuery } from './lakes';
import type { TerrainGenerator } from './terrain-gen';
import type { MapDef } from '../maps/shared/types';

/** Metres per texel (coarsened for very large maps so a side stays <= MAX_SIDE). */
const RES = 12;
const MAX_SIDE = 768;
/** Margin around the map bounds (m), covers the rendered horizon ring. */
const PAD = 300;
/** Box-blur radii (m) of the two topographic scales: a gully / a valley floor. */
const NEAR_R = 36;
const FAR_R = 130;
/** Metres of hollow depth (land below its surroundings) for full wetness. */
const HOLLOW_M = 3;
/** Reach of the wet strip along rivers / canals / lakes (m). */
const WATER_R = 40;

/** Moisture grid on the ground: x0, z0 (m) and 1 / width, 1 / depth (1/m), as the shader samples it. */
export interface GroundMoisture {
  texture: DataTexture;
  map: { x0: number; z0: number; invW: number; invD: number };
}

/**
 * Ground moisture over the whole map (0 = dry ridge, 0.5 = neutral, 1 = wet hollow / river bank), baked once per
 * map into a small top-down texture the terrain shader tints the grass with (world/terrain-material.ts,
 * `setGroundMoisture`): greener in hollows and near water, straw on ridges. From the land height before roads
 * (`TerrainGenerator.landHeight`) - its height against the mean of its surroundings at two scales - and the
 * distance to channels / lakes. Slope (steep = drier) is added in the shader from the vertex normal.
 */
export function bakeGroundMoisture(
  gen: TerrainGenerator,
  map: MapDef,
): GroundMoisture {
  const b = map.bounds;
  const x0 = b.minX - PAD;
  const z0 = b.minZ - PAD;
  const w = b.maxX - b.minX + 2 * PAD;
  const d = b.maxZ - b.minZ + 2 * PAD;
  const res = Math.max(RES, w / MAX_SIDE, d / MAX_SIDE);
  const nx = Math.ceil(w / res);
  const nz = Math.ceil(d / res);
  const n = nx * nz;

  const h = new Float32Array(n);
  const water = new Float32Array(n);
  const pq = newPathQuery();
  const lq = newLakeQuery();
  const half = res / 2;
  for (let j = 0; j < nz; j++) {
    const z = z0 + (j + 0.5) * res;
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * res;
      const k = j * nx + i;
      h[k] = gen.landHeight(x, z);
      // Water anywhere in the texel (narrow streams pass between texel centres).
      let wet = false;
      if (gen.channels?.query(x, z, pq).found)
        wet = pq.distance < pq.halfWidth + half;
      if (!wet && gen.lakes?.query(x, z, lq)) wet = lq.sd < half;
      water[k] = wet ? 1 : 0;
    }
  }

  const near = boxBlur(h, nx, nz, Math.max(1, Math.round(NEAR_R / res)));
  const far = boxBlur(h, nx, nz, Math.max(1, Math.round(FAR_R / res)));
  const bank = boxBlur(water, nx, nz, Math.max(1, Math.round(WATER_R / res)));

  // > 0 = hollow (below the surroundings), < 0 = ridge / knoll; softened by a texel (DEM noise on flat land).
  const raw = new Float32Array(n);
  for (let k = 0; k < n; k++)
    raw[k] = (0.6 * (near[k] - h[k]) + 0.4 * (far[k] - h[k])) / HOLLOW_M;
  const hollow = boxBlur(raw, nx, nz, 1);

  const data = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    let m = Math.tanh(hollow[k]) * 0.8;
    // Banks: wet at the water, fading out over WATER_R (the blurred mask reaches ~0.1 there).
    m += (1 - m) * Math.min(1, bank[k] * 4);
    data[k] = Math.round((0.5 + 0.5 * Math.max(-1, Math.min(1, m))) * 255);
  }

  const t = new DataTexture(data, nx, nz, RedFormat, UnsignedByteType);
  t.magFilter = LinearFilter;
  t.minFilter = LinearFilter;
  t.unpackAlignment = 1; // rows of nx bytes
  t.name = 'ground-moisture';
  t.needsUpdate = true;
  return {
    texture: t,
    map: { x0, z0, invW: 1 / (nx * res), invD: 1 / (nz * res) },
  };
}

/** Separable box blur (radius `r` cells, clamped edges) - a running sum per row, then per column. */
function boxBlur(
  src: Float32Array,
  nx: number,
  nz: number,
  r: number,
): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const span = 2 * r + 1;
  for (let j = 0; j < nz; j++) {
    const row = j * nx;
    const at = (i: number) => src[row + Math.min(nx - 1, Math.max(0, i))];
    let s = 0;
    for (let i = -r; i <= r; i++) s += at(i);
    for (let i = 0; i < nx; i++) {
      tmp[row + i] = s / span;
      s += at(i + r + 1) - at(i - r);
    }
  }
  for (let i = 0; i < nx; i++) {
    const at = (j: number) => tmp[Math.min(nz - 1, Math.max(0, j)) * nx + i];
    let s = 0;
    for (let j = -r; j <= r; j++) s += at(j);
    for (let j = 0; j < nz; j++) {
      out[j * nx + i] = s / span;
      s += at(j + r + 1) - at(j - r);
    }
  }
  return out;
}
