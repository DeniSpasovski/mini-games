import {
  CanvasTexture,
  DoubleSide,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type Material,
} from 'three';
import { addWorldUniforms } from '../../engine/world-shading';

/**
 * Materials for the named parts of an imported body (scripts/car-model/segment-stl.py
 * labels them, stl-to-glb.mjs writes one primitive per material name). Shared by every
 * car - never cloned per instance. Unknown names (the body: 'livery' / 'body') return
 * undefined and get the car's painted livery material instead ('recess': a darker copy,
 * CarModel.recessMaterial).
 *
 * UVs: plain parts are box-projected in metres (tiling textures: mesh, carbon); fitted
 * parts are 0..1 over the part, v from the top down, and their textures below are drawn in
 * that space - lamps ('headlight', 'tail'): u from the car's centre outwards round the
 * corner; 'ventglass' (rear side windows): u from the rear end forwards.
 */
export type PartName =
  | 'trim'
  | 'gloss'
  | 'mesh'
  | 'carbon'
  | 'wingblue'
  | 'winggreen'
  | 'glass'
  | 'ventglass'
  | 'headlight'
  | 'twinlamp'
  | 'mirror'
  | 'lens'
  | 'lenscover'
  | 'chrome'
  | 'headchrome'
  | 'satin'
  | 'steel'
  | 'amber'
  | 'tail'
  | 'tailc'
  | 'seal'
  | 'reflector'
  | 'tailweave'
  | 'amberweave'
  | 'lensweave'
  | 'clearweave'
  | 'lamphousing'
  | 'headled'
  | 'tailled'
  | 'brakestrip'
  | 'reverselamp'
  | 'lampclear'
  | 'lampred'
  | 'tailc4'
  | 'redcover'
  | 'brakecover'
  | 'brakered'
  | 'brakestripred'
  | 'flagblue'
  | 'flagwhite'
  | 'flagred'
  | 'interior'
  | 'cage'
  | 'coilover'
  | 'lampcup'
  | 'lampbulb';

const cache = new Map<string, Material>();

/**
 * Headlight (CarModel.setLamps): emissive from `off` (lights off: the bulbs dark, the reflector shows by its own map) to
 * `on` with the lights on (night). `CarModel` also builds a halo round it and aims the beam from it.
 */
function headLamp<M extends Material & { emissiveIntensity: number }>(
  m: M,
  on: number,
  off = HEAD_OFF,
): M {
  m.emissiveIntensity = off;
  m.userData.headLamp = { off, on };
  return m;
}

/** A headlamp's glow with the lights off: almost dark (a hint of the lens catching the light, not a lit bulb). */
const HEAD_OFF = 0.04;

/** A lamp's emissive intensities with the lights fully on (night): idle (running lamp) and the brake pedal down. */
export interface LampNight {
  idle: number;
  on: number;
}

/**
 * Brake lamp (CarModel.setBrake): emissive from its idle value to `on` with the brake down. `reverseGlow` = an
 * emissive map that lights only the white reversing section; CarModel swaps it in while the car is in reverse gear.
 * `night` = the emissive intensities with the lights fully on (default: the idle glow rises by `TAIL_NIGHT_GLOW`, the
 * brake stays `on`). Night tone mapping (AgX) washes a bright red out to salmon pink, so red lamps keep both low there.
 * `idleGlow` = the emissive map while the brake is up (the running lamp's part of the glow map: the rest lights with the brake).
 */
function lamp(
  m: MeshPhysicalMaterial,
  on: number,
  reverseGlow?: CanvasTexture,
  night?: LampNight,
  idleGlow?: CanvasTexture,
): MeshPhysicalMaterial {
  m.userData.brakeLamp = {
    off: m.emissiveIntensity,
    on,
    reverseGlow,
    night,
    idleGlow,
  };
  return m;
}

/**
 * Red lamp glow with the lights on: night tone mapping (AgX) turns a bright red salmon pink, so the running lamp is dim and
 * the brake stays near 0.45 (by day, ACES keeps a pure red up to ~1.2 before it goes orange).
 */
const RED_NIGHT: LampNight = { idle: 0.25, on: 0.5 };
const STRIP_NIGHT: LampNight = { idle: 0.15, on: 0.45 };
/** Lamps whose glow map lights the whole lens body dimly and the LED parts at full red: a stronger running light than `RED_NIGHT`. */
const LENS_NIGHT: LampNight = { idle: 0.35, on: 0.6 };
/** `LENS_NIGHT` for small lamps (C4, 206): a little brighter so they read from a distance. */
const SMALL_LAMP_NIGHT: LampNight = { idle: 0.45, on: 0.85 };

/** Red see-through lens cover (transparent over a modelled lamp) that glows `emissive` up to intensity `on` with the brake down. */
function brakeCover(
  emissive: number,
  opacity: number,
  on: number,
  night?: LampNight,
  idle = 0.2,
  color = 0xb81408,
): MeshPhysicalMaterial {
  return lamp(
    new MeshPhysicalMaterial({
      color,
      emissive,
      emissiveIntensity: idle,
      roughness: 0.03,
      metalness: 0,
      transparent: true,
      opacity,
      depthWrite: false,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      envMapIntensity: 1.5,
    }),
    on,
    undefined,
    night,
  );
}

/** Dark red bumper reflector strip that glows `emissive` up to intensity `on` with the brake down. */
function brakeStrip(
  emissive: number,
  on: number,
  night?: LampNight,
): MeshPhysicalMaterial {
  return lamp(
    new MeshPhysicalMaterial({
      color: 0xa80f08,
      emissive,
      emissiveIntensity: 0,
      roughness: 0.25,
      metalness: 0.3,
      clearcoat: 1,
    }),
    on,
    undefined,
    night,
  );
}

/** Modelled tail-lamp LED strip: red, idle glow `idle`, bright (`on`) with the brake pedal (setBrake). */
function tailLed(
  emissive: number,
  idle: number,
  on: number,
  night?: LampNight,
): MeshPhysicalMaterial {
  return lamp(
    new MeshPhysicalMaterial({
      color: 0xd41408,
      emissive,
      emissiveIntensity: idle,
      roughness: 0.2,
      metalness: 0.1,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
    }),
    on,
    undefined,
    night,
  );
}

export function partMaterial(name: string): Material | undefined {
  // `<part>:2s` = that part drawn double-sided (source models whose cockpit / trim shells are single-faced).
  const twoSided = name.endsWith(':2s');
  const base = twoSided ? name.slice(0, -3) : name;
  const one = base.startsWith('src:')
    ? () => srcPart(base)
    : BUILDERS[base as PartName];
  if (!one) return undefined;
  const build = twoSided
    ? () => {
        const m = one();
        m.side = DoubleSide;
        return m;
      }
    : one;
  let m = cache.get(name);
  if (!m) {
    m = build();
    m.name = name;
    cache.set(name, m);
  }
  return m;
}

function canvas(
  w: number,
  h: number,
  draw: (g: CanvasRenderingContext2D) => void,
  color = true,
): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new CanvasTexture(c);
  if (color) t.colorSpace = SRGBColorSpace;
  t.flipY = false; // glTF UV convention: v down
  t.anisotropy = 8;
  return t;
}

/** Sheet size of a source part's texture (maps are drawn at this size, whatever the file's). */
const SRC_SIZE = 512;

/**
 * Tail-lamp sheets whose pale red lens body is the running light (lit with the lights on, much brighter with the brake) while
 * the strong red bars light with the brake only (`lamp` `idleGlow`).
 */
const RUNNING_BODY = new Set(['subie_22b_lamps.png']);
const RUNNING_BODY_NIGHT: LampNight = { idle: 0.2, on: 0.6 };
/**
 * Tail-lamp sheets of a clear (silver, ribbed) lamp interior behind a red cover: the red light is that texture's own shading
 * painted in red, outside the reversing lens, and the lamp is dark while off.
 */
const CLEAR_INTERIOR = new Set(['subie_wrx_sti_lamps.png']);
/** Sheet row (of `SRC_SIZE`) where the tail lamp island starts: the plate lamps and reflectors above it stay dark. */
const CLEAR_FROM_ROW = 290;
/** Lamp sheets whose reversing lens also gets a white halo (`LampHalos` `reverse`). */
const REVERSE_HALO = new Set([
  'subie_wrx_sti_lamps.png',
  'subie_22b_lamps.png',
]);
/**
 * Head lamp sheet areas [u0, v0, u1, v1, glow colour] (v down, painted in order) drawn as flat swatches: a bulb / projector
 * lens lit full white, or housing / trim kept dark.
 */
const HEAD_SWATCHES: Record<
  string,
  [number, number, number, number, string][]
> = {
  // RS6: its three bulbs light (the two upper modules and the big lower module); the grey housing
  // and outline swatches (bottom left of the sheet) stay dark.
  'audi_rs6_lamps.png': [
    [0, 455 / 512, 36 / 512, 493 / 512, '#000'],
    [10 / 512, 282 / 512, 215 / 512, 412 / 512, '#fff'],
    [50 / 512, 420 / 512, 215 / 512, 505 / 512, '#fff'],
  ],
};
/** Sheets whose third brake light is a speckled texture (only some pixels strong red): it glows by the sheet's own red instead. */
const SOLID_CENTRE = new Set(['lancer_evo_6_lamps.png']);
/** A sheet pixel of a strong red (a bar or reflector), and of a pale red lens body (pink: green and blue about equal). */
const strongRed = (r: number, gr: number): boolean => r > 2 * gr + 40;
const paleRed = (r: number, gr: number, b: number): boolean =>
  r > gr + 30 && b > gr * 0.85;
const srcSheets = new Map<string, Promise<HTMLImageElement>>();

function sheetFor(file: string): Promise<HTMLImageElement> {
  let sheet = srcSheets.get(file);
  if (!sheet) {
    sheet = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = new URL(`models/cars/${file}`, location.href).href;
    });
    srcSheets.set(file, sheet);
  }
  return sheet;
}

/** Pixels of the sheet joined to `seed` (x, y) through non-black pixels: one lens, cut off from its neighbours by a dark outline. */
function lensRegion(
  px: Uint8ClampedArray,
  [sx, sy]: [number, number],
): Uint8Array {
  const inside = new Uint8Array(SRC_SIZE * SRC_SIZE);
  const todo = [sy * SRC_SIZE + sx];
  while (todo.length) {
    const i = todo.pop()!;
    const p = i * 4;
    if (inside[i] || px[p] + px[p + 1] + px[p + 2] < 77) continue;
    inside[i] = 1;
    const x = i % SRC_SIZE;
    if (x > 0) todo.push(i - 1);
    if (x < SRC_SIZE - 1) todo.push(i + 1);
    if (i >= SRC_SIZE) todo.push(i - SRC_SIZE);
    if (i < SRC_SIZE * (SRC_SIZE - 1)) todo.push(i + SRC_SIZE);
  }
  return inside;
}

