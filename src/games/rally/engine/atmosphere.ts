/**
 * Physical clear-sky daylight (`?light=v2`, engine/environment.ts): the Earth atmosphere of Bruneton / Hillaire
 * (Rayleigh, Mie aerosols, ozone over a spherical planet) integrated on the CPU once per sun angle. It gives the sun's
 * colour and strength at the ground, a sky-view table of the sky's radiance (the dome and the env map draw it), the
 * sky's light on flat ground and the horizon's colour all round (the aerial perspective's in-scattered light), all in
 * the same units, so the sun / sky balance, the sky's brightness and the haze come from one model instead of per-map
 * numbers. DOM-free (tests run it in node).
 *
 * Units: scene light (a DirectionalLight's intensity), scaled so the noon sun of a standard day is `SUN_NOON`, and
 * white balanced like a camera on daylight: the total light on flat ground at noon is neutral, so a low sun is golden.
 * Multiple scattering: Hillaire 2020's isotropic second-order term (`psi` table), ground bounce included.
 */

const RG = 6_360_000;
const RT = 6_460_000;
/** Rayleigh scattering at sea level (1/m, R G B) and its scale height. */
const RAY = [5.802e-6, 13.558e-6, 33.1e-6];
const H_RAY = 8000;
/** Mie (aerosol) scattering / absorption at sea level for `mie` = 1 (a very clear day), scale height, asymmetry. */
const MIE_S = 3.996e-6;
const MIE_A = 0.444e-6;
const H_MIE = 1200;
const MIE_G = 0.8;
/** Ozone absorption (1/m): a tent layer round 25 km. */
const OZONE = [0.65e-6, 1.881e-6, 0.085e-6];

/** Noon sun (58 deg, `mie` = `MIE_REF`) in scene units: the old `DAY_LIGHT.sun`, so lamps keep their balance. */
const SUN_NOON = 4.5;
const NOON_ELEVATION = 58;
const MIE_REF = 16;

/** Sky-view table: azimuth from the sun 0..180 deg (columns), elevation 0..90 deg on a square-root scale (rows). */
export const SKY_LUT_W = 64;
export const SKY_LUT_H = 48;

const NH = 32;
const NM = 128;
const PSI_H = 12;
const PSI_M = 32;

export interface AtmosphereOptions {
  /** Aerosols x a very clear day (1, ~200 km visibility); 8 = clear mountain air (~80 km), 24 = a hazy valley (~30 km). */
  mie: number;
  /** Camera height above sea level (m). */
  altitude: number;
  /** Mean ground albedo (the second-order scattering's bounce). */
  albedo: number;
}

/** A map's sky turbidity (three's Preetham `Sky`, 2 = clear, 4+ = hazy) -> the model's aerosol amount. */
export function mieFromTurbidity(turbidity: number): number {
  return Math.min(40, Math.max(1, 8 * (turbidity - 1)));
}

type RGB = [number, number, number];

function hOf(i: number, n: number): number {
  const x = i / (n - 1);
  return x * x * (RT - RG);
}
function hIndex(h: number, n: number): number {
  return Math.sqrt(Math.min(1, Math.max(0, h / (RT - RG)))) * (n - 1);
}
function muOf(j: number, n: number): number {
  const x = (j / (n - 1)) * 2 - 1;
  return Math.sign(x) * x * x;
}
function muIndex(mu: number, n: number): number {
  const m = Math.min(1, Math.max(-1, mu));
  return ((Math.sign(m) * Math.sqrt(Math.abs(m)) + 1) / 2) * (n - 1);
}

/** Bilinear lookup in a (rows = height, cols = mu) table of RGB. */
function lookup(
  t: Float32Array,
  nh: number,
  nm: number,
  fi: number,
  fj: number,
  out: RGB,
): RGB {
  const i0 = Math.min(nh - 2, Math.floor(fi));
  const j0 = Math.min(nm - 2, Math.floor(fj));
  const a = fi - i0;
  const b = fj - j0;
  for (let c = 0; c < 3; c++) {
    const p = (i0 * nm + j0) * 3 + c;
    const q = ((i0 + 1) * nm + j0) * 3 + c;
    out[c] =
      (t[p] * (1 - b) + t[p + 3] * b) * (1 - a) +
      (t[q] * (1 - b) + t[q + 3] * b) * a;
  }
  return out;
}

