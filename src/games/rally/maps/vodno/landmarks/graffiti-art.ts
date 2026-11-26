/**
 * The graffiti on the retaining wall at 300-380 m (graffiti-wall.ts), drawn into one atlas: four rows of 1.5 m pieces
 * and a 3 m mural, 12 m of wall to a row at the atlas's 2048 x 1536 px (170 px a metre). Row 0: the game's wordmark as a wildstyle piece
 * in yellow, orange and gravel browns over tyre tracks; row 1: "СКОПЈЕ" in bubble letters (the city only ever in Cyrillic) and "СК" in sharp hand-cut letters; row 2: "Скопје е мој град!"
 * in bold slanted letters; row 4: a painted mural of the Stone Bridge (`mural`); row 5: MK in the flag's red and yellow; row 3: "SKOPYEAH!" coloured like beer overflowing and a small throw-up of the wordmark. Spray-paint looks from the drawing alone
 * (outlines grown round each letter mask, extrusions, fades, drips, overspray, the concrete showing through), so the
 * system fonts only give the letter shapes. No DOM or three.js here: the landmark wraps it in a texture.
 */
type Ctx = CanvasRenderingContext2D;
type Canvas = HTMLCanvasElement;

export const ATLAS_W = 2048;
export const ATLAS_H = 1792;
/** One row of the atlas: 256 px, 1.5 m of wall. */
export const ROW_PX = 256;
/** The mural under the four rows: 2048 x 512 px, 12 x 3 m. */
export const MURAL_Y = 1024;
export const MURAL_PX = 512;
/** Row 5 under the mural: the MK flag piece (left half). */
export const ROW5_Y = 1536;

/** The brand colours (STYLEGUIDE.md): accent amber, ink, cream text; the logo pieces add gravel browns. */
const AMBER = '#f0a020';
const INK = '#0e0d0b';
const CREAM = '#f4f1ea';
const BROWN = '#6b3e1c';
const DARK_BROWN = '#3a210e';
const RUBBER = '#1c1712';

/** A seeded random stream (the art is the same every load). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): Canvas {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** `mask` (any colour, alpha = the letters) recoloured `fill` (a colour or gradient). */
function tint(mask: Canvas, fill: string | CanvasGradient): Canvas {
  const c = canvas(mask.width, mask.height);
  const g = c.getContext('2d')!;
  g.drawImage(mask, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = fill;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

/** The mask grown by `r` px (stamped round a circle), recoloured. */
function grown(mask: Canvas, r: number, fill: string): Canvas {
  const c = canvas(mask.width, mask.height);
  const g = c.getContext('2d')!;
  const n = Math.max(12, Math.round(r * 1.5));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    g.drawImage(mask, Math.cos(a) * r, Math.sin(a) * r);
  }
  g.drawImage(mask, 0, 0);
  return tint(c, fill);
}

/** A 3D block under the letters: the mask stepped `len` px along (dx, dy), recoloured. */
function extrude(
  mask: Canvas,
  dx: number,
  dy: number,
  len: number,
  fill: string,
): Canvas {
  const c = canvas(mask.width, mask.height);
  const g = c.getContext('2d')!;
  for (let i = 1; i <= len; i++) g.drawImage(mask, dx * i, dy * i);
  return tint(c, fill);
}

/** Paint runs: from the letters' lower edges, thin streaks with a round drop at their end. */
function drips(
  g: Ctx,
  mask: Canvas,
  color: string,
  count: number,
  r: () => number,
): void {
  const m = mask.getContext('2d')!.getImageData(0, 0, mask.width, mask.height);
  const lowest = (x: number): number => {
    for (let y = mask.height - 1; y >= 0; y--)
      if (m.data[(y * mask.width + x) * 4 + 3] > 128) return y;
    return -1;
  };
  g.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const x = Math.floor(mask.width * (0.08 + 0.84 * r()));
    const y = lowest(x);
    if (y < 0) continue;
    const len = 8 + r() * 34;
    const w = 2 + r() * 3;
    g.fillRect(x - w / 2, y - 2, w, len);
    g.beginPath();
    g.arc(x, y + len, w * 0.9, 0, Math.PI * 2);
    g.fill();
  }
}

/** Concrete showing through worn paint: specks rubbed out of a finished piece. */
function wear(c: Canvas, amount: number, r: () => number): void {
  const g = c.getContext('2d')!;
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < amount; i++) {
    g.globalAlpha = 0.25 + r() * 0.6;
    const s = 1 + r() * 3.5;
    g.fillRect(r() * c.width, r() * c.height, s, s);
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
}

/** Letters `text` in `font` as a mask, each letter turned, raised and scaled a little (hand-painted, not typeset). */
function letters(
  w: number,
  h: number,
  text: string,
  font: string,
  o: {
    jitter?: number;
    turn?: number;
    overlap?: number;
    skew?: number;
    seed?: number;
  } = {},
): Canvas {
  const c = canvas(w, h);
  const g = c.getContext('2d')!;
  const r = rng(o.seed ?? 1);
  g.font = font;
  g.textBaseline = 'middle';
  g.fillStyle = '#fff';
  const chars = [...text];
  const widths = chars.map((ch) => g.measureText(ch).width);
  const overlap = o.overlap ?? 0;
  const total =
    widths.reduce((s, x) => s + x, 0) - overlap * (chars.length - 1);
  // Shrink the font to fit 90 % of the cell.
  const k = Math.min(1, (w * 0.9) / total);
  let x = (w - total * k) / 2;
  g.setTransform(1, 0, -(o.skew ?? 0), 1, 0, 0);
  chars.forEach((ch, i) => {
    const jy = ((r() - 0.5) * (o.jitter ?? 0) * h) / 2;
    const turn = (r() - 0.5) * (o.turn ?? 0);
    const s = k * (1 + (r() - 0.5) * (o.jitter ?? 0) * 0.5);
    g.save();
    g.translate(x + (widths[i] * k) / 2 + (o.skew ?? 0) * h * 0.5, h / 2 + jy);
    g.rotate(turn);
    g.scale(s, s);
    g.textAlign = 'center';
    g.fillText(ch, 0, 0);
    g.restore();
    x += (widths[i] - overlap) * k;
  });
  return c;
}