/**
 * A part that keeps the source model's own texture and UVs (scripts/car-model/glb-src-parts.py): material name
 * `src:<kind>:<file in public/models/cars/>`. `int` = the sheet as it is (seat fabric, cockpit), matt, back faces dark; `shell` (no file) = dark plastic;
 * `lamp` = head lamp: the sheet, its bright neutral pixels glow with the lights on (`headLamp`); `tail` = brake lamp (setBrake): the red pixels glow, the bright neutral ones light in reverse
 * (`src:tail:<file>:<x>,<y>` = only the lens around that sheet pixel, when the clear ribbed trim behind the red cover must stay dark). The maps
 * stay dark until the sheet has loaded. Alpha comes from the sheet (clear lens areas show the reflector behind them).
 */
function srcPart(name: string): Material {
  const [, kind, file, seedText] = name.split(':');
  const seed = seedText?.split(',').map(Number) as [number, number] | undefined;
  // Closed back of an open source shell (glb-src-parts.py `shells`): dark plastic.
  if (kind === 'shell')
    return new MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.6 });
  const blank = (fill: string) =>
    tiling(
      canvas(SRC_SIZE, SRC_SIZE, (g) => {
        g.fillStyle = fill;
        g.fillRect(0, 0, SRC_SIZE, SRC_SIZE);
      }),
      1,
    );
  const map = blank('#1a1a1c');
  if (kind === 'int') {
    sheetFor(file)
      .then((img) => {
        const g = (map.image as HTMLCanvasElement).getContext('2d')!;
        g.drawImage(img, 0, 0, SRC_SIZE, SRC_SIZE);
        map.needsUpdate = true;
      })
      .catch(() => {});
    const mat = new MeshStandardMaterial({
      map,
      roughness: 0.9,
      side: DoubleSide,
    });
    // Source cockpits are single sheets seen from the front: their back faces (an open seat back seen from the rear seats)
    // draw as a dark plastic shell instead of the fabric's inside.
    mat.onBeforeCompile = (s) => {
      addWorldUniforms(s);
      s.fragmentShader = s.fragmentShader.replace(
        '#include <color_fragment>',
        '#include <color_fragment>\nif (!gl_FrontFacing) diffuseColor.rgb = vec3(0.03);',
      );
    };
    return mat;
  }
  const glow = blank('#000');
  const reverseGlow = kind === 'tail' ? blank('#000') : undefined;
  const running = kind === 'tail' && RUNNING_BODY.has(file);
  const idleGlow = running ? blank('#000') : undefined;
  const clear = kind === 'tail' && CLEAR_INTERIOR.has(file);
  const loaded = sheetFor(file)
    .then((img) => {
      const g = (map.image as HTMLCanvasElement).getContext('2d')!;
      g.clearRect(0, 0, SRC_SIZE, SRC_SIZE);
      g.drawImage(img, 0, 0, SRC_SIZE, SRC_SIZE);
      const px = g.getImageData(0, 0, SRC_SIZE, SRC_SIZE).data;
      // `red` = glow in pure red at the sheet's red level (a tail lamp's sheet colour is often orange or pink once it glows).
      const paint = (
        t: CanvasTexture,
        f: (r: number, gr: number, b: number, n: number) => number,
        red = false,
      ) => {
        const c = (t.image as HTMLCanvasElement).getContext('2d')!;
        const d = c.createImageData(SRC_SIZE, SRC_SIZE);
        for (let i = 0; i < px.length; i += 4) {
          const v = f(px[i], px[i + 1], px[i + 2], i >> 2) * (px[i + 3] / 255);
          d.data[i] = px[i] * v;
          d.data[i + 1] = (red ? px[i] * 0.03 : px[i + 1]) * v;
          d.data[i + 2] = (red ? px[i] * 0.015 : px[i + 2]) * v;
          d.data[i + 3] = 255;
        }
        c.putImageData(d, 0, 0);
        t.needsUpdate = true;
      };
      const lum = (r: number, gr: number, b: number) => (r + gr + b) / 765;
      const lens = kind === 'tail' && seed ? lensRegion(px, seed) : undefined;
      if (kind === 'tail') {
        paint(
          glow,
          (r, gr, b, n) =>
            strongRed(r, gr) || (running && paleRed(r, gr, b))
              ? 1
              : clear &&
                  n >> 9 > CLEAR_FROM_ROW &&
                  !lens?.[n] &&
                  Math.max(r, gr, b) - Math.min(r, gr, b) < 70
                ? lum(r, gr, b) ** 1.5
                : 0,
          true,
        );
        if (idleGlow)
          paint(
            idleGlow,
            (r, gr, b) => (!strongRed(r, gr) && paleRed(r, gr, b) ? 1 : 0),
            true,
          );
        paint(reverseGlow!, (r, gr, b, n) =>
          (!lens || lens[n]) &&
          Math.max(r, gr, b) - Math.min(r, gr, b) < 40 &&
          lum(r, gr, b) > 0.6
            ? 1
            : 0,
        );
      }
      // Head lamp: the neutral pixels (bulb, reflector, clear lens) light up, the amber indicator stays dark. A lit lamp fills
      // its whole lens, so the darker reflector / projector greys glow too (`** 0.4`), the black housing hardly.
      else {
        paint(glow, (r, gr, b) =>
          Math.max(r, gr, b) - Math.min(r, gr, b) < 60
            ? lum(r, gr, b) ** 0.4
            : 0,
        );
        // Bulbs / housings drawn as flat swatches: their own glow.
        const gc = (glow.image as HTMLCanvasElement).getContext('2d')!;
        for (const [u0, v0, u1, v1, colour] of HEAD_SWATCHES[file] ?? []) {
          gc.fillStyle = colour;
          gc.fillRect(
            u0 * SRC_SIZE,
            v0 * SRC_SIZE,
            (u1 - u0) * SRC_SIZE,
            (v1 - v0) * SRC_SIZE,
          );
        }
      }
      map.needsUpdate = true;
    })
    .catch(() => {}); // no sheet: the dark placeholder stays
  const m = new MeshPhysicalMaterial({
    map,
    emissive: 0xffffff,
    emissiveMap: glow,
    emissiveIntensity: clear ? 0.02 : kind === 'tail' ? 0.35 : 0.5,
    transparent: true,
    side: DoubleSide,
    roughness: 0.16,
    metalness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  });
  // The glow map is painted once the sheet has loaded: `CarModel` builds the lamp halos after that.
  m.userData.lampLoaded = loaded;
  if (kind !== 'tail') return headLamp(m, 6);
  m.userData.reverseHalo = REVERSE_HALO.has(file);
  m.userData.srcUv = REVERSE_HALO.has(file);
  lamp(
    m,
    1.2,
    reverseGlow,
    running ? RUNNING_BODY_NIGHT : LENS_NIGHT,
    idleGlow,
  );
  if (SOLID_CENTRE.has(file)) m.userData.brakeLamp.solidCentre = true;
  return m;
}

/** Tiling texture for metre UVs: `tile` = size of one canvas repeat in metres. */
function tiling(t: CanvasTexture, tile: number): CanvasTexture {
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(1 / tile, 1 / tile);
  return t;
}

let weaveTiles: { map: CanvasTexture; normal: CanvasTexture } | undefined;

/**
 * Moulded lamp lenses (the Porsche 930's own lenses): square pyramids on a 45 degree lattice, 6 mm apart, in box-projected
 * metre UVs (a 64 px tile = 24 mm). A grey map holds the faceting light from the upper left (dark / mid / bright facets) and
 * a normal map the facet slopes, so the lens glitters with the sun. Shared by the `*weave` parts.
 */
function lensWeave(): { map: CanvasTexture; normal: CanvasTexture } {
  if (!weaveTiles) {
    const S = 64;
    const P = 16;
    const TILT = (40 * Math.PI) / 180;
    // Which way the facet under pixel (x, y) leans, as a unit vector in the canvas plane.
    const lean = (x: number, y: number): [number, number] => {
      const u = (x + y) / P;
      const v = (x - y) / P;
      const a = u - Math.floor(u) - 0.5;
      const b = v - Math.floor(v) - 0.5;
      const k = Math.SQRT1_2;
      if (Math.abs(a) > Math.abs(b)) return a > 0 ? [k, k] : [-k, -k];
      return b > 0 ? [k, -k] : [-k, k];
    };
    const tile = (
      shade: (dx: number, dy: number) => [number, number, number],
      color: boolean,
    ) =>
      tiling(
        canvas(
          S,
          S,
          (g) => {
            const d = g.createImageData(S, S);
            for (let y = 0; y < S; y++)
              for (let x = 0; x < S; x++) {
                const [dx, dy] = lean(x, y);
                const i = (y * S + x) * 4;
                [d.data[i], d.data[i + 1], d.data[i + 2]] = shade(dx, dy);
                d.data[i + 3] = 255;
              }
            g.putImageData(d, 0, 0);
          },
          color,
        ),
        0.024,
      );
    weaveTiles = {
      map: tile((dx, dy) => {
        const v = 185 + 70 * (-dx - dy) * Math.SQRT1_2;
        return [v, v, v];
      }, true),
      normal: tile((dx, dy) => {
        const s = Math.sin(TILT);
        return [
          (dx * s * 0.5 + 0.5) * 255,
          (dy * s * 0.5 + 0.5) * 255,
          (Math.cos(TILT) * 0.5 + 0.5) * 255,
        ];
      }, false),
    };
  }
  return weaveTiles;
}

/**
 * Headlight in lamp space - a blade that widens outwards: top edge from (0, 0.5) up to
 * (0.87, 0.04), flat bottom edge at v 0.95, outer edge from (0.8, 0.85) up to the tip
 * (0.97, 0.15). Layout after the works car: gloss-black housing; a row of four faceted
 * chrome reflector modules under the top edge (slanted dividers); a frosted light guide
 * (DRL) along the bottom that turns up the outer edge.
 */