function rayleighPhase(c: number): number {
  return (3 / (16 * Math.PI)) * (1 + c * c);
}
function miePhase(c: number): number {
  const g2 = MIE_G * MIE_G;
  return (
    ((3 / (8 * Math.PI)) * ((1 - g2) * (1 + c * c))) /
    ((2 + g2) * Math.pow(1 + g2 - 2 * MIE_G * c, 1.5))
  );
}

/** Distance from radius `r` along cos-zenith `mu` to the atmosphere's top, or to the ground (negative = ground). */
function rayLength(r: number, mu: number): number {
  const d = r * r * (mu * mu - 1);
  if (mu < 0 && d + RG * RG >= 0) return -(-r * mu - Math.sqrt(d + RG * RG));
  return -r * mu + Math.sqrt(Math.max(0, d + RT * RT));
}

export class Atmosphere {
  readonly opts: AtmosphereOptions;
  private trans = new Float32Array(NH * NM * 3);
  private psi = new Float32Array(PSI_H * PSI_M * 3);
  private _t: RGB = [0, 0, 0];
  private _p: RGB = [0, 0, 0];

  constructor(opts: AtmosphereOptions) {
    this.opts = opts;
    this.buildTransmittance();
    this.buildPsi();
  }

  /** Scattering (Rayleigh, Mie) and extinction at height `h` (m). */
  private medium(h: number, ray: RGB, ext: RGB): number {
    const r = Math.exp(-h / H_RAY);
    const m = Math.exp(-h / H_MIE) * this.opts.mie;
    const o = Math.max(0, 1 - Math.abs(h - 25_000) / 15_000);
    for (let c = 0; c < 3; c++) {
      ray[c] = RAY[c] * r;
      ext[c] = ray[c] + (MIE_S + MIE_A) * m + OZONE[c] * o;
    }
    return MIE_S * m;
  }

  private buildTransmittance(): void {
    const ray: RGB = [0, 0, 0];
    const ext: RGB = [0, 0, 0];
    const steps = 40;
    for (let i = 0; i < NH; i++) {
      const r = RG + hOf(i, NH);
      for (let j = 0; j < NM; j++) {
        const mu = muOf(j, NM);
        const len = rayLength(r, mu);
        const o = (i * NM + j) * 3;
        if (len < 0) continue; // sun below the ground: 0
        const tau = [0, 0, 0];
        const dt = len / steps;
        for (let k = 0; k < steps; k++) {
          const t = (k + 0.5) * dt;
          const h = Math.sqrt(r * r + t * t + 2 * r * mu * t) - RG;
          this.medium(h, ray, ext);
          for (let c = 0; c < 3; c++) tau[c] += ext[c] * dt;
        }
        for (let c = 0; c < 3; c++) this.trans[o + c] = Math.exp(-tau[c]);
      }
    }
  }

  /** Transmittance from height `h` to space along cos-zenith `mu` (0 where the ground is in the way). */
  transmittance(h: number, mu: number, out: RGB = [0, 0, 0]): RGB {
    return lookup(this.trans, NH, NM, hIndex(h, NH), muIndex(mu, NM), out);
  }

