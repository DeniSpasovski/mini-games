import {
  AdditiveBlending,
  Box3,
  Color,
  DataTexture,
  DoubleSide,
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
const BLUR_MAX = 6;
const BLUR_MIN = 3;
/** Lamp pieces closer than this (x / y, metres) belong to one lamp. */
const JOIN = 0.05;
/** The glow quad sits this far outside the lamp (behind a tail lamp, in front of a head lamp; metres). */
const SETBACK = 0.04;
/**
 * A lamp's own unlit parts (glow below `DARK_LIT`: a blinker, a reversing lens) keep this little of the red glow over them and
 * round their outer edge: the halo sits behind the whole lamp and would otherwise tint them red.
 */
const DARK_LIT = 0.05;
const DARK_CUT = 0.85;
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
  const read = lookup(m, map, 0);
  return read && ((u, v) => read(u, v) ** 2);
}

/** How opaque a lamp's own texture is at a texture coordinate (its map's alpha), or null without a readable map. */
function opacityOf(m: MeshStandardMaterial): Glow | null {
  return lookup(m, m.map, 3);
}

/** A canvas texture of `m` read at a texture coordinate: the brightest colour channel (`channel` 0) or alpha (3), 0..1. */
function lookup(
  m: MeshStandardMaterial,
  map: MeshStandardMaterial['map'] | undefined,
  channel: 0 | 3,
): Glow | null {
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
    return channel
      ? px[i + 3] / 255
      : Math.max(px[i], px[i + 1], px[i + 2]) / 255;
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
/** A dark lamp part at least this opaque (its texture's alpha) hides a lit part behind it: no glow comes through (Lancer: the amber blinker). */
const OPAQUE = 0.8;
/** A lit surface this much (m) behind an opaque dark part counts as hidden by it. */
const HIDDEN = 0.003;

/**
 * One lamp: its body-space box and its lit triangles, 12 numbers a triangle (x, y, u, v for each corner), `glows` = the glow map
 * of each, `brakeOnly` = it lights only with the brake pedal (a third brake light).
 */
interface Piece {
  box: Box3;
  tris: number[];
  /** The corners' depth (body z), 3 a triangle. */
  zs: number[];
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
function pieces(
  mesh: Mesh,
  toBody: Matrix4,
  reverse: boolean,
  cover: number[],
): Piece[] {
  const uv = mesh.geometry.getAttribute('uv');
  const { xyz, find, corner, count } = weld(mesh, toBody);
  const v = new Vector3();
  const glow = glowOf(mesh.material as MeshStandardMaterial, reverse);
  const opacity = opacityOf(mesh.material as MeshStandardMaterial);
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
      if (!(reverse ? FINE : COARSE).some(([a, b, c]) => at(a, b, c))) {
        // A dark, opaque part (an amber blinker): it hides the red lit parts behind it from the halo (`cover`, x y z a corner).
        // Not for the reversing glow: the red lens round a reversing light would cut its white glow.
        const solid = (a: number, b: number, c: number): boolean =>
          opacity!(
            (u[0] * a + u[1] * b + u[2] * c) / (a + b + c),
            (w[0] * a + w[1] * b + w[2] * c) / (a + b + c),
          ) >= OPAQUE;
        if (!reverse && opacity && COARSE.every(([a, b, c]) => solid(a, b, c)))
          for (const i of ids)
            cover.push(xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2]);
        continue;
      }
    }
    const r = find(ids[0]);
    let piece = out.get(r);
    if (!piece) {
      piece = {
        box: new Box3(),
        tris: [],
        zs: [],
        glows: [],
        brakeOnly: !!(mesh.material as Material).userData.brakeLamp?.brakeOnly,
      };
      out.set(r, piece);
    }
    for (let c = 0; c < 3; c++) {
      const i = ids[c] * 3;
      piece.box.expandByPoint(v.set(xyz[i], xyz[i + 1], xyz[i + 2]));
      piece.tris.push(xyz[i], xyz[i + 1], u[c], w[c]);
      piece.zs.push(xyz[i + 2]);
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
    zs: [...p.zs],
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
          list[i].zs.push(...list[j].zs);
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
 * The pixels of triangle `k` of `tris` (`stride` numbers a corner, x y first, body space) in the `w` x `h` window at (`x0`, `y0`):
 * `fn(pixel index, barycentric weights)`. Edge-on triangles (a lamp side wall seen from behind) cover no pixel of their own.
 */
function raster(
  tris: number[],
  k: number,
  stride: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  fn: (i: number, l1: number, l2: number, l3: number) => void,
): void {
  const ax = (tris[k] - x0) / TEXEL;
  const ay = (tris[k + 1] - y0) / TEXEL;
  const bx = (tris[k + stride] - x0) / TEXEL;
  const by = (tris[k + stride + 1] - y0) / TEXEL;
  const cx = (tris[k + 2 * stride] - x0) / TEXEL;
  const cy = (tris[k + 2 * stride + 1] - y0) / TEXEL;
  const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(det) < 1e-6) return;
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
      if (l1 >= 0 && l2 >= 0 && l3 >= 0) fn(y * w + x, l1, l2, l3);
    }
}

