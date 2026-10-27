import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  DataTexture,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  type Material,
  type Texture,
} from 'three';
import { Noise2D } from '../../../shared/noise';
import { FUSE_S, MAX_TNT, START_RANGE } from '../sim/rules';
import type { TntView } from '../sim/types';
import {
  TNT_LAYOUTS,
  fusePoint,
  tntBandGeometry,
  tntBodyGeometry,
} from './crew-parts';
import { dynamiteTextures } from './dynamite-texture';
import type { Quality } from './renderer';

type Shader = Parameters<Material['onBeforeCompile']>[0];

/**
 * The paper label with a bold 1 / 2 / 3 in three cells side by side and a fourth plain cell for the rest of the band
 * (browser only: uses a canvas): aged paper (grain, fibres, a few stains, darker worn edges), worn hazard stripes top
 * and bottom (their pattern runs on across the cells), the digit in a dark ring, and small print either side of it
 * ("DANGER / EXPLOSIVE", a warning triangle, "KEEP AWAY FROM FIRE"); the plain cell carries "HIGH EXPLOSIVE".
 */
export function makeDigitAtlas(): CanvasTexture {
  // each cell three band heights wide (`tntBandGeometry`), so the digit and its ring come out round
  const cell = 256;
  const cw = cell * 3;
  const c = document.createElement('canvas');
  c.width = cw * 4;
  c.height = cell;
  const g = c.getContext('2d')!;
  const rnd = (k: number) => {
    const s = Math.sin(k * 12.9898) * 43758.5453;
    return s - Math.floor(s);
  };
  const stripe = 20;
  const tri = (x: number, y: number, s: number) => {
    g.beginPath();
    g.moveTo(x, y - s * 0.55);
    g.lineTo(x + s * 0.6, y + s * 0.5);
    g.lineTo(x - s * 0.6, y + s * 0.5);
    g.closePath();
    g.fillStyle = '#f2b81c';
    g.fill();
    g.lineWidth = s * 0.09;
    g.strokeStyle = '#231a14';
    g.stroke();
    g.fillStyle = '#231a14';
    g.font = `900 ${Math.round(s * 0.62)}px "Arial Black", Impact, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('!', x, y + s * 0.12);
  };
  for (let i = 0; i < 4; i++) {
    const x0 = i * cw;
    const paper = g.createLinearGradient(0, 0, 0, cell);
    paper.addColorStop(0, '#e2c48c');
    paper.addColorStop(0.2, '#f1dcae');
    paper.addColorStop(0.5, '#f6e5bf');
    paper.addColorStop(0.8, '#efd7a6');
    paper.addColorStop(1, '#dcbb80');
    g.fillStyle = paper;
    g.fillRect(x0, 0, cw, cell);
    // a few faint stains
    for (let k = 0; k < 4; k++) {
      const sx = x0 + rnd(k * 7.1 + i * 3.3) * cw;
      const sy = rnd(k * 3.7 + i * 9.1) * cell;
      const sr = 30 + rnd(k * 5.3 + i) * 70;
      const st = g.createRadialGradient(sx, sy, sr * 0.2, sx, sy, sr);
      st.addColorStop(0, 'rgba(150,100,45,0.10)');
      st.addColorStop(0.8, 'rgba(150,100,45,0.05)');
      st.addColorStop(1, 'rgba(150,100,45,0)');
      g.fillStyle = st;
      g.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
    }
    // fibres
    for (let k = 0; k < 1400; k++) {
      const a = rnd(k * 1.37 + i * 78.233);
      const b = rnd(k * 2.91 + i * 11.135);
      g.fillStyle = k % 3 ? 'rgba(110,70,30,0.10)' : 'rgba(255,255,255,0.22)';
      g.fillRect(x0 + a * cw, b * cell, 2 + (k % 5), 1);
    }
    // worn hazard stripes along the top and the bottom edge
    for (const y of [0, cell - 22]) {
      g.save();
      g.beginPath();
      g.rect(x0, y, cw, 22);
      g.clip();
      g.fillStyle = '#eeb21c';
      g.fillRect(x0, y, cw, 22);
      g.fillStyle = '#231a14';
      for (let sx = -stripe * 2; sx < cw + stripe * 2; sx += stripe * 2) {
        g.beginPath();
        g.moveTo(x0 + sx, y + 26);
        g.lineTo(x0 + sx + stripe, y + 26);
        g.lineTo(x0 + sx + stripe * 2, y - 4);
        g.lineTo(x0 + sx + stripe, y - 4);
        g.closePath();
        g.fill();
      }
      // scuffs: the paper shows through
      for (let k = 0; k < 40; k++) {
        g.fillStyle = 'rgba(240,222,180,0.55)';
        g.fillRect(
          x0 + rnd(k * 4.7 + i * 2.1 + y) * cw,
          y + rnd(k * 8.3 + y) * 22,
          3 + rnd(k * 1.9) * 9,
          1 + rnd(k * 2.7) * 2,
        );
      }
      g.restore();
    }
    g.fillStyle = '#5a2414';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (i === 3) {
      g.font = '900 46px "Arial Black", Impact, sans-serif';
      g.fillText('HIGH EXPLOSIVE', x0 + cw / 2, cell / 2 + 2);
      tri(x0 + 70, cell / 2, 64);
      tri(x0 + cw - 70, cell / 2, 64);
      continue;
    }
    // the count in a ring
    const cx = x0 + cw / 2;
    g.fillStyle = 'rgba(255,248,226,0.55)';
    g.beginPath();
    g.arc(cx, cell / 2, 98, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#4a1d12';
    g.lineWidth = 13;
    g.beginPath();
    g.arc(cx, cell / 2, 98, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#3b140c';
    g.font = '900 190px "Arial Black", Impact, sans-serif';
    g.fillText(String(i + 1), cx, cell / 2 + 8);
    // small print either side
    g.fillStyle = '#5a2414';
    g.font = '900 52px "Arial Black", Impact, sans-serif';
    g.fillText('DANGER', x0 + 150, cell / 2 - 26);
    g.font = '800 30px "Arial Narrow", Arial, sans-serif';
    g.fillText('EXPLOSIVE', x0 + 150, cell / 2 + 28);
    tri(x0 + cw - 190, cell / 2 - 4, 76);
    g.font = '800 22px "Arial Narrow", Arial, sans-serif';
    g.fillText('KEEP AWAY', x0 + cw - 92, cell / 2 - 16);
    g.fillText('FROM FIRE', x0 + cw - 92, cell / 2 + 12);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

let crinkle: DataTexture | null = null;

/** A small tiling normal map of crinkled paper for the label (no DOM). */
function labelCrinkle(): DataTexture {
  if (crinkle) return crinkle;
  const N = 128;
  const noise = new Noise2D(31);
  // tiling noise: four offset samples blended across the tile
  const tile = (x: number, y: number, f: number) => {
    const u = x / N;
    const v = y / N;
    const n = (a: number, b: number) => noise.noise2(a * f, b * f);
    return (
      n(u, v) * (1 - u) * (1 - v) +
      n(u - 1, v) * u * (1 - v) +
      n(u, v - 1) * (1 - u) * v +
      n(u - 1, v - 1) * u * v
    );
  };
  const hgt = new Float32Array(N * N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++)
      hgt[y * N + x] = Math.abs(tile(x, y, 4)) * 0.8 + tile(x, y, 11) * 0.1;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const at = (xx: number, yy: number) =>
        hgt[((yy + N) % N) * N + ((xx + N) % N)];
      const nx = -(at(x + 1, y) - at(x - 1, y)) * 3;
      const ny = -(at(x, y + 1) - at(x, y - 1)) * 3;
      const l = Math.hypot(nx, ny, 1);
      const o = (y * N + x) * 4;
      data[o] = Math.round(((nx / l) * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round(((ny / l) * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
      data[o + 3] = 255;
    }
  const t = new DataTexture(data, N, N, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.repeat.set(7, 2.5);
  t.needsUpdate = true;
  crinkle = t;
  return t;
}

/** A TNT's blast level as the player sees it: range 2 = level 1 (one stick) ... range 6 = level 5 (five sticks). */
export function tntLevel(range: number): number {
  return Math.max(1, Math.min(TNT_LAYOUTS.length, range - START_RANGE + 1));
}

/** Shader bits: every vertex knows its stick layout (`aLayout`, 0 = shared), each TNT its level; the rest collapses. */
const LEVEL_ATTRS = 'attribute float aLayout;\nattribute float aLevel;';
const LEVEL_PICK = `#include <begin_vertex>
  if (aLayout > 0.5 && abs(aLayout - aLevel) > 0.5) transformed = vec3(0.0);`;

/**
 * The body's own shader bits: the level pick, the fuse burning down (past the spark, `aBurn` per TNT, the cord shrinks
 * to grey ash: `aFuseT` / `aFuseC` in `crew-parts.ts`), a warm rim light so the sticks stand off the floor, and on High
 * the per-vertex roughness `part()` wrote (waxed paper, brass cap, rope) times the atlas's own (normal map alpha).
 */
function patchBody(shader: Shader, high: boolean): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
      ${LEVEL_ATTRS}
      attribute float aFuseT;
      attribute vec3 aFuseC;
      attribute float aBurn;
      ${high ? 'attribute float aGloss;\nvarying float vGloss;' : ''}`,
    )
    .replace(
      '#include <color_vertex>',
      `#include <color_vertex>
      float burnt = step(0.0, aFuseT) * step(aBurn, aFuseT);
      vColor.rgb = mix(vColor.rgb, vec3(0.3, 0.29, 0.27), burnt);
      ${high ? 'vGloss = aGloss;' : ''}`,
    )
    .replace(
      '#include <begin_vertex>',
      `${LEVEL_PICK}
      transformed = mix(transformed, aFuseC, burnt * 0.55);`,
    );
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <opaque_fragment>',
    `outgoingLight += vec3(1.0, 0.9, 0.75) * 0.3 * pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 3.0);
    #include <opaque_fragment>`,
  );
  if (high)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGloss;')
      .replace(
        '#include <roughnessmap_fragment>',
        // the atlas normal map carries a roughness multiplier in alpha (waxed ends, worn paper, hemp)
        'float roughnessFactor = roughness * ( 1.0 - vGloss ) * texture2D( normalMap, vNormalMapUv ).a * 1.5;',
      );
}

