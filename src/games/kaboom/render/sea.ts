import {
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  LinearFilter,
  Mesh,
  PlaneGeometry,
  RedFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector4,
  type BufferGeometry,
  type Texture,
} from 'three';

/** Height of the sea surface under the raft (the tiles' tops are at 0). */
export const WATER_Y = -0.8;
/** Edge of the water plane: far more than the camera ever sees. */
const WATER_SIZE = 280;
/** Splashes the water remembers at once (a ring buffer). */
const RIPPLES = 12;
/** Seconds a splash ring takes to fade. */
export const RIPPLE_S = 2.2;
/** The contact field stores the distance to the nearest hull up to this many metres. */
const REACH = 4;
/** Texels along the long side of the contact field. */
const FIELD_RES = 256;
/** The level's HDRI is brighter than the sky colours it stands in for (High quality reflects it). */
const ENV_GAIN = 0.32;
/** The HDRI is read at this roughness (a soft sky: the clouds, no hard edges). */
const ENV_ROUGHNESS = 0.2;
/** Direction the wind blows from (radians in x-z): the swells and the chop run along it, fanned out. */
const WIND = 0.55;

/**
 * Directional waves `[wavelength m, height or steepness, angle off the wind, phase]`. Swells move the vertices (height in
 * m); the chop only bends the normals in the fragment shader (steepness = slope). Wavelengths step by an irrational-ish
 * ratio and the directions fan out unevenly, so no two waves line up into a grid.
 */
const SWELLS: readonly (readonly number[])[] = [
  [16.5, 0.045, 0, 0],
  [10.7, 0.03, -0.55, 1.9],
  [7.3, 0.018, 0.7, 4.1],
];
const CHOP: readonly (readonly number[])[] = [
  [3.3, 0.11, 0.25, 0.7],
  [2.35, 0.1, -0.85, 2.6],
  [1.62, 0.085, 1.05, 5.3],
  [1.13, 0.075, -0.3, 3.4],
  [0.79, 0.06, 0.8, 1.2],
  [0.56, 0.05, -1.2, 4.7],
];
/** Low tier: the three longest chop waves only. */
const CHOP_LOW = 3;

/**
 * One wave term in GLSL: adds its height to `h` (`withHeight`) and its slope to `s`, fading where a pixel is wider than
 * the wave (`fw` = metres per pixel) so the far sea never shimmers. Deep-water speed, slowed for the toy scale.
 */
function waveGlsl(
  [len, amp, ang, phase]: readonly number[],
  slopeOnly: boolean,
): string {
  const k = (2 * Math.PI) / len;
  const w = Math.sqrt(9.81 * k) * 0.55;
  const dx = Math.cos(WIND + ang);
  const dz = Math.sin(WIND + ang);
  // swell: height `amp`, slope amp * k; chop: steepness `amp` straight
  const slope = slopeOnly ? amp : amp * k;
  const f = (v: number) => v.toFixed(5);
  return `{
      float ph = dot(p, vec2(${f(dx)}, ${f(dz)})) * ${f(k)} - t * ${f(w)} + ${f(phase)};
      float a = 1.0 - smoothstep(${f(len * 0.12)}, ${f(len * 0.45)}, fw);
      ${slopeOnly ? '' : `h += ${f(amp)} * sin(ph);`}
      s += vec2(${f(dx)}, ${f(dz)}) * (${f(slope)} * cos(ph) * a * gain);
    }`;
}

