import {
  AdditiveBlending,
  Box3,
  DataTexture,
  DoubleSide,
  Group,
  LinearFilter,
  Matrix4,
  Mesh,
  type MeshStandardMaterial,
  PlaneGeometry,
  RGBAFormat,
  ShaderMaterial,
  Vector3,
} from 'three';

/** Metres per mask pixel. */
const TEXEL = 0.012;
/** Blur radius (pixels, three box passes ~ a gaussian) of the biggest lamps and the smallest; thin lamps get a tighter glow. */
const BLUR_MAX = 7;
const BLUR_MIN = 3;
/** Lamp pieces closer than this (x / y, metres) belong to one lamp. */
const JOIN = 0.05;
/** The glow quad sits this far behind the lamp (metres). */
const SETBACK = 0.04;
/** A faint lamp (a thin LED strip) is boosted towards the same peak (`peak ** -0.6`), up to this factor. */
const MAX_BOOST = 4;

const quad = new PlaneGeometry(1, 1);

/** How lit a lamp's surface is at a texture coordinate (0..1): its glow map. */
type Glow = (u: number, v: number) => number;

/**
 * The glow map of a lamp material as a lookup (brightness squared, ~ linear), or null when the material glows all over
 * (no map, or one we cannot read).
 */
function glowOf(m: MeshStandardMaterial): Glow | null {
  const map = m.userData.brakeGlow ?? m.emissiveMap;
  const img = map?.image as HTMLCanvasElement | undefined;
  if (!map || !img || typeof img.getContext !== 'function') return null;
  const { width, height } = img;
  const px = img.getContext('2d')!.getImageData(0, 0, width, height).data;
  return (u, v) => {
    u = u * map.repeat.x + map.offset.x;
    v = v * map.repeat.y + map.offset.y;
    const x = Math.min(width - 1, Math.floor((u - Math.floor(u)) * width));
    const y = Math.min(
      height - 1,
      Math.floor((1 - (v - Math.floor(v))) * height),
    );
    const i = (y * width + x) * 4;
    const b = Math.max(px[i], px[i + 1], px[i + 2]) / 255;
    return b * b;
  };
}

/** Below this glow a point counts as dark. */
const LIT = 0.02;

/** One lamp: its body-space box and its lit triangles, 12 numbers a triangle (x, y, u, v for each corner), `glows` = the glow map of each. */
interface Piece {
  box: Box3;
  tris: number[];
  glows: (Glow | null)[];
}

/**
 * Pieces of `mesh` (triangles that share vertices) in body space: a lamp material's mesh holds both tail lamps and the
 * third brake light, so the mesh's own box would span the whole car width. Only triangles that glow somewhere count
 * (a lamp sheet's clear lens, a hidden bulb or a plate light do not).
 */
