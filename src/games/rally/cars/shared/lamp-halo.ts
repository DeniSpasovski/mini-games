import {
  AdditiveBlending,
  Box3,
  Color,
  DataTexture,
  DoubleSide,
  FrontSide,
  Group,
  LinearFilter,
  Matrix4,
  Mesh,
  type Material,
  type MeshStandardMaterial,
  PlaneGeometry,
  RGBAFormat,
  ShaderMaterial,
  Vector3,
} from 'three';
import { weld } from './lamp-islands';

/** Metres per mask pixel. */
const TEXEL = 0.012;
/** Blur radius (pixels, three box passes ~ a gaussian) of the biggest lamps and the smallest; thin lamps get a tighter glow. */
const BLUR_MAX = 7;
const BLUR_MIN = 3;
/** Lamp pieces closer than this (x / y, metres) belong to one lamp. */
const JOIN = 0.05;
/** The glow quad sits this far outside the lamp (behind a tail lamp, in front of a head lamp; metres). */
const SETBACK = 0.04;
/** A faint lamp (a thin LED strip) is boosted towards the same peak (`peak ** -0.6`), up to this factor. */
const MAX_BOOST = 4;

const quad = new PlaneGeometry(1, 1);
const RED_COLOUR = new Vector3(1, 0.03, 0.02);
const REVERSE_COLOUR = new Vector3(1, 0.9, 0.75);

/** How lit a lamp's surface is at a texture coordinate (0..1): its glow map. */
type Glow = (u: number, v: number) => number;

/**
 * The glow map of a lamp material as a lookup (brightness squared, ~ linear), or null when the material glows all over
 * (no map, or one we cannot read).
 */
function glowOf(m: MeshStandardMaterial, reverse: boolean): Glow | null {
  const map = reverse
    ? m.userData.brakeLamp?.reverseGlow
    : (m.userData.brakeGlow ?? m.emissiveMap);
  const img = map?.image as HTMLCanvasElement | undefined;
  if (!map || !img || typeof img.getContext !== 'function') return null;
  const { width, height } = img;
  const srcUv = !!m.userData.srcUv;
  const px = img.getContext('2d')!.getImageData(0, 0, width, height).data;
  return (u, v) => {
    u = u * map.repeat.x + map.offset.x;
    v = v * map.repeat.y + map.offset.y;
    const x = Math.min(width - 1, Math.floor((u - Math.floor(u)) * width));
    // A lamp sheet keeps the glTF convention (v down, `flipY` off): v indexes the rows as it is.
    const row = srcUv ? v - Math.floor(v) : 1 - (v - Math.floor(v));
    const y = Math.min(height - 1, Math.floor(row * height));
    const i = (y * width + x) * 4;
    const b = Math.max(px[i], px[i + 1], px[i + 2]) / 255;
    return b * b;
  };
}

/** Barycentric sample points of a triangle for the lit test: a grid for the reversing lens, which is small. */
const FINE: [number, number, number][] = [];
for (let i = 0; i <= 8; i++)
  for (let j = 0; i + j <= 8; j++) FINE.push([i, j, 8 - i - j]);
/** Corners, middle and edge middles: enough for the red lamps, whose lit areas are large. */
const COARSE: [number, number, number][] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 1, 1],
  [1, 1, 0],
  [0, 1, 1],
  [1, 0, 1],
];

/** Below this glow a point counts as dark. */
const LIT = 0.02;

/**
 * One lamp: its body-space box and its lit triangles, 12 numbers a triangle (x, y, u, v for each corner), `glows` = the glow map
 * of each, `brakeOnly` = it lights only with the brake pedal (a third brake light).
 */
interface Piece {
  box: Box3;
  tris: number[];
  glows: (Glow | null)[];
  brakeOnly: boolean;
}

/** Joined pieces of one lamp; `brakeOnly` = all of them are. */
interface Lamp extends Piece {
  parts: Piece[];
}

/**
 * Pieces of `mesh` (triangles that share vertices) in body space: a lamp material's mesh holds both tail lamps and the
 * third brake light, so the mesh's own box would span the whole car width. Only triangles that glow somewhere count
 * (a lamp sheet's clear lens, a hidden bulb or a plate light do not).
 */
