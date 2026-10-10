import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshLambertMaterial,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { hash3, Rng } from '../../../shared/rng';
import { CRITTERS, type CritterId, type PlayerView } from '../sim/types';
import { ringPoints, treadMidD, treadY, TIERS } from './bowl';
import { TEAM_COLORS } from './characters';
import { buildCritter, VEST_R, VEST_CY, type VestFit } from './critters';
import type { Quality } from './renderer';
import { Color } from 'three';

/**
 * The spectators in the stands (DETAILS.md "Style"): the same eight animals as the crew, redrawn with a few hundred
 * triangles each (vertex clustering of the crew model, flat shaded) and wearing a shirt in a team colour. Shirts only come
 * in the colours of the players in the match (`setPlayers`). One InstancedMesh per animal, no fur, no hats; the crowd is
 * still until something explodes, then it jumps for a moment (`excite`).
 */

/** Cluster size of the decimation, critter units: bigger = fewer triangles. */
const CELL = 0.19;

interface LowPoly {
  position: Float32Array;
  color: Float32Array;
  normal: Float32Array;
  /** 1 on the vertices of the shirt (torso and sleeves), 0 elsewhere. */
  shirt: Float32Array;
}

const lowPolyCache = new Map<CritterId, LowPoly>();

/** The crew model redrawn in few triangles: vertices snapped to a grid of `cell`, merged, collapsed triangles dropped. */
function decimate(src: BufferGeometry, cell: number, fit: VestFit): LowPoly {
  const pos = src.getAttribute('position');
  const col = src.getAttribute('color');
  const ids = new Map<number, number>();
  const sum: number[] = []; // x y z r g b n per cluster
  const cluster = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const kx = Math.round(pos.getX(i) / cell) + 64;
    const ky = Math.round(pos.getY(i) / cell) + 64;
    const kz = Math.round(pos.getZ(i) / cell) + 64;
    const key = (kx * 256 + ky) * 256 + kz;
    let id = ids.get(key);
    if (id === undefined) {
      id = sum.length / 7;
      ids.set(key, id);
      sum.push(0, 0, 0, 0, 0, 0, 0);
    }
    const o = id * 7;
    sum[o] += pos.getX(i);
    sum[o + 1] += pos.getY(i);
    sum[o + 2] += pos.getZ(i);
    sum[o + 3] += col.getX(i);
    sum[o + 4] += col.getY(i);
    sum[o + 5] += col.getZ(i);
    sum[o + 6]++;
    cluster[i] = id;
  }
  const count = sum.length / 7;
  const cx = new Float32Array(count * 3);
  const cc = new Float32Array(count * 3);
  const cs = new Float32Array(count);
  for (let k = 0; k < count; k++) {
    const n = sum[k * 7 + 6];
    for (let a = 0; a < 3; a++) {
      cx[k * 3 + a] = sum[k * 7 + a] / n;
      cc[k * 3 + a] = sum[k * 7 + 3 + a] / n;
    }
    const x = cx[k * 3];
    const y = cx[k * 3 + 1];
    const z = cx[k * 3 + 2];
    // inside the vest's shell and between its hem and shoulders: shirt (the vest fit moves/scales the shared vest)
    const xc = x / fit.sx;
    const zc = z / fit.sz;
    const yc = (y - fit.cy) / fit.sy + VEST_CY;
    cs[k] =
      Math.hypot(xc, zc) < VEST_R + 0.04 && yc > 0.17 && yc < 0.62 ? 1 : 0;
  }
  const p: number[] = [];
  const c: number[] = [];
  const s: number[] = [];
  for (let t = 0; t < pos.count; t += 3) {
    const a = cluster[t];
    const b = cluster[t + 1];
    const d = cluster[t + 2];
    if (a === b || b === d || a === d) continue;
    for (const k of [a, b, d]) {
      p.push(cx[k * 3], cx[k * 3 + 1], cx[k * 3 + 2]);
      c.push(cc[k * 3], cc[k * 3 + 1], cc[k * 3 + 2]);
      s.push(cs[k]);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(p, 3));
  g.computeVertexNormals(); // non-indexed: one normal per face = flat shading
  return {
    position: new Float32Array(p),
    color: new Float32Array(c),
    normal: new Float32Array(g.getAttribute('normal').array),
    shirt: new Float32Array(s),
  };
}