  /** Hillaire's multiple-scattering transfer: isotropic 2nd order light / (1 - f_ms), per unit sun irradiance. */
  private buildPsi(): void {
    const dirs = 32;
    const steps = 12;
    const ray: RGB = [0, 0, 0];
    const ext: RGB = [0, 0, 0];
    const ts: RGB = [0, 0, 0];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < PSI_H; i++) {
      const r = RG + hOf(i, PSI_H);
      for (let j = 0; j < PSI_M; j++) {
        const muS = muOf(j, PSI_M);
        const sx = Math.sqrt(1 - muS * muS);
        const l2 = [0, 0, 0];
        const fms = [0, 0, 0];
        for (let d = 0; d < dirs; d++) {
          // Fibonacci sphere.
          const wy = 1 - (2 * (d + 0.5)) / dirs;
          const rr = Math.sqrt(1 - wy * wy);
          const wx = Math.cos(golden * d) * rr;
          const wz = Math.sin(golden * d) * rr;
          const raw = rayLength(r, wy);
          const len = Math.min(Math.abs(raw), 400_000);
          const T = [1, 1, 1];
          const L = [0, 0, 0];
          const f = [0, 0, 0];
          for (let k = 0; k < steps; k++) {
            const t0 = len * (k / steps) ** 2;
            const t1 = len * ((k + 1) / steps) ** 2;
            const t = (t0 + t1) / 2;
            const dt = t1 - t0;
            const px = wx * t;
            const py = r + wy * t;
            const pz = wz * t;
            const prad = Math.hypot(px, py, pz);
            const h = prad - RG;
            const mie = this.medium(h, ray, ext);
            const mus = (px * sx + py * muS) / prad;
            this.transmittance(h, mus, ts);
            for (let c = 0; c < 3; c++) {
              const sc = ray[c] + mie;
              const e = Math.max(ext[c], 1e-12);
              const stepT = Math.exp(-e * dt);
              const integ = (1 - stepT) / e;
              L[c] += (T[c] * sc * ts[c] * integ) / (4 * Math.PI);
              f[c] += T[c] * sc * integ;
              T[c] *= stepT;
            }
          }
          if (raw < 0) {
            // The ground: lit by the sun at its own angle, albedo / pi back up.
            const gx = wx * len;
            const gy = r + wy * len;
            const gz = wz * len;
            const gr = Math.hypot(gx, gy, gz);
            const mus = (gx * sx + gy * muS) / gr;
            this.transmittance(0, mus, ts);
            for (let c = 0; c < 3; c++)
              L[c] +=
                (T[c] * ts[c] * Math.max(mus, 0) * this.opts.albedo) / Math.PI;
          }
          for (let c = 0; c < 3; c++) {
            l2[c] += L[c] / dirs;
            fms[c] += f[c] / dirs;
          }
        }
        const o = (i * PSI_M + j) * 3;
        for (let c = 0; c < 3; c++)
          this.psi[o + c] = l2[c] / Math.max(1e-3, 1 - fms[c]);
      }
    }
  }

  private psiAt(h: number, muS: number, out: RGB): RGB {
    return lookup(
      this.psi,
      PSI_H,
      PSI_M,
      hIndex(h, PSI_H),
      muIndex(muS, PSI_M),
      out,
    );
  }

  /** Sky radiance for unit sun irradiance: view elevation / azimuth from the sun (rad), sun elevation (rad). */
  radiance(el: number, az: number, sunEl: number, out: RGB): RGB {
    const r = RG + this.opts.altitude;
    const sx = Math.cos(sunEl);
    const sy = Math.sin(sunEl);
    const wx = Math.cos(el) * Math.cos(az);
    const wy = Math.sin(el);
    const wz = Math.cos(el) * Math.sin(az);
    const cosT = wx * sx + wy * sy;
    const pR = rayleighPhase(cosT);
    const pM = miePhase(cosT);
    const raw = rayLength(r, wy);
    const len = Math.abs(raw);
    const steps = 30;
    const ray: RGB = [0, 0, 0];
    const ext: RGB = [0, 0, 0];
    const ts = this._t;
    const ps = this._p;
    const T = [1, 1, 1];
    out[0] = out[1] = out[2] = 0;
    for (let k = 0; k < steps; k++) {
      const t0 = len * (k / steps) ** 2;
      const t1 = len * ((k + 1) / steps) ** 2;
      const t = (t0 + t1) / 2;
      const dt = t1 - t0;
      const px = wx * t;
      const py = r + wy * t;
      const pz = wz * t;
      const prad = Math.hypot(px, py, pz);
      const h = prad - RG;
      const mie = this.medium(h, ray, ext);
      const mus = (px * sx + py * sy) / prad;
      this.transmittance(h, mus, ts);
      this.psiAt(h, mus, ps);
      for (let c = 0; c < 3; c++) {
        const e = Math.max(ext[c], 1e-12);
        const stepT = Math.exp(-e * dt);
        const s = ts[c] * (ray[c] * pR + mie * pM) + ps[c] * (ray[c] + mie);
        out[c] += (T[c] * s * (1 - stepT)) / e;
        T[c] *= stepT;
      }
    }
    return out;
  }

  /**
   * The sky-view table for a sun elevation (deg), RGB per texel (`SKY_LUT_W` x `SKY_LUT_H`), per unit sun irradiance.
   * Texel (i, j): azimuth from the sun = i / (W - 1) x 180 deg, elevation = (j / (H - 1))^2 x 90 deg.
   */
  skyView(sunElevation: number): Float32Array {
    const out = new Float32Array(SKY_LUT_W * SKY_LUT_H * 3);
    const se = (sunElevation * Math.PI) / 180;
    const px: RGB = [0, 0, 0];
    for (let j = 0; j < SKY_LUT_H; j++) {
      const v = j / (SKY_LUT_H - 1);
      // Just above the horizon at row 0 (a ray along the horizon runs 1000 km through the air).
      const el = Math.max(0.002, v * v * (Math.PI / 2));
      for (let i = 0; i < SKY_LUT_W; i++) {
        const az = (i / (SKY_LUT_W - 1)) * Math.PI;
        this.radiance(el, az, se, px);
        const o = (j * SKY_LUT_W + i) * 3;
        out[o] = px[0];
        out[o + 1] = px[1];
        out[o + 2] = px[2];
      }
    }
    return out;
  }
}

