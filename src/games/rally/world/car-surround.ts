import type { Color, Vector3 } from 'three';
import {
  carSurroundUniforms,
  markSurroundDirty,
  SURROUND_BANDS as B,
  SURROUND_BINS as N,
  SURROUND_BLUR,
  SURROUND_RANGE,
  surroundData,
} from '../engine/car-reflections';
import { canopyOf, isVegetation } from './aerial-trees';
import type { FarForest } from './far-forest';
import type { ScatterChunk } from './scatter';
import type { World } from './world';

/** Trees (scatter instances) out to this distance (m); past it the far forest's canopy map and the terrain. */
const TREE_REACH = 70;
/** Terrain horizon samples along each azimuth (m). */
const TERRAIN_D = [6, 10, 15, 22, 31, 43, 60, 82, 110, 150, 205, 280, 380];
/** Up to here the ground is the near heightfield (road cuts and banks), past it the analytic terrain. */
const NEAR_GROUND = 40;
/** Azimuths whose near / far terrain horizon is re-measured per update (the far one is ~10x the cost per sample). */
const NEAR_SLICE = 32;
const FAR_SLICE = 3;
/** Time constant (s) the reflection eases to a new surrounding with: trees slide through it, never pop. */
const EASE = 0.12;
/** The car's reflecting surfaces: this high over its origin (m). */
const EYE = 0.9;
/** Blur radius (azimuth bins) per texture row: sharp clear coat .. rough paint. */
const BLUR = [0, 2, 5, 14];
/** Channels per bin: coverage of the B bands, rgb, ground shade. */
const CH = B + 4;
const BAND = Math.PI / 2 / B;
const BIN = (2 * Math.PI) / N;
/** A crown's opacity (gaps between leaves and branches); trunks are solid. */
const CROWN_OPACITY = 0.8;
/** Crowns are lit brighter than their albedo x the ground's light: leaves scatter light through (translucency). */
const CROWN_GAIN = 1.4;
const BARK = [0.05, 0.042, 0.034];
/** Per packed tree: x, y, z, crown radius, crown centre height, crown vertical radius, r, g, b (linear albedo). */
const TREE_STRIDE = 9;

export interface SurroundLight {
  sunDir: Vector3;
  /** The env map's ground radiance (Environment.groundRadiance). */
  groundRadiance: Color;
  sunElevation: number;
  night: boolean;
}

/**
 * The car's surroundings for its reflections (engine/car-reflections.ts): per azimuth round the car, the elevation
 * bands its trees (crowns, trunks), the far forest's canopy and the terrain cover, their colour lit like the env map's
 * ground, and the forest floor's shade; eased over time, blurred into rows per roughness, uploaded as one small
 * texture. CPU only (no scene render): ~0.1 ms a frame in a wood.
 */
export class CarSurround {
  /** 0 = the car reflects the sky alone; 1 = full. */
  strength = 1;
  private veg = new WeakMap<ScatterChunk, Float32Array>();
  /** This frame's build: transmittance per bin x band, colour sum (rgb + weight), floor transmittance. */
  private trans = new Float32Array(N * B);
  private col = new Float32Array(N * 4);
  private floor = new Float32Array(N);
  /** Terrain horizon per bin, near and far: elevation (rad); the far one's radiance (re-measured in slices). */
  private nearEl = new Float32Array(N);
  private farEl = new Float32Array(N);
  private farCol = new Float32Array(N * 3);
  private nearCursor = 0;
  private farCursor = 0;
  /** The trees are re-gathered every other update (eased in between). */
  private tick = 0;
  /** Targets and the eased values, CH channels per bin. */
  private tgt = new Float32Array(N * CH);
  private cur = new Float32Array(N * CH);
  private blurred = new Float32Array(N * CH);
  private prefix = new Float64Array(N + 1);
  private prefixW = new Float64Array(N + 1);
  private canopy = new Float32Array(4);
  private at = { x: NaN, z: NaN };
  private primed = false;
  /** Covered share of the sky light at the car (0..1), eased; the car's diffuse sky light drops with it. */
  blocked = 0;