function headlightMaps(): { map: CanvasTexture; glow: CanvasTexture } {
  const W = 768;
  const H = 192;
  type P = [number, number];
  const topAt = (u: number) => 0.5 - 0.53 * Math.min(u, 0.87) + 0.08; // inside the frame
  const outerAt = (v: number) => 0.925 - (v - 0.15) / 4.12; // inside the outer edge
  const path = (g: CanvasRenderingContext2D, pts: P[]) => {
    g.beginPath();
    pts.forEach(([u, v], i) =>
      i ? g.lineTo(u * W, v * H) : g.moveTo(u * W, v * H),
    );
    g.closePath();
  };
  // Light guide: bottom band + the leg up the outer edge.
  const guide: P[] = [
    [0.08, 0.74],
    [outerAt(0.74) - 0.05, 0.74],
    [outerAt(0.3) - 0.05, 0.3],
    [outerAt(0.3), 0.3],
    [outerAt(0.88), 0.88],
    [0.1, 0.88],
  ];
  const guideCore: P[] = [
    [0.1, 0.79],
    [outerAt(0.79) - 0.03, 0.79],
    [outerAt(0.34) - 0.03, 0.34],
    [outerAt(0.34) - 0.015, 0.34],
    [outerAt(0.83) - 0.012, 0.83],
    [0.11, 0.83],
  ];
  // Reflector modules: between the top edge and the guide, dividers leaning outwards.
  const lean = 0.035;
  const gap = 0.008;
  const edges = [0.1, 0.25, 0.41, 0.575, 0.735];
  const modules: P[][] = edges.slice(0, -1).map((u0, i) => {
    const u1 = edges[i + 1];
    return [
      [u0 + gap, 0.69],
      [u1 - gap, 0.69],
      [u1 - gap + lean, topAt(u1 - gap + lean)],
      [u0 + gap + lean, topAt(u0 + gap + lean)],
    ];
  });
  const FACETS = [
    '#ffffff',
    '#a9b3be',
    '#eef2f6',
    '#7c8691',
    '#d6dde5',
    '#98a2ad',
  ];

  /** Each module's LED emitter (canvas px), filled in while the map is drawn. */
  const leds: [number, number][] = [];
  const map = canvas(W, H, (g) => {
    g.fillStyle = '#050607';
    g.fillRect(0, 0, W, H);
    modules.forEach((m, k) => {
      g.save();
      path(g, m);
      g.clip();
      // Faceted reflector: a fan of flat chrome facets around the LED.
      const cx = ((m[0][0] + m[1][0]) / 2 + lean * 0.4) * W;
      const cy = ((m[0][1] + m[3][1]) / 2 + 0.06) * H;
      leds.push([cx, cy]);
      const R = W * 0.25;
      const n = 11;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2 + k * 0.7;
        const a1 = ((i + 1) / n) * Math.PI * 2 + k * 0.7;
        g.fillStyle = FACETS[(i * 5 + k * 2) % FACETS.length];
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R);
        g.lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R);
        g.closePath();
        g.fill();
      }
      // Fine reflector ribs + shading towards the top (under the housing lip).
      g.strokeStyle = 'rgba(20, 24, 30, 0.18)';
      g.lineWidth = 1;
      for (let x = -H; x < W; x += 5) {
        g.beginPath();
        g.moveTo(x, H);
        g.lineTo(x + H * 0.45, 0);
        g.stroke();
      }
      const shade = g.createLinearGradient(0, m[3][1] * H, 0, 0.69 * H);
      shade.addColorStop(0, 'rgba(5, 6, 8, 0.5)');
      shade.addColorStop(0.35, 'rgba(5, 6, 8, 0.05)');
      shade.addColorStop(1, 'rgba(5, 6, 8, 0)');
      g.fillStyle = shade;
      g.fillRect(0, 0, W, H);
      // LED emitter.
      const led = g.createRadialGradient(cx, cy, 1, cx, cy, H * 0.09);
      led.addColorStop(0, '#ffffff');
      led.addColorStop(0.5, '#eef3fa');
      led.addColorStop(1, 'rgba(238, 243, 250, 0)');
      g.fillStyle = led;
      g.beginPath();
      g.arc(cx, cy, H * 0.09, 0, Math.PI * 2);
      g.fill();
      g.restore();
    });
    // Frosted light guide with its segment marks.
    const frost = g.createLinearGradient(0, 0.74 * H, 0, 0.88 * H);
    frost.addColorStop(0, '#aeb7c1');
    frost.addColorStop(0.5, '#e4e9ef');
    frost.addColorStop(1, '#97a1ac');
    path(g, guide);
    g.fillStyle = frost;
    g.fill();
    g.save();
    path(g, guide);
    g.clip();
    g.strokeStyle = 'rgba(60, 68, 78, 0.5)';
    g.lineWidth = 2;
    for (const u of edges.slice(1)) {
      g.beginPath();
      g.moveTo((u - 0.01) * W, 0.9 * H);
      g.lineTo((u + 0.01) * W, 0.72 * H);
      g.stroke();
    }
    g.restore();
    path(g, guideCore);
    g.fillStyle = '#ffffff';
    g.fill();
  });
  // Lights on: the low-beam LEDs blaze, their reflector modules light round them, the light guide glows.
  const glow = canvas(W, H, (g) => {
    g.fillStyle = '#000000';
    g.fillRect(0, 0, W, H);
    modules.forEach((m, k) => {
      g.save();
      path(g, m);
      g.clip();
      g.fillStyle = '#4a4e54';
      g.fillRect(0, 0, W, H);
      const [cx, cy] = leds[k];
      const led = g.createRadialGradient(cx, cy, 1, cx, cy, H * 0.14);
      led.addColorStop(0, '#ffffff');
      led.addColorStop(0.45, '#d8dce2');
      led.addColorStop(1, 'rgba(74, 78, 84, 0)');
      g.fillStyle = led;
      g.fillRect(0, 0, W, H);
      g.restore();
    });
    path(g, guide);
    g.fillStyle = '#3a3f46';
    g.fill();
    path(g, guideCore);
    g.fillStyle = '#ffffff';
    g.fill();
  });
  return { map, glow };
}

/**
 * E46 coupe tail lamp in lamp space ('corner' wrap, fitted to the Bimmer M3's lamp: u 0 = its inner end on the boot
 * lid at |x| 0.465, u 0.6 - 1 = the rounded corner onto the side; v 0 = the lamp's top edge at y 0.841, v 1 = its
 * lower edge on the groove under the lamp at y 0.658 - cars/bimmer-m3/DETAILS.md "Tail lamps"). The lamp is 0.511 x
 * 0.183 m in u / v (`span`), so texture px are not square: round things are drawn as ellipses (`PXU` / `PXV`). Layout of the facelift / M3 clear-top lamps (shapes
 * only, from reference photos): two pieces split at the boot lid's edge (`split`). Fender piece: a clear top section
 * (indicator: frosted, LED grid behind) over a bright red lens with a ring of LED dots (tail light: glows at idle).
 * Lid piece: lower than the fender piece, rounded at the trunk end, red with a slim clear reversing strip near its top.
 * Which part lights: tail / brake = the red lens only (both pieces, `glow`); reverse = the lid piece's white strip only
 * (`reverseGlow`); the clear top is the indicator, which the game does not use - never lit.
 */
const TAIL = {
  W: 768,
  H: 192,
  /** Outer end of the lamp, u per v (0 .. 1 in 0.1 steps): the corner piece is shorter at the top (measured on the GLB). */
  end: [
    0.751, 0.788, 0.831, 0.867, 0.901, 0.926, 0.949, 0.969, 0.986, 0.997, 1,
  ],
  /**
   * Dark housing rim (v) at the top / bottom of the fender piece, and half the lid piece's outline stroke: 2.7 mm all
   * round; under both pieces the 4 mm seal in the groove adds to it, so the bottoms line up left to right.
   */
  rim: [0.015, 0.015],
  /** Lamp size in u / v (m). */
  span: [0.511, 0.183],
  /**
   * Gap between the lid piece and the fender piece = the mesh's |x| 0.6 edge, u at v 0 and v 1: u mixes |x| and |z|
   * and the lamp face leans, so the edge slants in u (measured on the GLB; the lid piece is ~40 % of the lamp from behind).
   */
  split: [0.3235, 0.3075],
  /** Fender piece: the clear section runs from the top down to this v (y 0.773). */
  clear: 0.372,
  /**
   * LED ring in the fender piece's red part, a horizontal egg: centre (u, v), u radius towards the lid piece (`ruIn`) and
   * towards the corner (`ruOut`, 1 cm longer - the user's egg shape), v radius, dots. 11 x 8 cm, on the rear face: wrapped
   * round the corner it looked flat and bad.
   */
  ring: { u: 0.445, v: 0.69, ruIn: 0.098, ruOut: 0.117, rv: 0.219, n: 20 },
  /**
   * Lid piece outline (the mesh's `tail` region, model.source.json): its top at y 0.773 = the fender piece's clear /
   * red line (`clear`), so both red parts are the same height; the trunk-side end rounded with r 4.5 cm = 0.088 u x
   * 0.246 v. Above it is body.
   */
  lid: { top: 0.372, ru: 0.088, rv: 0.246 },
  /**
   * Clear reversing strip on the lid piece: [u0, u1, v0, v1] - 11.5 x 3.3 cm, centred across the piece (|x| 0.465 -
   * 0.6 = u 0 - ~0.315), y 0.753 - 0.720 (2 cm below the piece's top).
   */
  reverse: [0.0475, 0.2725, 0.48, 0.66],
};