/** The wordmark (a white-on-clear image) fitted into a w x h mask, `pad` px clear round it. */
function wordmark(
  logo: CanvasImageSource,
  aspect: number,
  w: number,
  h: number,
  pad: number,
): Canvas {
  const c = canvas(w, h);
  const g = c.getContext('2d')!;
  const bw = w - 2 * pad;
  const bh = h - 2 * pad;
  const lw = Math.min(bw, bh * aspect);
  const lh = lw / aspect;
  g.drawImage(logo, (w - lw) / 2, (h - lh) / 2, lw, lh);
  return c;
}

/**
 * The layers of a piece over its letter mask, bottom up: an outer line, a background cloud, the 3D block, an inner
 * outline, the fill (a gradient), highlights clipped to the letters, drips, wear. Drawn onto `g` at (x, y).
 */
function piece(
  g: Ctx,
  mask: Canvas,
  x: number,
  y: number,
  s: {
    outer?: [number, string];
    cloud?: [number, string];
    block?: [number, number, number, string];
    line: [number, string];
    fill: [string, string, string?];
    shine?: string;
    drips?: [string, number];
    wear: number;
    seed: number;
  },
): void {
  const r = rng(s.seed);
  const c = canvas(mask.width, mask.height);
  const p = c.getContext('2d')!;
  if (s.outer && s.cloud)
    p.drawImage(grown(mask, s.cloud[0] + s.outer[0], s.outer[1]), 0, 0);
  if (s.cloud) p.drawImage(grown(mask, s.cloud[0], s.cloud[1]), 0, 0);
  if (s.block) {
    const [dx, dy, len, col] = s.block;
    const lined = grown(mask, s.line[0], s.line[1]);
    p.drawImage(extrude(lined, dx, dy, len, col), 0, 0);
    p.drawImage(extrude(lined, dx, dy, len, s.line[1]), dx, dy);
    p.drawImage(extrude(lined, dx, dy, len - 1, col), 0, 0);
  }
  p.drawImage(grown(mask, s.line[0], s.line[1]), 0, 0);
  const grad = p.createLinearGradient(0, 0, 0, mask.height);
  grad.addColorStop(0, s.fill[0]);
  grad.addColorStop(0.55, s.fill[1]);
  grad.addColorStop(1, s.fill[2] ?? s.fill[1]);
  const body = tint(mask, grad);
  if (s.shine) {
    // A bright stripe across the top third of the letters and a few spray spots, clipped to them.
    const b = body.getContext('2d')!;
    b.globalCompositeOperation = 'source-atop';
    b.fillStyle = s.shine;
    b.globalAlpha = 0.55;
    b.beginPath();
    b.moveTo(0, mask.height * 0.3);
    for (let i = 0; i <= 24; i++)
      b.lineTo(
        (mask.width * i) / 24,
        mask.height * (0.33 + 0.05 * Math.sin(i * 1.7 + s.seed)),
      );
    b.lineTo(mask.width, mask.height * 0.39);
    for (let i = 24; i >= 0; i--)
      b.lineTo(
        (mask.width * i) / 24,
        mask.height * (0.39 + 0.04 * Math.sin(i * 1.3)),
      );
    b.closePath();
    b.fill();
    b.globalAlpha = 0.9;
    for (let i = 0; i < 26; i++) {
      b.beginPath();
      b.arc(
        r() * mask.width,
        mask.height * (0.2 + r() * 0.6),
        2 + r() * 5,
        0,
        Math.PI * 2,
      );
      b.fill();
    }
    b.globalAlpha = 1;
  }
  p.drawImage(body, 0, 0);
  if (s.drips) drips(p, mask, s.drips[0], s.drips[1], r);
  wear(c, s.wear, r);
  // Overspray: a faint soft copy of the whole piece under it.
  g.save();
  g.filter = 'blur(3px)';
  g.globalAlpha = 0.35;
  g.drawImage(c, x, y);
  g.restore();
  g.drawImage(c, x, y);
}

/** A soft spray haze behind a piece: blurred blobs of `color`. */
function haze(
  g: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  seed: number,
): void {
  const r = rng(seed);
  g.save();
  g.filter = 'blur(14px)';
  g.fillStyle = color;
  for (let i = 0; i < 9; i++) {
    g.globalAlpha = 0.25 + r() * 0.25;
    g.beginPath();
    g.ellipse(
      x + w * (0.1 + 0.8 * r()),
      y + h * (0.35 + 0.3 * r()),
      w * (0.12 + 0.12 * r()),
      h * (0.22 + 0.12 * r()),
      0,
      0,
      Math.PI * 2,
    );
    g.fill();
  }
  g.restore();
}

/**
 * A pair of tyre tracks sprayed along the cubic curve p0..p3 (the marks of a slide) or a polyline: two bands `w` px wide, `gap` px
 * apart, their tread cut out in slanted blocks, worn at the edges.
 */
