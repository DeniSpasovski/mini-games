import {
  PlaneGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  CustomBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import { hash3, Rng } from '../../../shared/rng';
import { gridToWorldX, gridToWorldZ } from '../sim/grid';
import { Terrain, type MapData } from '../sim/types';
import { SLAB_PAD } from './camera-rig';
import { GlowGrid } from './fx/glow-grid';
import { levelDetail } from './detail';
import { arenaMaterial } from './materials';
import { footShade } from './parts';
import { ContactShade } from './shadows';
import { shared, sharedValue } from './themes/cache';
import { levelTheme } from './themes';
import type { LevelTheme, Scenery } from './themes/theme';
import type { Quality } from './renderer';

const UP = new Vector3(0, 1, 0);
/** Sudden death: how long a wall takes to fall, and from how high. */
export const WALL_FALL_S = 0.35;
const WALL_DROP_H = 7;
/** Sea Deck: the tile shakes for `SINK_DELAY_S`, then falls with `SINK_G`; it meets the water `TILE_SPLASH_S` after the event. */
export const SINK_DELAY_S = 0.2;
const SINK_G = 4.5;
export const TILE_SPLASH_S = 0.6;

/** An InstancedMesh whose instances can be removed one by one (swap with the last, shrink `count`). */
interface Removable {
  mesh: InstancedMesh;
  /** Cell index of each live instance. */
  cells: number[];
}

let sharedSun: DirectionalLight | null = null;
/** Share of the hemisphere fill kept on High, where the level's HDRI lights the shade too. */
const ENV_FILL = 0.36;

/**
 * The arena diorama (DETAILS.md "Style" / "Levels"): a floor of tiles, hard blocks and crates (one InstancedMesh per
 * kind), decor on the margin, and the scenery round it (`Scenery`: the bowl and its rim, or the sea and the boats), all
 * dressed by the level's `LevelTheme`. About ten draw calls; the sun's shadow map is static and redrawn only when a
 * crate breaks. `group` is the platform (it may bob at sea), `scenery` stays put and holds the lights.
 */
export class Arena {
  readonly group = new Group();
  /** Bowl / water / boats and the lights: not part of the platform's motion. */
  readonly scenery = new Group();
  /** One sun for the page: a new round reuses it and its shadow map (allocating a 2048 x 2048 map is a visible hitch). */
  readonly sun = (sharedSun ??= new DirectionalLight(0xfff0d8, 2.5));
  private readonly crates: (Removable | null)[] = [null, null];
  private readonly hardMeshes: InstancedMesh[];
  /** Walls in the air (sudden death): mesh, instance slot, world x / z, landing time, yaw. */
  private readonly falling: {
    mesh: InstancedMesh;
    slot: number;
    x: number;
    z: number;
    land: number;
    yaw: number;
  }[] = [];
  /** Sea Deck: tiles on their way into the water (cell, start time, tilt axis, the crate it carries). */
  private readonly sinking: {
    cell: number;
    start: number;
    tilt: number;
    crate: Matrix4 | null;
  }[] = [];
  private readonly tiles: InstancedMesh;
  private readonly sunk: Uint8Array;
  private readonly warn: InstancedMesh;
  private readonly warnTime = { value: 0 };
  private readonly crateSlot: Int32Array;
  private readonly crateKind: Int8Array;
  private shadowDirty = true;
  private readonly materials: Material[] = [];
  /** Soft dark patches on the floor round every block (contact shading). */
  private readonly contact: ContactShade;
  private readonly level: Scenery;
  private readonly q = new Quaternion();
  private readonly q2 = new Quaternion();
  private readonly axis = new Vector3();
  private readonly p3 = new Vector3();
  private readonly s3 = new Vector3();

  constructor(
    readonly map: MapData,
    quality: Quality,
    glow: GlowGrid,
    readonly theme: LevelTheme = levelTheme('quarry'),
  ) {
    const { w, h } = map;
    const m4 = new Matrix4();
    const quat = new Quaternion();
    const pos = new Vector3();
    const scl = new Vector3();
    const tint = new Color();
    const id = theme.id;
    this.sunk = new Uint8Array(w * h);

    const mat = <T extends Material>(m: T): T => {
      this.materials.push(m);
      return m;
    };
    // the scenery and the margin carry the level's detail texture (only where a vertex asks for it: `aDetail`)
    const flat = mat(
      arenaMaterial(quality, { vertexColors: true, detail: levelDetail(id) }),
    );
    // blocks and crates: lit by the flames, and the boulders take the detail texture's rock
    const lit = mat(
      arenaMaterial(quality, {
        vertexColors: true,
        glow: glow.uniforms,
        detail: levelDetail(id),
      }),
    );
    // tiles may carry the detail texture too (the Valley's turf; a brown dirt tile takes its soil channel)
    const tileMat = mat(
      arenaMaterial(quality, {
        glow: glow.uniforms,
        vertexColors: theme.tiles.vertexColors,
        detail: levelDetail(id),
        soil: true,
      }),
    );

    // --- the floor plate under the margin, and the scenery round it (the crowd stands on its terraces: `Crowd`)
    const floor = new Mesh(
      shared(`${id}-floor${w}x${h}`, () => theme.floor(w, h, SLAB_PAD)),
      flat,
    );
    floor.receiveShadow = true;
    this.group.add(floor);
    const rng = new Rng(hash3(map.seed, w, h, 0x51ab));
    const hx = w / 2 + SLAB_PAD;
    const hz = h / 2 + SLAB_PAD;
    const ctx = { map, w, h, hx, hz, rng, flat, lit, quality };
    this.level = theme.scenery(ctx);
    this.scenery.add(...this.level.objects);
    if (theme.platformExtras) this.group.add(...theme.platformExtras(ctx));

    // --- floor tiles
    const tiles = new InstancedMesh(
      shared(`${id}-tile`, theme.tiles.geometry),
      tileMat,
      w * h,
    );
    tiles.receiveShadow = true;
    this.tiles = tiles;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const r = new Rng(hash3(x, y, map.seed, 11));
        theme.tiles.tint(x, y, r, tint);
        tiles.setColorAt(i, tint);
        tiles.setMatrixAt(i, this.tileMatrix(x, y, 0, 0, 0, 1, m4));
      }
    }
    this.group.add(tiles);

    // --- hard blocks (two variants) and crates (two variants), darker at the foot; a contact patch under each
    const low = quality.name === 'low';
    const q = low ? '-low' : '';
    const hardGeos = theme.hard.map((build, v) =>
      shared(`${id}-hard${v}${q}`, () => footShade(build(low))),
    );
    const crateGeos = theme.crate.map((build, v) =>
      shared(`${id}-crate${v}${q}`, () => footShade(build(low))),
    );
    this.contact = new ContactShade(w * h, theme.contact ?? 0.5);
    this.group.add(this.contact.mesh);
    const hardCount = [0, 0];
    const crateCount = [0, 0];
    for (let i = 0; i < map.terrain.length; i++) {
      const v = map.variant[i] % 2;
      if (map.terrain[i] === Terrain.Hard) hardCount[v]++;
      else if (map.terrain[i] === Terrain.Crate) crateCount[v]++;
    }
    const hardMeshes: InstancedMesh[] = [];
    hardGeos.forEach((g, v) => {
      // room for the walls that fall during sudden death
      const mesh = new InstancedMesh(g, lit, Math.max(1, hardCount[v]) + w * h);
      mesh.count = 0;
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
      hardMeshes.push(mesh);
    });
    this.hardMeshes = hardMeshes;
    this.crateSlot = new Int32Array(w * h).fill(-1);
    this.crateKind = new Int8Array(w * h).fill(-1);
    crateGeos.forEach((g, v) => {
      const mesh = new InstancedMesh(g, lit, Math.max(1, crateCount[v]));
      mesh.count = 0;
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
      this.crates[v] = { mesh, cells: [] };
    });

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const t = map.terrain[i];
        if (t === Terrain.Empty) continue;
        const v = map.variant[i] % 2;
        const r = new Rng(hash3(x, y, map.seed, 23));
        const target =
          t === Terrain.Hard ? hardMeshes[v] : this.crates[v]!.mesh;
        const slot = target.count++;
        quat.setFromAxisAngle(
          UP,
          t === Terrain.Hard
            ? v === 0
              ? r.range(0, 6.28)
              : r.pick([0, Math.PI / 2])
            : r.range(-0.14, 0.14),
        );
        const s = r.range(0.96, 1.04);
        m4.compose(
          pos.set(gridToWorldX(w, x + 0.5), 0, gridToWorldZ(h, y + 0.5)),
          quat,
          scl.set(s, s * r.range(0.96, 1.08), s),
        );
        target.setMatrixAt(slot, m4);
        tint.setScalar(r.range(0.92, 1.05));
        target.setColorAt(slot, tint);
        this.contact.add(i, pos.x, pos.z);
        if (t === Terrain.Crate) {
          this.crates[v]!.cells.push(i);
          this.crateSlot[i] = slot;
          this.crateKind[i] = v;
        }
      }
    }

    // --- decor on the margin
    const decor = sharedValue(`${id}-decor${w}x${h}`, () =>
      theme.decor(w, h, SLAB_PAD),
    );
    const decorMesh = new Mesh(decor.body, flat);
    decorMesh.castShadow = decorMesh.receiveShadow = true;
    const bulbMat = mat(
      new MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    );
    this.group.add(decorMesh, new Mesh(decor.bulbs, bulbMat));

    // --- warning squares on the floor where the next walls will land
    const warnGeo = shared('warn', () =>
      new PlaneGeometry(0.98, 0.98).rotateX(-Math.PI / 2),
    );
    const warnMat = mat(
      new ShaderMaterial({
        uniforms: {
          uColor: { value: new Color(theme.warnColor) },
          uTime: this.warnTime,
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          varying float vP;
          void main() {
            vUv = uv * 2.0 - 1.0;
            vP = instanceMatrix[1][1]; // how close the wall is to landing, 0..1 (see setWarnings)
            gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uTime;
          varying vec2 vUv;
          varying float vP;
          void main() {
            // a pulsing outline that beats faster as the wall comes, a faint fill, and the wall's shadow growing
            float e = max(abs(vUv.x), abs(vUv.y));
            float beat = 0.5 + 0.5 * sin(uTime * (9.0 + 16.0 * vP));
            float line = smoothstep(0.74, 0.82, e) * (1.0 - smoothstep(0.93, 0.99, e));
            float aLine = line * (0.55 + 0.45 * beat) + (1.0 - line) * 0.12 * step(e, 0.82);
            float s = mix(0.25, 0.85, vP);
            float aShade = (1.0 - smoothstep(s * 0.6, s, length(vUv))) * 0.6 * vP;
            float a = aLine + aShade * (1.0 - aLine);
            gl_FragColor = vec4(uColor * aLine * (1.0 + 0.4 * beat), a);
            #include <colorspace_fragment>
          }`,
        transparent: true,
        depthWrite: false,
        blending: CustomBlending,
        blendSrc: OneFactor,
        blendDst: OneMinusSrcAlphaFactor,
      }),
    );
    this.warn = new InstancedMesh(warnGeo, warnMat, 16);
    this.warn.count = 0;
    this.warn.frustumCulled = false;
    this.warn.renderOrder = 2;
    this.group.add(this.warn);

    // --- light: key + fill; the key's shadow map is static (see `consumeShadowDirty`)
    const r = Math.hypot(w, h) / 2 + 2;
    this.sun.color.set(theme.light.key);
    this.sun.intensity = theme.light.keyIntensity;
    this.sun.position.set(-0.5, 1, 0.7).normalize().multiplyScalar(40);
    this.sun.castShadow = quality.shadows;
    if (quality.shadows) {
      this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
      const cam = this.sun.shadow.camera;
      cam.left = -r;
      cam.right = r;
      cam.top = r;
      cam.bottom = -r;
      cam.near = 5;
      cam.far = 90;
      cam.updateProjectionMatrix();
      this.sun.shadow.bias = -0.0006;
      this.sun.shadow.normalBias = 0.04;
      this.sun.shadow.radius = 3;
    }
    this.scenery.add(
      this.sun,
      new HemisphereLight(
        theme.light.sky,
        theme.light.ground,
        theme.light.fill * (quality.name === 'high' ? ENV_FILL : 1),
      ),
    );
  }

  /**
   * Matrix of the tile at cell `(x, y)`: lifted by `dy`, tilted `tilt` rad about the horizontal axis at angle `axis`,
   * scaled by `scale`. Planks run both ways on alternate cells when the level asks for it.
   */
  private tileMatrix(
    x: number,
    y: number,
    dy: number,
    tilt: number,
    axis: number,
    scale: number,
    out: Matrix4,
  ): Matrix4 {
    const { w, h } = this.map;
    const turn = this.theme.tiles.rotate;
    const yaw =
      turn === 'any'
        ? (hash3(x, y, this.map.seed, 5) & 3) * (Math.PI / 2)
        : turn && (x + y) & 1
          ? Math.PI / 2
          : 0;
    const q = this.q.setFromAxisAngle(UP, yaw);
    if (tilt) {
      this.axis.set(Math.cos(axis), 0, Math.sin(axis));
      q.premultiply(this.q2.setFromAxisAngle(this.axis, tilt));
    }
    return out.compose(
      this.p3.set(gridToWorldX(w, x + 0.5), dy, gridToWorldZ(h, y + 0.5)),
      q,
      this.s3.setScalar(scale),
    );
  }

  /** Animate the walls in the air and the tiles sinking (`t` = the FX clock in seconds), and the scenery. */
  update(t: number): void {
    this.level.update?.(t);
    if (this.sinking.length) this.updateSinking(t);
    if (this.falling.length === 0) return;
    const m = new Matrix4();
    const q = new Quaternion();
    const p = new Vector3();
    const s = new Vector3();
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      const left = f.land - t; // seconds until it lands
      let y = 0;
      let sy = 1;
      if (left > 0) y = (left / WALL_FALL_S) ** 2 * WALL_DROP_H;
      else if (left > -0.16) {
        // a small bounce and squash on impact
        const k = -left / 0.16;
        y = Math.sin(k * Math.PI) * 0.2;
        sy = 1 - Math.sin(k * Math.PI) * 0.08;
      }
      q.setFromAxisAngle(UP, f.yaw);
      m.compose(p.set(f.x, y, f.z), q, s.set(1, sy, 1));
      f.mesh.setMatrixAt(f.slot, m);
      f.mesh.instanceMatrix.needsUpdate = true;
      if (left <= -0.16) {
        const { w, h } = this.map;
        const cx = Math.round(f.x + w / 2 - 0.5);
        const cy = Math.round(f.z + h / 2 - 0.5);
        this.contact.add(cy * w + cx, f.x, f.z);
        this.falling.splice(i, 1);
        this.shadowDirty = true;
      }
    }
  }

  /** Sea Deck: move the sinking tiles (and the crates riding them); the splash comes from the caller's FX. */
  private updateSinking(t: number): void {
    const { w } = this.map;
    const m = new Matrix4();
    for (let i = this.sinking.length - 1; i >= 0; i--) {
      const e = this.sinking[i];
      const k = t - e.start;
      const f = Math.max(0, k - SINK_DELAY_S);
      const dy = -SINK_G * f * f;
      const x = e.cell % w;
      const y = (e.cell - x) / w;
      const gone = dy < -1.7;
      const tilt =
        Math.min(1.1, f * 2.2) + (f === 0 ? 0.03 * Math.sin(k * 60) : 0);
      this.tileMatrix(x, y, dy, tilt, e.tilt, gone ? 0 : 1, m);
      this.tiles.setMatrixAt(e.cell, m);
      this.tiles.instanceMatrix.needsUpdate = true;
      const slot = this.crateSlot[e.cell];
      if (e.crate && slot >= 0) {
        const r = this.crates[this.crateKind[e.cell]]!;
        const carry = this.tileMatrix(x, y, dy, tilt, e.tilt, 1, new Matrix4());
        r.mesh.setMatrixAt(slot, carry.multiply(e.crate));
        r.mesh.instanceMatrix.needsUpdate = true;
        this.shadowDirty = true;
      }
      if (gone) {
        if (slot >= 0) this.removeCrate(x, y);
        this.sinking.splice(i, 1);
        this.shadowDirty = true;
      }
    }
  }

  /**
   * Sudden death: a wall falls onto cell `(x, y)`, landing `WALL_FALL_S` seconds after clock time `now`. Whatever stood there
   * (crate) must be removed by the caller first.
   */
  dropWall(x: number, y: number, now: number): void {
    if (this.theme.fall === 'tile') return this.sinkTile(x, y, now);
    const { w, h } = this.map;
    const variants = this.theme.wallVariants;
    const v = variants[(x * 7 + y * 13) % variants.length];
    const mesh = this.hardMeshes[v];
    if (mesh.count >= mesh.instanceMatrix.count) return;
    const slot = mesh.count++;
    const r = new Rng(hash3(x, y, this.map.seed, 77));
    const tint = new Color().setScalar(r.range(0.94, 1.04));
    mesh.setColorAt(slot, tint);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.falling.push({
      mesh,
      slot,
      x: gridToWorldX(w, x + 0.5),
      z: gridToWorldZ(h, y + 0.5),
      land: now + WALL_FALL_S,
      yaw: v === 0 ? r.range(0, 6.28) : r.pick([0, Math.PI / 2]),
    });
    // park it high until update() places it
    const m = new Matrix4().makeTranslation(0, 100, 0);
    mesh.setMatrixAt(slot, m);
    mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Sea Deck: the tile under cell `(x, y)` breaks loose at clock time `now` and sinks (the crate on it rides along and is
   * removed at the water). Needs no wall; the sim already treats the cell as hard.
   */
  sinkTile(x: number, y: number, now: number): void {
    const { w, h } = this.map;
    const cell = y * w + x;
    if (this.sunk[cell]) return;
    this.sunk[cell] = 1;
    this.contact.remove(cell);
    let crate: Matrix4 | null = null;
    const slot = this.crateSlot[cell];
    if (slot >= 0) {
      crate = new Matrix4();
      this.crates[this.crateKind[cell]]!.mesh.getMatrixAt(slot, crate);
    }
    const r = new Rng(hash3(x, y, this.map.seed, 78));
    this.sinking.push({ cell, start: now, tilt: r.range(0, 6.28), crate });
    this.level.ripple?.(
      gridToWorldX(w, x + 0.5),
      gridToWorldZ(h, y + 0.5),
      now + TILE_SPLASH_S,
    );
  }

  /** Has the tile at `(x, y)` broken loose (Sea Deck)? Always false in the other levels. */
  isSunk(x: number, y: number): boolean {
    return this.sunk[y * this.map.w + x] === 1;
  }

  /**
   * Mark the cells where walls are about to land (at most 16 are drawn); call every frame, `n = 0` hides them. `secs` =
   * seconds until each lands, out of `warnS`: the outline beats faster and the shadow grows as it comes.
   */
  setWarnings(
    cells: Int16Array,
    n: number,
    t: number,
    secs?: Float32Array,
    warnS = 1,
  ): void {
    const { w, h } = this.map;
    const m = new Matrix4();
    const count = Math.min(n, this.warn.instanceMatrix.count);
    this.warnTime.value = t;
    const planks = this.theme.fall === 'tile';
    for (let k = 0; k < count; k++) {
      const c = cells[k];
      const x = c % w;
      const y = (c - x) / w;
      // the y scale of a flat square changes nothing on screen: it carries the progress to the shader
      const p = secs ? 1 - Math.min(1, Math.max(0, secs[k] / warnS)) : 0.5;
      m.makeScale(1, Math.max(0.001, p), 1);
      m.setPosition(gridToWorldX(w, x + 0.5), 0.03, gridToWorldZ(h, y + 0.5));
      this.warn.setMatrixAt(k, m);
      if (planks) {
        // the planks strain and creak before they give way
        const sh = 0.05 * Math.sin(t * 45 + c * 1.7);
        this.tileMatrix(x, y, -0.2 * Math.abs(sh), sh, c, 1, m);
        this.tiles.setMatrixAt(c, m);
      }
    }
    if (planks && count) this.tiles.instanceMatrix.needsUpdate = true;
    this.warn.count = count;
    this.warn.instanceMatrix.needsUpdate = true;
  }

  /** Remove the crate on cell `(x, y)` (a `blockBroken` event). Returns false when there is none. */
  removeCrate(x: number, y: number): boolean {
    const { w } = this.map;
    const cell = y * w + x;
    const slot = this.crateSlot[cell];
    const kind = this.crateKind[cell];
    if (slot < 0 || kind < 0) return false;
    const r = this.crates[kind]!;
    const last = r.cells.length - 1;
    if (slot !== last) {
      const m = new Matrix4();
      r.mesh.getMatrixAt(last, m);
      r.mesh.setMatrixAt(slot, m);
      const c = new Color();
      r.mesh.getColorAt(last, c);
      r.mesh.setColorAt(slot, c);
      const moved = r.cells[last];
      r.cells[slot] = moved;
      this.crateSlot[moved] = slot;
    }
    r.cells.pop();
    r.mesh.count = r.cells.length;
    r.mesh.instanceMatrix.needsUpdate = true;
    if (r.mesh.instanceColor) r.mesh.instanceColor.needsUpdate = true;
    this.crateSlot[cell] = -1;
    this.crateKind[cell] = -1;
    this.contact.remove(cell);
    this.shadowDirty = true;
    return true;
  }

  /**
   * Clear everything standing in the world rectangle `x0..x1` x `z0..z1` (crates, hard blocks, walls): the results podium
   * rises there. Only for the end of a match (the next match builds a new arena).
   */
  clearArea(x0: number, x1: number, z0: number, z1: number): void {
    const { w, h } = this.map;
    for (const r of this.crates) {
      if (!r) continue;
      for (const cell of [...r.cells]) {
        const x = cell % w;
        const y = (cell - x) / w;
        const wx = gridToWorldX(w, x + 0.5);
        const wz = gridToWorldZ(h, y + 0.5);
        if (wx >= x0 && wx <= x1 && wz >= z0 && wz <= z1)
          this.removeCrate(x, y);
      }
    }
    const m = new Matrix4();
    const gone = new Matrix4().makeScale(0, 0, 0);
    for (const mesh of this.hardMeshes) {
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m);
        const wx = m.elements[12];
        const wz = m.elements[14];
        if (
          wx >= x0 &&
          wx <= x1 &&
          wz >= z0 &&
          wz <= z1 &&
          m.elements[13] < 5
        ) {
          mesh.setMatrixAt(i, gone);
          const cx = Math.round(wx + w / 2 - 0.5);
          const cy = Math.round(wz + h / 2 - 0.5);
          this.contact.remove(cy * w + cx);
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.shadowDirty = true;
  }

  /** Crates still standing. */
  get crateCount(): number {
    return (
      (this.crates[0]?.cells.length ?? 0) + (this.crates[1]?.cells.length ?? 0)
    );
  }

  /** Draw the static shadow map again at the next frame (after a lost WebGL context the map is empty). */
  markShadowDirty(): void {
    this.shadowDirty = true;
  }

  /** Casters changed since the last shadow draw (peek; `consumeShadowDirty` clears it). */
  isShadowDirty(): boolean {
    return this.shadowDirty;
  }

  /** True once after the casters changed: the game then sets `renderer.shadowMap.needsUpdate = true`. */
  consumeShadowDirty(): boolean {
    const d = this.shadowDirty;
    this.shadowDirty = false;
    return d;
  }

  dispose(): void {
    for (const m of this.materials) m.dispose();
    this.contact.dispose();
    this.level.dispose?.();
  }
}
