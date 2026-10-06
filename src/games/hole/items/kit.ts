import { BufferGeometry, Color, Float32BufferAttribute, Matrix4 } from 'three';

/**
 * Blocky geometry kit. Items are built from boxes, low-sided cylinders / cones
 * and roofs, with vertex colours (no textures). Everything merges into one
 * non-indexed BufferGeometry per item (flat shaded), pivot at the ground centre.
 *
 * Conventions: +Y up, vehicles / long items run along X and face +X, people
 * and facades face +Z.
 */
export type Vec3 = [number, number, number];

export interface BoxOpts {
  /** Part receives the per-instance paint colour. */
  paint?: boolean;
  /** Part glows: its colour is added on top of the lighting (screens, lamps, robot eyes); see `render/materials.ts`. */
  glow?: boolean;
  /** See-through part (domes, panes): drawn as a 50 % screen-door dither, see `render/materials.ts`. */
  glass?: boolean;
  /** Side faces use the window-tile UVs of the building materials. */
  wall?: boolean;
  /** Scale of the top face (1 = straight box, <1 = taper). */
  taper?: number;
  /** Skip the bottom face (default true). */
  bottom?: boolean;
}

export interface CylOpts {
  paint?: boolean;
  /** Glowing part (see BoxOpts.glow). */
  glow?: boolean;
  /** See-through part (domes, panes): drawn as a 50 % screen-door dither, see `render/materials.ts`. */
  glass?: boolean;
  /** Cylinder axis. Default 'y'. */
  axis?: 'x' | 'y' | 'z';
  /** Close the ends (default true; the bottom cap of 'y' cylinders is skipped). */
  caps?: boolean;
  /** Window UVs on the side (towers). */
  wall?: boolean;
}

export interface BallOpts {
  paint?: boolean;
  /** Glowing part (see BoxOpts.glow). */
  glow?: boolean;
  /** See-through part (domes, panes): drawn as a 50 % screen-door dither, see `render/materials.ts`. */
  glass?: boolean;
  /** Facets around (default from `roundDetail`). */
  seg?: number;
  /** Latitude rows, pole to pole (default from `roundDetail`). */
  rings?: number;
  /** 0..~0.5: the top narrows towards the pole, which makes an egg (point up; rotate with `xf` for a body). */
  taper?: number;
  /** Keep only the upper half (a dome); `cy` is its base. */
  half?: boolean;
  /** With `half`: close the flat bottom (default open, like a box without a bottom). */
  bottom?: boolean;
  /** 0..~0.3 seeded radius noise per vertex (boulders, bush and tree crowns). */
  jitter?: number;
  /** Seed of the jitter, so two crowns of one tree differ. */
  seed?: number;
}

/**
 * Facets for a round part by its biggest radius (m): tiny parts stay cheap, giants get smooth.
 * 6x3 = 24 triangles up to 12x8 = 168.
 */
export function roundDetail(r: number): { seg: number; rings: number } {
  if (r < 0.1) return { seg: 6, rings: 3 };
  if (r < 0.4) return { seg: 6, rings: 4 };
  if (r < 1.5) return { seg: 8, rings: 5 };
  if (r < 6) return { seg: 10, rings: 6 };
  return { seg: 12, rings: 8 };
}