/** A soft glow sprite round each fuse spark (additive, faces the camera, sized by the instance's scale). */
const GLOW_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float size = length(instanceMatrix[0].xyz);
    c.xy += position.xy * size;
    vUv = uv;
    gl_Position = projectionMatrix * c;
  }
`;
const GLOW_FRAG = /* glsl */ `
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float g = exp(-r * r * 5.0);
    gl_FragColor = vec4(vec3(1.0, 0.62, 0.2) * g * 1.4, 1.0);
  }
`;

/** Embers each fuse spark throws (camera-facing quads after the star in `sparkGeometry`). */
const EMBERS = 6;

/**
 * The fuse spark: a flickering star burst (two sets of rays turning against each other round a white-hot core) and
 * `EMBERS` embers it spits out, each flying a short arc and fading, then starting again from a new angle - all in the
 * vertex shader from one clock (`uTime`), the TNT's position as the seed. The instance's scale = the star's size.
 */
const SPARK_VERT = /* glsl */ `
  attribute float aKind;
  uniform float uTime;
  varying vec2 vUv;
  varying float vKind;
  varying float vFade;
  varying float vSeed;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    vec4 w = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float size = length(instanceMatrix[0].xyz);
    float seed = w.x * 3.1 + w.z * 7.7;
    vec3 off = vec3(0.0);
    float s = size;
    vFade = 1.0;
    if (aKind > 0.5) {
      float t = uTime * 1.8 + hash(aKind * 1.37 + seed);
      float ph = fract(t);
      float a = hash(aKind * 4.1 + seed + floor(t)) * 6.2832;
      float k = size / 0.16;
      off = (vec3(cos(a), 0.0, sin(a)) * ph * 0.17 + vec3(0.0, 0.14 * ph - 0.3 * ph * ph, 0.0)) * k;
      s = size * 0.17 * (1.0 - ph * 0.6);
      vFade = 1.0 - ph;
    }
    vec4 c = modelViewMatrix * vec4(w.xyz + off, 1.0);
    c.xy += position.xy * s;
    vUv = uv;
    vKind = aKind;
    vSeed = seed;
    gl_Position = projectionMatrix * c;
  }
