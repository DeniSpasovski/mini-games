import {
  CanvasTexture,
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
 * undefined and get the car's painted livery material instead.
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
  | 'glass'
  | 'ventglass'
  | 'headlight'
  | 'twinlamp'
  | 'mirror'
  | 'lens'
  | 'lenscover'
  | 'chrome'
  | 'amber'
  | 'tail'
  | 'tailc'
  | 'seal'
  | 'reflector'
  | 'lamphousing'
  | 'headled'
  | 'tailled'
  | 'redcover'
  | 'interior'
  | 'cage';

const cache = new Map<string, Material>();

/**
 * Brake lamp (CarModel.setBrake): emissive from its idle value to `on` with the brake down. `reverseGlow` = an
 * emissive map that lights only the white reversing section; CarModel swaps it in while the car is in reverse gear.
 */
function lamp(
  m: MeshPhysicalMaterial,
  on: number,
  reverseGlow?: CanvasTexture,
): MeshPhysicalMaterial {
  m.userData.brakeLamp = { off: m.emissiveIntensity, on, reverseGlow };
  return m;
}

export function partMaterial(name: string): Material | undefined {
  const build = BUILDERS[name as PartName];
  if (!build) return undefined;
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

/** Tiling texture for metre UVs: `tile` = size of one canvas repeat in metres. */
function tiling(t: CanvasTexture, tile: number): CanvasTexture {
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(1 / tile, 1 / tile);
  return t;
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
  const glow = canvas(W, H, (g) => {
    g.fillStyle = '#000000';
    g.fillRect(0, 0, W, H);
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
  // Emissive (x idle 0.5 / brake 5.5; the map is sRGB, so '#78' is ~19 % linear): the LED ring at full = the tail light,
  // the red lens areas at ~19 % only really light up with the brake (more washes the red out to salmon). The clear indicator section stays dark.
  const glow = canvas(W, H, (g) => {
    g.fillStyle = '#000000';
    g.fillRect(0, 0, W, H);
    g.save();
    outline(g);
    g.clip();
    red(g);
    g.fillStyle = '#780400';
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
    bg.addColorStop(0, '#d8343a');
    bg.addColorStop(1, '#b61f27');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    box(g, '#f4f4f2');
  });
  const glow = canvas(W, H, (g) => {
    g.fillStyle = '#3a0608';
    g.fillRect(0, 0, W, H);
    box(g, '#3a0608'); // brake light stays red-only: the white box has no brake glow
  });
  const reverseGlow = canvas(W, H, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    box(g, '#ffffff');
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
 * the floors of the recessed barrels drawn by twinLampDepth.
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
  const glow = canvas(W, H, (g) => {
    g.fillStyle = '#000000';
    g.fillRect(0, 0, W, H);
    for (const b of TWIN.bowls) atBowl(g, b, () => ring(g));
  });
  return { map, glow };
}

/**
 * Sets the twin lamp's round lamps back inside the housing (parallax, no extra geometry): the
 * lamp surface is the clear cover, each bowl is a barrel TWIN.depth deep behind it, running along the car's forward axis (+z model). A view ray
 * through a bowl opening either reaches the floor (the bowl art, sampled where the ray lands) or
 * hits the barrel wall (dark chrome, lit from below, darker towards the back), so the housing lip
 * covers part of the lamp from any angle but straight on. The ray is turned into lamp-space
 * steps with the surface gradients of u / v from screen derivatives (the GLB has no tangents).
 */
function twinLampDepth(m: MeshPhysicalMaterial): void {
  const f = (x: number) => x.toFixed(5);
  const bowls = TWIN.bowls
    .map(
      ([u, ru]) =>
        `vec4(${f(u)}, ${f(TWIN.bowlV)}, ${f(ru)}, ${f(TWIN.radius)})`,
    )
    .join(', ');
  m.onBeforeCompile = (shader) => {
    addWorldUniforms(shader);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vLampAxis;',
      )
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvLampAxis = (modelViewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz;',
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
            const float DEPTH = ${f(TWIN.depth)};
            vec4 BOWLS[2] = vec4[2](${bowls}); // centre uv, radius uv
            for (int i = 0; i < 2; i++) {
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
                diffuseColor.rgb *= mix(0.012, 0.3, lit) * mix(1.0, 0.4, z / DEPTH);
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
          totalEmissiveRadiance *= textureGrad(emissiveMap, lampUv, dFdx(vMapUv), dFdy(vMapUv)).rgb * (1.0 - lampWall);
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
    return new MeshPhysicalMaterial({
      map,
      emissive: 0xffffff,
      emissiveMap: glow,
      emissiveIntensity: 0.6,
      roughness: 0.22,
      metalness: 0.12,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
    });
  },
  /** Twin round headlight (E46 style), see twinLampMaps / twinLampDepth - needs `parts.wrap` 'corner'. */
  twinlamp: () => {
    const { map, glow } = twinLampMaps();
    const m = new MeshPhysicalMaterial({
      map,
      emissive: 0xffffff,
      emissiveMap: glow,
      emissiveIntensity: 0.7,
      roughness: 0.18,
      metalness: 0.25,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
    });
    twinLampDepth(m);
    return m;
  },
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
  /** Amber indicator bulb, glowing. */
  amber: () =>
    new MeshPhysicalMaterial({
      color: 0xff9a1a,
      emissive: 0xff7a00,
      emissiveIntensity: 0.55,
      roughness: 0.2,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
    }),
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
      5.5,
      reverseGlow,
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
        emissiveIntensity: 0.4,
        roughness: 0.16,
        metalness: 0,
        transparent: true,
        opacity: 0.8,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
      }),
      5,
      reverseGlow,
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
  /** Modelled headlight LED ring / DRL: warm white, always glowing. */
  headled: () =>
    new MeshPhysicalMaterial({
      color: 0xfff4d6,
      emissive: 0xffe9b0,
      emissiveIntensity: 1.2,
      roughness: 0.3,
      metalness: 0,
    }),
  /** Modelled tail-lamp LED strip: red, idle glow, bright with the brake pedal (setBrake). */
  tailled: () =>
    lamp(
      new MeshPhysicalMaterial({
        color: 0xd01418,
        emissive: 0xff2010,
        emissiveIntensity: 0.35,
        roughness: 0.2,
        metalness: 0.1,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
      }),
      3.2,
    ),
  /** Red see-through cover over a modelled tail lamp. */
  redcover: () =>
    new MeshPhysicalMaterial({
      color: 0xb3151c,
      roughness: 0.03,
      metalness: 0,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      envMapIntensity: 1.5,
    }),
  reflector: () =>
    new MeshPhysicalMaterial({
      color: 0xa30f17,
      roughness: 0.25,
      metalness: 0.3,
      clearcoat: 1,
    }),
};