/** Deterministic 0..1 noise from three integers. */
function hash2(a: number, b: number, seed: number): number {
  let h =
    (Math.imul(a + 1, 374761393) ^
      Math.imul(b + 7, 668265263) ^
      Math.imul(seed + 13, 2246822519)) >>>
    0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** UV of a plain wall pixel in the window tiles (also used for roofs / trims). */
export const SOLID_UV: [number, number] = [0.03, 0.03];
/** World metres per window tile. */
export const BAY = 3;
export const FLOOR = 3.2;

const tmpColor = new Color();

/** Distance (m) a coplanar face is pulled in by `Mesher.decoplanar`; above the clip checker's 4 mm. */
const DECOPLANAR_GAP = 0.0058;

export class Mesher {
  /** Debug: record the builder call site of every triangle (clip checker); slow, off by default. */
  static trace = false;
  /**
   * Opt-in (Toy Emporium builders): when a new axis-aligned box has a face in the same plane as an
   * earlier box's face (same direction, overlapping), pull that face in by `DECOPLANAR_GAP` so the two
   * never z-fight. City builders keep it off and avoid coplanar faces by hand.
   */
  static decoplanar = false;
  private placed: [number, number, number, number, number, number][] = [];
  /** Call site ("file:line") of each triangle, only filled while `Mesher.trace` is on. */
  readonly sites: string[] = [];
  /** Primitive number (box / cylinder / roof call) of each triangle, only filled while `Mesher.trace` is on. */
  readonly prims: number[] = [];
  private primCount = 0;
  private pos: number[] = [];
  private col: number[] = [];
  private uv: number[] = [];
  private paintAttr: number[] = [];
  /** Set while a `glow` box / cylinder is emitted: its vertices get paint attribute 2. */
  private glowNow = false;
  /** Set while a `glass` part is emitted: its vertices get paint attribute 3 (see-through dither in the item material). */
  private glassNow = false;
  private stack: Matrix4[] = [];
  private m = new Matrix4();

  /** Run `fn` with a local transform (translate, then yaw, pitch(x), roll(z)). */
  xf(
    x: number,
    y: number,
    z: number,
    fn: () => void,
    rotY = 0,
    rotX = 0,
    rotZ = 0,
  ): void {
    this.stack.push(this.m.clone());
    const t = new Matrix4()
      .makeTranslation(x, y, z)
      .multiply(new Matrix4().makeRotationY(rotY))
      .multiply(new Matrix4().makeRotationX(rotX))
      .multiply(new Matrix4().makeRotationZ(rotZ));
    this.m.multiply(t);
    fn();
    this.m = this.stack.pop()!;
  }

  /**
   * Build `fn` so that its bounding box is exactly w x d x h (footprint centred on x / z, standing on y = 0):
   * the shape is built once into a scratch Mesher to measure it, then again scaled to fit. Lets rigs
   * (animals) be designed by proportion while the built size equals the catalog size.
   */
  fitted(w: number, d: number, h: number, fn: (m: Mesher) => void): void {
    const probe = new Mesher();
    probe.primCount = 0;
    fn(probe);
    const bb = probe.build().boundingBox!;
    const sx = w / Math.max(1e-6, bb.max.x - bb.min.x);
    const sy = h / Math.max(1e-6, bb.max.y - bb.min.y);
    const sz = d / Math.max(1e-6, bb.max.z - bb.min.z);
    this.stack.push(this.m.clone());
    const t = new Matrix4()
      .makeTranslation(
        (-(bb.max.x + bb.min.x) / 2) * sx,
        -bb.min.y * sy,
        (-(bb.max.z + bb.min.z) / 2) * sz,
      )
      .multiply(new Matrix4().makeScale(sx, sy, sz));
    this.m.multiply(t);
    fn(this);
    this.m = this.stack.pop()!;
  }

  private v(p: Vec3): Vec3 {
    const e = this.m.elements;
    const [x, y, z] = p;
    return [
      e[0] * x + e[4] * y + e[8] * z + e[12],
      e[1] * x + e[5] * y + e[9] * z + e[13],
      e[2] * x + e[6] * y + e[10] * z + e[14],
    ];
  }

  private push(
    p: Vec3,
    color: number,
    paint: boolean,
    uv: [number, number],
  ): void {
    const w = this.v(p);
    this.pos.push(w[0], w[1], w[2]);
    // paint parts are white so the per-instance colour shows through (x ambient occlusion)
    tmpColor.setHex(paint ? 0xffffff : color);
    this.col.push(tmpColor.r, tmpColor.g, tmpColor.b);
    this.uv.push(uv[0], uv[1]);
    // paint attribute: 0 = plain, 1 = takes the instance colour, 2 = glows (emissive), 3 = glass (see-through dither)
    this.paintAttr.push(this.glowNow ? 2 : this.glassNow ? 3 : paint ? 1 : 0);
  }

  /** Triangle, wound so its normal points along `hint` (outward). */
  tri(
    a: Vec3,
    b: Vec3,
    c: Vec3,
    color: number,
    hint: Vec3,
    paint = false,
    uvs: [number, number][] = [SOLID_UV, SOLID_UV, SOLID_UV],
  ): void {
    if (Mesher.trace) {
      this.sites.push(callSite());
      this.prims.push(this.primCount);
    }
    const n = cross(sub(b, a), sub(c, a));
    if (dot(n, hint) < 0) {
      this.push(a, color, paint, uvs[0]);
      this.push(c, color, paint, uvs[2]);
      this.push(b, color, paint, uvs[1]);
    } else {
      this.push(a, color, paint, uvs[0]);
      this.push(b, color, paint, uvs[1]);
      this.push(c, color, paint, uvs[2]);
    }
  }

  quad(
    a: Vec3,
    b: Vec3,
    c: Vec3,
    d: Vec3,
    color: number,
    hint: Vec3,
    paint = false,
    uvs: [number, number][] = [SOLID_UV, SOLID_UV, SOLID_UV, SOLID_UV],
  ): void {
    this.tri(a, b, c, color, hint, paint, [uvs[0], uvs[1], uvs[2]]);
    this.tri(a, c, d, color, hint, paint, [uvs[0], uvs[2], uvs[3]]);
  }

  /** Box centred on (cx, cz), standing on y0. */
  box(
    cx: number,
    y0: number,
    cz: number,
    w: number,
    h: number,
    d: number,
    color: number,
    o: BoxOpts = {},
  ): void {
    this.primCount++;
    this.glowNow = !!o.glow;
    this.glassNow = !!o.glass;
    if (Mesher.decoplanar && (o.taper ?? 1) === 1) {
      const e = this.m.elements;
      const plain =
        Math.abs(e[0] - 1) < 1e-9 &&
        Math.abs(e[5] - 1) < 1e-9 &&
        Math.abs(e[10] - 1) < 1e-9 &&
        Math.abs(e[1]) + Math.abs(e[2]) + Math.abs(e[4]) + Math.abs(e[6]) <
          1e-9;
      if (plain) {
        const ox = e[12];
        const oy = e[13];
        const oz = e[14];
        const bb = this.separate([
          ox + cx - w / 2,
          ox + cx + w / 2,
          oy + y0,
          oy + y0 + h,
          oz + cz - d / 2,
          oz + cz + d / 2,
        ]);
        this.placed.push(bb);
        cx = (bb[0] + bb[1]) / 2 - ox;
        w = bb[1] - bb[0];
        y0 = bb[2] - oy;
        h = bb[3] - bb[2];
        cz = (bb[4] + bb[5]) / 2 - oz;
        d = bb[5] - bb[4];
      }
    }
    const hw = w / 2;
    const hd = d / 2;
    const tp = o.taper ?? 1;
    const y1 = y0 + h;
    const b: Vec3[] = [
      [cx - hw, y0, cz - hd],
      [cx + hw, y0, cz - hd],
      [cx + hw, y0, cz + hd],
      [cx - hw, y0, cz + hd],
    ];
    const t: Vec3[] = [
      [cx - hw * tp, y1, cz - hd * tp],
      [cx + hw * tp, y1, cz - hd * tp],
      [cx + hw * tp, y1, cz + hd * tp],
      [cx - hw * tp, y1, cz + hd * tp],
    ];
    const paint = !!o.paint;
    const centre: Vec3 = [cx, y0 + h / 2, cz];
    const side = (i: number, j: number) => {
      const mid: Vec3 = [
        (b[i][0] + b[j][0]) / 2,
        centre[1],
        (b[i][2] + b[j][2]) / 2,
      ];
      const hint = sub(mid, centre);
      const alongX = Math.abs(b[i][2] - b[j][2]) < 1e-6;
      const u0 = alongX ? b[i][0] : b[i][2];
      const u1 = alongX ? b[j][0] : b[j][2];
      const uvs: [number, number][] = o.wall
        ? [
            [u0 / BAY, y0 / FLOOR],
            [u1 / BAY, y0 / FLOOR],
            [u1 / BAY, y1 / FLOOR],
            [u0 / BAY, y1 / FLOOR],
          ]
        : [SOLID_UV, SOLID_UV, SOLID_UV, SOLID_UV];
      this.quad(b[i], b[j], t[j], t[i], color, hint, paint, uvs);
    };
    side(0, 1);
    side(1, 2);
    side(2, 3);
    side(3, 0);
    this.quad(t[0], t[1], t[2], t[3], color, [0, 1, 0], paint);
    if (o.bottom) this.quad(b[0], b[1], b[2], b[3], color, [0, -1, 0], paint);
    this.glowNow = false;
    this.glassNow = false;
  }

  /** Pull faces that share a plane with an earlier box inward (see `decoplanar`). */
  private separate(
    b: [number, number, number, number, number, number],
  ): [number, number, number, number, number, number] {
    const gap = DECOPLANAR_GAP;
    const tol = 0.0045;
    const ov = (a0: number, a1: number, b0: number, b1: number) =>
      Math.min(a1, b1) - Math.max(a0, b0) > 1e-4;
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      const pull = (hi: boolean, i: number): void => {
        // pull the face at index i inward (hi = the upper face of its axis)
        b[i] += hi ? -gap : gap;
        moved = true;
      };
      for (const q of this.placed) {
        // +X / -X faces overlap in (y, z); +Y in (x, z); +Z / -Z in (x, y)
        if (ov(b[2], b[3], q[2], q[3]) && ov(b[4], b[5], q[4], q[5])) {
          if (Math.abs(b[1] - q[1]) < tol && b[1] - gap > b[0]) pull(true, 1);
          if (Math.abs(b[0] - q[0]) < tol && b[0] + gap < b[1]) pull(false, 0);
        }
        if (ov(b[0], b[1], q[0], q[1]) && ov(b[4], b[5], q[4], q[5])) {
          if (Math.abs(b[3] - q[3]) < tol && b[3] - gap > b[2]) pull(true, 3);
        }
        if (ov(b[0], b[1], q[0], q[1]) && ov(b[2], b[3], q[2], q[3])) {
          if (Math.abs(b[5] - q[5]) < tol && b[5] - gap > b[4]) pull(true, 5);
          if (Math.abs(b[4] - q[4]) < tol && b[4] + gap < b[5]) pull(false, 4);
        }
      }
      if (!moved) break;
    }
    return b;
  }

  /** Cylinder / cone (rTop = 0) with `sides` sides; (cx, cz) is the centre, y0 the bottom. */
  cyl(
    cx: number,
    y0: number,
    cz: number,
    rBottom: number,
    rTop: number,
    h: number,
    sides: number,
    color: number,
    o: CylOpts = {},
  ): void {
    this.primCount++;
    this.glowNow = !!o.glow;
    this.glassNow = !!o.glass;
    const axis = o.axis ?? 'y';
    const paint = !!o.paint;
    const caps = o.caps ?? true;
    const build = () => {
      const ring = (r: number, y: number): Vec3[] => {
        const pts: Vec3[] = [];
        for (let i = 0; i < sides; i++) {
          const a = (i / sides) * Math.PI * 2;
          pts.push([Math.cos(a) * r, y, Math.sin(a) * r]);
        }
        return pts;
      };
      const bot = ring(rBottom, 0);
      const top = ring(rTop, h);
      for (let i = 0; i < sides; i++) {
        const j = (i + 1) % sides;
        const am = ((i + 0.5) / sides) * Math.PI * 2;
        const hint: Vec3 = [Math.cos(am), 0.0, Math.sin(am)];
        const uv: [number, number][] = o.wall
          ? [
              [((i / sides) * 2 * Math.PI * rBottom) / BAY, 0],
              [(((i + 1) / sides) * 2 * Math.PI * rBottom) / BAY, 0],
              [(((i + 1) / sides) * 2 * Math.PI * rTop) / BAY, h / FLOOR],
              [((i / sides) * 2 * Math.PI * rTop) / BAY, h / FLOOR],
            ]
          : [SOLID_UV, SOLID_UV, SOLID_UV, SOLID_UV];
        if (rTop < 1e-6)
          this.tri(bot[i], bot[j], top[i], color, hint, paint, [
            uv[0],
            uv[1],
            uv[3],
          ]);
        else this.quad(bot[i], bot[j], top[j], top[i], color, hint, paint, uv);
      }
      if (caps && rTop > 1e-6) {
        for (let i = 1; i < sides - 1; i++)
          this.tri(top[0], top[i], top[i + 1], color, [0, 1, 0], paint);
      }
      if (caps && axis !== 'y') {
        for (let i = 1; i < sides - 1; i++)
          this.tri(bot[0], bot[i], bot[i + 1], color, [0, -1, 0], paint);
      }
    };
    const rotAxis =
      axis === 'x'
        ? { z: -Math.PI / 2 }
        : axis === 'z'
          ? { x: Math.PI / 2 }
          : {};
    if (axis === 'y') {
      this.xf(cx, y0, cz, build);
    } else {
      // axis cylinders are centred on (cx, y0, cz): y0 is the centre height of the axis
      this.xf(
        cx,
        y0,
        cz,
        () => this.xf(0, -h / 2, 0, build),
        0,
        (rotAxis as { x?: number }).x ?? 0,
        (rotAxis as { z?: number }).z ?? 0,
      );
    }
    this.glowNow = false;
    this.glassNow = false;
  }

  /**
   * Low-poly ball / egg / dome (flat shaded, faceted): an ellipsoid with radii (rx, ry, rz) centred on
   * (cx, cy, cz). Triangles = 2 x seg x (rings - 1) (a dome: about half). Defaults to `roundDetail`
   * of the biggest radius. A `half` dome keeps the upper half and `cy` is its base height.
   */
  ball(
    cx: number,
    cy: number,
    cz: number,
    rx: number,
    ry: number,
    rz: number,
    color: number,
    o: BallOpts = {},
  ): void {
    this.primCount++;
    this.glowNow = !!o.glow;
    this.glassNow = !!o.glass;
    const paint = !!o.paint;
    const det = roundDetail(Math.max(rx, ry, rz));
    const seg = Math.max(3, o.seg ?? det.seg);
    const rings = Math.max(2, o.rings ?? det.rings);
    const taper = o.taper ?? 0;
    const jitter = o.jitter ?? 0;
    const seed = o.seed ?? 1;
    // latitude rows from the top pole (k = 0) down to the bottom pole, or to the equator for a dome
    const rows = o.half ? Math.max(2, Math.ceil(rings / 2)) : rings;
    const phiMax = o.half ? Math.PI / 2 : Math.PI;
    const vert = (k: number, i: number): Vec3 => {
      const phi = (k / rows) * phiMax;
      const cp = Math.cos(phi);
      const sp = Math.sin(phi);
      const a = (i / seg) * Math.PI * 2;
      let f = 1 - taper * (cp * 0.5 + 0.5);
      if (jitter > 0 && k > 0 && !(k === rows && !o.half))
        f *= 1 + (hash2(k, i % seg, seed) - 0.5) * 2 * jitter;
      let y = ry * cp;
      if (jitter > 0 && (k === 0 || (k === rows && !o.half)))
        y *= 1 + (hash2(k, 0, seed) - 0.5) * 2 * jitter;
      return [
        cx + rx * sp * Math.cos(a) * f,
        cy + y,
        cz + rz * sp * Math.sin(a) * f,
      ];
    };
    const centre: Vec3 = [cx, cy, cz];
    const out = (p: Vec3, q: Vec3, r: Vec3): Vec3 =>
      sub(
        [
          (p[0] + q[0] + r[0]) / 3,
          (p[1] + q[1] + r[1]) / 3,
          (p[2] + q[2] + r[2]) / 3,
        ],
        centre,
      );
    for (let k = 0; k < rows; k++) {
      for (let i = 0; i < seg; i++) {
        const a = vert(k, i);
        const b = vert(k, i + 1);
        const c = vert(k + 1, i + 1);
        const d = vert(k + 1, i);
        if (k === 0) this.tri(a, c, d, color, out(a, c, d), paint);
        else if (k === rows - 1 && !o.half && rows > 1)
          this.tri(a, b, d, color, out(a, b, d), paint);
        else {
          this.tri(a, b, c, color, out(a, b, c), paint);
          this.tri(a, c, d, color, out(a, c, d), paint);
        }
      }
    }
    if (o.half && o.bottom) {
      for (let i = 1; i < seg - 1; i++)
        this.tri(
          vert(rows, 0),
          vert(rows, i + 1),
          vert(rows, i),
          color,
          [0, -1, 0],
          paint,
        );
    }
    this.glowNow = false;
    this.glassNow = false;
  }

  /** Gable roof: ridge along X. (cx, cz) centre, y0 eave height, rh ridge rise. */
  gable(
    cx: number,
    y0: number,
    cz: number,
    w: number,
    d: number,
    rh: number,
    color: number,
    paint = false,
    endColor = color,
  ): void {
    this.primCount++;
    const hw = w / 2;
    const hd = d / 2;
    const a: Vec3 = [cx - hw, y0, cz - hd];
    const b: Vec3 = [cx + hw, y0, cz - hd];
    const c: Vec3 = [cx + hw, y0, cz + hd];
    const e: Vec3 = [cx - hw, y0, cz + hd];
    const r0: Vec3 = [cx - hw, y0 + rh, cz];
    const r1: Vec3 = [cx + hw, y0 + rh, cz];
    this.quad(a, b, r1, r0, color, [0, 1, -hd / Math.max(rh, 0.01)], paint);
    this.quad(e, c, r1, r0, color, [0, 1, hd / Math.max(rh, 0.01)], paint);
    this.tri(a, e, r0, endColor, [-1, 0, 0], paint);
    this.tri(b, c, r1, endColor, [1, 0, 0], paint);
  }

  /** Hip roof / pyramid frustum: footprint w x d, top scaled by `top` (0 = point). */
  hip(
    cx: number,
    y0: number,
    cz: number,
    w: number,
    d: number,
    h: number,
    top: number,
    color: number,
    paint = false,
  ): void {
    this.box(cx, y0, cz, w, h, d, color, {
      paint,
      taper: Math.max(top, 0.001),
    });
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    // ambient-occlusion feel: darken the bottom of every item
    let maxY = 0;
    for (let i = 1; i < this.pos.length; i += 3)
      maxY = Math.max(maxY, this.pos[i]);
    const ao = Math.min(maxY * 0.2, 4);
    const col = this.col.slice();
    if (ao > 0) {
      for (let i = 0; i < this.pos.length / 3; i++) {
        const y = this.pos[i * 3 + 1];
        const k = y >= ao ? 1 : 0.74 + 0.26 * Math.max(0, y / ao);
        col[i * 3] *= k;
        col[i * 3 + 1] *= k;
        col[i * 3 + 2] *= k;
      }
    }
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    g.setAttribute('paint', new Float32BufferAttribute(this.paintAttr, 1));
    g.computeVertexNormals();
    g.computeBoundingBox();
    if (Mesher.trace) {
      g.userData.sites = this.sites;
      g.userData.prims = this.prims;
    }
    return g;
  }
}