function pieces(mesh: Mesh, toBody: Matrix4, reverse: boolean): Piece[] {
  const uv = mesh.geometry.getAttribute('uv');
  const { xyz, find, corner, count } = weld(mesh, toBody);
  const v = new Vector3();
  const glow = glowOf(mesh.material as MeshStandardMaterial, reverse);
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
      if (!(reverse ? FINE : COARSE).some(([a, b, c]) => at(a, b, c))) continue;
    }
    const r = find(ids[0]);
    let piece = out.get(r);
    if (!piece) {
      piece = {
        box: new Box3(),
        tris: [],
        glows: [],
        brakeOnly: !!(mesh.material as Material).userData.brakeLamp?.brakeOnly,
      };
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

/** Pieces that overlap or sit within `JOIN` of each other (x / y) merged, until no two do (`parts` = the pieces merged). */
function lamps(all: Piece[]): Lamp[] {
  const list: Lamp[] = all.map((p) => ({
    ...p,
    box: p.box.clone(),
    tris: [...p.tris],
    glows: [...p.glows],
    parts: [p],
  }));
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
          list[i].brakeOnly &&= list[j].brakeOnly;
          list[i].parts.push(...list[j].parts);
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

function haloMaterial(
  mask: DataTexture,
  colour: Vector3,
  front: boolean,
): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uMask: { value: mask },
      uLevel: { value: 0 },
      uColour: { value: colour },
    },
    // Head lamps: the glow gathers round the lit parts (mask squared) and fades out before the quad's edges, so a wide
    // white lamp gives a soft glow instead of a lit box.
    defines: front ? { HEAD: '' } : {},
    transparent: true,
    depthWrite: false,
    fog: false,
    // A head lamp's glow faces forwards only: from behind it would shine through the car's windows.
    side: front ? FrontSide : DoubleSide,
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
      uniform vec3 uColour;
      varying vec2 vUv;
      void main() {
        float a = texture2D( uMask, vUv ).r;
        #ifdef HEAD
          vec2 e = min( vUv, 1.0 - vUv );
          a *= a * smoothstep( 0.0, 0.2, e.x ) * smoothstep( 0.0, 0.2, e.y );
        #endif
        gl_FragColor = vec4( uColour * ( uLevel * a ), 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/**
 * Soft glow round a car's red tail lamps: for each lamp (its pieces joined) one additive quad just behind it whose
 * shape is the lamp's own silhouette from behind, blurred (head lamps: just in front, see the constructor). Lit by `setLevel`.
 */
export class LampHalos {
  /** Children of the car body: the quads, in body space. */
  readonly group = new Group();
  private readonly materials: ShaderMaterial[] = [];
  /** The quads of the third brake lights: they glow only with the brake. */
  private readonly brakeOnly: ShaderMaterial[] = [];
  /** Each lamp's box (body space). */
  private readonly boxes: Box3[] = [];
  /** Running pieces of a lamp that also has brake-only ones: their glow gives way to the whole lamp's with the brake. */
  private readonly runningOnly: ShaderMaterial[] = [];

  /**
   * `meshes` = the red lamp meshes, `toBody` = world -> body matrix (the matrix worlds must be current). `reverse` = the glow
   * of the white reversing lens (its `reverseGlow` map) instead, in warm white. `front` = head lamps: the quad sits just in
   * front of each lamp, in `color` (sRGB hex, the beam's).
   */
  constructor(
    meshes: Mesh[],
    toBody: Matrix4,
    opts: { reverse?: boolean; front?: boolean; color?: number } = {},
  ) {
    const reverse = !!opts.reverse;
    const colour =
      opts.color !== undefined
        ? new Vector3(...new Color(opts.color).toArray())
        : reverse
          ? REVERSE_COLOUR
          : RED_COLOUR;
    for (const lamp of lamps(
      meshes.flatMap((m) => pieces(m, toBody, reverse)),
    )) {
      this.boxes.push(lamp.box);
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
      const add = (piece: Piece, list: ShaderMaterial[]): void => {
        const material = haloMaterial(
          maskTexture(piece, x0, y0, w, h, radius),
          colour,
          !!opts.front,
        );
        const halo = new Mesh(quad, material);
        halo.scale.set(w * TEXEL, h * TEXEL, 1);
        halo.position.set(
          x0 + (w * TEXEL) / 2,
          y0 + (h * TEXEL) / 2,
          opts.front ? lamp.box.max.z + SETBACK : lamp.box.min.z - SETBACK,
        );
        halo.renderOrder = 5;
        halo.frustumCulled = false;
        list.push(material);
        this.group.add(halo);
      };
      const running = lamp.parts.filter((p) => !p.brakeOnly);
      if (lamp.brakeOnly) add(lamp, this.brakeOnly);
      else if (running.length === lamp.parts.length) add(lamp, this.materials);
      else {
        // A lamp with brake-only pieces (a boot-lid half): the running halo round its running pieces, fading out as the
        // whole lamp's halo lights with the brake (one glow, no brighter overlap).
        add(lamp, this.brakeOnly);
        add(
          {
            box: lamp.box,
            tris: running.flatMap((p) => p.tris),
            glows: running.flatMap((p) => p.glows),
            brakeOnly: false,
          },
          this.runningOnly,
        );
      }
    }
  }

  /**
   * Where the lamps sit, through `bodyTo` (body -> the space wanted): x = half their spacing and y = their height (lamp
   * faces seen from the front, weighted by size), z = the foremost lamp face (+z); null without lamps.
   */
  mount(bodyTo: Matrix4): { x: number; y: number; z: number } | null {
    let area = 0;
    let x = 0;
    let y = 0;
    let z = -Infinity;
    const c = new Vector3();
    const size = new Vector3();
    for (const b of this.boxes) {
      b.getCenter(c);
      b.getSize(size);
      const a = Math.max(1e-4, size.x * size.y);
      area += a;
      x += Math.abs(c.x) * a;
      y += c.y * a;
      z = Math.max(z, b.max.z);
    }
    if (!area) return null;
    const p = new Vector3(x / area, y / area, z).applyMatrix4(bodyTo);
    return { x: p.x, y: p.y, z: p.z };
  }

  /** Glow strength of the lamps (0 = off) and of the brake-only ones (a third brake light). */
  setLevel(level: number, brakeOnly: number): void {
    for (const m of this.materials) m.uniforms.uLevel.value = level;
    for (const m of this.brakeOnly) m.uniforms.uLevel.value = brakeOnly;
    for (const m of this.runningOnly)
      m.uniforms.uLevel.value = Math.max(0, level - brakeOnly);
    this.group.visible = Math.max(level, brakeOnly) > 0.003;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const m of [
      ...this.materials,
      ...this.brakeOnly,
      ...this.runningOnly,
    ]) {
      (m.uniforms.uMask.value as DataTexture).dispose();
      m.dispose();
    }
  }
}