function tyreTracks(
  g: Ctx,
  path:
    | [number, number, number, number, number, number, number, number]
    | [number, number][],
  w: number,
  gap: number,
  color: string,
  seed: number,
): void {
  const N = 160;
  let pt: [number, number][];
  if (typeof path[0] === 'number') {
    const [x0, y0, x1, y1, x2, y2, x3, y3] = path as number[];
    pt = Array.from({ length: N + 1 }, (_, i) => {
      const t = i / N;
      const u = 1 - t;
      return [
        u * u * u * x0 +
          3 * u * u * t * x1 +
          3 * u * t * t * x2 +
          t * t * t * x3,
        u * u * u * y0 +
          3 * u * u * t * y1 +
          3 * u * t * t * y2 +
          t * t * t * y3,
      ] as [number, number];
    });
  } else pt = path as [number, number][];
  const M = pt.length - 1;
  const c = canvas(ATLAS_W, ROW_PX);
  const p = c.getContext('2d')!;
  const nrm = pt.map((_, i) => {
    const a = pt[Math.max(0, i - 1)];
    const b = pt[Math.min(M, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l] as [number, number];
  });
  p.strokeStyle = color;
  p.lineWidth = w;
  p.lineCap = 'butt';
  for (const side of [-1, 1]) {
    p.beginPath();
    pt.forEach(([x, y], i) => {
      const ox = x + nrm[i][0] * side * gap * 0.5;
      const oy = y + nrm[i][1] * side * gap * 0.5;
      if (i) p.lineTo(ox, oy);
      else p.moveTo(ox, oy);
    });
    p.stroke();
  }
  // Tread: slanted blocks cut across each band every few px, a groove down its middle.
  p.globalCompositeOperation = 'destination-out';
  p.lineWidth = 3;
  let run = 0;
  for (let i = 1; i <= M; i++) {
    run += Math.hypot(pt[i][0] - pt[i - 1][0], pt[i][1] - pt[i - 1][1]);
    if (run < w * 0.55) continue;
    run = 0;
    const [nx, ny] = nrm[i];
    const [tx, ty] = [ny, -nx];
    for (const side of [-1, 1]) {
      const cx = pt[i][0] + nx * side * gap * 0.5;
      const cy = pt[i][1] + ny * side * gap * 0.5;
      p.beginPath();
      p.moveTo(
        cx - nx * w * 0.5 - tx * w * 0.2,
        cy - ny * w * 0.5 - ty * w * 0.2,
      );
      p.lineTo(cx - nx * w * 0.08, cy - ny * w * 0.08);
      p.moveTo(cx + nx * w * 0.08, cy + ny * w * 0.08);
      p.lineTo(
        cx + nx * w * 0.5 - tx * w * 0.2,
        cy + ny * w * 0.5 - ty * w * 0.2,
      );
      p.stroke();
    }
  }
  p.globalCompositeOperation = 'source-over';
  wear(c, 2600, rng(seed));
  g.save();
  g.globalAlpha = 0.85;
  g.drawImage(c, 0, 0);
  g.restore();
}

/** Sans stacks with Cyrillic on every platform's default fonts. */
const HEAVY =
  '"Arial Black", "Segoe UI Black", Impact, "Inter Black", "DejaVu Sans", system-ui, sans-serif';
/**
 * Upright letters only, slanted by `letters`' skew: italic fonts switch Cyrillic to its handwritten italic forms (г, д,
 * т, и, п) that do not read as Macedonian lettering on a wall.
 */
const BOLD =
  '"Segoe UI", Arial, Roboto, "Helvetica Neue", "DejaVu Sans", sans-serif';

/**
 * A painted edge: the rectangle inset `pad` px with round corners, its border wandering a few px and softly blurred,
 * the top corners faded out so the sky blends into the wall.
 */
function raggedMask(w: number, h: number, pad: number, seed: number): Canvas {
  const r = rng(seed);
  const c = canvas(w, h);
  const g = c.getContext('2d')!;
  const pts: [number, number][] = [];
  const j = (): number => (r() - 0.5) * 14;
  // Round the corners: top ones wide (sky), bottom ones tighter (water).
  const corner = (cx: number, cy: number, rad: number, a0: number): void => {
    for (let k = 0; k <= 8; k++) {
      const a = a0 + (k / 8) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * rad + j(), cy + Math.sin(a) * rad + j()]);
    }
  };
  const RT = 150;
  const RB = 60;
  const step = 18;
  corner(pad + RT, pad + RT, RT, Math.PI);
  for (let x = pad + RT; x < w - pad - RT; x += step) pts.push([x, pad + j()]);
  corner(w - pad - RT, pad + RT, RT, -Math.PI / 2);
  for (let y = pad + RT; y < h - pad - RB; y += step)
    pts.push([w - pad + j(), y]);
  corner(w - pad - RB, h - pad - RB, RB, 0);
  for (let x = w - pad - RB; x > pad + RB; x -= step)
    pts.push([x, h - pad + j()]);
  corner(pad + RB, h - pad - RB, RB, Math.PI / 2);
  for (let y = h - pad - RB; y > pad + RT; y -= step) pts.push([pad + j(), y]);
  g.filter = 'blur(7px)';
  g.fillStyle = '#fff';
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.fill();
  g.filter = 'none';
  // Fade the sky out towards the top corners and along the top edge, like overspray thinning out.
  g.globalCompositeOperation = 'destination-out';
  for (const cx of [0, w]) {
    const f = g.createRadialGradient(cx, 0, 0, cx, 0, 420);
    f.addColorStop(0, 'rgba(0,0,0,1)');
    f.addColorStop(0.45, 'rgba(0,0,0,0.55)');
    f.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = f;
    g.fillRect(0, 0, w, h);
  }
  const top = g.createLinearGradient(0, 0, 0, 90);
  top.addColorStop(0, 'rgba(0,0,0,0.85)');
  top.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = top;
  g.fillRect(0, 0, w, 90);
  for (const x of [0, w]) {
    const side = g.createLinearGradient(x, 0, x ? x - 70 : 70, 0);
    side.addColorStop(0, 'rgba(0,0,0,0.7)');
    side.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = side;
    g.fillRect(x ? x - 70 : 0, 0, 70, h * 0.75);
  }
  return c;
}

/** A closed shape from points, filled and outlined the way a mural painter lines a shape. */
function shape(
  g: Ctx,
  pts: [number, number][],
  fill: string | CanvasGradient,
  line?: string,
): void {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  if (line) {
    g.strokeStyle = line;
    g.lineWidth = 2.5;
    g.globalAlpha = 0.7;
    g.stroke();
    g.globalAlpha = 1;
  }
}

/**
 * The mural: the Stone Bridge over the Vardar at sunset, the fortress walls of Kale on their hill to the left, Vodno
 * with its cross behind. Flat painted colours with the painter's dark
 * lines, brush strokes over everything, a ragged sprayed edge and the concrete showing through. Drawn at (0, oy).
 */