function lowPoly(id: CritterId): LowPoly {
  let lp = lowPolyCache.get(id);
  if (!lp) {
    const m = buildCritter(id);
    lp = decimate(m.geometry, CELL, m.vest);
    m.geometry.dispose();
    m.furGeometry.dispose();
    lowPolyCache.set(id, lp);
  }
  return lp;
}

/** Lambert + vertex colours; on the shirt vertices the colour comes from the instance (`aShirtCol`). */
function shirtMaterial(): MeshLambertMaterial {
  const m = new MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aShirt;\nattribute vec3 aShirtCol;',
      )
      .replace(
        '#include <color_vertex>',
        '#include <color_vertex>\nvColor.rgb = mix( vColor.rgb, aShirtCol, aShirt );',
      );
  };
  m.customProgramCacheKey = () => 'kaboom-crowd-shirt';
  return m;
}

interface Spectator {
  species: number;
  slot: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  phase: number;
  /** Favourite colour: a fixed draw in 0..1 that picks one of the colours on screen. */
  fav: number;
  shade: number;
}

const UP = new Vector3(0, 1, 0);

export class Crowd {
  readonly group = new Group();
  private readonly meshes: InstancedMesh[] = [];
  private readonly shirtAttr: InstancedBufferAttribute[] = [];
  private readonly spectators: Spectator[] = [];
  private readonly material = shirtMaterial();
  private excitement = 0;
  private colorMask = -1;
  private atRest = false;
  private readonly m4 = new Matrix4();
  private readonly quat = new Quaternion();
  private readonly pos = new Vector3();
  private readonly scl = new Vector3();
  private readonly tint = new Color();

