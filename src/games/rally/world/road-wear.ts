import { Noise2D } from '../../../shared/noise';
import type { RoadSample } from './road';

/**
 * Rally-worn tarmac: where cars on a tarmac stage leave the road dirty, as masks per 1 m road sample that the stage
 * road mesh writes into its vertices (`rwA` / `rwB`, world/road-mesh.ts) and the asphalt shader draws
 * (`ROAD_WEAR_*` below, engine/road-surface.ts). Pure functions of the road's curvature, the driven line, the verges and
 * the side road mouths, seeded: the same road always wears the same way. Visual only (physics keeps the surface).
 *
 * - **Cut dirt:** cars cut the inside of tight bends with their inside wheels off the road and drag the verge's earth
 *   and gravel back on: strongest just after the apex, fading along the road (and a little before it), widest at the
 *   apex, more where the inside verge is bare, more on tighter bends; a thinner spill on the outside of the exit.
 * - **Rubber:** dark tyre lines on the driven line in the braking zone before tight bends and through them.
 * - **Mouths:** mud in wheel tracks out of field / dirt tracks (both ways along the road), gravel washed out of paths.
 */

/** Stage road textures that wear (rally tarmac; not the city / parkway asphalts). */
export const WEAR_TEX: ReadonlySet<string> = new Set([
  'road_tarmac',
  'road_tarmac_kerbed',
  'road_tarmac_lines',
  'road_tarmac_plain',
]);
/** Kerbed streets: rubber only (no verge to cut, no mud tracks out of a mouth). */
export const KERBED_TEX: ReadonlySet<string> = new Set(['road_tarmac_kerbed']);

/** A side road mouth on the stage road. */
export interface WearMouth {
  /** Distance along the road (m). */
  along: number;
  /** +1 = left of the road's direction, -1 = right. */
  side: 1 | -1;
  /** Width of the side road (m). */
  width: number;
  /** Vehicles (a field / dirt track): mud in wheel tracks. Otherwise (a path): gravel washed out at the edge. */
  vehicles: boolean;
  /** 0..1. */
  strength: number;
}

export interface WearInput {
  samples: readonly RoadSample[];
  /** Driven line offset per sample (m, + left; road-mesh.ts `drivenLine`). */
  line: Float32Array;
  /** The stage is driven against the samples' order. */
  reverse: boolean;
  /** Per sample, 0..1: loose material the verge each side gives (0 = kerb, deck, wall). */
  vergeL: Float32Array;
  vergeR: Float32Array;
  mouths: readonly WearMouth[];
  seed: number;
}

/** Per sample (1 m) masks, 0..1. */
export interface Wear {
  /** Earth / gravel along the left / right edge (its width across grows with the value). */
  dirtL: Float32Array;
  dirtR: Float32Array;
  /** Rubber lines on the driven line. */
  rub: Float32Array;
  /** Mud out of mouths on the left / right (vertex value: `mudAt`). */
  mudL: Float32Array;
  mudR: Float32Array;
}