function mural(ctx: Ctx, oy: number): void {
  const W = ATLAS_W;
  const H = MURAL_PX;
  const c = canvas(W, H);
  const g = c.getContext('2d')!;
  const r = rng(41);
  const LINE = '#3a2a1a';
  const WATER = 410;

  // Sky: warm sunset, the sun low on the right with its glow.
  const sky = g.createLinearGradient(0, 0, 0, WATER);
  sky.addColorStop(0, '#e9853a');
  sky.addColorStop(0.45, '#f6bd6a');
  sky.addColorStop(1, '#fbe3b0');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, WATER);
  const glow = g.createRadialGradient(1470, 235, 10, 1470, 235, 260);
  glow.addColorStop(0, 'rgba(255,246,214,0.95)');
  glow.addColorStop(0.25, 'rgba(255,236,180,0.6)');
  glow.addColorStop(1, 'rgba(255,220,150,0)');
  g.fillStyle = glow;
  g.fillRect(1110, 0, 760, WATER);
  g.fillStyle = '#fff4d6';
  g.beginPath();
  g.arc(1470, 235, 58, 0, Math.PI * 2);
  g.fill();
  // Long brushy clouds.
  g.strokeStyle = '#fff0d0';
  g.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    const y = 40 + r() * 160;
    const x = r() * W;
    g.globalAlpha = 0.35 + r() * 0.25;
    g.lineWidth = 6 + r() * 10;
    g.beginPath();
    g.moveTo(x, y);
    g.bezierCurveTo(
      x + 120,
      y - 10,
      x + 260,
      y + 8,
      x + 360 + r() * 200,
      y - 4,
    );
    g.stroke();
  }
  g.globalAlpha = 1;

  // Vodno behind, long and low, the Millennium Cross on its top.
  const vodno: [number, number][] = [[760, WATER]];
  for (let x = 760; x <= W; x += 32) {
    const t = (x - 760) / (W - 760);
    vodno.push([
      x,
      // a long ridge rising to the top well right of the letters
      300 -
        60 * Math.sin(Math.PI * t) -
        95 * Math.exp(-(((x - 1720) / 300) ** 2)) +
        (r() - 0.5) * 6,
    ]);
  }
  vodno.push([W, WATER]);
  const hill = g.createLinearGradient(0, 140, 0, WATER);
  hill.addColorStop(0, '#8c8a6c');
  hill.addColorStop(1, '#5d6b4c');
  shape(g, vodno, hill, LINE);
  const peak = vodno.reduce((a, b) => (b[1] < a[1] ? b : a));
  g.fillStyle = '#f4f1ea';
  g.fillRect(peak[0] - 3, peak[1] - 62, 6, 64);
  g.fillRect(peak[0] - 20, peak[1] - 48, 40, 6);
  g.strokeStyle = LINE;
  g.lineWidth = 1.5;
  g.strokeRect(peak[0] - 3, peak[1] - 62, 6, 64);
  g.strokeRect(peak[0] - 20, peak[1] - 48, 40, 6);

  // Kale: its hill on the left, the stone walls along the top with square towers and battlements.
  const kale: [number, number][] = [
    [0, WATER],
    [0, 226],
    [140, 216],
    [330, 206],
    [520, 214],
    [640, 236],
    [740, 282],
    [820, WATER],
  ];
  const wallTop = (x: number): number =>
    214 - 14 * Math.sin((Math.PI * x) / 620);
  g.fillStyle = '#d2a868';
  g.strokeStyle = LINE;
  g.lineWidth = 2;
  for (let x = 30; x < 600; x += 6) {
    const y = wallTop(x);
    g.fillRect(x, y - 26, 7, 70);
  }
  for (let x = 30; x < 600; x += 16) {
    const y = wallTop(x);
    g.fillRect(x, y - 34, 9, 9);
  }
  for (const tx of [60, 250, 440, 580]) {
    const y = wallTop(tx);
    g.fillStyle = '#c89a5a';
    g.fillRect(tx - 22, y - 62, 44, 106);
    for (let k = 0; k < 4; k++) g.fillRect(tx - 22 + k * 12, y - 72, 8, 10);
    g.strokeRect(tx - 22, y - 62, 44, 106);
    g.fillStyle = '#3d2b1a';
    g.fillRect(tx - 3, y - 48, 6, 12);
    g.fillStyle = '#d2a868';
  }
  // The hill over the walls' feet: they stand behind its crest.
  shape(g, kale, '#8a7a4e', LINE);
  // Trees on the far bank.
  for (let x = 0; x < W; x += 14 + r() * 20) {
    g.fillStyle = r() < 0.5 ? '#3f5a34' : '#4d6b3b';
    g.beginPath();
    g.ellipse(
      x,
      WATER - 8 - r() * 6,
      16 + r() * 18,
      12 + r() * 10,
      0,
      0,
      Math.PI * 2,
    );
    g.fill();
  }

  // The Vardar: green water with light ripples.
  const water = g.createLinearGradient(0, WATER, 0, H);
  water.addColorStop(0, '#5f9483');
  water.addColorStop(1, '#2c5a52');
  g.fillStyle = water;
  g.fillRect(0, WATER, W, H - WATER);

  // The Stone Bridge (after its shape: a long deck rising to the guard tower right of the middle, small arches over the
  // banks, big round ones over the river on piers with cutwater blocks). Laid out in a reference frame 60..1690 wide.
  const X0 = 150;
  const X1 = 1900;
  const RX = (x: number): number => X0 + ((x - 60) * (X1 - X0)) / 1630;
  const K = (X1 - X0) / 1630;
  const DECK: [number, number][] = [
    [RX(60), 300],
    [RX(850), 252],
    [RX(1255), 222],
    [RX(1690), 266],
  ];
  const top = (x: number): number => {
    let i = 0;
    while (i + 2 < DECK.length && x > DECK[i + 1][0]) i++;
    const [[xa, ya], [xb, yb]] = [DECK[i], DECK[i + 1]];
    const t = Math.min(1, Math.max(0, (x - xa) / (xb - xa)));
    return ya + (yb - ya) * (0.5 - 0.5 * Math.cos(Math.PI * t));
  };
  const arches = (
    [
      [105, 70],
      [190, 75],
      [300, 115],
      [465, 160],
      [705, 180],
      [915, 180],
      [1130, 180],
      [1378, 175],
      [1540, 120],
    ] as const
  ).map(([cx, w]) => {
    const x = RX(cx);
    const rad = (w * K) / 2;
    return { x, rad, spring: top(x) + 14 + rad * 1.08 };
  });
  const bridge = canvas(W, H);
  const b = bridge.getContext('2d')!;
  b.beginPath();
  b.moveTo(X0 - 24, WATER + 6);
  for (let x = X0 - 24; x <= X1 + 24; x += 10)
    b.lineTo(x, top(Math.min(X1, Math.max(X0, x))));
  b.lineTo(X1 + 24, WATER + 6);
  b.closePath();
  b.fillStyle = '#d6c198';
  b.fill();
  // Courses and joints, clipped to the stone.
  b.save();
  b.clip();
  b.strokeStyle = '#a58c60';
  b.lineWidth = 1.2;
  b.globalAlpha = 0.6;
  for (let y = 210; y < WATER + 6; y += 9) {
    b.beginPath();
    b.moveTo(0, y);
    b.lineTo(W, y);
    b.stroke();
    for (let x = ((y / 9) % 2) * 11; x < W; x += 22 + r() * 6) {
      b.beginPath();
      b.moveTo(x, y);
      b.lineTo(x, y + 9);
      b.stroke();
    }
  }
  for (let i = 0; i < 500; i++) {
    b.fillStyle = r() < 0.5 ? '#c4ad80' : '#e2d0aa';
    b.globalAlpha = 0.5;
    b.fillRect(r() * W, 210 + r() * 200, 10 + r() * 12, 8);
  }
  b.restore();
  b.globalAlpha = 1;
  // The arches: a ring of voussoirs, then the dark opening, its jambs straight down to the water.
  for (const { x: ax, rad, spring } of arches) {
    const ring = 6 + rad * 0.1;
    b.fillStyle = '#b89d6c';
    b.beginPath();
    b.arc(ax, spring, rad + ring, Math.PI, 0);
    b.lineTo(ax + rad + ring, WATER + 6);
    b.lineTo(ax - rad - ring, WATER + 6);
    b.closePath();
    b.fill();
    b.strokeStyle = '#7d6640';
    b.lineWidth = 1.5;
    const n = Math.round(rad / 5);
    for (let k = 0; k <= n; k++) {
      const a = Math.PI + (Math.PI * k) / n;
      b.beginPath();
      b.moveTo(ax + Math.cos(a) * rad, spring + Math.sin(a) * rad);
      b.lineTo(
        ax + Math.cos(a) * (rad + ring),
        spring + Math.sin(a) * (rad + ring),
      );
      b.stroke();
    }
    const hole = b.createLinearGradient(0, spring - rad, 0, WATER + 6);
    hole.addColorStop(0, '#1f2b25');
    hole.addColorStop(0.7, '#2f4a40');
    hole.addColorStop(1, '#3f6d60');
    b.fillStyle = hole;
    b.beginPath();
    b.arc(ax, spring, rad, Math.PI, 0);
    b.lineTo(ax + rad, WATER + 6);
    b.lineTo(ax - rad, WATER + 6);
    b.closePath();
    b.fill();
    b.strokeStyle = LINE;
    b.lineWidth = 2;
    b.stroke();
  }
  // Cutwater blocks in front of the river piers: a block with a sloped cap on a wider plinth.
  const block = (cx: number, w: number, y0: number): void => {
    const x = RX(cx);
    const hw = (w * K) / 2;
    const body: [number, number][] = [
      [x - hw, WATER + 2],
      [x - hw, y0 + 14],
      [x - hw * 0.62, y0],
      [x + hw * 0.62, y0],
      [x + hw, y0 + 14],
      [x + hw, WATER + 2],
    ];
    shape(b, body, '#dccaa4', LINE);
    b.fillStyle = 'rgba(90,70,40,0.18)';
    b.fillRect(x + hw * 0.35, y0 + 14, hw * 0.65, WATER + 2 - y0 - 14);
    shape(
      b,
      [
        [x - hw - 7, WATER + 8],
        [x - hw - 7, WATER - 6],
        [x + hw + 7, WATER - 6],
        [x + hw + 7, WATER + 8],
      ],
      '#cdb98f',
      LINE,
    );
  };
  for (const [cx, w] of [
    [580, 100],
    [812, 85],
    [1025, 90],
    [1470, 55],
  ] as const) {
    const near = arches.filter((a) => Math.abs(a.x - RX(cx)) < 150 * K);
    block(cx, w, Math.min(...near.map((a) => a.spring)) - 4);
  }
  // The guard tower over the pier right of the middle: its face down to the water, a small kiosk over the deck.
  const T0 = RX(1220);
  const T1 = RX(1290);
  const ty = top((T0 + T1) / 2) - 26;
  shape(
    b,
    [
      [T0, WATER + 4],
      [T0, ty],
      [T1, ty],
      [T1, WATER + 4],
    ],
    '#e0cfa8',
    LINE,
  );
  b.fillStyle = 'rgba(90,70,40,0.18)';
  b.fillRect(T1 - 16, ty, 16, WATER + 4 - ty);
  const k0 = (T0 + T1) / 2 - 17;
  const k1 = (T0 + T1) / 2 + 17;
  shape(
    b,
    [
      [k0, ty],
      [k0, ty - 34],
      [k1, ty - 34],
      [k1, ty],
    ],
    '#e6d7b3',
    LINE,
  );
  shape(
    b,
    [
      [k0 - 5, ty - 34],
      [(k0 + k1) / 2, ty - 48],
      [k1 + 5, ty - 34],
    ],
    '#b89d6c',
    LINE,
  );
  // Parapet band and the painter's line along the deck.
  b.fillStyle = '#bfa575';
  b.beginPath();
  for (let x = X0; x <= X1; x += 10) b.lineTo(x, top(x) - 1);
  for (let x = X1; x >= X0; x -= 10) b.lineTo(x, top(x) + 12);
  b.closePath();
  b.fill();
  b.strokeStyle = LINE;
  b.lineWidth = 2.5;
  b.beginPath();
  for (let x = X0; x <= X1; x += 10) b.lineTo(x, top(x));
  b.stroke();
  // Lamps along the parapet.
  for (let i = 0; i < 7; i++) {
    const x = X0 + 120 + i * ((X1 - X0 - 240) / 6);
    if (x > T0 - 30 && x < T1 + 30) continue;
    const y = top(x);
    b.fillStyle = '#2a2420';
    b.fillRect(x - 2, y - 40, 4, 40);
    b.fillRect(x - 9, y - 36, 18, 3);
    b.fillStyle = '#fff3c4';
    for (const dx of [-9, 9, 0]) {
      b.beginPath();
      b.arc(x + dx, dx ? y - 38 : y - 46, 5, 0, Math.PI * 2);
      b.fill();
    }
  }
  // Its reflection: flipped about the water line, rippled, dark and faint.
  for (let y = 0; y < H - WATER; y += 3) {
    const sy = WATER + 6 - y;
    if (sy < 150) break;
    const dx = Math.sin(y * 0.35) * (2 + y * 0.06);
    g.globalAlpha = 0.38 * (1 - y / (H - WATER));
    g.drawImage(bridge, 0, sy - 3, W, 3, dx, WATER + y, W, 3);
  }
  g.globalAlpha = 1;
  g.drawImage(bridge, 0, 0);
  // Ripples over the water and the reflection.
  g.strokeStyle = '#a9d0bf';
  for (let i = 0; i < 160; i++) {
    const y = WATER + 10 + r() * (H - WATER - 20);
    const x = r() * W;
    g.globalAlpha = 0.25 + r() * 0.35;
    g.lineWidth = 1.5 + r() * 2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 20 + r() * 60, y);
    g.stroke();
  }
  g.globalAlpha = 1;

  // Brush strokes over everything (painted, not printed), then the ragged edge, a few runs and wear.
  g.save();
  g.globalCompositeOperation = 'source-atop';
  g.lineCap = 'round';
  for (let i = 0; i < 1400; i++) {
    const x = r() * W;
    const y = r() * H;
    const a = (r() - 0.5) * 0.8;
    const l = 8 + r() * 26;
    g.strokeStyle = r() < 0.5 ? '#ffffff' : '#000000';
    g.globalAlpha = 0.03 + r() * 0.03;
    g.lineWidth = 2 + r() * 3;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  g.restore();
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(raggedMask(W, H, 14, 44), 0, 0);
  g.globalCompositeOperation = 'source-over';
  wear(c, 900, rng(45));
  ctx.drawImage(c, 0, oy);
}