function pieces(mesh: Mesh, toBody: Matrix4): Piece[] {
  const geo = mesh.geometry;
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  const index = geo.index;
  const n = pos.count;
  const m = toBody.clone().multiply(mesh.matrixWorld);
  const v = new Vector3();
  const xyz = new Float32Array(n * 3);
  // Weld vertices at the same spot (a mesh may repeat them for its UV seams), then union each triangle's corners.
  const first = new Map<string, number>();
  const root = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i)
      .applyMatrix4(m)
      .toArray(xyz, i * 3);
    const k = `${Math.round(xyz[i * 3] * 1e4)},${Math.round(xyz[i * 3 + 1] * 1e4)},${Math.round(xyz[i * 3 + 2] * 1e4)}`;
    let r = first.get(k);
    if (r === undefined) first.set(k, (r = i));
    root[i] = r;
  }
  const find = (i: number): number => {
    while (root[i] !== i) i = root[i] = root[root[i]];
    return i;
  };
  const count = (index ? index.count : n) / 3;
  const corner = (t: number, c: number): number =>
    index ? index.getX(t * 3 + c) : t * 3 + c;
  for (let t = 0; t < count; t++) {
    const a = find(corner(t, 0));
    for (let c = 1; c < 3; c++) root[find(corner(t, c))] = a;
  }
  const glow = glowOf(mesh.material as MeshStandardMaterial);
  const out = new Map<number, Piece>();
  for (let t = 0; t < count; t++) {
    const ids = [corner(t, 0), corner(t, 1), corner(t, 2)];
    const u = ids.map((i) => (uv ? uv.getX(i) : 0));
    const w = ids.map((i) => (uv ? uv.getY(i) : 0));
    // Lit anywhere on the triangle? Corners, middle and edge middles.
    if (glow && uv) {
      const at = (a: number, b: number, c: number): boolean =>
        glow(
          (u[0] * a + u[1] * b + u[2] * c) / (a + b + c),
          (w[0] * a + w[1] * b + w[2] * c) / (a + b + c),
        ) > LIT;
      if (
        ![
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
          [1, 1, 1],
          [1, 1, 0],
          [0, 1, 1],
          [1, 0, 1],
        ].some(([a, b, c]) => at(a, b, c))
      )
        continue;
    }
    const r = find(ids[0]);
    let piece = out.get(r);
    if (!piece) {
      piece = { box: new Box3(), tris: [], glows: [] };
      out.set(r, piece);
    }
    for (let c = 0; c < 3; c++) {
      const i = ids[c] * 3;
      piece.box.expandByPoint(v.set(xyz[i], xyz[i + 1], xyz[i + 2]));
      piece.tris.push(xyz[i], xyz[i + 1], u[c], w[c]);
    }
    piece.glows.push(glow);
  }
  return [...out.values()];
}

/** Pieces that overlap or sit within `JOIN` of each other (x / y) merged, until no two do. */
function lamps(all: Piece[]): Piece[] {
  const list = [...all];
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < list.length && !again; i++)
      for (let j = i + 1; j < list.length && !again; j++) {
        const a = list[i].box;
        const b = list[j].box;
        if (
          a.min.x - JOIN <= b.max.x &&
          a.max.x + JOIN >= b.min.x &&
          a.min.y - JOIN <= b.max.y &&
          a.max.y + JOIN >= b.min.y
        ) {
          a.union(b);
          list[i].tris.push(...list[j].tris);
          list[i].glows.push(...list[j].glows);
          list.splice(j, 1);
          again = true;
        }
      }
  }
  return list;
}

/** One box-blur pass (`radius` pixels) along the rows or (`vertical`) the columns of the `w` x `h` mask, zero outside. */
function blur(
  src: Float32Array,
  w: number,
  h: number,
  vertical: boolean,
  radius: number,
): void {
  const len = vertical ? h : w;
  const lines = vertical ? w : h;
  const stride = vertical ? w : 1;
  const line = new Float32Array(len);
  const norm = 1 / (2 * radius + 1);
  for (let l = 0; l < lines; l++) {
    const base = vertical ? l : l * w;
    let sum = 0;
    for (let i = 0; i < radius; i++)
      sum += i < len ? src[base + i * stride] : 0;
    for (let i = 0; i < len; i++) {
      const add = i + radius;
      const drop = i - radius - 1;
      if (add < len) sum += src[base + add * stride];
      if (drop >= 0) sum -= src[base + drop * stride];
      line[i] = sum * norm;
    }
    for (let i = 0; i < len; i++) src[base + i * stride] = line[i];
  }
}

/**
 * The lamp's silhouette from behind in the `w` x `h` pixel window at (`x0`, `y0`), blurred by `radius` pixels, as a texture
 * that peaks at 1 (a faint lamp is boosted).
 */
