import {
  CanvasTexture,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type Material,
} from 'three';

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
  | 'reflector'
  | 'interior';

const cache = new Map<string, Material>();

/** Brake lamp (CarModel.setBrake): emissive from its idle value to `on` with the brake down. */
function lamp(m: MeshPhysicalMaterial, on: number): MeshPhysicalMaterial {
  m.userData.brakeLamp = { off: m.emissiveIntensity, on };
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
 * lid at |x| 0.465, u 0.75 - 1 = the rounded corner onto the side; v 0 = the boot-lid gap at y 0.841, v 1 = the lid's
 * lower edge at y 0.662 - cars/bimmer-m3/DETAILS.md "Tail lamps"): a dark red lens with fine horizontal ribs, the
 * clear reversing section in the inner top corner and two bright red light bars (tail / brake) - the upper one from
 * the reversing section out round the corner, the lower one across the whole lamp.
 */
const TAIL = {
  W: 512,
  H: 128,
  /** Clear reversing lens: u 0 .. reverseU, v reverseV[0] .. reverseV[1]. */
  reverseU: 0.3,
  reverseV: [0.1, 0.52],
  /** Light bars: [u0, u1, v0, v1]. */
  bars: [
    [0.33, 0.985, 0.16, 0.4],
    [0.02, 0.985, 0.62, 0.86],
  ],
};

function tailMaps(): { map: CanvasTexture; glow: CanvasTexture } {
  const { W, H } = TAIL;
  const bars = (g: CanvasRenderingContext2D, fill: string) => {
    g.fillStyle = fill;
    for (const [u0, u1, v0, v1] of TAIL.bars)
      g.fillRect(u0 * W, v0 * H, (u1 - u0) * W, (v1 - v0) * H);
  };
  const map = canvas(W, H, (g) => {
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#a3121b');
    bg.addColorStop(1, '#6e0a10');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    bars(g, '#ff3b30');
    // Clear reversing lens over a chrome reflector.
    const [r0, r1] = TAIL.reverseV;
    const rev = g.createLinearGradient(0, r0 * H, 0, r1 * H);
    rev.addColorStop(0, '#f2f4f6');
    rev.addColorStop(1, '#b9c0c8');
    g.fillStyle = rev;
    g.fillRect(0, r0 * H, TAIL.reverseU * W, (r1 - r0) * H);
    // Horizontal optic ribs across the whole lens.
    g.strokeStyle = 'rgba(0, 0, 0, 0.22)';
    g.lineWidth = 1;
    for (let y = 3; y < H; y += 5) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
    }
  });
  const glow = canvas(W, H, (g) => {
    g.fillStyle = '#1a0203';
    g.fillRect(0, 0, W, H);
    bars(g, '#ff2a1c');
  });
  return { map, glow };
}

/**
 * Fabia R5 tail lamp. The 'corner' wrap fits u / v over BOTH the lamp and the third brake light above it, so each lamp
 * only covers u 0.18 - 0.99, v 0.63 - 1 of the texture. The lamp mesh is a raised U-shaped ridge (opening towards the
 * car's centre) round a recessed box (u 0.37 - 0.82, v 0.715 - 0.875); the white reversing light is the small
 * parallelogram the user traced in the middle of the U on a screenshot (2026-10-04): the traced pixels were mapped to the
 * mesh by calibrating the camera on the recessed box's four corner vertices and ray-casting the traced corners onto the
 * lamp triangles (u, v = 0.704, 0.755 / 0.349, 0.762 / 0.29, 0.866 / 0.662, 0.866). Everything else is a light red lens.
 */
function tailCMaps(): { map: CanvasTexture; glow: CanvasTexture } {
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
    box(g, '#9a9a9a');
  });
  return { map, glow };
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
    const { map, glow } = tailMaps();
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
    );
  },
  /** Modelled cockpit of an imported body (seats, cage, dash, door cards): dark, matte - without it the cockpit got the livery. */
  interior: () => new MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.9 }),
  /** Fabia R5 tail lamp: even red lens + white reversing square, see tailCMaps - needs `parts.wrap` 'corner'. */
  tailc: () => {
    const { map, glow } = tailCMaps();
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
    );
  },
  reflector: () =>
    new MeshPhysicalMaterial({
      color: 0xa30f17,
      roughness: 0.25,
      metalness: 0.3,
      clearcoat: 1,
    }),
};