/** Bends cut with the inside wheels off the road: none at a radius of CUT_R0 m, full from CUT_R1 m. */
const CUT_R0 = 40;
const CUT_R1 = 12;
/** Bends braked for hard enough to leave rubber: from RUB_R0 m, full at RUB_R1 m. */
const RUB_R0 = 60;
const RUB_R1 = 14;
/** Metres the dragged dirt lasts after the apex (1/e), and before it. */
const DIRT_AFTER = 8;
const DIRT_BEFORE = 4;
/** Spill on the outside of the exit: share of the inside's, and its fade (m). */
const SPILL = 0.1;
const SPILL_AFTER = 12;
/** Strongest cut dirt (0..1 of the mask): a light film, never a carpet across the lane. */
const DIRT_MAX = 0.4;
/** Braking zone before the bend (1/e, m) and the cap on its reach (m). */
const BRAKE_LEN = 24;
const BRAKE_MAX = 45;
/** Mud tracks out of a mouth: 1/e length along the road (m) and the reach. */
const MUD_LEN = 9;
const MUD_MAX = 30;
/** Gravel washed out of a path mouth: fade along the road (m). */
const WASH_LEN = 2.5;

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Exponential trail of `src` along the travel direction (max of src and the decayed trail), `len` m per 1/e. */
function trail(
  src: Float32Array,
  samples: readonly RoadSample[],
  len: number,
  forward: boolean,
  cap = Infinity,
): Float32Array {
  const n = src.length;
  const out = new Float32Array(n);
  let acc = 0;
  let from = 0;
  for (let k = 0; k < n; k++) {
    const i = forward ? k : n - 1 - k;
    const p = forward ? i - 1 : i + 1;
    const step = k ? Math.abs(samples[i].dist - samples[p].dist) : 0;
    acc *= Math.exp(-step / len);
    if (acc < 0.004) acc = 0;
    from += step;
    if (src[i] >= acc) {
      acc = src[i];
      from = 0;
    }
    out[i] = from <= cap ? acc : acc * Math.max(0, 1 - (from - cap) / 5);
  }
  return out;
}

/** Curvature box-filtered over +-`r` m (samples are ~1 m apart). */
function smoothCurvature(
  samples: readonly RoadSample[],
  r: number,
): Float32Array {
  const n = samples.length;
  const out = new Float32Array(n);
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + samples[i].curvature;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - r);
    const b = Math.min(n - 1, i + r);
    out[i] = (pre[b + 1] - pre[a]) / (b - a + 1);
  }
  return out;
}

export function roadWear(inp: WearInput): Wear {
  const { samples, vergeL, vergeR, mouths, reverse } = inp;
  const n = samples.length;
  const fwd = !reverse;
  const noise = new Noise2D(inp.seed);
  const k = smoothCurvature(samples, 6);
  const cutL = new Float32Array(n);
  const cutR = new Float32Array(n);
  const brake = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.abs(k[i]);
    // Some corners are cut harder than others (the drivers, the verge's edge): seeded per ~60 m.
    // Kept light (a thin film at the edge) and only on about one hairpin in three.
    const vary =
      DIRT_MAX *
      smooth(0.15, 0.45, 0.5 + 0.5 * noise.noise2(samples[i].dist / 60, 3.7));
    const c = smooth(1 / CUT_R0, 1 / CUT_R1, a) * vary;
    if (k[i] > 0) cutL[i] = c;
    else cutR[i] = c;
    brake[i] = smooth(1 / RUB_R0, 1 / RUB_R1, a);
  }
  const side = (
    cut: Float32Array,
    other: Float32Array,
    verge: Float32Array,
  ) => {
    const after = trail(cut, samples, DIRT_AFTER, fwd);
    const before = trail(cut, samples, DIRT_BEFORE, !fwd);
    const spill = trail(other, samples, SPILL_AFTER, fwd);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const inside = Math.max(after[i], 0.4 * before[i]);
      const exit = SPILL * Math.max(0, spill[i] - 0.5 * other[i]);
      out[i] = Math.min(1, Math.max(inside, exit) * verge[i]);
    }
    return out;
  };
  const dirtL = side(cutL, cutR, vergeL);
  const dirtR = side(cutR, cutL, vergeR);
  // Rubber: braking into the bend (behind its start against the travel direction), lighter through it.
  const zone = trail(brake, samples, BRAKE_LEN, !fwd, BRAKE_MAX);
  const rub = new Float32Array(n);
  for (let i = 0; i < n; i++)
    rub[i] = Math.min(
      1,
      Math.max(zone[i] * (1 - 0.55 * brake[i]), 0.45 * brake[i]),
    );
  const mudL = new Float32Array(n);
  const mudR = new Float32Array(n);
  for (const m of mouths) {
    // (samples are ~1 m apart from 0: index by distance)
    const i0 = Math.max(0, Math.floor(m.along - MUD_MAX - m.width));
    const i1 = Math.min(n - 1, Math.ceil(m.along + MUD_MAX + m.width) + 2);
    for (let i = i0; i <= i1; i++) {
      const da = Math.abs(samples[i].dist - m.along);
      if (m.vehicles) {
        const d = Math.max(0, da - (m.width / 2 + 1.5));
        const v =
          d > MUD_MAX
            ? 0
            : m.strength * Math.exp(-d / MUD_LEN) * (1 - d / MUD_MAX);
        const arr = m.side > 0 ? mudL : mudR;
        arr[i] = Math.max(arr[i], v);
      } else {
        const d = Math.max(0, da - m.width / 2);
        const v = m.strength * Math.exp(-d / WASH_LEN);
        const arr = m.side > 0 ? dirtL : dirtR;
        arr[i] = Math.max(arr[i], v);
      }
    }
  }
  return { dirtL, dirtR, rub, mudL, mudR };
}