`;
const SPARK_FRAG = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying float vKind;
  varying float vFade;
  varying float vSeed;
  void main() {
    vec2 p = vUv - 0.5;
    float r = length(p) * 2.0;
    if (vKind < 0.5) {
      float a = atan(p.y, p.x);
      float spin = uTime * 7.0 + vSeed;
      float rays = pow(abs(cos(a * 3.0 + spin)), 14.0) + 0.7 * pow(abs(cos(a * 4.0 - spin * 1.3 + 0.5)), 22.0);
      float core = exp(-r * r * 10.0);
      float g = core * 1.8 + rays * (1.0 - smoothstep(0.05, 1.0, r)) * 1.1;
      vec3 col = mix(vec3(1.0, 0.5, 0.12), vec3(1.0, 0.96, 0.82), clamp(core * 1.5, 0.0, 1.0));
      gl_FragColor = vec4(col * g, 1.0);
    } else {
      float g = exp(-r * r * 5.0) * vFade;
      gl_FragColor = vec4(vec3(1.0, 0.68, 0.28) * g * 1.6, 1.0);
    }
  }
`;

/** The star quad (kind 0) and `EMBERS` ember quads (kind 1...), unit squares the spark shader places and sizes. */
function sparkGeometry(): BufferGeometry {
  const quads = EMBERS + 1;
  const pos = new Float32Array(quads * 12);
  const uv = new Float32Array(quads * 8);
  const kind = new Float32Array(quads * 4);
  const index: number[] = [];
  const corners = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ];
  for (let q = 0; q < quads; q++) {
    corners.forEach(([x, y], c) => {
      const v = q * 4 + c;
      pos.set([x, y, 0], v * 3);
      uv.set([x + 0.5, y + 0.5], v * 2);
      kind[v] = q;
    });
    const b = q * 4;
    index.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('aKind', new Float32BufferAttribute(kind, 1));
  g.setIndex(index);
  return g;
}