function tailMaps(): {
  map: CanvasTexture;
  glow: CanvasTexture;
  reverseGlow: CanvasTexture;
} {
  const { W, H, split, clear, ring, lid, rim } = TAIL;
  const [r0, r1, rv0, rv1] = TAIL.reverse;
  /** Texture px per metre across / down the lamp. */
  const PXU = W / TAIL.span[0];
  const PXV = H / TAIL.span[1];
  /** x (px) of the lid / fender gap at height v. */
  const splitX = (v: number) => (split[0] + (split[1] - split[0]) * v) * W;
  /** A round dot of radius r (m) at (x, y) px. */
  const dot = (
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
  ) => {
    g.beginPath();
    g.ellipse(x, y, r * PXU, r * PXV, 0, 0, Math.PI * 2);
    g.fill();
  };
  /** The lamp outline (inner end, top, slanted outer end, bottom). */
  const outline = (g: CanvasRenderingContext2D) => {
    g.beginPath();
    g.moveTo(0, 0);
    for (let i = 0; i <= 10; i++) g.lineTo(TAIL.end[i] * W, (i / 10) * H);
    g.lineTo(0, H);
    g.closePath();
  };
  /** Red lens areas: the lid piece and the fender piece below its clear section. */
  const red = (g: CanvasRenderingContext2D) => {
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(splitX(0), 0);
    g.lineTo(splitX(1), H);
    g.lineTo(0, H);
    g.closePath();
    g.moveTo(splitX(clear), clear * H);
    g.lineTo(W, clear * H);
    g.lineTo(W, H);
    g.lineTo(splitX(1), H);
    g.closePath();
  };
  /** The dark gap between the two pieces, 6 px wide. */
  const gap = (g: CanvasRenderingContext2D) => {
    // Below the lid piece's top it straddles the split (half on each piece); above it the lid side is body, so
    // there it lies wholly on the fender piece - the same width all the way up.
    const t = lid.top;
    g.beginPath();
    g.moveTo(splitX(0), 0);
    g.lineTo(splitX(0) + 6, 0);
    g.lineTo(splitX(t) + 6, t * H);
    g.lineTo(splitX(t) + 3, t * H);
    g.lineTo(splitX(1) + 3, H);
    g.lineTo(splitX(1) - 3, H);
    g.lineTo(splitX(t) - 3, t * H);
    g.lineTo(splitX(t), t * H);
    g.closePath();
    g.fill();
  };
  /** LED ring dot centres (px). */
  const ringDots: [number, number][] = [];
  for (let i = 0; i < ring.n; i++) {
    const a = (i / ring.n) * Math.PI * 2;
    ringDots.push([
      (ring.u + (Math.cos(a) > 0 ? ring.ruOut : ring.ruIn) * Math.cos(a)) * W,
      (ring.v + ring.rv * Math.sin(a)) * H,
    ]);
  }
  /** LED dot radius (m). */
  const dotR = 0.0045;
  /** Lid piece outline: straight at the split, rounded at the trunk-side end. */
  const lidPath = (g: CanvasRenderingContext2D) => {
    const [rx, ry] = [lid.ru * W, lid.rv * H];
    const [t, b] = [lid.top * H, H];
    g.beginPath();
    g.moveTo(splitX(lid.top), t);
    g.lineTo(rx, t);
    g.ellipse(rx, t + ry, rx, ry, 0, -Math.PI / 2, Math.PI, true);
    g.lineTo(0, b - ry);
    g.ellipse(rx, b - ry, rx, ry, 0, Math.PI, Math.PI / 2, true);
    g.lineTo(splitX(1), b);
  };
  const reverseRect = (g: CanvasRenderingContext2D) => {
    g.beginPath();
    // Corners r 8 mm on the car (px are not square): softly rounded ends, not a pill (the strip is only 3.3 cm tall).
    g.roundRect(r0 * W, rv0 * H, (r1 - r0) * W, (rv1 - rv0) * H, {
      x: 0.008 * PXU,
      y: 0.008 * PXV,
    });
  };

  const map = canvas(W, H, (g) => {
    g.fillStyle = '#1a0a0c'; // housing rim
    g.fillRect(0, 0, W, H);
    g.save();
    outline(g);
    g.clip();
    // Bright red lens, a little inside the rim.
    const lens = g.createLinearGradient(0, 0, 0, H);
    lens.addColorStop(0, '#d81c25');
    lens.addColorStop(1, '#a8121a');
    g.fillStyle = lens;
    g.fillRect(0.01 * W, rim[0] * H, W, (1 - rim[0] - rim[1]) * H);
    // Fine vertical optics in the red.
    g.save();
    red(g);
    g.clip();
    g.strokeStyle = 'rgba(80, 0, 6, 0.12)';
    g.lineWidth = 1;
    for (let x = 2; x < W; x += 4) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, H);
      g.stroke();
    }
    g.restore();
    // Fender piece's clear top: frosted glass over a grid of LEDs.
    const cl = g.createLinearGradient(0, rim[0] * H, 0, clear * H);
    cl.addColorStop(0, '#f1f3f5');
    cl.addColorStop(1, '#c4c9cf');
    g.fillStyle = cl;
    g.beginPath();
    g.moveTo(splitX(rim[0]), rim[0] * H);
    g.lineTo(W, rim[0] * H);
    g.lineTo(W, clear * H);
    g.lineTo(splitX(clear), clear * H);
    g.closePath();
    g.fill();
    // LED grid behind the clear section: round dots on a 14 mm pitch.
    const pitch = 0.014;
    for (
      let y = rim[0] * H + pitch * PXV * 0.7;
      y < clear * H - pitch * PXV * 0.4;
      y += pitch * PXV
    )
      for (let x = splitX(y / H) + pitch * PXU * 0.8; x < W; x += pitch * PXU) {
        g.fillStyle = '#9aa1aa';
        dot(g, x, y, pitch * 0.3);
        g.fillStyle = '#e6e9ec';
        dot(g, x - pitch * 0.07 * PXU, y - pitch * 0.07 * PXV, pitch * 0.12);
      }
    // LED ring: darker red dots with a highlight.
    for (const [x, y] of ringDots) {
      g.fillStyle = '#7a0a10';
      dot(g, x, y, dotR);
      g.fillStyle = 'rgba(255, 150, 150, 0.6)';
      dot(g, x - dotR * 0.3 * PXU, y - dotR * 0.3 * PXV, dotR * 0.35);
    }
    // Lid piece: clear reversing strip with chrome slats.
    reverseRect(g);
    g.fillStyle = '#c9ced4';
    g.fill();
    g.save();
    reverseRect(g);
    g.clip();
    for (let y = rv0 * H + 2; y < rv1 * H; y += 6) {
      const s = g.createLinearGradient(0, y, 0, y + 4);
      s.addColorStop(0, '#f4f6f8');
      s.addColorStop(1, '#7b838c');
      g.fillStyle = s;
      g.fillRect(r0 * W, y, (r1 - r0) * W, 4);
    }
    g.restore();
    // Gap between the lid piece and the fender piece, and the lid piece's own rim (its top + rounded end).
    g.fillStyle = '#1a0a0c';
    gap(g);
    lidPath(g);
    g.strokeStyle = '#1a0a0c';
    g.lineWidth = 2 * rim[1] * H;
    g.stroke();
    // Glass highlight along the top of each piece.
    for (const [u0, u1, v0] of [
      [split[0], 1, rim[0]],
      [0, split[0], lid.top + 0.035],
    ]) {
      const hl = g.createLinearGradient(0, v0 * H, 0, (v0 + 0.16) * H);
      hl.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
      hl.addColorStop(1, 'rgba(255, 255, 255, 0)');
      g.fillStyle = hl;
      g.fillRect(u0 * W, v0 * H, (u1 - u0) * W, 0.16 * H);
    }
    g.restore();
  });
  // Emissive (x idle 0.5 / brake 1.1 by day, LENS_NIGHT in the dark; the map is sRGB, so '#b0' is ~43 % linear): the LED ring at
  // full red = the tail light, the red lens at ~43 %. Pure red only: a lighter ring washes out to salmon. The clear indicator section stays dark.
  const glow = canvas(W, H, (g) => {
    g.fillStyle = '#000000';
    g.fillRect(0, 0, W, H);
    g.save();
    outline(g);
    g.clip();
    red(g);
    g.fillStyle = '#b00800';
    g.fill();
    reverseRect(g);
    g.fillStyle = '#000000';
    g.fill();
    g.fillStyle = '#ff1a0e';
    for (const [x, y] of ringDots) dot(g, x, y, dotR);
    g.fillStyle = '#000000';
    gap(g);
    g.restore();
  });
  const reverseGlow = canvas(W, H, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    reverseRect(g);
    g.fillStyle = '#ffffff';
    g.fill();
  });
  return { map, glow, reverseGlow };
}

/**
 * Fabia R5 tail lamp. The 'corner' wrap fits u / v over BOTH the lamp and the third brake light above it, so each lamp
 * only covers u 0.18 - 0.99, v 0.63 - 1 of the texture. The lamp mesh is a raised U-shaped ridge (opening towards the
 * car's centre) round a recessed box (u 0.37 - 0.82, v 0.715 - 0.875); the white reversing light is the small
 * parallelogram the user traced in the middle of the U on a screenshot (2026-10-04): the traced pixels were mapped to the
 * mesh by calibrating the camera on the recessed box's four corner vertices and ray-casting the traced corners onto the
 * lamp triangles (u, v = 0.704, 0.755 / 0.349, 0.762 / 0.29, 0.866 / 0.662, 0.866). Everything else is a light red lens.
 */
function tailCMaps(): {
  map: CanvasTexture;
  glow: CanvasTexture;
  reverseGlow: CanvasTexture;
} {
  const W = 256;
  const H = 256;
  const box = (g: CanvasRenderingContext2D, color: string) => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0.704 * W, 0.755 * H);
    g.lineTo(0.349 * W, 0.762 * H);
    g.lineTo(0.29 * W, 0.866 * H);
    g.lineTo(0.662 * W, 0.866 * H);
    g.closePath();
    g.fill();
  };
  const map = canvas(W, H, (g) => {
    const bg = g.createLinearGradient(0, 0, W, 0);
    bg.addColorStop(0, '#d01a20');
    bg.addColorStop(1, '#ac1218');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    box(g, '#f4f4f2');
  });
  const glow = canvas(W, H, (g) => {
    g.fillStyle = '#ff0000';
    g.fillRect(0, 0, W, H);
    box(g, '#000'); // brake light stays red-only: the white box has no brake glow
  });
  const reverseGlow = canvas(W, H, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    box(g, '#ffffff');
  });
  return { map, glow, reverseGlow };
}

type Pt = [number, number];