/** Mud at a vertex of sample `i`, `lat` m left of the centre: the near half of the road gets the most. */
export function mudAt(w: Wear, i: number, lat: number, hw: number): number {
  const l = w.mudL[i];
  const r = w.mudR[i];
  if (!l && !r) return 0;
  const t = smooth(-hw, hw, lat);
  return Math.max(l * (0.3 + 0.7 * t), r * (1 - 0.7 * t));
}

/**
 * GLSL of the wear, for the baked asphalt shader (engine/road-surface.ts `applyRoadSurface` with `wear`). Attributes:
 * `rwA` = (metres left of the centre, half width, driven line offset), `rwB` = (dirt left, dirt right, rubber, mud).
 */
export const ROAD_WEAR_VERTEX_PARS = /* glsl */ `
attribute vec3 rwA;
attribute vec4 rwB;
varying vec3 vRwA;
varying vec4 vRwB;
varying vec2 vRwXZ;`;

export const ROAD_WEAR_VERTEX = /* glsl */ `
vRwA = rwA;
vRwB = rwB;
vRwXZ = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;`;

/** Needs `RW_*` defines (road-surface.ts) and `rsHash` / `rsNoise`. */
export const ROAD_WEAR_FRAGMENT_PARS = /* glsl */ `
uniform mediump sampler2DArray tGround;
varying vec3 vRwA;
varying vec4 vRwB;
varying vec2 vRwXZ;
float rwCover = 0.0;
float rwMud = 0.0;
float rwMudThick = 0.0;
float rwRub = 0.0;
float rwSeal = 0.0;
// A line of half width hw at distance d, anti-aliased: thinner than a pixel it fades instead of crawling.
float rwLine( float d, float hw, float pix ) {
  float w = max( hw, 0.5 * pix );
  return ( 1.0 - smoothstep( w - 0.5 * pix, w + 0.5 * pix, d ) ) * ( hw / w );
}`;

