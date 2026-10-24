import {
  BufferGeometry,
  DepthFormat,
  DepthTexture,
  DirectionalLight,
  Float32BufferAttribute,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  NearestFilter,
  PerspectiveCamera,
  UnsignedIntType,
  Vector3,
  WebGLRenderTarget,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { setFarShadow, setFarShadowDisc } from '../engine/world-shading';
import { canopyOf, isVegetation } from './aerial-trees';
import type { World } from './world';

/**
 * Layer of the far shadow pass: static casters enable it (`farShadowCaster`), the crown proxies are only on it. The
 * pass draws nothing else (no car, people, scatter or real trees: they stay inside the sun's shadow map).
 */
export const FAR_SHADOW_LAYER = 5;

/** Let a static mesh (terrain, buildings, bridges ...) cast into the far shadow map too. */
export function farShadowCaster(o: Object3D): void {
  o.layers.enable(FAR_SHADOW_LAYER);
}

/** Share of the sun a crown proxy stops (hashed holes, as the near map's leafy crown proxies). */
const CROWN_DENSITY = 0.82;
/** Crowns smaller than this (m) cast nothing here: lost in the texels. */
const MIN_RADIUS = 1;
/**
 * The proxy window around the box centre: radius (x the box half-size) and how far the box moves (x half-size)
 * before a rebuild. The far map covers only this disc (`setFarShadowDisc`): past it there are no crowns, and the
 * baked canopy shadows must not be switched off there.
 */
const WINDOW = 1.5;
const REBUILD_MOVE = 0.3;
/** A rebuild also picks up scatter chunks generated since (ms). */
const REFRESH = 4000;
/** Rebuild time slice per frame (ms). */
const BUDGET = 1.5;
/** The box snaps to this share of its half-size; the map is re-rendered only when the snapped box moves. */
const SNAP = 0.1;

/**
 * The far shadow map: a second sun depth map over a large box ahead of the camera (`farShadowExtent`, ~4x the sun's
 * shadow map), drawn only when its snapped box moves (every 20-30 m of travel), not every frame. Casters: terrain and
 * static world meshes (`farShadowCaster`) plus one hashed ellipsoid per tree crown (the same crowns as the canopy
 * shadows), placed in 3D so their shadows land on the real slope. engine/world-shading.ts samples it past the sun's
 * shadow map (`wsFarSun`), and the baked canopy shadows only take over past it.
 *
 * Drawn from inside the main render (`trigger.onBeforeRender`, the first opaque draw): three's shadow pass needs the
 * render state of a running `render()`.
 */
export class FarShadow {
  /** Add to the scene: draws nothing, renders the far map when due. */
  readonly trigger: Mesh;
  private light = new DirectionalLight();
  private target: WebGLRenderTarget;
  /** Camera handed to the shadow pass: only its layers matter (the pass culls with the light's camera). */
  private view = new PerspectiveCamera();
  private proxies: InstancedMesh;
  private mats = new Float32Array(16 * 1024);
  private count = 0;
  private job: Generator<void> | null = null;
  private windowAt = { x: Infinity, z: Infinity };
  /** The window of the job running (applied with its upload). */
  private building = { x: 0, z: 0 };
  /** The window of the crowns on the GPU. */
  private uploaded = { x: Infinity, z: Infinity };
  private lastBuild = -Infinity;
  private centre = new Vector3();
  private rendered = new Vector3(Infinity, 0, 0);
  private renderedSun = new Vector3();
  private pending = false;
  private right = new Vector3();
  private up = new Vector3();
  enabled = true;
  /** Far passes drawn so far (perf checks). */
  renders = 0;

  constructor(
    private renderer: WebGLRenderer,
    private scene: Scene,
    private world: World,
    private sunDir: Vector3,
    private size: number,
    private extent: number,
  ) {
    const l = this.light;
    l.castShadow = true;
    l.shadow.mapSize.set(size, size);
    const cam = l.shadow.camera;
    cam.left = cam.bottom = -extent;
    cam.right = cam.top = extent;
    cam.near = 1;
    cam.far = 1200;
    cam.updateProjectionMatrix();
    this.view.layers.set(FAR_SHADOW_LAYER);
    // Our own depth target, read as a plain sampler2D (no compare mode; the shader compares): a sampler2DShadow in
    // every lit program breaks the draws of programs that never get the world uniforms (unit 0 holds a colour
    // texture: "mismatch between texture format and sampler type").
    this.target = new WebGLRenderTarget(size, size);
    const depth = new DepthTexture(size, size, UnsignedIntType);
    depth.format = DepthFormat;
    depth.minFilter = depth.magFilter = NearestFilter;
    depth.name = 'far shadow map';
    this.target.depthTexture = depth;
    l.shadow.map = this.target;

    const proxy = new IcosahedronGeometry(1, 1);
    this.proxies = new InstancedMesh(
      proxy,
      new MeshBasicMaterial({ colorWrite: false }),
      1024,
    );
    this.proxies.count = 0;
    this.proxies.castShadow = true;
    this.proxies.frustumCulled = false;
    this.proxies.layers.set(FAR_SHADOW_LAYER);
    this.proxies.customDepthMaterial = new MeshDepthMaterial({
      alphaHash: true,
      opacity: CROWN_DENSITY,
    });
    this.proxies.name = 'far shadow crowns';
    scene.add(this.proxies);

    // One degenerate triangle with an empty draw range: drawn (so onBeforeRender runs), never rasterised.
    const none = new BufferGeometry().setAttribute(
      'position',
      new Float32BufferAttribute(new Float32Array(9), 3),
    );
    none.setDrawRange(0, 0);
    this.trigger = new Mesh(
      none,
      new MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
    );
    this.trigger.name = 'far shadow trigger';
    this.trigger.frustumCulled = false;
    this.trigger.renderOrder = -10;
    this.trigger.onBeforeRender = () => this.render();
    scene.add(this.trigger);
  }

  /** Every frame: place the box ahead of `focus` along `forward`, rebuild the crowns as the camera moves. */
  update(focus: Vector3, forward: Vector3, castShadow: boolean): void {
    if (!this.enabled || !castShadow) {
      setFarShadow(null);
      this.rendered.x = Infinity;
      return;
    }
    const c = this.centre.copy(focus);
    const fl = Math.hypot(forward.x, forward.z);
    if (fl > 1e-3) {
      c.x += (forward.x / fl) * this.extent * 0.45;
      c.z += (forward.z / fl) * this.extent * 0.45;
    }
    this.updateWindow(c);
    // Snap along the light's right / up axes to a coarse grid (whole texels) and along the light itself (depth: the
    // map's 1200 m range has room): the map only changes when the snapped box moves.
    const s = this.sunDir;
    this.right.set(0, 1, 0).cross(s).normalize();
    this.up.copy(s).cross(this.right).normalize();
    // A whole number of texels: a fractional step shifts the texel grid at every redraw (the shadows crawl).
    const texel = (this.extent * 2) / this.size;
    const step = Math.round((this.extent * SNAP) / texel) * texel;
    for (const axis of [this.right, this.up, s]) {
      const a = c.dot(axis);
      c.addScaledVector(axis, Math.round(a / step) * step - a);
    }
    if (
      c.distanceToSquared(this.rendered) > 1e-4 ||
      !s.equals(this.renderedSun)
    )
      this.pending = true;
  }

  /** The far pass (from the trigger's onBeforeRender, inside the main render). */
  private render(): void {
    if (!this.pending) return;
    this.pending = false;
    const l = this.light;
    const c = this.centre;
    l.target.position.copy(c);
    l.position.copy(c).addScaledVector(this.sunDir, 600);
    l.updateMatrixWorld();
    l.target.updateMatrixWorld();
    l.shadow.map = this.target;
    this.renderer.shadowMap.render([l], this.scene, this.view);
    // three replaces the map when the shadow type changes (its own, compare mode on): keep ours, draw again.
    if (l.shadow.map !== this.target) {
      l.shadow.map.dispose();
      l.shadow.map = this.target;
      this.pending = true;
      return;
    }
    this.renders++;
    this.rendered.copy(c);
    this.renderedSun.copy(this.sunDir);
    const texel = 1 / this.size;
    const metres = (this.extent * 2) / this.size;
    setFarShadow(this.target.depthTexture, l.shadow.matrix, {
      strength: 1,
      texel,
      normalOffset: metres * 1.5,
      bias: 0.0004,
    });
  }

  /** Start / continue the crown proxy rebuild around the box centre (one time slice per call). */
  private updateWindow(focus: Vector3): void {
    if (!this.job) {
      const dx = focus.x - this.windowAt.x;
      const dz = focus.z - this.windowAt.z;
      const move = this.extent * REBUILD_MOVE;
      const now = performance.now();
      if (dx * dx + dz * dz < move * move && now - this.lastBuild < REFRESH)
        return;
      this.lastBuild = now;
      this.windowAt.x = this.building.x = focus.x;
      this.windowAt.z = this.building.z = focus.z;
      this.job = this.build(focus.x, focus.z);
    }
    const t0 = performance.now();
    while (performance.now() - t0 < BUDGET)
      if (this.job.next().done) {
        this.job = null;
        break;
      }
  }

  private *build(fx: number, fz: number): Generator<void> {
    const r = this.extent * WINDOW;
    const scatter = this.world.scatter;
    const cs = scatter.chunkSize;
    let n = 0;
    for (let cz = Math.floor((fz - r) / cs); cz * cs <= fz + r; cz++) {
      for (let cx = Math.floor((fx - r) / cs); cx * cs <= fx + r; cx++) {
        const chunk = scatter.cachedChunk(cx, cz);
        if (!chunk) continue;
        for (const inst of chunk.instances) {
          if (!isVegetation(inst.asset)) continue;
          const c = canopyOf(inst.asset);
          const rx = c.radius * inst.scale;
          if (rx < MIN_RADIUS) continue;
          if ((n + 1) * 16 > this.mats.length) {
            const grown = new Float32Array(this.mats.length * 2);
            grown.set(this.mats);
            this.mats = grown;
          }
          // Column-major: scale (r, ry, r), translate to the crown centre (written in place: no garbage per tree).
          const m = this.mats;
          const o = n * 16;
          m.fill(0, o, o + 16);
          m[o] = rx;
          m[o + 5] = c.ry * inst.scale;
          m[o + 10] = rx;
          m[o + 12] = inst.x;
          m[o + 13] = inst.y + c.height * inst.scale;
          m[o + 14] = inst.z;
          m[o + 15] = 1;
          n++;
        }
        yield;
      }
    }
    // A refresh that found nothing new (same window, same crowns) leaves the map as it is.
    if (n === this.count && fx === this.uploaded.x && fz === this.uploaded.z)
      return;
    this.count = n;
    this.uploaded.x = fx;
    this.uploaded.z = fz;
    this.upload();
  }

  private upload(): void {
    let p = this.proxies;
    if (p.instanceMatrix.count < this.count) {
      const grown = new InstancedMesh(
        p.geometry,
        p.material,
        Math.ceil(this.count * 1.25),
      );
      grown.castShadow = true;
      grown.frustumCulled = false;
      grown.layers.mask = p.layers.mask;
      grown.customDepthMaterial = p.customDepthMaterial;
      grown.name = p.name;
      this.scene.remove(p);
      p.dispose();
      this.scene.add(grown);
      this.proxies = p = grown;
    }
    p.instanceMatrix.array.set(this.mats.subarray(0, this.count * 16));
    p.instanceMatrix.needsUpdate = true;
    p.count = this.count;
    this.pending = true;
    // Crowns just inside the edge still shade the ground past it: fade out over the last 15% (minus a shadow).
    const end = this.extent * WINDOW - 15;
    setFarShadowDisc(
      this.building.x,
      this.building.z,
      end - this.extent * 0.15,
      end,
    );
  }

  dispose(): void {
    setFarShadow(null);
    this.scene.remove(this.proxies, this.trigger);
    this.proxies.geometry.dispose();
    (this.proxies.material as MeshBasicMaterial).dispose();
    this.proxies.customDepthMaterial?.dispose();
    this.proxies.dispose();
    this.trigger.geometry.dispose();
    (this.trigger.material as MeshBasicMaterial).dispose();
    this.target.depthTexture?.dispose();
    this.light.shadow.dispose();
  }
}