const VERT = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorld;
  void main() {
    vec2 p = position.xz;
    float t = uTime;
    float h = 0.0;
    vec2 s = vec2(0.0);
    float fw = 0.0;
    float gain = 1.0;
    ${SWELLS.map((w) => waveGlsl(w, false)).join('\n')}
    vec4 w = modelMatrix * vec4(position.x, position.y + h, position.z, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec2 uHalf;
  uniform vec4 uRip[${RIPPLES}];
  uniform sampler2D uField;
  uniform vec4 uFieldBox;
  uniform vec3 uSkyTop;
  uniform vec3 uSkyMid;
  uniform vec3 uSkyLow;
  varying vec3 vWorld;
  #ifdef SEA_ENV
  uniform samplerCube envMap;
  uniform float uEnvMip;
  #endif
  float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  }
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  // distance to the nearest hull or the raft's edge (m, 0 inside)
  float contact(vec2 p) {
    return texture2D(uField, (p - uFieldBox.xy) * uFieldBox.zw).r * ${REACH.toFixed(1)};
  }
  vec3 sky(float y) {
    y = clamp(y, 0.0, 1.0);
    return mix(mix(uSkyLow, uSkyMid, smoothstep(0.0, 0.3, y)), uSkyTop, smoothstep(0.25, 0.85, y));
  }
  void main() {
    vec2 p = vWorld.xz;
    float t = uTime;
    vec3 V = normalize(cameraPosition - vWorld);
    float fw = length(fwidth(p));
    float c = contact(p);
    float sd = sdBox(p, uHalf);

    // wind patches: the chop is livelier in some places than others, drifting slowly (big-scale variation)
    float patchy = vnoise(p * 0.045 + vec2(t * 0.012, -t * 0.008)) * 0.65 + vnoise(p * 0.13 - t * 0.02) * 0.35;
    float h = 0.0;
    vec2 s = vec2(0.0);
    float gain = 1.0;
    ${SWELLS.map((w) => waveGlsl(w, false)).join('\n')}
    // the hulls calm the chop right next to them
    gain = (0.55 + 0.9 * patchy) * (0.45 + 0.55 * smoothstep(0.0, 1.2, c));
    {
      // the chop on a gently warped grid: its crests bend and never line up in rows
      vec2 p = vWorld.xz + (vec2(vnoise(vWorld.xz * 0.23), vnoise(vWorld.xz * 0.23 + 7.3)) - 0.5) * 2.2;
      #ifdef LOW
      ${CHOP.slice(0, CHOP_LOW)
        .map((w) => waveGlsl(w, true))
        .join('\n')}
      #else
      ${CHOP.map((w) => waveGlsl(w, true)).join('\n')}
      #endif
    }
    #ifndef LOW
    // wavelets lapping out from every hull
    vec2 e = vec2(0.12, 0.0);
    vec2 cg = vec2(contact(p + e.xy) - c, contact(p + e.yx) - c) / 0.12;
    s += cg * (0.09 * sin(c * 8.5 - t * 3.2) * exp(-c * 0.9) * step(0.02, c));
    #endif
    vec3 N = normalize(vec3(-s.x, 1.0, -s.y));
    float NV = max(dot(N, V), 0.0);

    // the water itself: deep blue-green, a lighter teal round the fleet, slow darker and greener patches far out
    vec3 deep = vec3(0.012, 0.085, 0.15);
    vec3 mid = vec3(0.02, 0.17, 0.22);
    vec3 lagoon = vec3(0.04, 0.3, 0.32);
    float far = vnoise(p * 0.018 + 3.7);
    vec3 body = mix(mid, deep, smoothstep(5.0, 40.0, c + 20.0 * far));
    body = mix(body, lagoon, 0.55 * exp(-c * 0.45));
    body *= 0.9 + 0.2 * vnoise(p * 0.06 + 11.0);
    // light scattering up through the wave faces that lean towards the sun
    vec3 L = normalize(vec3(-0.5, 1.0, 0.7));
    body *= 0.8 + 0.45 * max(dot(N, L), 0.0);
    body += vec3(0.01, 0.05, 0.045) * smoothstep(0.0, 0.07, h);

    // the sky in the water: Fresnel (a little lifted, so it reads from the steep camera too)
    vec3 R = reflect(-V, N);
    float fres = 0.04 + 0.96 * pow(1.0 - NV, 5.0);
    fres = clamp(fres * 1.6 + 0.05, 0.0, 1.0);
    vec3 refl = sky(R.y) * 0.85;
    #ifdef SEA_ENV
    // High: the level's HDRI (its clouds) over the plain sky colours, scaled down to them
    refl = mix(refl, textureLod(envMap, vec3(R.x, abs(R.y), R.z), uEnvMip).rgb * ${ENV_GAIN.toFixed(2)}, 0.7);
    #endif
    vec3 col = mix(body, refl, fres);
    #ifndef LOW
    // the sun's glint on the steepest faces, and fine sparkles where the chop is sharpest
    float sun = max(dot(R, L), 0.0);
    col += vec3(1.0, 0.92, 0.76) * (pow(sun, 90.0) * 0.6 + pow(sun, 900.0) * 4.0 * smoothstep(0.4, 0.8, patchy));
    #endif

    // in the shade of the raft and the hulls: a darker band right against the wood
    col *= 1.0 - 0.55 * smoothstep(0.1, -0.5, sd);
    col *= 1.0 - 0.3 * exp(-c * 3.5);

    // foam breaking along every hull and the raft's edge: a ragged, moving band with loose bubbles behind it
    float n1 = vnoise(p * 2.3 + vec2(t * 0.35, -t * 0.25));
    float n2 = vnoise(p * 6.1 - vec2(t * 0.5, t * 0.3));
    float surge = 0.5 + 0.5 * sin(t * 1.4 + vnoise(p * 0.35) * 6.28);
    float band = 1.0 - c / (0.14 + 0.3 * surge);
    float foam = smoothstep(0.15, 0.5, band + (n1 - 0.5) * 0.9 + (n2 - 0.5) * 0.35);
    float trail = smoothstep(0.68, 0.85, n1 * 0.6 + n2 * 0.5) * exp(-c * 1.6) * step(0.05, c);
    foam = max(foam, trail * 0.55) * smoothstep(-0.3, 0.0, sd);
    col = mix(col, vec3(0.74, 0.86, 0.88), foam * 0.8);

    // splashes: a foam blob where the tile went in, a ring racing outwards
    for (int i = 0; i < ${RIPPLES}; i++) {
      vec4 r = uRip[i];
      float age = uTime - r.z;
      if (age > 0.0 && age < ${RIPPLE_S.toFixed(1)}) {
        float dist = length(vWorld.xz - r.xy);
        float k = age / ${RIPPLE_S.toFixed(1)};
        float ring = smoothstep(0.2, 0.0, abs(dist - age * 2.4)) * (1.0 - k);
        float blob = smoothstep(0.75, 0.0, dist) * (1.0 - smoothstep(0.35, 0.9, k));
        col = mix(col, vec3(0.9, 0.97, 0.98), clamp(ring * 0.7 + blob * 0.85, 0.0, 1.0));
      }
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Squared distance transform of one row / column (Felzenszwalb & Huttenlocher), in place. */
function edt1d(
  f: Float64Array,
  n: number,
  v: Int32Array,
  z: Float64Array,
  d: Float64Array,
): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    const meet = (r: number) =>
      (f[q] + q * q - (f[r] + r * r)) / (2 * q - 2 * r);
    let s = meet(v[k]);
    while (s <= z[k]) s = meet(v[--k]);
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
  for (let q = 0; q < n; q++) f[q] = d[q];
}

/**
 * The contact field: for every patch of water round the raft, the distance (m, up to `REACH`) to the nearest hull
 * (`outlines`, waterline polygons) or to the raft's edge. Baked once per raft size on the CPU, one small R8 texture; the
 * sea darkens, calms and foams by it. `box` gets the shader's mapping `[x0, z0, 1 / width, 1 / depth]`.
 */
export function contactField(
  hx: number,
  hz: number,
  outlines: readonly (readonly number[])[],
): { texture: DataTexture; box: Vector4 } {
  let ex = hx;
  let ez = hz;
  for (const o of outlines)
    for (let i = 0; i < o.length; i += 2) {
      ex = Math.max(ex, Math.abs(o[i]));
      ez = Math.max(ez, Math.abs(o[i + 1]));
    }
  ex += REACH + 0.5;
  ez += REACH + 0.5;
  const ts = (2 * Math.max(ex, ez)) / FIELD_RES;
  const W = Math.ceil((2 * ex) / ts);
  const H = Math.ceil((2 * ez) / ts);
  const x0 = -W * ts * 0.5;
  const z0 = -H * ts * 0.5;
  const BIG = 1e12;
  const f = new Float64Array(W * H).fill(BIG);
  const mark = (x: number, z: number) => {
    const i = Math.floor((x - x0) / ts);
    const j = Math.floor((z - z0) / ts);
    return [i, j] as const;
  };
  // the raft
  {
    const [i0, j0] = mark(-hx, -hz);
    const [i1, j1] = mark(hx, hz);
    for (let j = Math.max(0, j0); j <= Math.min(H - 1, j1); j++)
      for (let i = Math.max(0, i0); i <= Math.min(W - 1, i1); i++)
        f[j * W + i] = 0;
  }
  // every hull: texel centres inside the polygon (even-odd)
  for (const o of outlines) {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < o.length; i += 2) {
      minX = Math.min(minX, o[i]);
      maxX = Math.max(maxX, o[i]);
      minZ = Math.min(minZ, o[i + 1]);
      maxZ = Math.max(maxZ, o[i + 1]);
    }
    const [i0, j0] = mark(minX, minZ);
    const [i1, j1] = mark(maxX, maxZ);
    for (let j = Math.max(0, j0); j <= Math.min(H - 1, j1); j++) {
      const z = z0 + (j + 0.5) * ts;
      for (let i = Math.max(0, i0); i <= Math.min(W - 1, i1); i++) {
        const x = x0 + (i + 0.5) * ts;
        let inside = false;
        for (let a = 0, b = o.length - 2; a < o.length; b = a, a += 2) {
          const za = o[a + 1];
          const zb = o[b + 1];
          if (
            za > z !== zb > z &&
            x < ((o[b] - o[a]) * (z - za)) / (zb - za) + o[a]
          )
            inside = !inside;
        }
        if (inside) f[j * W + i] = 0;
      }
    }
  }
  // exact distance transform: columns, then rows
  const n = Math.max(W, H);
  const line = new Float64Array(n);
  const v = new Int32Array(n);
  const zz = new Float64Array(n + 1);
  const d = new Float64Array(n);
  for (let i = 0; i < W; i++) {
    for (let j = 0; j < H; j++) line[j] = f[j * W + i];
    edt1d(line, H, v, zz, d);
    for (let j = 0; j < H; j++) f[j * W + i] = line[j];
  }
  const data = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) line[i] = f[j * W + i];
    edt1d(line, W, v, zz, d);
    for (let i = 0; i < W; i++)
      data[j * W + i] = Math.min(
        255,
        Math.round(((Math.sqrt(line[i]) * ts) / REACH) * 255),
      );
  }
  const texture = new DataTexture(data, W, H, RedFormat, UnsignedByteType);
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return {
    texture,
    box: new Vector4(x0, z0, 1 / (W * ts), 1 / (H * ts)),
  };
}