  constructor(
    private world: World,
    private farForest?: FarForest,
  ) {}

  /** Rebuild round `pos` (the car), ease by `dt` (s) and upload. */
  update(dt: number, pos: Vector3, light: SurroundLight): void {
    const on = carSurroundUniforms.wsSurroundOn.value;
    if (this.strength <= 0) {
      on.set(0, 1);
      return;
    }
    const y0 = pos.y + EYE;
    // A jump (start, reset, replay seek): measure all of the terrain now and take the new values at once.
    const jumped = !(Math.hypot(pos.x - this.at.x, pos.z - this.at.z) < 25);
    this.at.x = pos.x;
    this.at.z = pos.z;
    if (jumped) this.primed = false;
    const lamb0 = light.night ? 0.012 : 0.25;
    this.measureTerrain(
      pos,
      y0,
      this.primed ? NEAR_SLICE : N,
      false,
      lamb0,
      light.groundRadiance,
    );
    this.measureTerrain(
      pos,
      y0,
      this.primed ? FAR_SLICE : N,
      true,
      lamb0,
      light.groundRadiance,
    );
    if (!this.primed || (this.tick++ & 1) === 0) this.build(pos, y0, light);

    // Ease to the targets.
    const k = this.primed ? 1 - Math.exp(-dt / EASE) : 1;
    const cur = this.cur;
    const tgt = this.tgt;
    for (let i = 0; i < cur.length; i++) cur[i] += (tgt[i] - cur[i]) * k;
    this.blocked += (this.blockedTarget - this.blocked) * k;
    this.primed = true;
    on.set(this.strength, 1 - 0.5 * this.blocked * this.strength);
    this.upload();
  }

  private blockedTarget = 0;