  /** Spectators seat themselves round a floor of `w x h` cells grown by `pad`. */
  constructor(w: number, h: number, pad: number, quality: Quality) {
    const hx = w / 2 + pad;
    const hz = h / 2 + pad;
    const low = quality.name === 'low';
    const tiers = low ? TIERS - 1 : TIERS;
    const spacing = low ? 1.0 : 0.74;
    const fill = [0.94, 0.9, 0.82, 0.72];
    const rng = new Rng(hash3(w, h, 0xc0de, 5));
    const counts = new Array<number>(CRITTERS.length).fill(0);

    for (let t = 0; t < tiers; t++) {
      const pts = ringPoints(hx, hz, treadMidD(t));
      const n = pts.length / 2;
      let carry = rng.range(0, spacing);
      for (let i = 0; i < n; i++) {
        const ax = pts[i * 2];
        const az = pts[i * 2 + 1];
        const bx = pts[((i + 1) % n) * 2];
        const bz = pts[((i + 1) % n) * 2 + 1];
        const len = Math.hypot(bx - ax, bz - az);
        for (let s = carry; s < len; s += spacing) {
          carry = s + spacing - len;
          if (rng.next() > fill[t]) continue;
          const k = s / len;
          let x = ax + (bx - ax) * k;
          let z = az + (bz - az) * k;
          // look at the nearest point of the floor
          const fx = Math.max(-hx, Math.min(hx, x));
          const fz = Math.max(-hz, Math.min(hz, z));
          let dx = fx - x;
          let dz = fz - z;
          const dl = Math.hypot(dx, dz) || 1;
          dx /= dl;
          dz /= dl;
          const back = rng.range(-0.22, 0.22);
          x -= dx * back;
          z -= dz * back;
          const species = rng.int(0, CRITTERS.length - 1);
          this.spectators.push({
            species,
            slot: counts[species]++,
            x,
            y: treadY(t),
            z,
            yaw: Math.atan2(dx, dz) + rng.range(-0.3, 0.3),
            scale: rng.range(0.62, 0.76),
            phase: rng.range(0, 6.28),
            fav: rng.next(),
            shade: rng.range(0.92, 1.06),
          });
        }
      }
    }

    CRITTERS.forEach((id, sp) => {
      const lp = lowPoly(id);
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute(lp.position, 3));
      geo.setAttribute('color', new Float32BufferAttribute(lp.color, 3));
      geo.setAttribute('normal', new Float32BufferAttribute(lp.normal, 3));
      geo.setAttribute('aShirt', new Float32BufferAttribute(lp.shirt, 1));
      const shirt = new InstancedBufferAttribute(
        new Float32Array(Math.max(1, counts[sp]) * 3),
        3,
      );
      geo.setAttribute('aShirtCol', shirt);
      const mesh = new InstancedMesh(
        geo,
        this.material,
        Math.max(1, counts[sp]),
      );
      mesh.count = counts[sp];
      mesh.frustumCulled = false;
      this.meshes.push(mesh);
      this.shirtAttr.push(shirt);
      this.group.add(mesh);
    });
    this.place(0, 0);
  }

  get count(): number {
    return this.spectators.length;
  }

  /** Triangles drawn for the whole crowd. */
  get triangles(): number {
    let t = 0;
    for (const m of this.meshes)
      t += (m.geometry.getAttribute('position').count / 3) * m.count;
    return t;
  }

  /**
   * Shirts take the colours of the players in the match (benched bots do not count), so a colour only shows in the stands
   * when it is on screen. Cheap to call every frame: it only works when the set of colours changes.
   */
  setPlayers(players: readonly PlayerView[]): void {
    let mask = 0;
    for (const p of players)
      if (p.state !== 'out') mask |= 1 << (p.color % TEAM_COLORS.length);
    if (mask === this.colorMask) return;
    this.colorMask = mask;
    const palette: number[] = [];
    TEAM_COLORS.forEach((c, i) => {
      if (mask & (1 << i)) palette.push(c);
    });
    if (palette.length === 0) palette.push(...TEAM_COLORS);
    for (const sp of this.spectators) {
      const hex =
        palette[
          Math.min(palette.length - 1, Math.floor(sp.fav * palette.length))
        ];
      this.tint.setHex(hex).multiplyScalar(sp.shade);
      const a = this.shirtAttr[sp.species];
      a.setXYZ(sp.slot, this.tint.r, this.tint.g, this.tint.b);
    }
    for (const a of this.shirtAttr) a.needsUpdate = true;
  }

  /** The colours the shirts can take right now (for tests and the debug page). */
  get shirtMask(): number {
    return this.colorMask;
  }

  /** Something blew up: the crowd jumps (`amount` 0..1, adds up to 1). */
  excite(amount: number): void {
    this.excitement = Math.min(1, this.excitement + amount);
  }

  update(t: number, dt: number): void {
    if (this.excitement <= 0.01) {
      this.excitement = 0;
      if (!this.atRest) this.place(t, 0);
      return;
    }
    this.excitement *= Math.exp(-dt * 1.6);
    this.place(t, this.excitement);
  }

  private place(t: number, excite: number): void {
    this.atRest = excite === 0;
    const { m4, quat, pos, scl } = this;
    for (const sp of this.spectators) {
      const hop = excite * 0.28 * Math.abs(Math.sin(t * 9 + sp.phase));
      quat.setFromAxisAngle(UP, sp.yaw);
      scl.set(sp.scale, sp.scale * (1 + hop * 0.15), sp.scale);
      pos.set(sp.x, sp.y + hop, sp.z);
      m4.compose(pos, quat, scl);
      this.meshes[sp.species].setMatrixAt(sp.slot, m4);
    }
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
      m.dispose();
    }
    this.material.dispose();
  }
}
