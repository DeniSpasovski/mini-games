import {
  BufferGeometry,
  CanvasTexture,
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  SRGBColorSpace,
  SphereGeometry,
  type Texture,
} from 'three';
import { MAX_TNT } from '../sim/rules';
import type { TntView } from '../sim/types';
import { tntBandGeometry, tntBodyGeometry } from './crew-parts';

/** Paper band with a bold 1 / 2 / 3 in three cells side by side (browser only: uses a canvas). */
export function makeDigitAtlas(): CanvasTexture {
  const cell = 128;
  const c = document.createElement('canvas');
  c.width = cell * 3;
  c.height = cell;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 3; i++) {
    g.fillStyle = '#f3dfae';
    g.fillRect(i * cell, 0, cell, cell);
    g.fillStyle = '#d9bf86';
    g.fillRect(i * cell, 0, cell, 10);
    g.fillRect(i * cell, cell - 10, cell, 10);
    g.fillStyle = '#4a1d12';
    g.font = '900 104px "Arial Black", Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(i + 1), i * cell + cell / 2, cell / 2 + 6);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

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
  private readonly digit: InstancedBufferAttribute;
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
    this.geos.push(bodyGeo, bandGeo, sparkGeo);
    this.digit = new InstancedBufferAttribute(new Float32Array(MAX_TNT), 1);
    bandGeo.setAttribute('aDigit', this.digit);

    const bodyMat = new MeshLambertMaterial({ vertexColors: true });
    const bandMat = new MeshLambertMaterial({ map: atlas });
    bandMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float aDigit;',
        )
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
          #ifdef USE_MAP
            vMapUv.x = vMapUv.x / 3.0 + aDigit / 3.0;
          #endif`,
        );
    };
    bandMat.customProgramCacheKey = () => 'kaboom-tnt-band';
    const sparkMat = new MeshBasicMaterial({
      color: 0xffc247,
      toneMapped: false,
    });
    this.disposables.push(bodyMat, bandMat, sparkMat, atlas, ...this.geos);

    this.body = new InstancedMesh(bodyGeo, bodyMat, MAX_TNT);
    this.band = new InstancedMesh(bandGeo, bandMat, MAX_TNT);
    this.spark = new InstancedMesh(sparkGeo, sparkMat, MAX_TNT);
    for (const m of [this.body, this.band, this.spark]) {
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = false;
      this.group.add(m);
    }
    this.body.setColorAt(0, this.color.setRGB(1, 1, 1));
  }

  /** Pose every active TNT of `tnts` (the sim's pool). `dt` in seconds. */
  update(tnts: readonly TntView[], dt: number): void {
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

      const burned = 3 - Math.min(3, t.fuse);
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
      this.digit.setX(n, Math.min(2, Math.max(0, Math.ceil(t.fuse) - 1)));

      // the spark rides down the fuse as it burns
      const sy = 0.53 + 0.1 * (Math.min(3, t.fuse) / 3);
      const sr = 0.045 + 0.02 * Math.abs(Math.sin(this.clock * 30 + i * 2));
      this.m.makeScale(sr, sr, sr).setPosition(x, hop + sy * pulse, z - 0.02);
      this.spark.setMatrixAt(n, this.m);
      n++;
    }
    this.body.count = this.band.count = this.spark.count = n;
    this.body.instanceMatrix.needsUpdate = true;
    this.band.instanceMatrix.needsUpdate = true;
    this.spark.instanceMatrix.needsUpdate = true;
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
    this.digit.needsUpdate = true;
  }

  /** Active instances drawn last frame. */
  get count(): number {
    return this.body.count;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.body.dispose();
    this.band.dispose();
    this.spark.dispose();
  }
}