  /** This moment's targets: trees round `pos`, then the terrain horizons under them. */
  private build(pos: Vector3, y0: number, light: SurroundLight): void {
    const lamb = light.night ? 0.012 : 0.25;
    const lsun = light.night ? 0 : 0.55;
    const s = light.sunDir;
    const sh = Math.hypot(s.x, s.z) || 1;
    const sx = s.x / sh;
    const sz = s.z / sh;
    const sinSun = Math.max(0, s.y);
    const cosSun = Math.sqrt(Math.max(0, 1 - sinSun * sinSun));
    const ground = light.groundRadiance;

    const trans = this.trans.fill(1);
    const col = this.col.fill(0);
    const floor = this.floor.fill(1);
    const scatter = this.world.scatter;
    const cs = scatter.chunkSize;
    const R = TREE_REACH;
    for (let cz = Math.floor((pos.z - R) / cs); cz * cs <= pos.z + R; cz++)
      for (let cx = Math.floor((pos.x - R) / cs); cx * cs <= pos.x + R; cx++) {
        const chunk = scatter.cachedChunk(cx, cz);
        if (!chunk) continue;
        const v = this.vegetation(chunk);
        for (let o = 0; o < v.length; o += TREE_STRIDE) {
          const dx = v[o] - pos.x;
          const dz = v[o + 2] - pos.z;
          const d = Math.hypot(dx, dz);
          if (d > R) continue;
          const fade = d > R * 0.8 ? (R - d) / (R * 0.2) : 1;
          const r = v[o + 3];
          const ctr = v[o + 1] + v[o + 4];
          const top = ctr + v[o + 5];
          const bot = Math.max(v[o + 1] + 0.5, ctr - v[o + 5]);
          const az = Math.atan2(dz, dx);
          // The side facing the car: sunlit when the sun is behind the car; crowns overhead show their shaded
          // undersides; a forest's crowns shade each other's sides.
          const facing = d > 0.5 ? Math.max(0, -(dx * sx + dz * sz) / d) : 0;
          const mid = Math.atan2(ctr - y0, Math.max(0.5, d - r));
          const under = 1 - 0.5 * smooth(0.5, 1.2, mid);
          const lit =
            (lamb + lsun * 0.7 * (0.35 * sinSun + 0.65 * facing * cosSun)) *
            under *
            CROWN_GAIN;
          const op = CROWN_OPACITY * fade;
          const cr = v[o + 6] * lit;
          const cg = v[o + 7] * lit;
          const cb = v[o + 8] * lit;
          if (d > 3 * r)
            this.addRect(
              az,
              Math.asin(r / d),
              Math.atan2(bot - y0, d),
              Math.max(Math.atan2(top - y0, d), Math.atan2(ctr - y0, d - r)),
              op,
              cr,
              cg,
              cb,
            );
          else this.addNearCrown(az, d, r, bot - y0, top - y0, op, cr, cg, cb);
          // Trunk, from the ground to the crown (dark bark in the crowns' shade).
          if (d > 0.4 && bot > y0 - 0.5) {
            const tr = 0.12 + 0.05 * r;
            const k = (lamb + lsun * 0.25 * facing * cosSun) * 0.8;
            this.addRect(
              az,
              Math.atan(tr / d),
              -0.1,
              Math.atan2(bot - y0, d),
              0.95 * fade,
              BARK[0] * k,
              BARK[1] * k,
              BARK[2] * k,
            );
          }
          // The ground near the car under this crown: shaded.
          if (d < r + 14) {
            const k = 0.7 * (1 - Math.max(0, d - r) / 14);
            const h = d > r ? Math.asin(r / d) : Math.PI;
            this.addRect(az, h, 0, 0, k, 0, 0, 0, true);
          }
        }
      }

    // Terrain (and the far forest) under its horizon, then the targets.
    const tgt = this.tgt;
    let blockedSum = 0;
    let weightSum = 0;
    for (let i = 0; i < N; i++) {
      const ne = this.nearEl[i];
      const fe = this.farEl[i];
      const e = Math.max(ne, fe) / BAND;
      // Colour: the far forest's / slope's where the far horizon is the higher, else the ground near the road.
      const fw = fe > ne ? 1 : 0;
      let tw = 0;
      for (let k = 0; k < B && e > k; k++) {
        const ov = Math.min(1, e - k);
        trans[i * B + k] *= 1 - ov;
        tw += ov;
      }
      if (tw > 0) {
        const fc = this.farCol;
        col[i * 4] += tw * (ground.r + (fc[i * 3] - ground.r) * fw);
        col[i * 4 + 1] += tw * (ground.g + (fc[i * 3 + 1] - ground.g) * fw);
        col[i * 4 + 2] += tw * (ground.b + (fc[i * 3 + 2] - ground.b) * fw);
        col[i * 4 + 3] += tw;
      }
      const o = i * CH;
      for (let k = 0; k < B; k++) {
        const cov = 1 - trans[i * B + k];
        tgt[o + k] = cov;
        // Sky light seen by the car's sides and roof: band k's share (half cosine-weighted, half even).
        const w = BAND_LIGHT[k];
        blockedSum += cov * w;
        weightSum += w;
      }
      const w = col[i * 4 + 3];
      tgt[o + B] = w > 1e-4 ? col[i * 4] / w : ground.r;
      tgt[o + B + 1] = w > 1e-4 ? col[i * 4 + 1] / w : ground.g;
      tgt[o + B + 2] = w > 1e-4 ? col[i * 4 + 2] / w : ground.b;
      tgt[o + B + 3] = 1 - floor[i];
    }

    this.blockedTarget = blockedSum / weightSum;
  }