function maskTexture(
  lamp: Piece,
  x0: number,
  y0: number,
  w: number,
  h: number,
  radius: number,
): DataTexture {
  const mask = new Float32Array(w * h);
  const t = lamp.tris;
  for (let k = 0, tri = 0; k < t.length; k += 12, tri++) {
    const ax = (t[k] - x0) / TEXEL;
    const ay = (t[k + 1] - y0) / TEXEL;
    const bx = (t[k + 4] - x0) / TEXEL;
    const by = (t[k + 5] - y0) / TEXEL;
    const cx = (t[k + 8] - x0) / TEXEL;
    const cy = (t[k + 9] - y0) / TEXEL;
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    // Edge-on triangles (a lamp side wall seen from behind) cover no pixel of their own.
    if (Math.abs(det) < 1e-6) continue;
    const glow = lamp.glows[tri];
    const xa = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const xb = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
    const ya = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const yb = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = ya; y <= yb; y++)
      for (let x = xa; x <= xb; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det;
        const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < 0 || l2 < 0 || l3 < 0) continue;
        // The lamp's own glow at this spot (its texture coordinate), so a clear lens or a dark segment adds nothing.
        const lit = glow
          ? glow(
              l1 * t[k + 2] + l2 * t[k + 6] + l3 * t[k + 10],
              l1 * t[k + 3] + l2 * t[k + 7] + l3 * t[k + 11],
            )
          : 1;
        if (lit > mask[y * w + x]) mask[y * w + x] = lit;
      }
  }
  for (let pass = 0; pass < 3; pass++) {
    blur(mask, w, h, false, radius);
    blur(mask, w, h, true, radius);
  }
  let peak = 0;
  for (const v of mask) peak = Math.max(peak, v);
  const scale = peak > 0 ? Math.min(MAX_BOOST, peak ** -0.6) : 0;
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = Math.min(255, Math.round(mask[i] * scale * 255));
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const tex = new DataTexture(data, w, h, RGBAFormat);
  tex.minFilter = tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function haloMaterial(mask: DataTexture): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uMask: { value: mask }, uLevel: { value: 0 } },
    transparent: true,
    depthWrite: false,
    fog: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMask;
      uniform float uLevel;
      varying vec2 vUv;
      void main() {
        float a = texture2D( uMask, vUv ).r;
        gl_FragColor = vec4( vec3( 1.0, 0.03, 0.02 ) * ( uLevel * a ), 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/**
 * Soft red glow round a car's red tail lamps: for each lamp (its pieces joined) one additive quad just behind it whose
 * shape is the lamp's own silhouette from behind, blurred. Pure red, so night tone mapping keeps it red. Lit by `setLevel`.
 */
export class LampHalos {
  /** Children of the car body: the quads, in body space. */
  readonly group = new Group();
  private readonly materials: ShaderMaterial[] = [];

  /** `meshes` = the red lamp meshes, `toBody` = world -> body matrix (the matrix worlds must be current). */
  constructor(meshes: Mesh[], toBody: Matrix4) {
    for (const lamp of lamps(meshes.flatMap((m) => pieces(m, toBody)))) {
      const size = lamp.box.getSize(new Vector3());
      const radius = Math.max(
        BLUR_MIN,
        Math.min(BLUR_MAX, Math.round(Math.min(size.x, size.y) / TEXEL / 2)),
      );
      // The glow fades out about 4 radii from the lamp.
      const margin = Math.ceil(4.2 * radius) * TEXEL;
      const x0 = lamp.box.min.x - margin;
      const y0 = lamp.box.min.y - margin;
      const w = Math.ceil((size.x + 2 * margin) / TEXEL);
      const h = Math.ceil((size.y + 2 * margin) / TEXEL);
      const material = haloMaterial(maskTexture(lamp, x0, y0, w, h, radius));
      const halo = new Mesh(quad, material);
      halo.scale.set(w * TEXEL, h * TEXEL, 1);
      halo.position.set(
        x0 + (w * TEXEL) / 2,
        y0 + (h * TEXEL) / 2,
        lamp.box.min.z - SETBACK,
      );
      halo.renderOrder = 5;
      halo.frustumCulled = false;
      this.materials.push(material);
      this.group.add(halo);
    }
  }

  /** Glow strength: 0 = off. */
  setLevel(level: number): void {
    for (const m of this.materials) m.uniforms.uLevel.value = level;
    this.group.visible = level > 0.003;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const m of this.materials) {
      (m.uniforms.uMask.value as DataTexture).dispose();
      m.dispose();
    }
  }
}