/**
 * The lamp's silhouette from behind in the `w` x `h` pixel window at (`x0`, `y0`), blurred by `radius` pixels, as a texture
 * that peaks at 1 (a faint lamp is boosted).
 */
function maskTexture(
  lamp: Piece,
  cover: number[],
  x0: number,
  y0: number,
  w: number,
  h: number,
  radius: number,
): DataTexture {
  const mask = new Float32Array(w * h);
  // Lamp pixels that do not glow (an amber blinker, a clear reversing lens, a dark segment): the glow is cut there.
  const dark = new Uint8Array(w * h);
  // The nearest dark opaque part seen from behind (lowest z) at each pixel: a lit part behind it is hidden.
  const front = new Float32Array(w * h).fill(Infinity);
  for (let k = 0; k < cover.length; k += 9)
    raster(cover, k, 3, x0, y0, w, h, (i, l1, l2, l3) => {
      const z = l1 * cover[k + 2] + l2 * cover[k + 5] + l3 * cover[k + 8];
      if (z < front[i]) front[i] = z;
      dark[i] = 1;
    });
  const t = lamp.tris;
  const zs = lamp.zs;
  for (let k = 0, tri = 0; k < t.length; k += 12, tri++) {
    const glow = lamp.glows[tri];
    raster(t, k, 4, x0, y0, w, h, (i, l1, l2, l3) => {
      // Behind a dark opaque part: hidden, adds no glow.
      const z = l1 * zs[tri * 3] + l2 * zs[tri * 3 + 1] + l3 * zs[tri * 3 + 2];
      if (z > front[i] + HIDDEN) return;
      // The lamp's own glow at this spot (its texture coordinate), so a clear lens or a dark segment adds nothing.
      const lit = glow
        ? glow(
            l1 * t[k + 2] + l2 * t[k + 6] + l3 * t[k + 10],
            l1 * t[k + 3] + l2 * t[k + 7] + l3 * t[k + 11],
          )
        : 1;
      if (lit > mask[i]) mask[i] = lit;
      // A lit piece in front of or behind an unlit one wins.
      if (lit >= DARK_LIT) dark[i] = 2;
      else if (!dark[i]) dark[i] = 1;
    });
  }
  // The unlit parts, blurred like the glow: the glow is cut over them and round their outer edge (else a red fringe hugs a blinker).
  const shade = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) shade[i] = dark[i] === 1 ? 1 : 0;
  for (let pass = 0; pass < 3; pass++) {
    blur(mask, w, h, false, radius);
    blur(mask, w, h, true, radius);
    blur(shade, w, h, false, radius);
    blur(shade, w, h, true, radius);
  }
  let peak = 0;
  for (const v of mask) peak = Math.max(peak, v);
  const scale = peak > 0 ? Math.min(MAX_BOOST, peak ** -0.6) : 0;
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    // Blurred, not per pixel: a photo sheet's dark specks would cut blocky holes in the glow.
    const cut = dark[i] === 2 ? 1 : 1 - DARK_CUT * Math.min(1, 2 * shade[i]);
    const v = Math.min(255, Math.round(mask[i] * scale * cut * 255));
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const tex = new DataTexture(data, w, h, RGBAFormat);
  tex.minFilter = tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** A head lamp glare's size (m, across): the smallest lamp and the biggest. */
const GLARE_MIN = 0.1;
const GLARE_MAX = 0.45;
/** A bulb's own glare (`bulbGlares`), m across. */
const GLARE_BULB = 0.24;

/**
 * Camera-facing glare (`LampHalos.addGlare`): the quad turns to the camera round its centre and steps 1/2 its size towards it
 * (so the lamp's own lens and bezel do not cut it), and its level follows how straight the camera looks into the lamp (body
 * +z): full ahead, half at ~45 degrees, gone side-on.
 */