let geo: BufferGeometry | null = null;

/**
 * The sea under the raft and out to the horizon: one plane. Swells move the vertices; layered chop, the sky's reflection,
 * the sun's glint and foam along every hull (from the contact field) are drawn in the fragment shader.
 */
export class Sea {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private readonly ripples: Vector4[] = [];
  private head = 0;

  /**
   * `hx`, `hz` = half extents of the raft incl. its margin (the shaded patch follows it); `field` = `contactField()` of the
   * raft and its boats; `sky` = the level's sky colours, top to horizon.
   */
  constructor(
    hx: number,
    hz: number,
    low: boolean,
    field: { texture: Texture; box: Vector4 },
    sky: readonly [string, string, string],
  ) {
    geo ??= new PlaneGeometry(WATER_SIZE, WATER_SIZE, 140, 140).rotateX(
      -Math.PI / 2,
    );
    for (let i = 0; i < RIPPLES; i++)
      this.ripples.push(new Vector4(0, 0, 1e9, 0));
    this.material = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uHalf: { value: new Vector2(hx, hz) },
        uRip: { value: this.ripples },
        uField: { value: field.texture },
        uFieldBox: { value: field.box },
        uSkyTop: { value: new Color(sky[0]) },
        uSkyMid: { value: new Color(sky[1]) },
        uSkyLow: { value: new Color(sky[2]) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      defines: low ? { LOW: '' } : {},
    });
    this.mesh = new Mesh(
      low
        ? new PlaneGeometry(WATER_SIZE, WATER_SIZE, 70, 70).rotateX(
            -Math.PI / 2,
          )
        : geo,
      this.material,
    );
    this.mesh.position.y = WATER_Y;
    this.mesh.frustumCulled = false;
    // High quality: reflect the scene's environment (the level's HDRI) once it has loaded
    this.mesh.onBeforeRender = (_r, scene) => {
      const env = scene.environment;
      if (low || !env || env === this.material.uniforms.envMap?.value) return;
      // r187 PMREM = a cube render target; its mips are the roughness steps (three's roughnessToMip)
      const maxLod = (env.mipmaps?.length ?? 1) - 1;
      this.material.uniforms.envMap = { value: env };
      this.material.uniforms.uEnvMip = {
        value: maxLod * ENV_ROUGHNESS * (2 - ENV_ROUGHNESS),
      };
      this.material.defines.SEA_ENV = '';
      this.material.needsUpdate = true;
    };
  }

  update(t: number): void {
    this.material.uniforms.uTime.value = t;
  }

  /** A tile hits the water at world `(x, z)` at clock time `t`. */
  ripple(x: number, z: number, t: number): void {
    this.ripples[this.head].set(x, z, t, 0);
    this.head = (this.head + 1) % RIPPLES;
  }

  dispose(): void {
    this.material.dispose();
    if (this.mesh.geometry !== geo) this.mesh.geometry.dispose();
  }
}