  /**
   * Re-measure the terrain horizon of `count` bins (from the cursor on): `far` = the analytic terrain and the far forest's
   * canopy past NEAR_GROUND, else the near heightfield (road cuts and banks).
   */
  private measureTerrain(
    pos: Vector3,
    y0: number,
    count: number,
    far: boolean,
    lamb: number,
    ground: Color,
  ): void {
    const w = this.world;
    const ff = this.farForest;
    const cbuf = this.canopy;
    const els = far ? this.farEl : this.nearEl;
    for (let n = 0; n < Math.min(count, N); n++) {
      const i = far ? this.farCursor : this.nearCursor;
      if (far) this.farCursor = (i + 1) % N;
      else this.nearCursor = (i + 1) % N;
      const az = (i + 0.5) * BIN;
      const ux = Math.cos(az);
      const uz = Math.sin(az);
      let best = -0.2;
      let forest = 0;
      let fr = 0;
      let fg = 0;
      let fb = 0;
      for (const d of TERRAIN_D) {
        if (far !== d > NEAR_GROUND) continue;
        const x = pos.x + ux * d;
        const z = pos.z + uz * d;
        let h = far ? w.analytic.height(x, z) : w.heightAt(x, z);
        let isForest = 0;
        // Past the scatter trees: the far forest's canopy on the ground.
        if (ff && d > TREE_REACH * 0.8) {
          const cover = ff.sampleCanopy(x, z, cbuf);
          if (cover > 0.3) {
            const t = smooth(0.3, 0.7, cover);
            h += (cbuf[0] - h) * t;
            isForest = t;
          }
        }
        const e = Math.atan2(h - y0, d);
        if (e > best) {
          best = e;
          forest = isForest;
          if (isForest) {
            fr = cbuf[1];
            fg = cbuf[2];
            fb = cbuf[3];
          }
        }
      }
      els[i] = best;
      if (!far) continue;
      // A wood seen from afar is mostly shade; bare slopes are the env map's ground.
      const fl = lamb * 2.2 * 0.55;
      this.farCol[i * 3] = ground.r + (fr * fl - ground.r) * forest;
      this.farCol[i * 3 + 1] = ground.g + (fg * fl - ground.g) * forest;
      this.farCol[i * 3 + 2] = ground.b + (fb * fl - ground.b) * forest;
    }
  }

  /**
   * A crown near the car (a cylinder: radius r, d m away at azimuth az, bottom / top `b` / `t` m over the car's eye), bin
   * by bin: along each bin's centre azimuth a ray at elevation e passes through it between the cylinder's walls (t1, t2)
   * when it is between the bottom and top there, so it covers atan(b / t2) .. atan(t / t1) (to the zenith from under it).
   */
  private addNearCrown(
    az: number,
    d: number,
    r: number,
    b: number,
    t: number,
    opacity: number,
    cr: number,
    cg: number,
    cb: number,
  ): void {
    const half = d > r ? Math.asin(r / d) : Math.PI;
    const i0 = half >= Math.PI ? 0 : Math.floor((az - half) / BIN - 0.5);
    const i1 = half >= Math.PI ? N - 1 : Math.ceil((az + half) / BIN - 0.5);
    for (let i = i0; i <= i1; i++) {
      const rel = (i + 0.5) * BIN - az;
      const s = d * Math.sin(rel);
      if (Math.abs(s) >= r) continue;
      const q = Math.sqrt(r * r - s * s);
      const c = d * Math.cos(rel);
      const t2 = c + q;
      if (t2 <= 0.05) continue;
      const t1 = c - q;
      const lo = Math.atan2(b, t2);
      const hi = t1 > 0.05 ? Math.atan2(t, t1) : Math.PI / 2;
      this.addRect((i + 0.5) * BIN, BIN * 0.5, lo, hi, opacity, cr, cg, cb);
    }
  }

  /**
   * A rectangle (azimuth az +- half, elevation lo..hi, rad) of `opacity` into every bin it overlaps (by the overlapped
   * share of the bin); `floorOnly`: shade the ground in those bins instead (by `opacity`).
   */
  private addRect(
    az: number,
    half: number,
    lo: number,
    hi: number,
    opacity: number,
    r: number,
    g: number,
    b: number,
    floorOnly = false,
  ): void {
    const lb = Math.max(0, lo / BAND);
    const hb = Math.min(B, hi / BAND);
    if ((!floorOnly && hb <= lb) || opacity <= 0) return;
    const trans = this.trans;
    const col = this.col;
    const k0 = Math.floor(lb);
    const k1 = Math.ceil(hb);
    const all = half >= Math.PI - 1e-3;
    const b0 = all ? 0 : (az - half) / BIN;
    const b1 = all ? N - 1e-6 : (az + half) / BIN;
    for (let i = Math.floor(b0); i <= Math.floor(b1); i++) {
      const f = Math.min(b1, i + 1) - Math.max(b0, i);
      if (f <= 0) continue;
      const bin = ((i % N) + N) % N;
      const a = opacity * f;
      if (floorOnly) {
        this.floor[bin] *= 1 - a;
        continue;
      }
      for (let k = k0; k < k1; k++) {
        const ov = Math.min(hb, k + 1) - Math.max(lb, k);
        trans[bin * B + k] *= 1 - a * ov;
      }
      const wgt = a * (hb - lb);
      col[bin * 4] += wgt * r;
      col[bin * 4 + 1] += wgt * g;
      col[bin * 4 + 2] += wgt * b;
      col[bin * 4 + 3] += wgt;
    }
  }