/** Peugeot 206 LED tail lamp, left lamp, in each part's own 'corner' wrap UV (0..1, v down): read off the model's mesh. */
const P206_TUBES: Pt[] = [
  [0.702, 0.68],
  [0.812, 0.552],
  [0.873, 0.452],
  [0.967, 0.219],
  [0.996, 0.121],
  [1, 0.061],
  [0.941, 0],
  [0.683, 0.045],
  [0.273, 0.154],
  [0.18, 0.233],
  [0.099, 0.421],
  [0.339, 0.371],
  [0.777, 0.262],
  [0.738, 0.36],
  [0.698, 0.418],
  [0.603, 0.523],
  [0.558, 0.556],
  [0.218, 0.674],
  [0.156, 0.714],
  [0.084, 0.816],
  [0.022, 0.97],
  [0.19, 0.934],
  [0.398, 0.863],
  [0.493, 0.818],
];
/** The tubes' centre line (inner tip of the top tube, round the outer end, back to the inner tip of the lower one). */
const P206_TUBE_CORE: Pt[] = [
  [0.14, 0.33],
  [0.31, 0.26],
  [0.5, 0.2],
  [0.7, 0.155],
  [0.86, 0.12],
  [0.93, 0.19],
  [0.9, 0.3],
  [0.83, 0.43],
  [0.74, 0.53],
  [0.63, 0.6],
  [0.55, 0.67],
  [0.4, 0.74],
  [0.2, 0.81],
  [0.09, 0.88],
];
/** The same lamp in the body part's wrap UV: the top tube's top edge, the gap between the tubes (pocket), the lower tube's underside. */
const P206_LENS_OUTLINE: Pt[] = [
  [0.018, 0.88],
  [0.066, 0.49],
  [0.134, 0.24],
  [0.184, 0.166],
  [0.4, 0.04],
  [0.58, 0],
  [0.96, 0.1],
  [0.99, 0.155],
  [0.999, 0.2],
  [0.99, 0.31],
  [0.944, 0.445],
  [0.8, 0.62],
  [0.625, 0.79],
  [0.54, 0.845],
  [0.375, 0.92],
  [0.206, 0.97],
  [0.047, 0.98],
  [0.024, 0.95],
];
const P206_TOP_EDGE: Pt[] = [
  [0.201, 0.335],
  [0.276, 0.281],
  [0.523, 0.223],
  [0.813, 0.176],
];
const P206_POCKET_TOP: Pt[] = [
  [0.136, 0.464],
  [0.678, 0.356],
];
const P206_POCKET_BOTTOM: Pt[] = [
  [0.074, 0.84],
  [0.124, 0.734],
  [0.182, 0.665],
  [0.232, 0.637],
  [0.505, 0.557],
  [0.618, 0.462],
  [0.65, 0.422],
];
const P206_UNDERSIDE: Pt[] = [
  [0.074, 0.84],
  [0.21, 0.815],
  [0.376, 0.766],
  [0.453, 0.736],
  [0.621, 0.641],
  [0.709, 0.554],
  [0.758, 0.485],
];

/** v of a polyline (u ascending) at u. */
function polyAt(p: Pt[], u: number): number {
  for (let i = 1; i < p.length; i++) {
    if (u <= p[i][0] || i === p.length - 1) {
      const t = (u - p[i - 1][0]) / (p[i][0] - p[i - 1][0]);
      return p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t;
    }
  }
  return p[0][1];
}

/** A polyline moved `d` px sideways (towards the lower side) in canvas pixels. */
function offsetLine(p: Pt[], d: number): Pt[] {
  return p.map((q, i) => {
    const a = p[Math.max(i - 1, 0)];
    const b = p[Math.min(i + 1, p.length - 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [q[0] - ((b[1] - a[1]) / len) * d, q[1] + ((b[0] - a[0]) / len) * d];
  });
}

function tracePath(
  g: CanvasRenderingContext2D,
  p: Pt[],
  W: number,
  H: number,
  close = false,
) {
  g.beginPath();
  p.forEach(([x, y], i) =>
    i ? g.lineTo(x * W, y * H) : g.moveTo(x * W, y * H),
  );
  if (close) g.closePath();
}

/**
 * Peugeot 206 LED tail-lamp body ('corner' wrap fitted over the lamp body part, about 0.6 x 0.18 m): a deep red glossy
 * lens with a dark smoked pocket in the gap between the two tubes (two rows of LED dots) and a smoked dotted strip under
 * the lower tube. `glow` = the lens body lit dark red; `reverseGlow` = that strip lit white for the reversing light (the rest stays black).
 */
function lampClearMaps(): {
  map: CanvasTexture;
  glow: CanvasTexture;
  reverseGlow: CanvasTexture;
} {
  const W = 768;
  const H = 232;
  const stripLine = offsetLine(
    P206_UNDERSIDE.map(([u, v]): Pt => [u * W, v * H]),
    16,
  );
  const pocket = (g: CanvasRenderingContext2D, inset: number) => {
    const us: number[] = [];
    for (let u = 0.15; u < 0.655; u += 0.02) us.push(u);
    const top = us.map((u): Pt => [
      u * W,
      (polyAt(P206_POCKET_TOP, u) + inset) * H,
    ]);
    const bottom = us.map((u): Pt => [
      u * W,
      (polyAt(P206_POCKET_BOTTOM, u) - inset) * H,
    ]);
    g.beginPath();
    [...top, ...bottom.reverse()].forEach(([x, y], i) =>
      i ? g.lineTo(x, y) : g.moveTo(x, y),
    );
    g.closePath();
  };
  const dotRows = (
    g: CanvasRenderingContext2D,
    colour: string,
    rows: number,
  ) => {
    g.setLineDash([9, 7]);
    g.lineWidth = 8;
    g.strokeStyle = colour;
    for (let r = 1; r <= rows; r++) {
      g.beginPath();
      for (let u = 0.19; u <= 0.52; u += 0.02) {
        const top = polyAt(P206_POCKET_TOP, u);
        const bottom = polyAt(P206_POCKET_BOTTOM, u);
        const v = top + ((bottom - top) * r) / (rows + 1);
        if (u === 0.19) g.moveTo(u * W, v * H);
        else g.lineTo(u * W, v * H);
      }
      g.stroke();
    }
    g.setLineDash([]);
  };
  const strip = (g: CanvasRenderingContext2D, width: number) => {
    g.beginPath();
    stripLine.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.lineWidth = width;
    g.lineCap = 'butt';
    g.lineJoin = 'round';
    g.stroke();
  };
  const map = canvas(W, H, (g) => {
    // Deep red lens: lighter in the middle, darker towards the rim.
    const lens = g.createLinearGradient(0, 0, 0, H);
    lens.addColorStop(0, '#58070d');
    lens.addColorStop(0.45, '#7c0c14');
    lens.addColorStop(1, '#470609');
    g.fillStyle = lens;
    g.fillRect(0, 0, W, H);
    const sweep = g.createLinearGradient(0, 0, W, H * 0.4);
    sweep.addColorStop(0, 'rgba(255,90,80,0)');
    sweep.addColorStop(0.5, 'rgba(255,90,80,0.12)');
    sweep.addColorStop(1, 'rgba(255,90,80,0)');
    g.fillStyle = sweep;
    g.fillRect(0, 0, W, H);
    // The lens rim (the lamp's outline) is darker still, so the lamp reads as its own part on the red body.
    g.strokeStyle = '#1c0205';
    g.lineJoin = 'round';
    g.globalAlpha = 0.13;
    for (let width = 44; width >= 12; width -= 4) {
      g.lineWidth = width;
      tracePath(g, P206_LENS_OUTLINE, W, H, true);
      g.stroke();
    }
    g.globalAlpha = 1;
    // A thin lighter line along the top of the upper tube.
    g.strokeStyle = 'rgba(255,130,120,0.3)';
    g.lineWidth = 3;
    g.lineCap = 'round';
    g.beginPath();
    offsetLine(
      P206_TOP_EDGE.map(([u, v]): Pt => [u * W, v * H]),
      -13,
    ).forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
    // Smoked pocket between the tubes, with two rows of LED dots.
    pocket(g, 0.026);
    g.fillStyle = '#3a0a10';
    g.strokeStyle = '#3a0a10';
    g.lineJoin = 'round';
    g.lineWidth = 11; // rounds the pocket's corners
    g.fill();
    g.stroke();
    dotRows(g, '#5e1a22', 2);
    // Smoked strip under the lower tube: a row of dark LED cells.
    g.strokeStyle = '#4a2a2e';
    strip(g, 26);
    g.strokeStyle = '#2a0b10';
    strip(g, 22);
    g.setLineDash([16, 10]);
    g.strokeStyle = '#4e1a21';
    strip(g, 12);
    g.setLineDash([]);
  });
  // The red lens body lights dimly behind the tubes (running / brake light); the smoked pocket and the strip stay dark.
  const glow = canvas(W, H, (g) => {
    g.fillStyle = '#9a0c10';
    g.fillRect(0, 0, W, H);
    pocket(g, 0.026);
    g.fillStyle = '#000';
    g.strokeStyle = '#000';
    g.lineJoin = 'round';
    g.lineWidth = 11;
    g.fill();
    g.stroke();
    strip(g, 26);
  });
  const reverseGlow = canvas(W, H, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#4e4e4e';
    strip(g, 20);
    g.setLineDash([16, 10]);
    g.strokeStyle = '#ffffff';
    strip(g, 12);
    g.setLineDash([]);
  });
  return { map, glow, reverseGlow };
}

/**
 * Peugeot 206 LED tubes ('corner' wrap fitted over the two joined red tubes): lighter glossy red than the lens, dark at the
 * rim, a thin light-guide line along the middle. `glow` = what lights with the brake pedal: a hot core fading to dark red.
 */
function lampRedMaps(): { map: CanvasTexture; glow: CanvasTexture } {
  const W = 768;
  const H = 192;
  const draw = (g: CanvasRenderingContext2D, lit: boolean) => {
    g.fillStyle = lit ? '#000' : '#6e070d';
    g.fillRect(0, 0, W, H);
    g.save();
    tracePath(g, P206_TUBES, W, H, true);
    g.fillStyle = lit ? '#ff2418' : '#d1202a';
    g.fill();
    g.clip();
    // Darker towards the rim of the tube: strokes along the outline, each wider and fainter (a smooth falloff).
    g.lineJoin = 'round';
    g.strokeStyle = lit ? '#2a0204' : '#7a070d';
    g.globalAlpha = 0.14;
    for (let width = 44; width >= 8; width -= 4) {
      g.lineWidth = width;
      tracePath(g, P206_TUBES, W, H, true);
      g.stroke();
    }
    g.globalAlpha = 1;
    // The core of the tube: a light-guide line (hot white when lit).
    g.lineCap = 'round';
    g.lineWidth = lit ? 11 : 5;
    g.strokeStyle = lit ? '#ff4630' : 'rgba(255,170,160,0.55)';
    tracePath(g, P206_TUBE_CORE, W, H);
    g.stroke();
    g.restore();
  };
  return {
    map: canvas(W, H, (g) => draw(g, false)),
    glow: canvas(W, H, (g) => draw(g, true)),
  };
}

/**
 * Citroen C4 WRC tail lamp ('corner' wrap fitted over the lamp mesh: u = |x| - |z| from its inner end, v from the top
 * edge down; a tall wedge that is wide at the bottom: the rear-facing lower pad is v 0.72 - 1, the sweep up the pillar
 * is the narrow upper part, the mesh's two grooves sit at v 0.435 and 0.705). Top band: LED light-guide stripes; middle:
 * a dot matrix; lower pad: reflector ribs on the inner side and the white reversing lens on the outer side.
 */
function tailC4Maps(): {
  map: CanvasTexture;
  glow: CanvasTexture;
  reverseGlow: CanvasTexture;
} {
  const W = 512;
  const H = 256;
  const REV = { u0: 0.58, u1: 0.93, v0: 0.76, v1: 0.93 };
  const draw = (
    g: CanvasRenderingContext2D,
    c: {
      base: string;
      dark: string;
      stripe: [string, string];
      dot: string;
      rib: [string, string];
      white: string;
    },
  ) => {
    g.fillStyle = c.base;
    g.fillRect(0, 0, W, H);
    // Top band: light-guide stripes.
    for (let x = 0; x < W; x += 12) {
      g.fillStyle = c.stripe[(x / 12) % 2];
      g.fillRect(x, 0.04 * H, 6, 0.4 * H);
    }
    // Middle band: dot matrix.
    g.fillStyle = c.dot;
    for (let row = 0; row < 4; row++)
      for (let x = 10; x < W; x += 14) {
        g.beginPath();
        g.arc(x + (row % 2) * 7, (0.47 + row * 0.058) * H, 3.2, 0, 7);
        g.fill();
      }
    // Lower pad: slanted reflector ribs.
    g.save();
    g.beginPath();
    g.rect(0, 0.72 * H, W, 0.28 * H);
    g.clip();
    for (let x = -H; x < W; x += 26) {
      g.fillStyle = c.rib[0];
      g.beginPath();
      g.moveTo(x, H);
      g.lineTo(x + 13, H);
      g.lineTo(x + 13 + 0.28 * H * 0.7, 0.72 * H);
      g.lineTo(x + 0.28 * H * 0.7, 0.72 * H);
      g.fill();
    }
    g.restore();
    // Dark grooves between the sections and the rim of the reversing lens.
    g.fillStyle = c.dark;
    g.fillRect(0, 0.425 * H, W, 0.022 * H);
    g.fillRect(0, 0.695 * H, W, 0.022 * H);
    g.fillRect(
      REV.u0 * W - 7,
      REV.v0 * H - 7,
      (REV.u1 - REV.u0) * W + 14,
      (REV.v1 - REV.v0) * H + 14,
    );
    g.fillStyle = c.white;
    g.fillRect(
      REV.u0 * W,
      REV.v0 * H,
      (REV.u1 - REV.u0) * W,
      (REV.v1 - REV.v0) * H,
    );
    g.fillStyle = c.dark;
    for (let k = 1; k < 4; k++)
      g.fillRect(
        (REV.u0 + ((REV.u1 - REV.u0) * k) / 4) * W - 1,
        REV.v0 * H,
        3,
        (REV.v1 - REV.v0) * H,
      );
  };
  const map = canvas(W, H, (g) =>
    draw(g, {
      base: '#b9141b',
      dark: '#1b0507',
      stripe: ['#d92830', '#8e0e14'],
      dot: '#ff7566',
      rib: ['#8a0d13', ''],
      white: '#f2f2ef',
    }),
  );
  // Lit with SMALL_LAMP_NIGHT: the whole lens body glows dark red, the light-guide stripes and dots at full red (a lighter dot
  // would wash out to pink), the white reversing lens stays dark.
  const glow = canvas(W, H, (g) =>
    draw(g, {
      base: '#b00c10',
      dark: '#000',
      stripe: ['#ff2a1c', '#8a0a0e'],
      dot: '#ff2a1c',
      rib: ['#7a090c', ''],
      white: '#160204',
    }),
  );
  const reverseGlow = canvas(W, H, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#fff';
    g.fillRect(
      REV.u0 * W,
      REV.v0 * H,
      (REV.u1 - REV.u0) * W,
      (REV.v1 - REV.v0) * H,
    );
  });
  return { map, glow, reverseGlow };
}