/** Inside the asphalt's map block (after the tone / patches: `rsM` = (u * 6, metres along)). */
export const ROAD_WEAR_FRAGMENT = /* glsl */ `
{
  vec2 wp = vRwXZ;
  vec2 dpx = dFdx( wp );
  vec2 dpy = dFdy( wp );
  float lat = vRwA.x;
  float hw = vRwA.y;
  float along = rsM.y;
  // Metres per pixel across / along the road: a line along the road is anti-aliased by the first, one across by the second.
  float pxL = fwidth( lat );
  float pxA = fwidth( along );
  float pix = max( pxL, pxA );
  // Old asphalt (roads with repair patches, rsPatch): potholes filled with darker new asphalt, cut square, mostly in the
  // wheel paths, and sealed cracks (black bitumen bands over the cracks, a little glossy; near only, thinner than a
  // pixel further): one across the road in some 9 m cells, runs along the centre joint and near each edge.
  if ( rsPatch > 0.0 && rsPatchDark < 0.5 ) {
    float near = 1.0 - smoothstep( 0.06, 0.15, pix );
    float dens = rsPatch * mix( 0.45, 1.0, smoothstep( 250.0, 3000.0, along ) );
    float seal = 0.0;
    // filled potholes: one in some 6 m cells, 0.4 - 1.1 m
    float pc = floor( along / 6.0 );
    if ( rsHash( vec2( pc, 61.7 ) ) < 0.4 * dens ) {
      float py = pc * 6.0 + 1.2 + 3.6 * rsHash( vec2( pc, 67.3 ) );
      float r = rsHash( vec2( pc, 71.9 ) );
      float px = r < 0.8 ? ( r < 0.4 ? -1.0 : 1.0 ) * ( 0.5 * hw + ( rsHash( vec2( pc, 73.1 ) ) < 0.5 ? -0.8 : 0.8 ) ) : ( r < 0.9 ? hw - 0.5 : 0.5 - hw );
      vec2 hs = vec2( 0.2 + 0.35 * rsHash( vec2( pc, 79.3 ) ), 0.2 + 0.35 * rsHash( vec2( pc, 83.7 ) ) );
      vec2 q = abs( vec2( lat - px, along - py ) ) - hs;
      float d = length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 );
      float fill = 1.0 - smoothstep( -0.5 * pix, 0.5 * pix, d );
      diffuseColor.rgb *= 1.0 - ( 0.28 + 0.08 * rsNoise( wp * 7.0 ) ) * fill;
      seal = rwLine( abs( d ), 0.018, pix );
    }
    if ( near > 0.0 ) {
      float ci = floor( along / 9.0 );
      float fy = along - ci * 9.0;
      // across the road: wavy, from one edge or the joint to part way over
      if ( rsHash( vec2( ci, 41.3 ) ) < 0.55 * dens ) {
        float cy = 1.0 + 7.0 * rsHash( vec2( ci, 43.1 ) );
        float a0 = mix( -hw, 0.0, step( 0.5, rsHash( vec2( ci, 47.9 ) ) ) ) - 0.2;
        float a1 = a0 + hw * ( 0.7 + 0.6 * rsHash( vec2( ci, 53.3 ) ) );
        float y = cy + 0.25 * ( rsNoise( vec2( lat * 1.1, ci ) ) - 0.5 ) + 0.06 * ( rsNoise( vec2( lat * 7.0, ci + 3.0 ) ) - 0.5 ) + 0.12 * lat * ( rsHash( vec2( ci, 59.1 ) ) - 0.5 );
        float on = step( a0, lat ) * step( lat, a1 );
        seal = max( seal, on * rwLine( abs( fy - y ) * 0.9, 0.014 + 0.01 * rsNoise( vec2( lat * 3.0, ci ) ), pxA ) );
      }
      // along the centre joint and ~0.5 m in from each edge: segments that come and go
      for ( int k = 0; k < 3; k++ ) {
        float fk = float( k );
        float base = k == 0 ? 0.08 : ( k == 1 ? hw - 0.45 : -hw + 0.55 );
        float x = base + 0.18 * ( rsNoise( vec2( along / 4.3, fk * 7.1 ) ) - 0.5 ) + 0.05 * ( rsNoise( vec2( along / 0.7, fk * 3.3 ) ) - 0.5 );
        float on = smoothstep( 0.62, 0.68, rsNoise( vec2( along / 11.0, fk * 5.7 + 2.0 ) ) + 0.25 * ( dens - 1.0 ) + ( k == 0 ? 0.04 : 0.0 ) );
        seal = max( seal, on * rwLine( abs( lat - x ), 0.013 + 0.009 * rsNoise( vec2( along * 2.0, fk ) ), pxL ) );
      }
    }
    rwSeal = seal * near;
    diffuseColor.rgb *= 1.0 - 0.5 * rwSeal;
  }
  if ( max( max( vRwB.x, vRwB.y ), max( vRwB.z, vRwB.w ) ) > 0.004 ) {
    // The verge's earth and gravel (the terrain's own scans, world XZ). Dry it is dust lighter than the earth it came from.
    vec3 soil = textureGrad( tGround, vec3( wp * RW_SOIL_SCALE, RW_SOIL_LAYER ), dpx * RW_SOIL_SCALE, dpy * RW_SOIL_SCALE ).rgb / RW_SOIL_MEAN;
    vec3 grav = textureGrad( tGround, vec3( wp * RW_GR_SCALE, RW_GR_LAYER ), dpx * RW_GR_SCALE, dpy * RW_GR_SCALE ).rgb;
    float hs = dot( grav, vec3( 0.2126, 0.7152, 0.0722 ) ) / RW_GR_MEAN;
    // Edge dirt: dragged by tyres, so streaky along the road; its band across is wider where there is more of it.
    float c = 0.0;
    for ( int s = 0; s < 2; s++ ) {
      float str = s == 0 ? vRwB.x : vRwB.y;
      if ( str < 0.004 ) continue;
      float d = hw - ( s == 0 ? lat : -lat );
      float w = 0.25 + 1.2 * str;
      c = max( c, str * ( 1.0 - smoothstep( -0.2, w, d + 0.35 * w * ( rsNoise( vec2( along / 3.1, float( s ) * 9.0 ) ) - 0.5 ) ) ) );
    }
    float streak = 0.55 * rsNoise( vec2( along / 2.4, lat / 0.22 ) ) + 0.45 * rsNoise( wp / 0.3 + 4.0 );
    float film = smoothstep( streak - 0.16, streak + 0.16, c * 1.25 );
    float haze = 0.35 * c;
    // Mud out of a track: smeared along the wheel paths of both lanes (a blanket right at the mouth), continuous where
    // it is thick and breaking up with distance into patches, clods and flecks with irregular gaps; soft-edged.
    float m = vRwB.w;
    float mud = 0.0;
    float thick = 0.0;
    if ( m > 0.004 ) {
      float tr = 0.0;
      for ( int k = 0; k < 4; k++ ) {
        float fk = float( k );
        float x = ( k < 2 ? 1.0 : -1.0 ) * 0.42 * hw + ( mod( fk, 2.0 ) < 0.5 ? -0.8 : 0.8 ) + 0.25 * ( rsNoise( vec2( along / 9.0, fk * 4.3 ) ) - 0.5 ) + 0.06 * ( rsNoise( vec2( along / 1.9, fk * 2.1 ) ) - 0.5 );
        float w = 0.1 + 0.08 * rsNoise( vec2( along / 2.7, fk * 5.9 ) );
        tr = max( tr, 1.0 - smoothstep( 0.3 * w, 1.6 * w + 0.1, abs( lat - x ) ) );
      }
      // smear amount along the path (long, irregular) and gaps that open up as it thins
      float amt = tr * m * ( 0.6 + 0.6 * rsNoise( vec2( along / 3.3, lat * 1.3 + 3.0 ) ) );
      float gap = 0.55 * rsNoise( vec2( along / 1.3, lat * 2.2 + 11.0 ) ) + 0.45 * rsNoise( vec2( along / 3.1 + lat * 0.7, lat * 1.9 + 5.0 ) );
      float smear = clamp( amt * 1.3 - ( 1.0 - m ) * smoothstep( 0.3, 0.75, gap ), 0.0, 1.0 );
      smear = max( smear, smoothstep( 0.85, 1.0, m ) * ( 0.75 + 0.25 * gap ) );
      // close up: flecks and clods at the smear's thin edges (isotropic, fades out where they would shimmer)
      float fl = 0.6 * rsNoise( wp / 0.09 + 2.0 ) + 0.4 * rsNoise( wp / 0.035 + 7.0 );
      float fd = 1.0 - smoothstep( 0.015, 0.05, pix );
      mud = mix( smoothstep( 0.0, 0.6, smear ), smoothstep( fl - 0.18, fl + 0.18, smear * 1.25 ), fd );
      // (the faint tail: nothing, not a scatter of specks)
      mud *= smoothstep( 0.08, 0.3, smear );
      thick = smoothstep( 0.45, 0.95, smear );
      haze = max( haze, 0.25 * m * ( 0.3 + 0.7 * tr ) );
    }
    rwMud = mud;
    rwCover = max( film, mud );
    // Colours: dust (lighter, warm), stones from the gravel scan, mud (the earth, damp and darker).
    vec3 dust = soil * RW_DUST;
    vec3 base = diffuseColor.rgb;
    diffuseColor.rgb = mix( base, mix( base, dust, 0.6 ), min( 1.0, haze ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, dust * ( 0.85 + 0.3 * rsNoise( wp / 0.5 ) ), film * 0.85 );
    // loose stones over the film, and a few out on the bare asphalt where it thins
    float stones = smoothstep( 1.05, 1.35, hs ) * smoothstep( 0.15, 0.6, c );
    diffuseColor.rgb = mix( diffuseColor.rgb, grav, stones * 0.9 );
    // thin: dried, dusty; thick: darker, wetter brown
    diffuseColor.rgb = mix( diffuseColor.rgb, mix( dust * 0.8, soil * RW_MUD * 0.85, 0.25 + 0.65 * thick ), mud );
    rwMudThick = thick * mud;
    // Wet: dust turns to mud, darker.
    diffuseColor.rgb *= 1.0 - 0.35 * wsWet.x * rwCover;
    // Rubber on the driven line: under each wheel a few cars' tyre lines (0.11 - 0.15 m, a darker core), side by side
    // and wandering, each coming and going (a car brakes a little earlier or later than the last).
    float rb = vRwB.z;
    if ( rb > 0.004 ) {
      float x = lat - vRwA.z + 0.22 * ( rsNoise( vec2( along / 14.0, 1.3 ) ) - 0.5 );
      float t = 0.0;
      for ( int k = 0; k < 4; k++ ) {
        float fk = float( k );
        float o = 0.19 * ( fk - 1.5 ) + 0.1 * ( rsNoise( vec2( along / ( 6.0 + 3.0 * fk ), fk * 2.9 ) ) - 0.5 );
        float hwT = 0.055 + 0.02 * fract( fk * 0.618 );
        float on = smoothstep( 0.35, 0.6, rsNoise( vec2( along / ( 5.0 + 2.0 * fk ), fk * 6.1 + 1.0 ) ) );
        float dA = abs( x - 0.78 - o );
        float dB = abs( x + 0.78 - o );
        float l = max( rwLine( dA, hwT, pxL ) * ( 0.6 + 0.4 * rwLine( dA, 0.5 * hwT, pxL ) ), rwLine( dB, hwT, pxL ) * ( 0.6 + 0.4 * rwLine( dB, 0.5 * hwT, pxL ) ) );
        t = 1.0 - ( 1.0 - t ) * ( 1.0 - 0.7 * l * on * ( 0.75 + 0.25 * rsNoise( vec2( along / 0.35, x * 30.0 ) ) ) );
      }
      rb = sqrt( rb );
      rwRub = t * rb * ( 1.0 - rwCover );
      diffuseColor.rgb *= 1.0 - RW_RUB * rwRub;
    }
  }
}`;

/** After the roughness line: dust and mud are matte (wet: glossier), sealant and rubber a little smoother. */
export const ROAD_WEAR_ROUGHNESS = /* glsl */ `
roughnessFactor = mix( roughnessFactor, mix( 1.0 - 0.22 * rwMudThick, 0.55, wsWet.x ), rwCover ) * ( 1.0 - 0.3 * rwSeal - 0.12 * rwRub );`;

/** After the normal map: under dust and mud the asphalt grain is filled (flatter). */
export const ROAD_WEAR_NORMAL = /* glsl */ `
normal = normalize( mix( normal, nonPerturbedNormal, 0.75 * rwCover + 0.5 * rwSeal ) );`;