  /** A chunk's trees packed once (TREE_STRIDE floats each): bushes and weeds under 0.8 m of crown are left out. */
  private vegetation(chunk: ScatterChunk): Float32Array {
    let v = this.veg.get(chunk);
    if (v) return v;
    const out: number[] = [];
    for (const inst of chunk.instances) {
      if (!isVegetation(inst.asset)) continue;
      const c = canopyOf(inst.asset);
      const r = c.radius * inst.scale;
      if (r < 0.8) continue;
      out.push(
        inst.x,
        inst.y,
        inst.z,
        r,
        c.height * inst.scale,
        c.ry * inst.scale,
        c.color.r,
        c.color.g,
        c.color.b,
      );
    }
    v = new Float32Array(out);
    this.veg.set(chunk, v);
    return v;
  }

  /** Blur each channel round the azimuth per row, write the bytes (engine/car-reflections.ts layout). */
  private upload(): void {
    const cur = this.cur;
    const out = this.blurred;
    const p = this.prefix;
    const pw = this.prefixW;
    const data = surroundData;
    // Colour is averaged by coverage (an open bin has no colour of its own): weights of the low bands.
    pw[0] = 0;
    for (let i = 0; i < N; i++)
      pw[i + 1] = pw[i] + cur[i * CH] + cur[i * CH + 1] + 0.02;
    for (let level = 0; level < SURROUND_BLUR; level++) {
      const rad = BLUR[level];
      if (rad === 0) out.set(cur);
      else
        for (let c = 0; c < CH; c++) {
          const colour = c >= B && c < B + 3;
          p[0] = 0;
          for (let i = 0; i < N; i++) {
            const o = i * CH;
            p[i + 1] =
              p[i] + cur[o + c] * (colour ? cur[o] + cur[o + 1] + 0.02 : 1);
          }
          for (let i = 0; i < N; i++) {
            const v = wrapSum(p, i - rad, i + rad);
            out[i * CH + c] = colour
              ? v / wrapSum(pw, i - rad, i + rad)
              : v / (2 * rad + 1);
          }
        }
      // Rows: level, SURROUND_BLUR + level, 2 SURROUND_BLUR + level.
      for (let i = 0; i < N; i++) {
        const o = i * CH;
        for (let blk = 0; blk < 3; blk++) {
          const t = ((blk * SURROUND_BLUR + level) * N + i) * 4;
          for (let c = 0; c < 4; c++) {
            let v = out[o + blk * 4 + c];
            if (blk === 2 && c < 3)
              v = Math.sqrt(Math.max(0, v) / SURROUND_RANGE);
            data[t + c] = Math.round(Math.min(1, Math.max(0, v)) * 255);
          }
        }
      }
    }
    markSurroundDirty();
  }
}

/** Sum of bins a..b (b - a < N, wrapping round) from a prefix sum `p` (N + 1 entries). */
function wrapSum(p: Float64Array, a: number, b: number): number {
  const lo = ((a % N) + N) % N;
  const hi = lo + (b - a);
  return hi < N ? p[hi + 1] - p[lo] : p[N] - p[lo] + p[hi - N + 1];
}

/** Band k's share of the sky light on the car: half cosine-weighted (roof), half even over the elevation (sides). */
const BAND_LIGHT = Array.from({ length: B }, (_, k) => {
  const a = k * BAND;
  const b = (k + 1) * BAND;
  const cosw = (Math.sin(b) ** 2 - Math.sin(a) ** 2) / 2;
  return 0.5 * cosw * 2 + 0.5 / B;
});

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