/**
 * Rear side windows (rear door glass u 0.35 - 1 + quarter glass u 0 - 0.33) with the rally
 * car's black plastic panel along the top and its row of rounded vent openings.
 * `finish` = R clearcoat, G roughness: glossy glass, matt plastic.
 */
function ventGlassMaps(): { map: CanvasTexture; finish: CanvasTexture } {
  const W = 512;
  const H = 256;
  const panelBottom = (u: number) => 0.335 - 0.05 * u;
  const holes = [0.25, 0.45, 0.565, 0.68, 0.795, 0.91];
  const draw = (
    g: CanvasRenderingContext2D,
    glass: string,
    plastic: string,
    opening: string,
  ) => {
    g.fillStyle = glass;
    g.fillRect(0, 0, W, H);
    g.fillStyle = plastic;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(W, 0);
    g.lineTo(W, panelBottom(1) * H);
    g.lineTo(0, panelBottom(0) * H);
    g.closePath();
    g.fill();
    g.fillStyle = opening;
    for (const u of holes) {
      const w = 0.1 * W;
      const h = 0.13 * H;
      g.beginPath();
      g.roundRect(u * W - w / 2, (0.19 - 0.03 * u) * H - h / 2, w, h, h * 0.3);
      g.fill();
    }
  };
  return {
    map: canvas(W, H, (g) => draw(g, '#0a0d10', '#0c0d0e', '#707a85')),
    finish: canvas(
      W,
      H,
      (g) => draw(g, 'rgb(255,15,0)', 'rgb(0,200,0)', 'rgb(255,30,0)'),
      false,
    ),
  };
}

/**
 * Twin lamp layout in lamp space, fitted to the Bimmer M3's lamp outline (the engraved groove traced on the mesh,
 * cars/bimmer-m3/DETAILS.md "Headlights"): the lamp runs from its inner tip by the kidney (u 0) to the amber
 * divider (|x| 0.74; the amber is its own part, not drawn here). Measured on the GLB (u = 1.843 (|x| - |z|) + 3.02,
 * v = 5.447 - 8.17 y): inner bowl at |x| 0.488 (u 0.257), the groove between the two sections at |x| 0.57
 * (u 0.471), outer bowl at |x| 0.655 (u 0.692), both 9.5 cm across. Each bowl has its own u radius: the corner wrap
 * stretches u where the lamp sweeps back (1.37x more at the outer bowl), so the ellipses come out round seen from
 * the front.
 */
const TWIN = {
  W: 640,
  H: 128,
  /** Bowl centre u + u radius. */
  bowls: [
    [0.257, 0.115],
    [0.692, 0.137],
  ],
  bowlV: 0.5,
  /** Bowl radius in v (lamp v span 0.122 m: 4.75 cm). */
  radius: 0.39,
  /** The groove between the inner and the outer bowl section (drawn as a chrome divider). */
  divider: 0.471,
  /** How far the round lamps sit behind the clear cover (m). */
  depth: 0.03,
};

/**
 * Twin round headlight in lamp space ('corner' wrap: u from the car's centre outwards, v down),
 * after the BMW E46: smoked chrome housing, two round projector bowls (chrome reflector, dark
 * lens, bright ring light) and a chrome divider between the two sections (the amber indicator is its own
 * part: `amber`). Layout: TWIN. The bowls are
 * the floors of the recessed barrels drawn by lampDepth.
 */
function twinLampMaps(): { map: CanvasTexture; glow: CanvasTexture } {
  const { W, H } = TWIN;
  const R = TWIN.radius * H;
  const divider = TWIN.divider * W;
  /** Draw in a bowl's own frame: origin at its centre, circles of radius R fill the bowl. */
  const atBowl = (
    g: CanvasRenderingContext2D,
    [u, ru]: number[],
    draw: () => void,
  ) => {
    g.save();
    g.translate(u * W, TWIN.bowlV * H);
    g.scale((ru * W) / R, 1);
    draw();
    g.restore();
  };
  const ring = (g: CanvasRenderingContext2D) => {
    g.strokeStyle = '#ffffff';
    g.lineWidth = 0.07 * R;
    g.beginPath();
    g.arc(0, 0, R * 0.84, 0, Math.PI * 2);
    g.stroke();
  };
  const map = canvas(W, H, (g) => {
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#5a6068');
    bg.addColorStop(0.5, '#262a30');
    bg.addColorStop(1, '#14171b');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    for (const b of TWIN.bowls)
      atBowl(g, b, () => {
        // Smoked chrome reflector bowl: lighter rim, dark throat.
        const bowl = g.createRadialGradient(0, 0, R * 0.2, 0, 0, R);
        bowl.addColorStop(0, '#22272d');
        bowl.addColorStop(0.55, '#7d8792');
        bowl.addColorStop(0.8, '#c3cbd4');
        bowl.addColorStop(1, '#4a5159');
        g.fillStyle = bowl;
        g.beginPath();
        g.arc(0, 0, R, 0, Math.PI * 2);
        g.fill();
        ring(g);
        // Projector lens: dark glass with a highlight.
        const lens = g.createRadialGradient(
          -R * 0.12,
          -R * 0.14,
          R * 0.04,
          0,
          0,
          R * 0.42,
        );
        lens.addColorStop(0, '#e8f0ff');
        lens.addColorStop(0.25, '#3c4a5c');
        lens.addColorStop(1, '#07090c');
        g.fillStyle = lens;
        g.beginPath();
        g.arc(0, 0, R * 0.42, 0, Math.PI * 2);
        g.fill();
      });
    // Chrome divider between the inner and the outer bowl section (the mesh's groove).
    const dv = g.createLinearGradient(divider - 3, 0, divider + 3, 0);
    dv.addColorStop(0, '#3a4048');
    dv.addColorStop(0.5, '#d8dde3');
    dv.addColorStop(1, '#3a4048');
    g.fillStyle = dv;
    g.fillRect(divider - 3, 0, 6, H);
    // Lens highlight across the top.
    const hl = g.createLinearGradient(0, 0, 0, 0.3 * H);
    hl.addColorStop(0, 'rgba(255, 255, 255, 0.35)');
    hl.addColorStop(1, 'rgba(255, 255, 255, 0)');
    g.fillStyle = hl;
    g.fillRect(0, 0, W, 0.3 * H);
  });
  // Lights on: both ring lights, and the low-beam projector in the outer bowl (the inner one is the high beam: dark).
  const glow = canvas(W, H, (g) => {
    g.fillStyle = '#000000';
    g.fillRect(0, 0, W, H);
    for (const b of TWIN.bowls) atBowl(g, b, () => ring(g));
    atBowl(g, TWIN.bowls[1], () => {
      const lens = g.createRadialGradient(0, 0, R * 0.05, 0, 0, R * 0.7);
      lens.addColorStop(0, '#ffffff');
      lens.addColorStop(0.55, '#c9ced6');
      lens.addColorStop(1, 'rgba(60, 64, 70, 0)');
      g.fillStyle = lens;
      g.beginPath();
      g.arc(0, 0, R * 0.7, 0, Math.PI * 2);
      g.fill();
    });
  });
  return { map, glow };
}