/** Bilinear sample of a sky-view table at elevation / azimuth-from-sun (rad). */
export function sampleSkyView(
  lut: Float32Array,
  el: number,
  az: number,
  out: RGB = [0, 0, 0],
): RGB {
  const fj = Math.sqrt(Math.max(0, el) / (Math.PI / 2)) * (SKY_LUT_H - 1);
  const fi = (Math.min(Math.PI, Math.abs(az)) / Math.PI) * (SKY_LUT_W - 1);
  return lookup(lut, SKY_LUT_H, SKY_LUT_W, fj, fi, out);
}

/** Irradiance of the sky dome (no sun disc) on flat ground, from a sky-view table. */
export function skyIrradiance(lut: Float32Array): RGB {
  const out: RGB = [0, 0, 0];
  const ne = 32;
  const na = 32;
  const px: RGB = [0, 0, 0];
  const de = Math.PI / 2 / ne;
  const da = Math.PI / na;
  for (let j = 0; j < ne; j++) {
    const el = (j + 0.5) * de;
    // cos(zenith) x solid angle; x 2 for the mirrored half of the azimuths.
    const w = Math.sin(el) * Math.cos(el) * de * da * 2;
    for (let i = 0; i < na; i++) {
      sampleSkyView(lut, el, (i + 0.5) * da, px);
      for (let c = 0; c < 3; c++) out[c] += px[c] * w;
    }
  }
  return out;
}

/**
 * The horizon's radiance round the view as a + b c + d max(c, 0)^12, c = cos(azimuth from the sun) (horizontal: a
 * high sun keeps its lobe off the haze) for a view 1 deg up: least squares over the table's azimuths. The aerial perspective lights its haze with it
 * (`HAZE_FRAGMENT`), so far land fades into the sky's own horizon.
 */
export function horizonFit(
  lut: Float32Array,
  sunElevation: number,
): { a: RGB; b: RGB; d: RGB } {
  void sunElevation;
  const el = Math.PI / 180;
  const n = 48;
  const A = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const y: RGB[] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const px: RGB = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const az = ((i + 0.5) / n) * Math.PI;
    const c = Math.cos(az);
    const basis = [1, c, Math.max(c, 0) ** 12];
    sampleSkyView(lut, el, az, px);
    // Relative error: the bright aureole of a low sun would otherwise pull the fit off everywhere else.
    const wt = 1 / (luminance(px) + 0.01) ** 2;
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < 3; k++) A[r][k] += wt * basis[r] * basis[k];
      for (let ch = 0; ch < 3; ch++) y[r][ch] += wt * basis[r] * px[ch];
    }
  }
  // Tiny ridge: a sun high in the sky leaves the lobe column near zero.
  for (let r = 0; r < 3; r++) A[r][r] += 1e-3;
  const sol = solve3(A, y);
  return { a: sol[0], b: sol[1], d: sol[2] };
}

