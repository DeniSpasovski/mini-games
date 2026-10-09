import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  DataTexture,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  ShaderMaterial,
  SphereGeometry,
  UnsignedByteType,
  Vector3,
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

/**
 * The paper label with a bold 1 / 2 / 3 in three cells side by side (browser only: uses a canvas): aged paper with
 * speckles, a hazard-stripe border top and bottom, and the digit in a dark ring.
 */
export function makeDigitAtlas(): CanvasTexture {
  // each cell as wide as the label's front (about 3 : 1), so the digit and its ring come out round
  const cell = 128;
  const cw = cell * 3;
  const c = document.createElement('canvas');
  c.width = cw * 3;
  c.height = cell;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 3; i++) {
    const x0 = i * cw;
    const paper = g.createLinearGradient(0, 0, 0, cell);
    paper.addColorStop(0, '#efd8a6');
    paper.addColorStop(0.5, '#f7e6bf');
    paper.addColorStop(1, '#e6cc96');
    g.fillStyle = paper;
    g.fillRect(x0, 0, cw, cell);
    // speckles and fibres
    for (let k = 0; k < 400; k++) {
      const a = (Math.sin(k * 12.9898 + i * 78.233) * 43758.5453) % 1;
      const b = (Math.sin(k * 39.346 + i * 11.135) * 24634.6345) % 1;
      g.fillStyle = k % 3 ? 'rgba(120,80,40,0.10)' : 'rgba(255,255,255,0.25)';
      g.fillRect(x0 + Math.abs(a) * cw, Math.abs(b) * cell, 3, 1);
    }
    // hazard stripes along the top and the bottom edge
    for (const y of [0, cell - 12]) {
      g.save();
      g.beginPath();
      g.rect(x0, y, cw, 12);
      g.clip();
      g.fillStyle = '#f2b81c';
      g.fillRect(x0, y, cw, 12);
      g.fillStyle = '#231a14';
      for (let sx = -16; sx < cw + 16; sx += 16) {
        g.beginPath();
        g.moveTo(x0 + sx, y + 16);
        g.lineTo(x0 + sx + 8, y + 16);
        g.lineTo(x0 + sx + 16, y);
        g.lineTo(x0 + sx + 8, y);
        g.closePath();
        g.fill();
      }
      g.restore();
    }
    // the count in a ring
    g.strokeStyle = '#4a1d12';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(x0 + cw / 2, cell / 2, 47, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#3b140c';
    g.font = '900 92px "Arial Black", Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(i + 1), x0 + cw / 2, cell / 2 + 4);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

let stickPaper: DataTexture | null = null;

/**
 * The dynamite stick paper (shared by every TNT and the power-up models): red wrap with fibres, a spiral seam, waxed
 * darker ends and printed cream rings with pinstripes near both ends. u = round the stick, v = along it. The strip at
 * u > 0.97 is plain white for parts that only want their vertex colour (`plainUV` in `crew-parts.ts`). Generated once,
 * no DOM (works in node).
 */
export function stickPaperTexture(): DataTexture {
  if (stickPaper) return stickPaper;
  const W = 256;
  const H = 256;
  const data = new Uint8Array(W * H * 4);
  const noise = new Noise2D(808);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const u = (x + 0.5) / W;
      const v = (y + 0.5) / H;
      let r: number;
      let g: number;
      let b: number;
      if (u > 0.97) {
        r = g = b = 255;
      } else {
        const uu = u / 0.97;
        const fibre =
          noise.noise2(uu * 40, v * 6) * 0.5 +
          noise.noise2(uu * 140, v * 24) * 0.3;
        let k = 1 + 0.08 * fibre;
        // the wrap's spiral seam: a dark line with a lighter overlap beside it
        const seam = (((uu + v * 0.35) % 1) + 1) % 1;
        if (Math.abs(seam - 0.5) < 0.006) k *= 0.72;
        else if (seam > 0.506 && seam < 0.52) k *= 1.08;
        // waxed ends
        const end = Math.min(v, 1 - v);
        if (end < 0.06) k *= 0.78 + (end / 0.06) * 0.22;
        r = 196 * k;
        g = 42 * k;
        b = 36 * k;
        // printed cream rings with dark pinstripes near both ends
        const ring = (lo: number, hi: number) => v > lo && v < hi;
        if (ring(0.1, 0.17) || ring(0.83, 0.9)) {
          r = 236 * k;
          g = 214 * k;
          b = 168 * k;
        }
        if (
          Math.abs(v - 0.1) < 0.005 ||
          Math.abs(v - 0.17) < 0.005 ||
          Math.abs(v - 0.83) < 0.005 ||
          Math.abs(v - 0.9) < 0.005
        )
          r = g = b = 40;
      }
      data[o] = Math.max(0, Math.min(255, r));
      data[o + 1] = Math.max(0, Math.min(255, g));
      data[o + 2] = Math.max(0, Math.min(255, b));
      data[o + 3] = 255;
    }
  const t = new DataTexture(data, W, H, RGBAFormat, UnsignedByteType);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  stickPaper = t;
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

/**
 * Every TNT on the field in three draw calls: the bundle of sticks, the paper band that shows the count (the digit is
 * picked per instance in the vertex shader from `ceil(fuse)`), and the glowing fuse spark. A fixed pool of `MAX_TNT`
 * instances, compacted each frame; no allocation. The fuse shows as pulse (faster as it burns) and a white-hot blink in
 * the last half second.
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
  private readonly geos: BufferGeometry[] = [];
  private readonly disposables: { dispose(): void }[] = [];
  private readonly age = new Float32Array(MAX_TNT);
  private readonly was = new Uint8Array(MAX_TNT);
  private readonly m = new Matrix4();
  private readonly color = new Color();
  private clock = 0;

  /** `w`, `h` = arena size in cells; `atlas` = digit texture (default: drawn on a canvas). */
  constructor(
    private readonly w: number,
    private readonly h: number,
    atlas: Texture = makeDigitAtlas(),
  ) {
    const bodyGeo = tntBodyGeometry();
    const bandGeo = tntBandGeometry();
    const sparkGeo = new SphereGeometry(1, 6, 4);
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

    const bodyMat = new MeshLambertMaterial({
      vertexColors: true,
      map: stickPaperTexture(),
    });
    bodyMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${LEVEL_ATTRS}`)
        .replace('#include <begin_vertex>', LEVEL_PICK);
    };
    bodyMat.customProgramCacheKey = () => 'kabooom-tnt-body';
    const bandMat = new MeshLambertMaterial({ map: atlas });
    bandMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>\nattribute float aDigit;\n${LEVEL_ATTRS}`,
        )
        .replace('#include <begin_vertex>', LEVEL_PICK)
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
          #ifdef USE_MAP
            vMapUv.x = vMapUv.x / 3.0 + aDigit / 3.0;
          #endif`,
        );
    };
    bandMat.customProgramCacheKey = () => 'kabooom-tnt-band';
    const sparkMat = new MeshBasicMaterial({
      color: 0xffc247,
      toneMapped: false,
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
      const f = fusePoint(0.08 + 0.92 * (left / 3), this.fp);
      const flick = Math.abs(Math.sin(this.clock * 30 + i * 2));
      const sr = 0.035 + 0.02 * flick;
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