/** Recessed round lamps for lampDepth: bowls (centre u, v, radius u, v in lamp space), depth (m), wall colour dark -> lit, wall glow. */
type LampBowls = {
  bowls: number[][];
  depth: number;
  wallDark: number[];
  wallLit: number[];
  /** How much of the emissive map still shows on the walls (0 = dark walls). */
  wallGlow: number;
  /** The car's forward axis seen from the lamp: 1 for a front lamp (barrels run back), -1 for a rear one. */
  facing: number;
};

const TWIN_BOWLS: LampBowls = {
  bowls: TWIN.bowls.map(([u, ru]) => [u, TWIN.bowlV, ru, TWIN.radius]),
  depth: TWIN.depth,
  wallDark: [0.012, 0.012, 0.012],
  wallLit: [0.3, 0.3, 0.3],
  wallGlow: 0,
  facing: 1,
};

/**
 * Sets a lamp's round lamps back inside the housing (parallax, no extra geometry): the
 * lamp surface is the clear cover, each bowl is a barrel `depth` deep behind it, running along the car's forward axis (+z model). A view ray
 * through a bowl opening either reaches the floor (the bowl art, sampled where the ray lands) or
 * hits the barrel wall (`wallDark` -> `wallLit` from below, darker towards the back), so the housing lip
 * covers part of the lamp from any angle but straight on. The ray is turned into lamp-space
 * steps with the surface gradients of u / v from screen derivatives (the GLB has no tangents).
 */