/**
 * Every TNT on the field in four draw calls: the bundle of sticks, the paper band that shows the count (the digit is
 * picked per instance in the vertex shader from `ceil(fuse)`), the fuse spark with its embers and its soft glow. A fixed
 * pool of `MAX_TNT` instances, compacted each frame; no allocation. The fuse burns down to ash behind the spark; the TNT
 * pulses (faster as it burns) and blinks white-hot in the last half second.
 */
export class TntRenderer {
  readonly group = new Group();
  private readonly body: InstancedMesh;
  private readonly band: InstancedMesh;
  private readonly spark: InstancedMesh;
  private readonly glow: InstancedMesh;
  private readonly fp = new Vector3();
  private readonly digit: InstancedBufferAttribute;
  private readonly level: InstancedBufferAttribute;
  private readonly burn: InstancedBufferAttribute;
  private readonly time = { value: 0 };
  private readonly geos: BufferGeometry[] = [];
  private readonly disposables: { dispose(): void }[] = [];
  private readonly age = new Float32Array(MAX_TNT);
  private readonly was = new Uint8Array(MAX_TNT);
  private readonly m = new Matrix4();
  private readonly color = new Color();
  private clock = 0;

  /**
   * `w`, `h` = arena size in cells; `atlas` = digit texture (default: drawn on a canvas); `quality` High = physically
   * based sticks (waxed paper sheen in the level's environment light), else Lambert.
   */
  constructor(
    private readonly w: number,
    private readonly h: number,
    atlas: Texture = makeDigitAtlas(),
    quality?: Quality,
  ) {
    const bodyGeo = tntBodyGeometry();
    const bandGeo = tntBandGeometry();
    const sparkGeo = sparkGeometry();
    const glowGeo = new PlaneGeometry(1, 1);
    this.geos.push(bodyGeo, bandGeo, sparkGeo, glowGeo);
    this.digit = new InstancedBufferAttribute(new Float32Array(MAX_TNT), 1);
    bandGeo.setAttribute('aDigit', this.digit);
    // blast level per TNT: picks its stick layout out of the five in the body and label geometry
    this.level = new InstancedBufferAttribute(
      new Float32Array(MAX_TNT).fill(1),
      1,
    );
    bodyGeo.setAttribute('aLevel', this.level);
    bandGeo.setAttribute('aLevel', this.level);
    // how far along the fuse the spark is (the cord past it is ash)
    this.burn = new InstancedBufferAttribute(
      new Float32Array(MAX_TNT).fill(1),
      1,
    );
    bodyGeo.setAttribute('aBurn', this.burn);

    const high = quality?.name === 'high';
    const dyn = dynamiteTextures();
    const bodyMat = high
      ? new MeshStandardMaterial({
          vertexColors: true,
          map: dyn.map,
          normalMap: dyn.normal,
          roughness: 1,
          metalness: 0,
        })
      : new MeshLambertMaterial({
          vertexColors: true,
          map: dyn.map,
          normalMap: dyn.normal,
        });
    bodyMat.onBeforeCompile = (shader) => patchBody(shader, high);
    bodyMat.customProgramCacheKey = () => `kaboom-tnt-body-${high}`;
    const bandMat = new MeshLambertMaterial({
      map: atlas,
      normalMap: labelCrinkle(),
      normalScale: new Vector2(0.2, 0.2),
    });
    // uv.x runs round the band in atlas cells (`tntBandGeometry`): the cell round the front shows the digit, the rest
    // the plain cell; sampled with the unwrapped gradients so the cell seams take no mip jump
    bandMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>\nattribute float aDigit;\nvarying float vDigit;\n${LEVEL_ATTRS}`,
        )
        .replace('#include <begin_vertex>', `${LEVEL_PICK}\nvDigit = aDigit;`);
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying float vDigit;',
        )
        .replace(
          '#include <map_fragment>',
          `#ifdef USE_MAP
            float lu = vMapUv.x;
            float cellId = abs(lu - 0.5) < 0.5 ? floor(vDigit + 0.5) : 3.0;
            vec2 st = vec2((fract(lu) + cellId) / 4.0, vMapUv.y);
            vec2 un = vec2(lu / 4.0, vMapUv.y);
            diffuseColor *= textureGrad(map, st, dFdx(un), dFdy(un));
          #endif`,
        );
    };
    bandMat.customProgramCacheKey = () => 'kaboom-tnt-band';
    const sparkMat = new ShaderMaterial({
      vertexShader: SPARK_VERT,
      fragmentShader: SPARK_FRAG,
      uniforms: { uTime: this.time },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const glowMat = new ShaderMaterial({
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.disposables.push(
      bodyMat,
      bandMat,
      sparkMat,
      glowMat,
      atlas,
      ...this.geos,
    );

    this.body = new InstancedMesh(bodyGeo, bodyMat, MAX_TNT);
    this.band = new InstancedMesh(bandGeo, bandMat, MAX_TNT);
    this.spark = new InstancedMesh(sparkGeo, sparkMat, MAX_TNT);
    this.glow = new InstancedMesh(glowGeo, glowMat, MAX_TNT);
    this.glow.renderOrder = 5;
    this.spark.renderOrder = 6;
    for (const m of [this.body, this.band, this.spark, this.glow]) {
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = false;
      this.group.add(m);
    }
    this.body.setColorAt(0, this.color.setRGB(1, 1, 1));
  }

  /** Pose every active TNT of `tnts` (the sim's pool). `dt` in seconds. */
  update(tnts: readonly TntView[], dt: number, fuseS = FUSE_S): void {
    this.clock += dt;
    this.time.value = this.clock;
    let n = 0;
    for (let i = 0; i < tnts.length; i++) {
      const t = tnts[i];
      if (!t.active) {
        this.was[i] = 0;
        continue;
      }
      if (!this.was[i]) {
        this.was[i] = 1;
        this.age[i] = 0;
      }
      const age = (this.age[i] += dt);

      // the band always counts 3 / 2 / 1, scaled to this match's fuse
      const left = Math.min(3, (t.fuse / fuseS) * 3);
      const burned = 3 - left;
      const hot = t.fuse < 0.5;
      const pulse =
        1 +
        (0.04 + (hot ? 0.07 : 0)) * Math.sin(this.clock * (7 + burned * 5) + i);
      const hop = Math.abs(Math.sin(age * 13)) * 0.3 * Math.exp(-age * 6);
      const squash =
        age < 0.4 ? 1 - Math.exp(-age * 9) * Math.cos(age * 30) * 0.12 : 1;
      const x = t.x + 0.5 - this.w / 2;
      const z = t.y + 0.5 - this.h / 2;

      this.m
        .makeScale(pulse / squash, pulse * squash, pulse / squash)
        .setPosition(x, hop, z);
      this.body.setMatrixAt(n, this.m);
      this.band.setMatrixAt(n, this.m);
      const blink = hot && Math.sin(this.clock * 38) > 0 ? 1.9 : 1;
      this.body.setColorAt(
        n,
        this.color.setRGB(blink, blink * 0.9, blink * 0.85),
      );
      this.digit.setX(n, Math.min(2, Math.max(0, Math.ceil(left) - 1)));
      this.level.setX(n, tntLevel(t.range));

      // the spark rides down the fuse as it burns, in a flickering glow
      const ft = 0.08 + 0.92 * (left / 3);
      this.burn.setX(n, ft);
      const f = fusePoint(ft, this.fp);
      const flick = Math.abs(Math.sin(this.clock * 30 + i * 2));
      const sr = (hot ? 0.2 : 0.15) + 0.04 * flick;
      const sx = x + f.x * pulse;
      const sy = hop + f.y * pulse;
      const sz = z + f.z * pulse;
      this.m.makeScale(sr, sr, sr).setPosition(sx, sy, sz);
      this.spark.setMatrixAt(n, this.m);
      const gr = (hot ? 0.42 : 0.3) + 0.08 * flick;
      this.m.makeScale(gr, gr, gr).setPosition(sx, sy, sz);
      this.glow.setMatrixAt(n, this.m);
      n++;
    }
    this.body.count = this.band.count = this.spark.count = this.glow.count = n;
    this.body.instanceMatrix.needsUpdate = true;
    this.band.instanceMatrix.needsUpdate = true;
    this.spark.instanceMatrix.needsUpdate = true;
    this.glow.instanceMatrix.needsUpdate = true;
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
    this.digit.needsUpdate = true;
    this.level.needsUpdate = true;
    this.burn.needsUpdate = true;
  }

  /** Active instances drawn last frame. */
  get count(): number {
    return this.body.count;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.body.dispose();
    this.band.dispose();
    this.glow.dispose();
    this.spark.dispose();
  }
}