/** First stack frame outside this file (the builder line that asked for the shape). */
function callSite(): string {
  const lines = (new Error().stack ?? '').split(/\r?\n/).slice(1);
  for (const l of lines) {
    if (/kit(-toy)?\.(ts|js)/.test(l)) continue;
    const m = /([\w.-]+):(\d+):\d+\)?$/.exec(l.trim());
    if (m) return `${m[1]}:${m[2]}`;
  }
  return '?';
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Named palette (hex sRGB). */
export const PAL = {
  white: 0xf4f1ea,
  cream: 0xf3e3c3,
  black: 0x25282b,
  dark: 0x3a3f45,
  grey: 0x8b9298,
  light: 0xc9cdd1,
  concrete: 0xb4b2ab,
  asphalt: 0x4a4e54,
  red: 0xd94a3a,
  darkRed: 0x9c2f2a,
  orange: 0xf08a2b,
  yellow: 0xf2c230,
  green: 0x4fa84a,
  darkGreen: 0x2f7a3a,
  leaf: 0x58b04c,
  leafDark: 0x3c8a3e,
  blue: 0x3b82d6,
  darkBlue: 0x2a4f8f,
  glass: 0x7fb6d9,
  glassDark: 0x3d6f94,
  wood: 0xa8743f,
  woodDark: 0x7a5230,
  sand: 0xe6d29a,
  stone: 0xaeb0ad,
  brick: 0xb4573c,
  roof: 0xa4452f,
  roofGrey: 0x5c646e,
  skin: 0xf0c49a,
  hair: 0x4b3425,
  rubber: 0x1f2124,
  chrome: 0xd7dadd,
  lamp: 0xfff2b0,
  water: 0x4aa3df,
} as const;