function lampDepth(m: MeshPhysicalMaterial, cfg: LampBowls): void {
  const f = (x: number) => x.toFixed(5);
  const v3 = (c: number[]) => `vec3(${c.map(f).join(', ')})`;
  const n = cfg.bowls.length;
  const bowls = cfg.bowls.map((b) => `vec4(${b.map(f).join(', ')})`).join(', ');
  // One program per bowl layout (the default key is the hook's source text, the same for every lamp).
  const key = `lampDepth ${JSON.stringify(cfg)}`;
  m.customProgramCacheKey = () => key;
  m.onBeforeCompile = (shader) => {
    addWorldUniforms(shader);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vLampAxis;',
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>\nvLampAxis = (modelViewMatrix * vec4(0.0, 0.0, ${f(cfg.facing)}, 0.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vLampAxis;',
      )
      .replace(
        '#include <map_fragment>',
        `vec2 lampUv = vMapUv;
        float lampWall = 0.0;
        {
          vec3 n = normalize(vNormal);
          n = gl_FrontFacing ? n : -n;
          vec3 ray = -normalize(vViewPosition);
          float rn = dot(ray, n);
          vec3 q0 = dFdx(-vViewPosition);
          vec3 q1 = dFdy(-vViewPosition);
          vec2 st0 = dFdx(vMapUv);
          vec2 st1 = dFdy(vMapUv);
          vec3 r1 = cross(q1, n);
          vec3 r2 = cross(n, q0);
          float det = dot(q0, r1);
          if (rn < -0.05 && abs(det) > 1e-14) {
            // Lamp-space step per metre of depth along the ray (grazing rays clamped).
            vec3 gu = (r1 * st0.x + r2 * st1.x) / det;
            vec3 gv = (r1 * st0.y + r2 * st1.y) / det;
            // Barrels run along the car's forward axis (projectors aim straight ahead), not along the surface
            // normal: the E46 lamp face slopes back, and normal barrels looked aimed upwards from the front.
            vec3 axis = normalize(vLampAxis);
            float ra = max(-dot(ray, axis), 0.3);
            vec3 o = ray / ra + axis;
            vec2 duv = vec2(dot(o, gu), dot(o, gv));
            const float DEPTH = ${f(cfg.depth)};
            vec4 BOWLS[${n}] = vec4[${n}](${bowls}); // centre uv, radius uv
            for (int i = 0; i < ${n}; i++) {
              vec2 RAD = BOWLS[i].zw;
              vec2 p0 = (vMapUv - BOWLS[i].xy) / RAD;
              float c = dot(p0, p0) - 1.0;
              if (c >= 0.0) continue;
              vec2 d = duv / RAD;
              float a = dot(d, d);
              float b = dot(p0, d);
              float z = a > 1e-10 ? (-b + sqrt(b * b - a * c)) / a : 1e9;
              if (z >= DEPTH) {
                lampUv = vMapUv + duv * DEPTH;
              } else {
                vec2 w = p0 + d * z;
                float lit = smoothstep(-0.7, 0.9, w.y);
                lampWall = 1.0;
                diffuseColor.rgb *= mix(${v3(cfg.wallDark)}, ${v3(cfg.wallLit)}, lit) * mix(1.0, 0.4, z / DEPTH);
              }
            }
          }
          #ifdef USE_MAP
            if (lampWall < 0.5) diffuseColor *= textureGrad(map, lampUv, st0, st1);
          #endif
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#ifdef USE_EMISSIVEMAP
          totalEmissiveRadiance *= textureGrad(emissiveMap, lampUv, dFdx(vMapUv), dFdy(vMapUv)).rgb * (1.0 - lampWall * ${f(1 - cfg.wallGlow)});
        #endif`,
      );
  };
}

const BUILDERS: Record<PartName, () => Material> = {
  /** Unpainted plastic: arch liners, intake ducts, window frames, diffuser. */
  trim: () => new MeshStandardMaterial({ color: 0x141516, roughness: 0.78 }),
  /** Piano-black grille. */
  gloss: () =>
    new MeshPhysicalMaterial({
      color: 0x08090a,
      roughness: 0.32,
      clearcoat: 0.6,
      clearcoatRoughness: 0.12,
      envMapIntensity: 0.55,
    }),
  /** Painted rear-wing blades (Fiesta WRC): the livery's navy and green. */
  wingblue: () =>
    new MeshPhysicalMaterial({
      color: 0x0c2a6e,
      roughness: 0.4,
      clearcoat: 0.6,
      clearcoatRoughness: 0.15,
      envMapIntensity: 0.6,
    }),
  winggreen: () =>
    new MeshPhysicalMaterial({
      color: 0x2eaa4a,
      roughness: 0.4,
      clearcoat: 0.6,
      clearcoatRoughness: 0.15,
      envMapIntensity: 0.6,
    }),
  /** Wire mesh over an intake: dark diamonds in a lighter wire grid, ~12 mm cells. */
  mesh: () =>
    new MeshStandardMaterial({
      map: tiling(
        canvas(32, 32, (g) => {
          g.fillStyle = '#4a4e54';
          g.fillRect(0, 0, 32, 32);
          g.fillStyle = '#060607';
          g.beginPath();
          g.moveTo(16, 3);
          g.lineTo(29, 16);
          g.lineTo(16, 29);
          g.lineTo(3, 16);
          g.closePath();
          g.fill();
        }),
        0.012,
      ),
      roughness: 0.65,
      metalness: 0.5,
    }),
  /** Clear-coated carbon: 2 x 2 twill weave, ~5 mm tows. */
  carbon: () =>
    new MeshPhysicalMaterial({
      map: tiling(
        canvas(16, 16, (g) => {
          g.fillStyle = '#17181b';
          g.fillRect(0, 0, 16, 16);
          g.fillStyle = '#2b2d32';
          for (let j = 0; j < 4; j++)
            for (let i = 0; i < 4; i++)
              if ((i + j) % 4 < 2) g.fillRect(i * 4, j * 4, 4, 4);
        }),
        0.02,
      ),
      roughness: 0.5,
      metalness: 0.1,
      clearcoat: 0.35,
      clearcoatRoughness: 0.3,
      envMapIntensity: 0.6,
    }),
  /** Dark tinted glazing (opaque: imported bodies have no interior). */
  glass: () =>
    new MeshPhysicalMaterial({
      color: 0x0a0d10,
      roughness: 0.06,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      envMapIntensity: 0.9,
    }),
  ventglass: () => {
    const { map, finish } = ventGlassMaps();
    return new MeshPhysicalMaterial({
      map,
      roughness: 1,
      roughnessMap: finish,
      metalness: 0,
      clearcoat: 1,
      clearcoatMap: finish,
      clearcoatRoughness: 0.03,
      envMapIntensity: 0.9,
    });
  },
  headlight: () => {
    const { map, glow } = headlightMaps();
    return headLamp(
      new MeshPhysicalMaterial({
        map,
        emissive: 0xffffff,
        emissiveMap: glow,
        roughness: 0.22,
        metalness: 0.12,
        clearcoat: 1,
        clearcoatRoughness: 0.04,
      }),
      5,
    );
  },
  /** Twin round headlight (E46 style), see twinLampMaps / lampDepth - needs `parts.wrap` 'corner'. */
  twinlamp: () => {
    const { map, glow } = twinLampMaps();
    const m = new MeshPhysicalMaterial({
      map,
      emissive: 0xffffff,
      emissiveMap: glow,
      roughness: 0.18,
      metalness: 0.25,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
    });
    lampDepth(m, TWIN_BOWLS);
    return headLamp(m, 4);
  },
  /** Painted coil-over spring (a model's own suspension in the wheel well), the 'sti' yellow of the setup screen. */
  coilover: () =>
    new MeshStandardMaterial({
      color: 0xf0c020,
      roughness: 0.45,
      metalness: 0.3,
    }),
  /** Mirror glass. */
  mirror: () =>
    new MeshPhysicalMaterial({
      color: 0xb8c2cc,
      roughness: 0.04,
      metalness: 1,
      envMapIntensity: 1.2,
    }),
  /** Clear lamp section (reversing light) over a chrome reflector. */
  lens: () =>
    new MeshPhysicalMaterial({
      color: 0xd5dae0,
      roughness: 0.16,
      metalness: 0.7,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
    }),
  /** See-through lamp cover, lightly smoked: the lamp's own reflector bowls and bulbs show behind it, the tint and
   *  sky reflection make the glass itself read (at 20 % clear it looked like there was no cover). */
  lenscover: () =>
    new MeshPhysicalMaterial({
      color: 0x7d8fa4,
      roughness: 0.02,
      metalness: 0,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      envMapIntensity: 1.8,
    }),
  /** Bright polished metal: lamp reflector bowls and projector bodies. */
  chrome: () =>
    new MeshPhysicalMaterial({
      color: 0xd8dce2,
      roughness: 0.14,
      metalness: 1,
      envMapIntensity: 1.1,
    }),
  /** Chrome headlamp reflector bowl (a car whose lamp is only the bowl, `gltf.remap`): polished metal by day, lit warm white with the lights on. */
  headchrome: () =>
    headLamp(
      new MeshPhysicalMaterial({
        color: 0xd8dce2,
        emissive: 0xffe9b0,
        roughness: 0.14,
        metalness: 1,
        envMapIntensity: 1.1,
      }),
      1.4,
    ),
  /** Brushed aluminium: window frames, roof rails. */
  satin: () =>
    new MeshStandardMaterial({
      color: 0xb4b8be,
      roughness: 0.4,
      metalness: 0.85,
      envMapIntensity: 0.7,
    }),
  /** Satin stainless steel: exhaust tail pipes. */
  steel: () =>
    new MeshPhysicalMaterial({
      color: 0xdfe3e8,
      roughness: 0.32,
      metalness: 0.65,
      emissive: 0x2a2d32,
      envMapIntensity: 1.2,
    }),
  /** Amber indicator lens: orange plastic, only a faint glow (no indicator lamp is ever lit, so it must not shine at night). */
  amber: () =>
    new MeshPhysicalMaterial({
      color: 0xff9a1a,
      emissive: 0xff7a00,
      emissiveIntensity: 0.06,
      roughness: 0.2,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
    }),
  /** Round lamp cup behind a see-through lens (chrome reflector seen through red), glows with the tail / brake light. */
  lampcup: () =>
    lamp(
      new MeshPhysicalMaterial({
        color: 0xc8303a,
        roughness: 0.22,
        metalness: 0.85,
        emissive: 0xff1810,
        emissiveIntensity: 0.25,
        side: DoubleSide,
      }),
      2.2,
    ),
  /** Bulb in a `lampcup`. */
  lampbulb: () =>
    lamp(
      new MeshPhysicalMaterial({
        color: 0xffc8b8,
        roughness: 0.1,
        emissive: 0xff3020,
        emissiveIntensity: 0.4,
        side: DoubleSide,
      }),
      6,
    ),
  tail: () => {
    const { map, glow, reverseGlow } = tailMaps();
    return lamp(
      new MeshPhysicalMaterial({
        map,
        emissive: 0xffffff,
        emissiveMap: glow,
        emissiveIntensity: 0.5,
        roughness: 0.16,
        metalness: 0.1,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
      }),
      1.1,
      reverseGlow,
      LENS_NIGHT,
    );
  },
  /**
   * Rubber seal in the groove round a tail lamp: the lamp texture's dark housing-rim colour (TAIL) with the lamp's own
   * gloss, so it reads like the lamp's bottom rim ("light black") instead of flat black.
   */
  seal: () =>
    new MeshPhysicalMaterial({
      color: 0x1a0a0c,
      roughness: 0.16,
      metalness: 0.1,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
    }),
  /** Roof scoop stripes (French flag, Citroen C4 WRC). */
  flagblue: () => new MeshStandardMaterial({ color: 0x1d3a9e, roughness: 0.4 }),
  flagwhite: () =>
    new MeshStandardMaterial({ color: 0xf1f1f1, roughness: 0.4 }),
  flagred: () => new MeshStandardMaterial({ color: 0xd3202c, roughness: 0.4 }),
  /** Modelled cockpit of an imported body (seats, dash, door cards): dark, matte - without it the cockpit got the livery. */
  interior: () => new MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.9 }),
  /** Roll cage of an imported cockpit: light grey like the procedural cars' cage (car-model.ts cageMat). */
  cage: () =>
    new MeshStandardMaterial({
      color: 0xd6d8db,
      roughness: 0.45,
      metalness: 0.2,
    }),
  /** Fabia R5 tail lamp: even red lens + white reversing square, see tailCMaps - needs `parts.wrap` 'corner'. */
  tailc: () => {
    const { map, glow, reverseGlow } = tailCMaps();
    return lamp(
      new MeshPhysicalMaterial({
        map,
        emissive: 0xffffff,
        emissiveMap: glow,
        emissiveIntensity: 0.05,
        roughness: 0.16,
        metalness: 0,
        transparent: true,
        opacity: 0.8,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
      }),
      1.1,
      reverseGlow,
      RED_NIGHT,
    );
  },
  /** Dark metal lamp housing / bezel of a modelled (3D) lamp. */
  lamphousing: () =>
    new MeshPhysicalMaterial({
      color: 0x3a3b3e,
      roughness: 0.35,
      metalness: 0.6,
      clearcoat: 0.6,
      clearcoatRoughness: 0.1,
      envMapIntensity: 0.8,
    }),
  /**
   * Modelled headlight LED ring / bulb / light guide: frosted clear plastic, so it reads grey by day (not a lit white ring)
   * and glows warm white with the lights on.
   */
  headled: () =>
    headLamp(
      new MeshPhysicalMaterial({
        color: 0x8f9194,
        emissive: 0xffe9b0,
        roughness: 0.35,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
      }),
      4,
    ),
  /** Citroen C4 WRC tail lamp, see tailC4Maps - needs `parts.wrap` 'corner'. */
  tailc4: () => {
    const { map, glow, reverseGlow } = tailC4Maps();
    return lamp(
      new MeshPhysicalMaterial({
        map,
        emissive: 0xffffff,
        emissiveMap: glow,
        emissiveIntensity: 0.5,
        roughness: 0.16,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
      }),
      1.2,
      reverseGlow,
      SMALL_LAMP_NIGHT,
    );
  },
  /** Modelled tail-lamp LED strip: red, idle glow, bright with the brake pedal (setBrake). */
  tailled: () => tailLed(0xff0000, 0.3, 1.1, RED_NIGHT),
  /** Bumper corner strip: dark red reflector while off, lights like `tailled` with the brake pedal (setBrake). */
  brakestrip: () => brakeStrip(0xff0000, 1.1, STRIP_NIGHT),
  brakestripred: () => brakeStrip(0xff0000, 1.1, STRIP_NIGHT),
  /** Modelled reversing lamp: matte white, dark until the car is in reverse gear (setBrake `reversing`), never lit by the brake. */
  reverselamp: () =>
    lamp(
      new MeshPhysicalMaterial({
        color: 0xe4e6e8,
        roughness: 0.55,
        metalness: 0,
        emissive: 0xffffff,
        emissiveMap: canvas(2, 2, (g) => {
          g.fillStyle = '#000';
          g.fillRect(0, 0, 2, 2);
        }),
        emissiveIntensity: 0,
      }),
      2.2,
      canvas(2, 2, (g) => {
        g.fillStyle = '#fff';
        g.fillRect(0, 0, 2, 2);
      }),
    ),
  /**
   * Peugeot 206 LED tail-lamp body (the lens behind the tubes): glossy deep red with smoked LED pockets, see lampClearMaps -
   * needs `parts.wrap` 'corner'. The smoked strip along the bottom lights white in reverse gear only, like `reverselamp`.
   */
  lampclear: () => {
    const { map, glow, reverseGlow } = lampClearMaps();
    return lamp(
      new MeshPhysicalMaterial({
        map,
        roughness: 0.3,
        metalness: 0,
        envMapIntensity: 0.35,
        clearcoat: 0.3,
        clearcoatRoughness: 0.12,
        emissive: 0xffffff,
        emissiveMap: glow,
        emissiveIntensity: 0.2,
      }),
      2,
      reverseGlow,
      { idle: 0.5, on: 0.85 },
    );
  },
  /** Peugeot 206 LED tubes: glossy red, see lampRedMaps - needs `parts.wrap` 'corner'. The tube cores light with the brake. */
  lampred: () => {
    const { map, glow } = lampRedMaps();
    return lamp(
      new MeshPhysicalMaterial({
        map,
        emissive: 0xffffff,
        emissiveMap: glow,
        emissiveIntensity: 0.4,
        roughness: 0.25,
        metalness: 0,
        envMapIntensity: 0.7,
        clearcoat: 0.9,
        clearcoatRoughness: 0.08,
      }),
      1.2,
      undefined,
      SMALL_LAMP_NIGHT,
    );
  },
  /** Red see-through cover over a modelled tail lamp. */
  redcover: () =>
    new MeshPhysicalMaterial({
      color: 0xb81408,
      roughness: 0.03,
      metalness: 0,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      envMapIntensity: 1.5,
    }),
  /** Red see-through cover that lights with the brake pedal (setBrake), like `tailled`. */
  brakecover: () => brakeCover(0xff0000, 0.72, 1.1, RED_NIGHT),
  /**
   * Thin dark red glass over a lamp sheet (WRX): it hardly glows itself - the sheet beneath lights, so its texture shows through
   * and the lamp stays dark while off.
   */
  brakered: () =>
    brakeCover(0xff0000, 0.5, 0.15, { idle: 0.02, on: 0.1 }, 0, 0xc0160a),
  reflector: () =>
    new MeshPhysicalMaterial({
      color: 0xa80f08,
      roughness: 0.25,
      metalness: 0.3,
      clearcoat: 1,
    }),
  /** Red weave lens (Porsche 930 tail lamp): lights with the brake like `tailled`. */
  tailweave: () => {
    const { map, normal } = lensWeave();
    return lamp(
      new MeshPhysicalMaterial({
        color: 0xd41408,
        map,
        normalMap: normal,
        emissive: 0xff2010,
        emissiveMap: map,
        emissiveIntensity: 0.35,
        roughness: 0.25,
        metalness: 0.1,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
      }),
      1.2,
      undefined,
      { idle: 0.3, on: 0.65 },
    );
  },
  /** Amber weave lens (indicator), faintly glowing. */
  amberweave: () => {
    const { map, normal } = lensWeave();
    return new MeshPhysicalMaterial({
      color: 0xf0900f,
      map,
      normalMap: normal,
      emissive: 0xff7a00,
      emissiveMap: map,
      emissiveIntensity: 0.4,
      roughness: 0.22,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
    });
  },
  /** White weave lens (reversing section of a tail lamp). */
  lensweave: () => {
    const { map, normal } = lensWeave();
    return new MeshPhysicalMaterial({
      color: 0xd8dadc,
      map,
      normalMap: normal,
      roughness: 0.3,
      metalness: 0.15,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
    });
  },
  /** Smoked clear weave lens over a dark housing (front bumper lamps). */
  clearweave: () => {
    const { map, normal } = lensWeave();
    return new MeshPhysicalMaterial({
      color: 0x5c6167,
      map,
      normalMap: normal,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      roughness: 0.12,
      metalness: 0.2,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
    });
  },
};