function glareMaterial(colour: Vector3): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uLevel: { value: 0 }, uColour: { value: colour } },
    transparent: true,
    depthWrite: false,
    fog: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vFacing;
      void main() {
        vUv = uv;
        vec4 centre = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
        vec3 axis = normalize( ( modelViewMatrix * vec4( 0.0, 0.0, 1.0, 0.0 ) ).xyz );
        vec3 toCam = normalize( -centre.xyz );
        vFacing = max( dot( axis, toCam ), 0.0 );
        float size = length( ( modelViewMatrix * vec4( 1.0, 0.0, 0.0, 0.0 ) ).xyz );
        centre.xyz += toCam * size * 0.5;
        centre.xy += position.xy * size;
        gl_Position = projectionMatrix * centre;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uLevel;
      uniform vec3 uColour;
      varying vec2 vUv;
      varying float vFacing;
      void main() {
        float r = length( vUv - 0.5 ) * 2.0;
        // A small hot core and a faint wide skirt (a corona, not a lit disc), gone at the quad's edge.
        float a = ( 0.8 * exp( -r * r * 40.0 ) + 0.2 * exp( -r * r * 7.0 ) ) * ( 1.0 - smoothstep( 0.7, 1.0, r ) );
        float facing = smoothstep( 0.15, 1.0, vFacing );
        gl_FragColor = vec4( uColour * ( uLevel * a * facing * facing ), 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** A tail lamp's camera-facing glow (`corona`), m across: the smallest lamp and the biggest. */
const CORONA_MIN = 0.15;
const CORONA_MAX = 0.45;
/** Its strength against the flat halo's level (`setLevel`): the halo spreads its light over a much larger area. */
const CORONA_GAIN = 1.6;

/**
 * Camera-facing glow of a tail / reversing lamp (`LampHalos` corona): a soft round glow on the lamp that turns to the
 * camera, so the lamp glows from any side (the flat halo fades out side-on). It steps 1/4 of its size towards the
 * camera off the lamp's middle, so the depth test against the body cuts it where the body is in front. Strength by how
 * the lamp faces the camera (`axis` = the lamp's outward direction, body -z for a tail lamp): full from the side, a
 * little face-on (the flat halo carries the lamp there), none from the front of the car. A side lamp (`side` = body +-x,
 * 0 for a centred one) seen from the car's other side at a shallow angle is behind the body: its glow, which would show
 * past the body's outline as a ball in the air, fades out.
 */
function coronaMaterial(colour: Vector3, side: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uLevel: { value: 0 },
      uColour: { value: colour },
      uSide: { value: new Vector3(side, 0, 0) },
    },
    defines: { CORONA_GAIN: CORONA_GAIN.toFixed(1) },
    transparent: true,
    depthWrite: false,
    fog: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform vec3 uSide;
      varying vec2 vUv;
      varying float vSide;
      void main() {
        vUv = uv;
        vec4 centre = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
        vec3 axis = normalize( ( modelViewMatrix * vec4( 0.0, 0.0, -1.0, 0.0 ) ).xyz );
        vec3 toCam = normalize( -centre.xyz );
        float d = dot( axis, toCam );
        vSide = smoothstep( -0.3, 0.2, d ) * ( 1.0 - 0.75 * smoothstep( 0.35, 0.8, d ) );
        if ( uSide.x != 0.0 ) {
          float outward = dot( normalize( ( modelViewMatrix * vec4( uSide, 0.0 ) ).xyz ), toCam );
          vSide *= max( smoothstep( 0.35, 0.6, d ), smoothstep( -0.1, 0.2, outward ) );
        }
        float size = length( ( modelViewMatrix * vec4( 1.0, 0.0, 0.0, 0.0 ) ).xyz );
        centre.xyz += toCam * size * 0.25;
        centre.xy += position.xy * size;
        gl_Position = projectionMatrix * centre;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uLevel;
      uniform vec3 uColour;
      varying vec2 vUv;
      varying float vSide;
      void main() {
        float r = length( vUv - 0.5 ) * 2.0;
        // A soft glow over the whole lit lens (sized to it), not a bright dot at its middle.
        float a = ( 0.5 * exp( -r * r * 7.0 ) + 0.5 * exp( -r * r * 3.0 ) ) * ( 1.0 - smoothstep( 0.55, 1.0, r ) );
        gl_FragColor = vec4( uColour * ( CORONA_GAIN * uLevel * a * vSide ), 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

function haloMaterial(mask: DataTexture, colour: Vector3): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uMask: { value: mask },
      uLevel: { value: 0 },
      uSharp: { value: 1 },
      uColour: { value: colour },
    },
    transparent: true,
    depthWrite: false,
    fog: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    // A flat glow seen at an angle slides off the lamp (a bar or a blob on the body): it fades out as it turns away, the
    // lamp's camera-facing glow (`coronaMaterial`) takes over.
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vFacing;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4( position, 1.0 );
        vFacing = smoothstep( 0.5, 0.85, abs( dot( normalize( normalMatrix * vec3( 0.0, 0.0, 1.0 ) ), normalize( -mv.xyz ) ) ) );
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMask;
      uniform float uLevel;
      uniform float uSharp;
      uniform vec3 uColour;
      varying vec2 vUv;
      varying float vFacing;
      void main() {
        // uSharp > 1: a tight glow that dies away quickly (a lit lens through rain, not a lit fog bank); 1 = the soft night glow.
        float a = pow( texture2D( uMask, vUv ).r, uSharp ) * vFacing;
        gl_FragColor = vec4( uColour * ( uLevel * a ), 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/**
 * Soft glow round a car's red tail lamps: for each lamp (its pieces joined) one additive quad just behind it whose
 * shape is the lamp's own silhouette from behind, blurred (head lamps: a camera-facing glare, `addGlare`). Lit by `setLevel`.
 */
export class LampHalos {
  /** Children of the car body: the quads, in body space. */
  readonly group = new Group();
  private readonly materials: ShaderMaterial[] = [];
  /** The quads of the third brake lights: they glow only with the brake. */
  private readonly brakeOnly: ShaderMaterial[] = [];
  /** Each lamp's box (body space), brake-only ones (a centred third brake light) left out: `mount`. */
  private readonly boxes: Box3[] = [];
  /** Running pieces of a lamp that also has brake-only ones: their glow gives way to the whole lamp's with the brake. */
  private readonly runningOnly: ShaderMaterial[] = [];
  /** Head lamp glares (`front`). */
  private readonly glares: ShaderMaterial[] = [];
  /** Camera-facing glows of the lamps (`coronaMaterial`), in the same groups as the flat halos. */
  private readonly coronas = {
    materials: [] as ShaderMaterial[],
    brakeOnly: [] as ShaderMaterial[],
    runningOnly: [] as ShaderMaterial[],
  };
  /** The last `setSharp` value (-1 = not set yet). */
  private sharp = -1;

  /**
   * `meshes` = the red lamp meshes, `toBody` = world -> body matrix (the matrix worlds must be current). `reverse` = the glow
   * of the white reversing lens (its `reverseGlow` map) instead, in warm white. `front` = head lamps: a glare in front of each
   * lamp (`addGlare`), in `color` (sRGB hex, the beam's).
   */
  constructor(
    meshes: Mesh[],
    toBody: Matrix4,
    opts: {
      reverse?: boolean;
      front?: boolean;
      color?: number;
      bulbs?: [number, number, number][];
      /** Opaque amber lenses beside the red ones: the red glow is cut over them, like over a lamp's own dark part. */
      covers?: Mesh[];
    } = {},
  ) {
    const reverse = !!opts.reverse;
    const colour =
      opts.color !== undefined
        ? new Vector3(...new Color(opts.color).toArray())
        : reverse
          ? REVERSE_COLOUR
          : RED_COLOUR;
    // Dark opaque lamp parts (x y z a corner): they hide the lit parts behind them.
    const cover: number[] = [];
    for (const mesh of opts.covers ?? []) {
      const { xyz, corner, count } = weld(mesh, toBody);
      for (let t = 0; t < count; t++)
        for (let c = 0; c < 3; c++) {
          const i = corner(t, c);
          cover.push(xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2]);
        }
    }
    for (const lamp of lamps(
      meshes.flatMap((m) => pieces(m, toBody, reverse, cover)),
    )) {
      if (!lamp.brakeOnly) this.boxes.push(lamp.box);
      if (opts.front) {
        if (!opts.bulbs || !this.addBulbGlares(lamp, colour, opts.bulbs))
          this.addGlare(lamp, colour);
        continue;
      }
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
      const add = (
        piece: Piece,
        list: ShaderMaterial[],
        coronas: ShaderMaterial[],
      ): void => {
        this.addCorona(piece, colour, coronas);
        const material = haloMaterial(
          maskTexture(piece, cover, x0, y0, w, h, radius),
          colour,
        );
        const halo = new Mesh(quad, material);
        halo.scale.set(w * TEXEL, h * TEXEL, 1);
        halo.position.set(
          x0 + (w * TEXEL) / 2,
          y0 + (h * TEXEL) / 2,
          lamp.box.min.z - SETBACK,
        );
        halo.renderOrder = 5;
        halo.frustumCulled = false;
        list.push(material);
        this.group.add(halo);
      };
      const running = lamp.parts.filter((p) => !p.brakeOnly);
      if (lamp.brakeOnly) add(lamp, this.brakeOnly, this.coronas.brakeOnly);
      else if (running.length === lamp.parts.length)
        add(lamp, this.materials, this.coronas.materials);
      else {
        // A lamp with brake-only pieces (a boot-lid half): the running halo round its running pieces, fading out as the
        // whole lamp's halo lights with the brake (one glow, no brighter overlap).
        add(lamp, this.brakeOnly, this.coronas.brakeOnly);
        add(
          {
            box: lamp.box,
            tris: running.flatMap((p) => p.tris),
            zs: running.flatMap((p) => p.zs),
            glows: running.flatMap((p) => p.glows),
            brakeOnly: false,
          },
          this.runningOnly,
          this.coronas.runningOnly,
        );
      }
    }
  }

  /**
   * Where the lamps sit, through `bodyTo` (body -> the space wanted): x = half their spacing and y = their height (lamp
   * faces seen from the front, weighted by size), z = the foremost lamp face (+z; `rear`: the rearmost); null without lamps.
   */
  mount(
    bodyTo: Matrix4,
    rear = false,
  ): { x: number; y: number; z: number } | null {
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
      z = rear ? Math.max(z, -b.min.z) : Math.max(z, b.max.z);
    }
    if (!area) return null;
    if (rear) z = -z;
    const p = new Vector3(x / area, y / area, z).applyMatrix4(bodyTo);
    return { x: p.x, y: p.y, z: p.z };
  }

  /** Glow strength of the lamps (0 = off) and of the brake-only ones (a third brake light). */
  /**
   * A head lamp's glare: a soft round glow facing the camera, centred on the lamp's lit area and as big as it (not a flat
   * quad, which from an angle read as a lit sheet or a line). It shines when looking into the lamp and fades out by the time
   * the lamp is seen side-on, like a corona in a racing game; the lamp's own lit surface carries it from the side.
   */
  /** A glare on each listed bulb ([|x|, y, z], body space) inside the lamp; false when none is. */
  private addBulbGlares(
    lamp: Lamp,
    colour: Vector3,
    bulbs: [number, number, number][],
  ): boolean {
    const side = Math.sign(lamp.box.min.x + lamp.box.max.x) || 1;
    const box = lamp.box.clone().expandByScalar(0.03);
    const inside = bulbs
      .map(([x, y, z]) => new Vector3(side * x, y, z))
      .filter((p) => box.containsPoint(p));
    const placed: Vector3[] = [];
    for (const p of inside) {
      // Two listed pieces of one light (a projector's lens and bezel) share a glare.
      if (placed.some((q) => q.distanceTo(p) < GLARE_BULB / 4)) continue;
      placed.push(p);
      const material = glareMaterial(colour);
      const glare = new Mesh(quad, material);
      glare.scale.set(GLARE_BULB, GLARE_BULB, 1);
      // At the bulb itself (a lamp that wraps round the corner has bulbs well behind its front).
      glare.position.set(p.x, p.y, p.z + SETBACK);
      glare.renderOrder = 5;
      glare.frustumCulled = false;
      this.glares.push(material);
      this.group.add(glare);
    }
    return inside.length > 0;
  }

  private addGlare(lamp: Lamp, colour: Vector3): void {
    let area = 0;
    let x = 0;
    let y = 0;
    const t = lamp.tris;
    for (let k = 0, tri = 0; k < t.length; k += 12, tri++) {
      const a =
        Math.abs(
          (t[k + 4] - t[k]) * (t[k + 9] - t[k + 1]) -
            (t[k + 8] - t[k]) * (t[k + 5] - t[k + 1]),
        ) / 2;
      const glow = lamp.glows[tri];
      const lit =
        a *
        (glow
          ? glow(
              (t[k + 2] + t[k + 6] + t[k + 10]) / 3,
              (t[k + 3] + t[k + 7] + t[k + 11]) / 3,
            )
          : 1);
      area += lit;
      x += (lit * (t[k] + t[k + 4] + t[k + 8])) / 3;
      y += (lit * (t[k + 1] + t[k + 5] + t[k + 9])) / 3;
    }
    if (area <= 0) return;
    const size = lamp.box.getSize(new Vector3());
    const material = glareMaterial(colour);
    const glare = new Mesh(quad, material);
    // About twice the lamp's lit size across, so the glow spills a little past the lens.
    const r = Math.min(
      GLARE_MAX,
      Math.max(GLARE_MIN, 2 * Math.sqrt(area), Math.min(size.x, size.y)),
    );
    glare.scale.set(r, r, 1);
    glare.position.set(x / area, y / area, lamp.box.max.z + SETBACK);
    glare.renderOrder = 5;
    glare.frustumCulled = false;
    this.glares.push(material);
    this.group.add(glare);
  }

  /** The camera-facing glow of a lamp piece: on its lit area's middle (lit-weighted, body space), as big as the lit part. */
  private addCorona(
    piece: Piece,
    colour: Vector3,
    list: ShaderMaterial[],
  ): void {
    let area = 0;
    const c = new Vector3();
    const litBox = new Box3();
    const p = new Vector3();
    const t = piece.tris;
    const zs = piece.zs;
    for (let k = 0, tri = 0; k < t.length; k += 12, tri++) {
      const a =
        Math.abs(
          (t[k + 4] - t[k]) * (t[k + 9] - t[k + 1]) -
            (t[k + 8] - t[k]) * (t[k + 5] - t[k + 1]),
        ) / 2;
      const glow = piece.glows[tri];
      const lit =
        a *
        (glow
          ? glow(
              (t[k + 2] + t[k + 6] + t[k + 10]) / 3,
              (t[k + 3] + t[k + 7] + t[k + 11]) / 3,
            )
          : 1);
      area += lit;
      if (lit > 0)
        for (let j = 0; j < 12; j += 4)
          litBox.expandByPoint(
            p.set(t[k + j], t[k + j + 1], zs[tri * 3 + j / 4]),
          );
      c.x += (lit * (t[k] + t[k + 4] + t[k + 8])) / 3;
      c.y += (lit * (t[k + 1] + t[k + 5] + t[k + 9])) / 3;
      c.z += (lit * (zs[tri * 3] + zs[tri * 3 + 1] + zs[tri * 3 + 2])) / 3;
    }
    if (area <= 0) return;
    const lit = litBox.getSize(new Vector3());
    const r = Math.min(
      CORONA_MAX,
      Math.max(CORONA_MIN, 1.2 * Math.max(lit.x, lit.y, lit.z)),
    );
    c.divideScalar(area);
    // A lamp off the centre line sits on one side of the car (a third brake light on neither).
    const material = coronaMaterial(
      colour,
      Math.abs(c.x) > 0.25 ? Math.sign(c.x) : 0,
    );
    const corona = new Mesh(quad, material);
    corona.scale.set(r, r, 1);
    corona.position.copy(c);
    corona.renderOrder = 5;
    corona.frustumCulled = false;
    list.push(material);
    this.group.add(corona);
  }

  /** How tight the glow is: 1 = soft (night), 2 = tight (a lit lens through rain / fog by day). */
  setSharp(sharp: number): void {
    if (sharp === this.sharp) return;
    this.sharp = sharp;
    for (const list of [this.materials, this.brakeOnly, this.runningOnly])
      for (const m of list) m.uniforms.uSharp.value = sharp;
  }

  setLevel(level: number, brakeOnly: number): void {
    for (const m of this.glares) m.uniforms.uLevel.value = level;
    for (const m of this.materials) m.uniforms.uLevel.value = level;
    for (const m of this.brakeOnly) m.uniforms.uLevel.value = brakeOnly;
    for (const m of this.runningOnly)
      m.uniforms.uLevel.value = Math.max(0, level - brakeOnly);
    for (const m of this.coronas.materials) m.uniforms.uLevel.value = level;
    for (const m of this.coronas.brakeOnly) m.uniforms.uLevel.value = brakeOnly;
    for (const m of this.coronas.runningOnly)
      m.uniforms.uLevel.value = Math.max(0, level - brakeOnly);
    this.group.visible = Math.max(level, brakeOnly) > 0.003;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const m of this.glares) m.dispose();
    for (const list of Object.values(this.coronas))
      for (const m of list) m.dispose();
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