function solve3(A: number[][], y: RGB[]): RGB[] {
  const m = A.map((row, i) => [...row, ...y[i]]);
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++)
      if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    [m[col], m[piv]] = [m[piv], m[col]];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let k = col; k < 6; k++) m[r][k] -= f * m[col][k];
    }
  }
  return [0, 1, 2].map(
    (r) => [3, 4, 5].map((k) => m[r][k] / m[r][r]) as RGB,
  ) as RGB[];
}

const cache = new Map<string, Atmosphere>();
/** One atmosphere per option set (its tables take a few ms to build). */
export function atmosphereFor(opts: AtmosphereOptions): Atmosphere {
  const key = `${opts.mie.toFixed(2)}|${Math.round(opts.altitude)}|${opts.albedo.toFixed(2)}`;
  let a = cache.get(key);
  if (!a) {
    a = new Atmosphere(opts);
    cache.set(key, a);
  }
  return a;
}

export interface Daylight {
  /** Sun irradiance at the camera (scene units, rgb; normal to the beam). */
  sun: RGB;
  /** The sky's irradiance on flat ground (no sun). */
  sky: RGB;
  /** Sky-view table in scene units (`SKY_LUT_W` x `SKY_LUT_H` RGB). */
  lut: Float32Array;
  /** The horizon's light round the view (see `horizonFit`), scene units. */
  horizon: { a: RGB; b: RGB; d: RGB };
  /** Extinction per channel at the ground relative to its luminance (far land turns blue: blue dims most). */
  extinction: RGB;
}

const LUM = [0.2126, 0.7152, 0.0722];
export function luminance(c: readonly number[]): number {
  return c[0] * LUM[0] + c[1] * LUM[1] + c[2] * LUM[2];
}

/**
 * The camera's daylight white balance and scale (per channel): the total light on flat ground under a 58 deg sun on a
 * standard day comes out neutral, and that sun at `SUN_NOON`.
 */
let balance: RGB | undefined;
function whiteBalance(): RGB {
  if (balance) return balance;
  const atm = atmosphereFor({ mie: MIE_REF, altitude: 400, albedo: 0.15 });
  const sun = atm.transmittance(
    400,
    Math.sin((NOON_ELEVATION * Math.PI) / 180),
  );
  const sky = skyIrradiance(atm.skyView(NOON_ELEVATION));
  const s = Math.sin((NOON_ELEVATION * Math.PI) / 180);
  const total = [0, 1, 2].map((c) => sun[c] * s + sky[c]);
  const lt = luminance(total);
  const wb = total.map((t) => lt / t) as RGB;
  const k =
    SUN_NOON / luminance([sun[0] * wb[0], sun[1] * wb[1], sun[2] * wb[2]]);
  balance = [wb[0] * k, wb[1] * k, wb[2] * k];
  return balance;
}

/** Daylight for a sun elevation (deg) through an atmosphere: everything `Environment` needs for `light=v2`. */
export function daylight(
  sunElevation: number,
  opts: AtmosphereOptions,
): Daylight {
  const atm = atmosphereFor(opts);
  const wb = whiteBalance();
  const t = atm.transmittance(
    opts.altitude,
    Math.sin((sunElevation * Math.PI) / 180),
  );
  const sun = [t[0] * wb[0], t[1] * wb[1], t[2] * wb[2]] as RGB;
  const lut = atm.skyView(sunElevation);
  for (let i = 0; i < lut.length; i++) lut[i] *= wb[i % 3];
  const sky = skyIrradiance(lut);
  const horizon = horizonFit(lut, sunElevation);
  const h = opts.altitude;
  const m = Math.exp(-h / H_MIE) * opts.mie * (MIE_S + MIE_A);
  const ext = RAY.map((r) => r * Math.exp(-h / H_RAY) + m);
  const le = luminance(ext);
  return {
    sun,
    sky,
    lut,
    horizon,
    extinction: ext.map((e) => e / le) as RGB,
  };
}