/**
 * Draws the atlas. `logo` = the wordmark image (white on clear, `aspect` = its width / height); without it the logo
 * pieces are left out (it is drawn again once it loads).
 */
export function drawGraffiti(
  ctx: Ctx,
  logo: CanvasImageSource | null,
  aspect: number,
): void {
  ctx.clearRect(0, 0, ATLAS_W, ATLAS_H);
  const R = ROW_PX;
  // Row 0: the wordmark, wildstyle: yellow to orange letters, cream shine, brown block and cloud, ink lines, over the
  // tyre tracks of a slide across the wall.
  if (logo) {
    const m = wordmark(logo, aspect, 1900, R, 34);
    haze(ctx, 300, 0, 1450, R, '#c9822f', 21);
    tyreTracks(
      ctx,
      [40, 236, 520, 150, 1300, 250, 2010, 70],
      22,
      38,
      RUBBER,
      22,
    );
    // A donut spun under the middle of it (behind the letters): one and a half wide loops, drifting as the car turns.
    const loops: [number, number][] = [];
    for (let i = 0; i <= 260; i++) {
      const t = (i / 260) * 1.5;
      const a = Math.PI * 2 * t - Math.PI / 2;
      loops.push([
        990 + t * 40 + Math.cos(a) * 230,
        132 + Math.sin(a) * (88 - t * 6),
      ]);
    }
    tyreTracks(ctx, loops, 18, 30, RUBBER, 23);
    piece(ctx, m, 74, 0, {
      outer: [5, INK],
      cloud: [16, BROWN],
      block: [1, 1, 14, DARK_BROWN],
      line: [5, INK],
      fill: ['#ffd84a', AMBER, '#d9780c'],
      shine: CREAM,
      drips: [AMBER, 9],
      wear: 1800,
      seed: 11,
    });
  }
  haze(ctx, 120, R, 780, R, '#ffd84d', 31);
  // Row 1, left: СКОПЈЕ in fat bubble letters, overlapping, pink to orange, white line, ink outer.
  piece(
    ctx,
    letters(1024, R, 'СКОПЈЕ', `900 200px ${HEAVY}`, {
      jitter: 0.25,
      turn: 0.35,
      overlap: 26,
      seed: 3,
    }),
    0,
    R,
    {
      outer: [4, INK],
      cloud: [10, CREAM],
      line: [5, INK],
      fill: ['#ff6fb5', '#ff4d6d', '#ff9f43'],
      shine: '#ffffff',
      drips: ['#ff4d6d', 6],
      wear: 900,
      seed: 4,
    },
  );
  // Row 1, right: СК in sharp hand-cut letters: angular chiselled shapes ending in spikes, a mint to turquoise fade, an
  // ink line with white and pink edges, an emerald block, cracks through the paint, a purple haze behind.
  {
    const C_SHAPE: [number, number][] = [
      [262, 0],
      [205, 58],
      [150, 50],
      [104, 66],
      [90, 112],
      [104, 156],
      [150, 168],
      [196, 146],
      [276, 226],
      [196, 214],
      [122, 226],
      [48, 206],
      [14, 150],
      [-22, 140],
      [10, 112],
      [24, 52],
      [-4, 20],
      [70, 22],
      [110, 2],
      [182, 14],
    ];
    const K_SHAPE: [number, number][] = [
      [-6, 6],
      [94, 8],
      [92, 88],
      [182, 16],
      [270, -4],
      [236, 54],
      [150, 108],
      [212, 156],
      [284, 232],
      [196, 218],
      [96, 140],
      [94, 196],
      [126, 232],
      [26, 222],
      [34, 170],
      [16, 120],
      [32, 60],
    ];
    const m = canvas(1024, R);
    const mg = m.getContext('2d')!;
    mg.fillStyle = '#fff';
    const glyph = (
      pts: [number, number][],
      x: number,
      y: number,
      turn: number,
    ): void => {
      mg.save();
      mg.translate(x + 130, y + 112);
      mg.rotate(turn);
      mg.scale(0.8, 0.8);
      mg.beginPath();
      pts.forEach(([px, py], i) =>
        i ? mg.lineTo(px - 130, py - 112) : mg.moveTo(px - 130, py - 112),
      );
      mg.closePath();
      mg.fill();
      mg.restore();
    };
    glyph(C_SHAPE, 262, 16, -0.07);
    glyph(K_SHAPE, 470, 14, 0.06);
    // Wildstyle blades grown out of the letters: long tapering spikes left, right and up, part of the same body.
    for (const blade of [
      [
        [290, 105],
        [160, 96],
        [36, 124],
        [160, 134],
        [290, 150],
      ],
      [
        [688, 188],
        [830, 184],
        [988, 214],
        [830, 212],
        [700, 228],
      ],
      [
        [700, 36],
        [820, 22],
        [946, 16],
        [820, 44],
        [712, 68],
      ],
      [
        [305, 50],
        [250, 26],
        [186, 18],
        [258, 44],
        [294, 66],
      ],
      [
        [560, 120],
        [610, 100],
        [660, 118],
        [610, 112],
      ],
    ] as [number, number][][]) {
      mg.beginPath();
      blade.forEach(([x, y], i) => (i ? mg.lineTo(x, y) : mg.moveTo(x, y)));
      mg.closePath();
      mg.fill();
    }
    haze(ctx, 1024 + 60, R, 900, R, '#7a3fd0', 32);
    const c = canvas(1024, R);
    const g = c.getContext('2d')!;
    piece(g, m, 0, 0, {
      outer: [4, '#ff5fb0'],
      cloud: [8, '#ffffff'],
      block: [1, 1, 14, '#1c7a45'],
      line: [6, INK],
      fill: ['#c8fff4', '#62dccb', '#33b5a8'],
      shine: '#ffffff',
      wear: 600,
      seed: 27,
    });
    // Facets cut into the letters: grey and emerald wedges, white edge lines, as on a wildstyle wall piece.
    const fc = canvas(1024, R);
    const fq = fc.getContext('2d')!;
    for (const [pts, col] of [
      [
        [
          [300, 70],
          [392, 88],
          [330, 112],
        ],
        '#b9c4c6',
      ],
      [
        [
          [536, 58],
          [606, 70],
          [556, 112],
        ],
        '#1c7a45',
      ],
      [
        [
          [598, 150],
          [688, 176],
          [640, 192],
        ],
        '#b9c4c6',
      ],
      [
        [
          [372, 168],
          [466, 180],
          [402, 198],
        ],
        '#1c7a45',
      ],
      [
        [
          [120, 112],
          [250, 118],
          [150, 128],
        ],
        '#b9c4c6',
      ],
      [
        [
          [760, 196],
          [900, 206],
          [790, 210],
        ],
        '#1c7a45',
      ],
      [
        [
          [760, 22],
          [880, 10],
          [790, 32],
        ],
        '#b9c4c6',
      ],
    ] as [[number, number][], string][]) {
      fq.fillStyle = col;
      fq.beginPath();
      pts.forEach(([x, y], i) => (i ? fq.lineTo(x, y) : fq.moveTo(x, y)));
      fq.closePath();
      fq.fill();
    }
    fq.strokeStyle = '#ffffff';
    fq.lineCap = 'round';
    fq.lineWidth = 2.5;
    for (const [ax, ay, bx, by] of [
      [292, 60, 352, 44],
      [100, 118, 250, 112],
      [530, 40, 548, 120],
      [740, 30, 900, 20],
      [720, 196, 940, 210],
      [330, 196, 440, 204],
    ]) {
      fq.beginPath();
      fq.moveTo(ax, ay);
      fq.lineTo(bx, by);
      fq.stroke();
    }
    fq.globalCompositeOperation = 'destination-in';
    fq.drawImage(m, 0, 0);
    g.drawImage(fc, 0, 0);
    // Cracks: thin jagged dark lines branching through the letters.
    const cr = canvas(1024, R);
    const q = cr.getContext('2d')!;
    const r = rng(29);
    q.strokeStyle = '#1b6f66';
    q.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      let x = 250 + r() * 520;
      let y = 30 + r() * 190;
      q.lineWidth = 1.5 + r() * 1.5;
      q.beginPath();
      q.moveTo(x, y);
      const a = r() * Math.PI * 2;
      for (let k = 0; k < 5; k++) {
        x += Math.cos(a + (r() - 0.5) * 1.4) * (8 + r() * 14);
        y += Math.sin(a + (r() - 0.5) * 1.4) * (8 + r() * 14);
        q.lineTo(x, y);
      }
      q.stroke();
    }
    q.globalCompositeOperation = 'destination-in';
    q.drawImage(m, 0, 0);
    g.drawImage(cr, 0, 0);
    ctx.drawImage(c, 1024, R);
  }
  haze(ctx, 200, 2 * R, 1600, R, '#d9302a', 33);
  // Row 2: Скопје е мој град! in bold slanted letters: white with an ink outline and an amber shadow, a few runs.
  piece(
    ctx,
    letters(2048, R, 'Скопје е мој град!', `800 165px ${BOLD}`, {
      skew: 0.2,
      jitter: 0.12,
      turn: 0.12,
      seed: 7,
    }),
    0,
    2 * R,
    {
      block: [1, 1, 7, AMBER],
      line: [4, INK],
      fill: [CREAM, '#ffffff', '#e8e2d4'],
      drips: [CREAM, 10],
      wear: 1400,
      seed: 8,
    },
  );
  // Row 3, left: SKOPYEAH! as a glass of beer: amber to gold letters full of bubbles, a white head of foam spilling
  // over their tops and running down their faces.
  {
    const m = letters(1024, R, 'SKOPYEAH!', `900 150px ${HEAVY}`, {
      jitter: 0.16,
      turn: 0.18,
      overlap: 8,
      seed: 15,
    });
    const c = canvas(1024, R);
    const g = c.getContext('2d')!;
    piece(g, m, 0, 0, {
      outer: [4, INK],
      cloud: [9, '#fff8e6'],
      block: [1, 1, 10, '#5a2f0c'],
      line: [5, INK],
      fill: ['#ffe27a', '#f4b42c', '#b8650f'],
      wear: 500,
      seed: 16,
    });
    const r = rng(17);
    // Bubbles rising in the beer, clipped to the letters.
    const fizz = canvas(1024, R);
    const f = fizz.getContext('2d')!;
    for (let i = 0; i < 260; i++) {
      const x = r() * 1024;
      const y = 60 + r() * 150;
      const rad = 1.5 + r() * 3.5;
      f.globalAlpha = 0.35 + r() * 0.5;
      f.strokeStyle = '#fff6d0';
      f.lineWidth = 1.2;
      f.beginPath();
      f.arc(x, y, rad, 0, Math.PI * 2);
      f.stroke();
      f.fillStyle = 'rgba(255,250,225,0.35)';
      f.fill();
    }
    f.globalCompositeOperation = 'destination-in';
    f.drawImage(m, 0, 0);
    g.drawImage(fizz, 0, 0);
    // The head: foam along each letter's top edge, piled over it, and runs of foam down the faces.
    const px = m.getContext('2d')!.getImageData(0, 0, 1024, R).data;
    const topAt = (x: number): number => {
      for (let y = 0; y < R; y++)
        if (px[(y * 1024 + x) * 4 + 3] > 128) return y;
      return -1;
    };
    const foam = canvas(1024, R);
    const q = foam.getContext('2d')!;
    for (let x = 0; x < 1024; x += 4) {
      const y = topAt(x);
      if (y < 0) continue;
      for (let k = 0; k < 1; k++) {
        q.fillStyle = r() < 0.75 ? '#fffdf6' : '#f1e6cf';
        q.beginPath();
        q.arc(
          x + (r() - 0.5) * 4,
          y - 2 - r() * 8,
          5 + r() * 6,
          0,
          Math.PI * 2,
        );
        q.fill();
      }
    }
    for (let i = 0; i < 9; i++) {
      const x = Math.floor(40 + r() * 940);
      const y = topAt(x);
      if (y < 0) continue;
      const len = 10 + r() * 28;
      const w = 5 + r() * 4;
      q.fillStyle = '#fffdf6';
      q.fillRect(x - w / 2, y, w, len);
      q.beginPath();
      q.arc(x, y + len, w * 0.62, 0, Math.PI * 2);
      q.fill();
    }
    // Its shading and a few bubbles in it, then the painter's line round it.
    const edge = grown(foam, 3, INK);
    g.drawImage(edge, 0, 0);
    g.drawImage(foam, 0, 0);
    g.save();
    g.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < 120; i++) {
      g.strokeStyle = 'rgba(190,170,130,0.55)';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(r() * 1024, 20 + r() * 120, 1.5 + r() * 3, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
    wear(c, 400, rng(18));
    ctx.drawImage(c, 0, 3 * R);
  }
  // Row 3, right: a quick throw-up of the wordmark: orange-yellow fill, brown line, a short skid under it.
  if (logo) {
    const m = wordmark(logo, aspect, 1024, R, 40);
    const c = canvas(ATLAS_W, R);
    const g = c.getContext('2d')!;
    tyreTracks(
      g,
      [1080, 225, 1350, 190, 1700, 240, 1990, 200],
      14,
      24,
      RUBBER,
      14,
    );
    ctx.drawImage(c, 0, 3 * R);
    piece(ctx, m, 1024, 3 * R, {
      line: [6, BROWN],
      fill: ['#ffd84a', '#f2a52a'],
      drips: [BROWN, 5],
      wear: 1100,
      seed: 13,
    });
  }
  // Row 4: the mural.
  mural(ctx, MURAL_Y);
  // Row 5, left: MK in the flag: red letters with the yellow sun and its eight widening rays across both, a dark red
  // block, an ink line and a cream cloud, yellow and red runs.
  {
    const m = letters(1024, R, 'MK', `900 220px ${HEAVY}`, {
      jitter: 0.06,
      turn: 0.06,
      skew: 0.08,
      seed: 31,
    });
    const c = canvas(1024, R);
    const g = c.getContext('2d')!;
    piece(g, m, 0, 0, {
      outer: [5, INK],
      cloud: [12, CREAM],
      block: [1, 1, 14, '#6e0a0a'],
      line: [5, INK],
      fill: ['#e00d0d', '#d20000', '#b00000'],
      wear: 0,
      seed: 32,
    });
    // The sun and rays, clipped to the letters: centred on them, the rays sprayed loose (uneven, soft-edged, fading
    // out) with a glow round the sun, not a ruled flag.
    const mp = m.getContext('2d')!.getImageData(0, 0, 1024, R).data;
    let by0 = R;
    let by1 = 0;
    let bx0 = 1024;
    let bx1 = 0;
    for (let y = 0; y < R; y++)
      for (let x = 0; x < 1024; x++)
        if (mp[(y * 1024 + x) * 4 + 3] > 128) {
          by0 = Math.min(by0, y);
          by1 = Math.max(by1, y);
          bx0 = Math.min(bx0, x);
          bx1 = Math.max(bx1, x);
        }
    const cx = (bx0 + bx1) / 2;
    const cy = (by0 + by1) / 2;
    const flag = canvas(1024, R);
    const f = flag.getContext('2d')!;
    const YELLOW = '#ffe600';
    const sr = rng(35);
    const far = 700;
    f.save();
    f.filter = 'blur(3px)';
    for (let i = 0; i < 8; i++) {
      // Rays to the corners and the middles of the sides of a 2:1 flag, widening outwards.
      const a =
        [
          0,
          0.4636,
          Math.PI / 2,
          Math.PI - 0.4636,
          Math.PI,
          Math.PI + 0.4636,
          1.5 * Math.PI,
          -0.4636,
        ][i] +
        (sr() - 0.5) * 0.08;
      const half = (i % 2 ? 0.075 : 0.06) * (0.8 + sr() * 0.5);
      const fade = f.createRadialGradient(
        cx,
        cy,
        30,
        cx,
        cy,
        far * (0.55 + sr() * 0.3),
      );
      fade.addColorStop(0, 'rgba(255,230,0,1)');
      fade.addColorStop(0.6, 'rgba(255,225,0,0.9)');
      fade.addColorStop(1, 'rgba(255,215,0,0.55)');
      f.fillStyle = fade;
      f.beginPath();
      f.moveTo(cx, cy);
      const n = 6;
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const d = far * t;
        f.lineTo(
          cx + Math.cos(a - half) * d + (sr() - 0.5) * 10,
          cy + Math.sin(a - half) * d + (sr() - 0.5) * 10,
        );
      }
      for (let k = n; k >= 0; k--) {
        const t = k / n;
        const d = far * t;
        f.lineTo(
          cx + Math.cos(a + half) * d + (sr() - 0.5) * 10,
          cy + Math.sin(a + half) * d + (sr() - 0.5) * 10,
        );
      }
      f.closePath();
      f.fill();
    }
    f.restore();
    // The glow and the sun.
    const glow = f.createRadialGradient(cx, cy, 40, cx, cy, 110);
    glow.addColorStop(0, 'rgba(255,236,60,0.8)');
    glow.addColorStop(0.45, 'rgba(255,214,0,0.3)');
    glow.addColorStop(1, 'rgba(255,200,0,0)');
    f.fillStyle = glow;
    f.fillRect(0, 0, 1024, R);
    f.save();
    f.filter = 'blur(2px)';
    f.fillStyle = YELLOW;
    f.beginPath();
    f.arc(cx, cy, 46, 0, Math.PI * 2);
    f.fill();
    f.fillStyle = 'rgba(255,255,220,0.6)';
    f.beginPath();
    f.arc(cx - 10, cy - 12, 18, 0, Math.PI * 2);
    f.fill();
    f.restore();
    f.globalCompositeOperation = 'destination-in';
    f.drawImage(m, 0, 0);
    g.drawImage(flag, 0, 0);
    // Runs and wear.
    const r = rng(33);
    drips(g, m, YELLOW, 4, r);
    drips(g, m, '#d20000', 5, r);
    wear(c, 900, rng(34));
    ctx.save();
    ctx.filter = 'blur(3px)';
    ctx.globalAlpha = 0.3;
    ctx.drawImage(c, 0, ROW5_Y);
    ctx.restore();
    ctx.drawImage(c, 0, ROW5_Y);
  }
}
