/**
 * Asphalt tile generator, run inside the browser by `bake.mjs` (a classic script, no imports: it needs a 2D canvas).
 * `window.asphaltTile(id, size)` -> { color, normal, rough } as base64 WebP (opaque RGB each).
 *
 * u (x) runs across the road, v (y) along it. Dense fine aggregate in bitumen, a bitumen film over the wheel paths,
 * hairline cracks, tar snakes, repair patches, edge grit, painted lines with stones showing through. A height field
 * becomes the tangent-space normal map; the roughness map polishes the wheel paths and glosses tar. Sizes below
 * 1024 are their own design (coarser stones, fewer cracks), not a downscale: the stone radius never drops below ~1 px.
 */
(() => {
  /** Same mulberry32 as src/shared/rng.ts, so a seed means the same everywhere. */
  class Rng {
    constructor(seed) {
      this.a = seed >>> 0 || 0x6d2b79f5;
    }
    next() {
      this.a = (this.a + 0x6d2b79f5) | 0;
      let t = this.a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    range(a, b) {
      return a + (b - a) * this.next();
    }
    int(a, b) {
      return Math.floor(this.range(a, b + 1));
    }
    chance(p) {
      return this.next() < p;
    }
    pick(arr) {
      return arr[Math.floor(this.next() * arr.length)];
    }
    gauss() {
      return (
        (this.next() + this.next() + this.next() + this.next() - 2) * 1.732
      );
    }
  }

  const WHITE = '#dcdcd4';
  const YELLOW = '#d2a82a';
  /** Ajvatovci's road surface, shared by its two presets. */
  const AJVATOVCI = {
    seed: 7,
    photo: 'asphalt_04',
    photoM: 4.04,
    photoLum: 128,
    photoFlat: 0.35,
    relief: 1,
    polish: 0.7,
    filmA: 0.3,
    patches: 0,
    cracks: 16,
    crackW: 0.7,
    crackDark: 70,
    crackA: 0.6,
    snakes: 0,
    joints: 0,
    oil: 14,
    dust: 0.6,
    edgeBlend: true,
    crumble: 140,
    chips: 55000,
  };
  /** Vodno's old mountain road: lighter, finer stones, no baked patches (the shader draws them, road-surface.ts); the lines and plain tiles share it, so they join. */
  const VODNO = {
    seed: 7,
    polish: 0.3,
    exposed: 0.35,
    cracks: 20,
    grain: 0.65,
    tone: 0.18,
    patches: 0,
    dust: 0.7,
    age: 0.7,
    // a soft, light grey (the road reads calm from the driver's seat)
    lift: 0.62,
    warmTarget: [142, 140, 135],
    relief: 0.45,
    crackW: 0.7,
    // the white and dark aggregate showing in the surface, as on Ajvatovci's road
    chips: 55000,
  };
  /**
   * len = metres per tile along the road (must match `texLength` in world/road-mesh.ts).
   * polish: bitumen film over the wheel paths; exposed: aggregate showing between them; grain: stone size
   * (1 = worn road, 0.6 = fine new surface); dust: grit along the edges; age: warm, sun-bleached;
   * gain: brightens the bitumen and stones keeping their contrast (a sun-bleached light road);
   * lift: 0..1 toward a lighter, lower-contrast warm grey (bleached old road);
   * relief: scales the stone relief in the normal map; crackW: scales the crack width;
   * warmTarget: the colour `lift` blends toward (default a neutral warm grey);
   * filmA: strength of the wheel-path film (0.8 = dark tyre bands, 0.5 = faint tyre marks);
   * crackDark / crackA: grey level and opacity of the cracks (12 / 1 = black, 60 / 0.45 = hairline grey);
   * snakes / joints: counts of tar-filled snakes and transverse joints (default cracks / 8 and 2);
   * oil: faint oil stains; tone: strength of the slow tone variation; edgeBlend / crumble: the edge melts into a gravel
   *   shoulder (patchy dust, gravel-coloured stones) and that many gravel bites break its line (1024 px);
   * chips: light stone chips drawn over the base (count per 1024 px tile);
   * photo / photoM / photoLum: a scanned base instead of the drawn stones (bake.mjs `PHOTOS`), its size in metres and
   *   the mean brightness it is scaled to (sRGB luma); photoFlat: how much of its slow blotches to remove (0-1);
   *   across: metres the tile spans across the road (default 6; a square tile, across = len, wraps both ways).
   */
  const PRESETS = {
    /** Ajvatovci's newer road (also Galichica, Petralica): Poly Haven Asphalt 04 at real scale, its own neutral grey. */
    road_tarmac: { ...AJVATOVCI, len: 7 },
    /** The same road along Ajvatovci's kerbed start street (to the canal bridge): no grit at the edges. */
    road_tarmac_kerbed: { ...AJVATOVCI, len: 7, dust: 0, crumble: 0 },
    /**
     * The same road where a side road joins it (the junction mouth and its rounded corners, laid flat in world space):
     * a square tile that wraps both ways, no wheel paths or edges, cracks and oil drips in any direction.
     */
    road_tarmac_junction: {
      ...AJVATOVCI,
      len: 7,
      across: 7,
      polish: 0,
      dust: 0,
      edgeBlend: false,
      crumble: 0,
      cracks: 12,
      oil: 10,
      anyDir: true,
    },
    road_tarmac_lines: {
      ...VODNO,
      len: 7,
      lines: [
        { u: 0.05, w: 12, color: WHITE },
        { u: 0.5, w: 12, color: WHITE },
        { u: 0.95, w: 12, color: WHITE },
      ],
    },
    /** The same surface without lines (Vodno's crossroad, where the road paint lies over it). */
    road_tarmac_plain: { ...VODNO, len: 7 },
    /** The same road along Vodno's kerbed city streets: no grit at the edges. */
    road_tarmac_plain_kerbed: { ...VODNO, len: 7, dust: 0, crumble: 0 },
    /** Vodno's junction mouths (like `road_tarmac_junction`): a square world-aligned tile of the same old road. */
    road_tarmac_plain_junction: {
      ...VODNO,
      len: 7,
      across: 7,
      polish: 0,
      dust: 0,
      edgeBlend: false,
      crumble: 0,
      cracks: 12,
      anyDir: true,
    },
    road_city: {
      seed: 11,
      len: 8,
      polish: 0.8,
      exposed: 0.4,
      cracks: 14,
      grain: 0.7,
      patches: 5,
      dust: 0.25,
      age: 0.2,
    },
    road_street: {
      seed: 12,
      len: 8,
      polish: 0.8,
      exposed: 0.4,
      cracks: 14,
      grain: 0.7,
      patches: 5,
      dust: 0.25,
      age: 0.2,
      lines: [
        { u: 0.4873, w: 5, color: YELLOW },
        { u: 0.5127, w: 5, color: YELLOW },
      ],
    },
    road_street4: {
      seed: 13,
      len: 12,
      polish: 0.8,
      exposed: 0.4,
      cracks: 10,
      grain: 0.7,
      patches: 4,
      dust: 0.2,
      age: 0.2,
      lines: [
        { u: 0.4912, w: 3, color: YELLOW },
        { u: 0.5088, w: 3, color: YELLOW },
        { u: 0.26, w: 4, color: WHITE, dash: [3, 9] },
        { u: 0.74, w: 4, color: WHITE, dash: [3, 9] },
      ],
    },
    road_parkway: {
      seed: 21,
      len: 12,
      polish: 0.85,
      exposed: 0.35,
      cracks: 8,
      grain: 0.6,
      patches: 4,
      dust: 0.1,
      age: 0.1,
      // a little lighter than fresh black asphalt, same texture
      gain: 1.15,
      lines: [
        { u: 0.045, w: 10, color: '#d9b43a' },
        { u: 0.955, w: 10, color: WHITE },
        { u: 0.5, w: 8, color: WHITE, dash: [3, 9] },
      ],
    },
    /** City junction box: no wheel paths, any direction, so cracks run every way. */
    junction_asphalt: {
      seed: 31,
      len: 8,
      polish: 0,
      exposed: 0.4,
      cracks: 8,
      grain: 0.7,
      patches: 6,
      dust: 0,
      age: 0.2,
      anyDir: true,
    },
  };

  const grey = (v) => `rgb(${Math.round(v)},${Math.round(v)},${Math.round(v)})`;

  function canvas(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    return [c, c.getContext('2d', { willReadFrequently: true })];
  }

  function draw(o, size) {
    const w = size;
    const h = size;
    // Pixel sizes below are written for 1024; S converts them.
    const S = size / 1024;
    const coarse = size < 1024 ? 1.3 : 1;
    const rng = new Rng(o.seed + size);
    const [color, cx] = canvas(size);
    const [height, hx] = canvas(size);
    const [rough, rx] = canvas(size);
    const track = (u) =>
      Math.max(0, 1 - Math.abs(u - 0.28) / 0.09, 1 - Math.abs(u - 0.72) / 0.09);
    const ell = (ctx, x, y, rx_, ry, ang, fill) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.ellipse(x, y, rx_, ry, ang, 0, Math.PI * 2);
      ctx.fill();
    };

    // Photo base (a CC0 scan, `photo` / `photoM` / `photoLum`): its colour, height and roughness at real scale (rounded
    // so a whole number of repeats fits `len`). Three copies, shifted and turned, are blended by a soft random mask so
    // the scan's own period (half the tile) does not show; its slow blotches are flattened (`photoFlat`) so the 7 m
    // tile does not read as a repeat either. Brightness is scaled to `photoLum`, its own hue kept.
    const photo = o.photo && window.asphaltPhotos?.[o.photo];
    if (photo) {
      const along = o.len / Math.max(1, Math.round(o.len / o.photoM));
      const pw = (w * along) / (o.across ?? 6);
      const ph = (h * along) / o.len;
      const prng = new Rng(o.seed * 31 + 5);
      const layers = [0, 1, 2].map((k) => ({
        turn: (k * Math.PI) / 2 + (k === 2 ? Math.PI / 2 : 0),
        ox: prng.next() * pw,
        oy: prng.next() * ph,
      }));
      // Mask: smooth value noise on a lattice of ~1.2 m cells, periodic along v so the tile still wraps (and across on
      // a square tile).
      const wrapU = o.across === o.len;
      const gx = Math.max(2, Math.round((o.across ?? 6) / 1.2));
      const gy = Math.max(2, Math.round(o.len / 1.2));
      const nodes = layers.map(() =>
        Array.from({ length: (gx + 1) * gy }, () => prng.next()),
      );
      const smooth = (t) => t * t * (3 - 2 * t);
      const weights = new Float32Array(w * h * 3);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const fx = (x / w) * gx;
          const fy = (y / h) * gy;
          const ix = Math.floor(fx);
          const iy = Math.floor(fy);
          const tx = smooth(fx - ix);
          const ty = smooth(fy - iy);
          let sum = 0;
          const e = [];
          for (let k = 0; k < 3; k++) {
            const n = nodes[k];
            const at = (i, j) =>
              n[(j % gy) * (gx + 1) + (wrapU ? i % gx : Math.min(i, gx))];
            const v =
              (at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty) +
              (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty;
            e[k] = Math.exp(9 * v);
            sum += e[k];
          }
          for (let k = 0; k < 3; k++) weights[(y * w + x) * 3 + k] = e[k] / sum;
        }
      const [lc, lx] = canvas(size);
      for (const [ctx, img] of [
        [cx, photo.diff],
        [hx, photo.disp],
        [rx, photo.rough],
      ]) {
        const parts = layers.map((l) => {
          lx.save();
          lx.imageSmoothingEnabled = true;
          lx.imageSmoothingQuality = 'high';
          for (let y = -l.oy; y < h; y += ph)
            for (let x = -l.ox; x < w; x += pw) {
              lx.save();
              lx.translate(x + pw / 2, y + ph / 2);
              lx.scale(pw, ph);
              lx.rotate(l.turn);
              lx.drawImage(img, -0.5, -0.5, 1, 1);
              lx.restore();
            }
          lx.restore();
          return lx.getImageData(0, 0, w, h).data;
        });
        const out = ctx.createImageData(w, h);
        for (let i = 0, p = 0; i < out.data.length; i += 4, p += 3) {
          for (let c = 0; c < 3; c++)
            out.data[i + c] =
              parts[0][i + c] * weights[p] +
              parts[1][i + c] * weights[p + 1] +
              parts[2][i + c] * weights[p + 2];
          out.data[i + 3] = 255;
        }
        ctx.putImageData(out, 0, 0);
      }
      lc.width = lc.height = 0;
      // Flatten the slow blotches: subtract part of a wide blur (wrapped along v), keep the grain.
      const flat = o.photoFlat ?? 0;
      if (flat > 0) {
        const r = Math.round(0.35 * (w / (o.across ?? 6)));
        const tall = document.createElement('canvas');
        const nx = wrapU ? 3 : 1;
        tall.width = w * nx;
        tall.height = h * 3;
        const tx_ = tall.getContext('2d');
        for (let i = 0; i < nx; i++)
          for (let j = 0; j < 3; j++) tx_.drawImage(color, i * w, j * h);
        const [bc, bx] = canvas(size);
        bx.filter = `blur(${r}px)`;
        bx.drawImage(tall, wrapU ? -w : 0, -h);
        const blur = bx.getImageData(0, 0, w, h).data;
        bc.width = bc.height = tall.width = tall.height = 0;
        const img = cx.getImageData(0, 0, w, h);
        const mean = [0, 0, 0];
        for (let i = 0; i < blur.length; i += 4)
          for (let c = 0; c < 3; c++) mean[c] += blur[i + c];
        for (let c = 0; c < 3; c++) mean[c] /= w * h;
        for (let i = 0; i < img.data.length; i += 4)
          for (let c = 0; c < 3; c++)
            img.data[i + c] += flat * (mean[c] - blur[i + c]);
        cx.putImageData(img, 0, 0);
      }
      const img = cx.getImageData(0, 0, w, h);
      let sum = 0;
      for (let i = 0; i < img.data.length; i += 4)
        sum +=
          0.2126 * img.data[i] +
          0.7152 * img.data[i + 1] +
          0.0722 * img.data[i + 2];
      const k = o.photoLum / (sum / (w * h));
      for (let i = 0; i < img.data.length; i += 4)
        for (let c = 0; c < 3; c++)
          img.data[i + c] = Math.min(255, img.data[i + c] * k);
      cx.putImageData(img, 0, 0);
    }

    // Light stone chips (`chips` = count per 1024 px tile): the white and pale grey aggregate that shows in a worn
    // road's surface, each with a little relief. Over a photo base under the wheel-path film, over drawn stones after them.
    const drawChips = () => {
      const cr = new Rng(o.seed + 41);
      const n = Math.round(o.chips * S * S);
      for (let i = 0; i < n; i++) {
        const x = cr.next() * w;
        const y = cr.next() * h;
        const r = Math.max(0.5, cr.range(0.5, 1.4) * S * coarse);
        // (one in three a dark stone: the chips are mixed aggregate, not just white specks)
        const v = Math.round(
          cr.next() < 0.33 ? cr.range(28, 60) : cr.range(135, 225),
        );
        const fill = `rgba(${v},${v - 2},${v - 6},${cr.range(0.4, 0.85).toFixed(2)})`;
        const sx = r * cr.range(0.6, 1.4);
        const ang = cr.next() * Math.PI;
        for (const ox of [-w, 0, w])
          for (const oy of [-h, 0, h]) {
            if (
              x + ox + r < 0 ||
              x + ox - r > w ||
              y + oy + r < 0 ||
              y + oy - r > h
            )
              continue;
            ell(cx, x + ox, y + oy, sx, r, ang, fill);
            ell(hx, x + ox, y + oy, sx, r, ang, grey(185));
          }
      }
    };
    if (photo && o.chips) drawChips();

    // Bitumen base.
    const warm = o.age;
    const lift = o.lift ?? 0;
    const gain = o.gain ?? 1;
    const target = o.warmTarget ?? [128, 124, 116];
    const lighten = (c) =>
      c.map((v, i) => Math.round(v * gain + (target[i] - v * gain) * lift));
    // The drawn stones' colours (also the stones in painted lines); none on a photo base.
    let palette = [];
    if (!photo) {
      cx.fillStyle = `rgb(${lighten([44 + warm * 10, 44 + warm * 8, 46 + warm * 4])})`;
      cx.fillRect(0, 0, w, h);
      hx.fillStyle = grey(70);
      hx.fillRect(0, 0, w, h);
      rx.fillStyle = grey(235);
      rx.fillRect(0, 0, w, h);

      // Aggregate: dense crushed stone of mixed greys. Between the wheel paths more shows.
      palette = [
        [50, 50, 52],
        [62, 61, 61],
        [74, 73, 71],
        [88, 86, 83],
        [96, 93, 89],
        [70, 67, 64],
      ].map(([r, g, b]) =>
        lighten([r + warm * 10, g + warm * 6, b - warm * 2]),
      );
      const n = Math.round(
        (170000 * S * S) / (o.grain * o.grain * coarse * coarse),
      );
      for (let i = 0; i < n; i++) {
        const x = rng.next() * w;
        const y = rng.next() * h;
        const u = x / w;
        const keep = 1 - o.polish * track(u) * 0.85 + (o.exposed - 0.5) * 0.3;
        if (rng.next() > keep) continue;
        const r = Math.max(0.85, rng.range(0.9, 2.7) * o.grain * S * coarse);
        const c =
          palette[Math.floor(Math.pow(rng.next(), 1.8) * palette.length)];
        const k = rng.range(0.9, 1.1);
        const sx = r * rng.range(0.7, 1.3);
        const ang = rng.next() * Math.PI;
        const ht = rng.range(110, 230);
        const fill = `rgb(${(c[0] * k) | 0},${(c[1] * k) | 0},${(c[2] * k) | 0})`;
        for (const ox of [-w, 0, w]) {
          if (x + ox + r < 0 || x + ox - r > w) continue;
          for (const oy of [-h, 0, h]) {
            if (y + oy + r < 0 || y + oy - r > h) continue;
            ell(cx, x + ox, y + oy, sx, r, ang, fill);
            ell(hx, x + ox, y + oy, sx, r, ang, grey(ht));
            ell(rx, x + ox, y + oy, sx, r, ang, grey(225));
          }
        }
      }
    }

    // Wheel paths: a bitumen film that polishes (darker, roughness down, stones smoothed in the height).
    if (o.polish > 0)
      for (const u0 of [0.28, 0.72]) {
        for (const [ctx, c0] of [
          [cx, photo ? '60,58,56' : lighten([30, 30, 32]).join(',')],
          [hx, '70,70,70'],
          [rx, '120,120,120'],
        ]) {
          const g = ctx.createLinearGradient(
            (u0 - 0.1) * w,
            0,
            (u0 + 0.1) * w,
            0,
          );
          g.addColorStop(0, `rgba(${c0},0)`);
          g.addColorStop(0.5, `rgba(${c0},${o.polish * (o.filmA ?? 0.8)})`);
          g.addColorStop(1, `rgba(${c0},0)`);
          ctx.fillStyle = g;
          ctx.fillRect((u0 - 0.1) * w, 0, 0.2 * w, h);
        }
      }

    // Slow tone variation (oxidation, binder bleed) as an overlay (a photo base has its own).
    if (!photo) {
      const [lo, lx] = canvas(64);
      const img = lx.createImageData(64, 64);
      const r2 = new Rng(o.seed + 5);
      for (let i = 0; i < 64 * 64; i++) {
        const v = 128 + r2.gauss() * 38;
        img.data.set([v, v, v, 255], i * 4);
      }
      lx.putImageData(img, 0, 0);
      cx.save();
      cx.globalCompositeOperation = 'overlay';
      cx.globalAlpha = o.tone ?? 0.55;
      cx.imageSmoothingEnabled = true;
      cx.drawImage(lo, 0, 0, w, h);
      cx.restore();
    }

    if (!photo && o.chips) drawChips();

    // Patches: straight-edged repairs, darker, with a sealed edge.
    for (let i = 0; i < o.patches; i++) {
      const pw = rng.range(0.15, 0.4) * w;
      const ph = rng.range(30, 160) * S;
      const px = rng.range(0.04, 0.96 - pw / w) * w;
      const py = rng.range(0, h - ph);
      cx.fillStyle = 'rgba(26,26,28,0.38)';
      cx.fillRect(px, py, pw, ph);
      cx.strokeStyle = 'rgba(14,14,16,0.7)';
      cx.lineWidth = 2 * S;
      cx.strokeRect(px, py, pw, ph);
      hx.fillStyle = 'rgba(95,95,95,0.5)';
      hx.fillRect(px, py, pw, ph);
      rx.fillStyle = 'rgba(150,150,150,0.5)';
      rx.fillRect(px, py, pw, ph);
      rx.strokeStyle = grey(90);
      rx.lineWidth = 2 * S;
      rx.strokeRect(px, py, pw, ph);
    }

    // Oil and tyre stains: long, faint, mostly on the wheel paths.
    for (let i = 0; i < (o.oil ?? 0); i++) {
      // (a junction: drips anywhere, round-ish, wrapped both ways)
      const u = o.anyDir
        ? rng.next()
        : rng.chance(0.7)
          ? rng.pick([0.28, 0.72]) + rng.range(-0.05, 0.05)
          : rng.range(0.1, 0.9);
      const y = rng.next() * h;
      const len = rng.range(50, 240) * S;
      const wid = o.anyDir ? len * rng.range(0.3, 0.7) : rng.range(7, 20) * S;
      const a0 = o.anyDir ? rng.range(0.07, 0.16) : 0;
      for (const [ox, oy] of (o.anyDir ? [-w, 0, w] : [0]).flatMap((ox) =>
        [-h, 0, h].map((oy) => [ox, oy]),
      )) {
        const x = u * w + ox;
        const g = cx.createRadialGradient(x, y + oy, 0, x, y + oy, len);
        g.addColorStop(0, `rgba(60,48,36,${a0 || rng.range(0.07, 0.16)})`);
        g.addColorStop(1, 'rgba(60,48,36,0)');
        cx.save();
        cx.translate(x, y + oy);
        cx.scale(wid / len, 1);
        cx.translate(-x, -(y + oy));
        cx.fillStyle = g;
        cx.beginPath();
        cx.arc(x, y + oy, len, 0, Math.PI * 2);
        cx.fill();
        cx.restore();
      }
    }

    // Cracks (thin, dark, recessed, branching) and tar-filled snakes (wider, glossy).
    const crack = (x, y, a, steps, lw, snake, depth = 0) => {
      const pts = [[x, y]];
      for (let k = 0; k < steps; k++) {
        a += rng.range(-0.55, 0.55);
        x += Math.cos(a) * 7 * S;
        y += Math.sin(a) * 7 * S;
        pts.push([x, y]);
        if (depth < 2 && rng.chance(0.05))
          crack(
            x,
            y,
            a + rng.range(-1.2, 1.2),
            rng.int(4, 14),
            lw * 0.7,
            snake,
            depth + 1,
          );
      }
      for (const ox of [-w, 0, w])
        for (const oy of [-h, 0, h]) {
          const stroke = (ctx, style, wd) => {
            ctx.strokeStyle = style;
            ctx.lineWidth = Math.max(1, wd * S);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            pts.forEach(([qx, qy], j) =>
              j ? ctx.lineTo(qx + ox, qy + oy) : ctx.moveTo(qx + ox, qy + oy),
            );
            ctx.stroke();
          };
          const cd = o.crackDark ?? 12;
          const ca = o.crackA ?? 1;
          stroke(
            cx,
            snake
              ? 'rgba(14,14,16,0.85)'
              : `rgba(${cd},${cd},${cd + 2},${0.8 * ca})`,
            lw,
          );
          stroke(
            hx,
            snake ? 'rgba(80,80,80,0.9)' : `rgba(10,10,10,${0.9 * ca})`,
            lw,
          );
          stroke(rx, grey(snake ? 150 : 215), lw);
        }
    };
    for (let i = 0; i < o.cracks; i++) {
      const long = rng.chance(0.5);
      const x =
        (rng.chance(0.6) ? rng.pick([0.08, 0.5, 0.92]) : rng.next()) * w;
      const a = o.anyDir
        ? rng.range(0, Math.PI * 2)
        : Math.PI / 2 + rng.range(-0.5, 0.5);
      crack(
        x,
        rng.next() * h,
        a,
        long ? rng.int(20, 60) : rng.int(6, 18),
        rng.range(1.0, 2.0) * (o.crackW ?? 1),
        false,
      );
    }
    for (let i = 0; i < (o.snakes ?? Math.round(o.cracks / 8)); i++) {
      const a = o.anyDir
        ? rng.range(0, Math.PI * 2)
        : Math.PI / 2 + rng.range(-0.3, 0.3);
      crack(
        rng.next() * w,
        rng.next() * h,
        a,
        rng.int(40, 90),
        rng.range(3, 5),
        true,
      );
    }
    // Transverse joints (not on a junction box: it has no direction).
    for (let i = 0; i < (o.joints ?? (o.anyDir ? 0 : 2)); i++) {
      const y = rng.next() * h;
      for (const [ctx, style] of [
        [cx, 'rgba(14,14,16,0.7)'],
        [hx, 'rgba(40,40,40,0.9)'],
        [rx, grey(110)],
      ]) {
        ctx.strokeStyle = style;
        ctx.lineWidth = Math.max(1, 2.2 * S);
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (let x = 0; x <= w; x += 16 * S)
          ctx.lineTo(x, y + rng.range(-1.5, 1.5) * S);
        ctx.stroke();
      }
    }

    // `edgeBlend`: the road meets a gravel shoulder (Ajvatovci's open road): patchy dust, the shoulder's own stones and
    // a crumbling edge. Otherwise the older fine edge grit.
    if (o.edgeBlend) {
      // Edges: dust and loose gravel from the verge (the shoulder's own colours, textures.ts GRAVEL_PALETTE), so the
      // road melts into the gravel beside it instead of ending in a clean line.
      const grit = [
        [150, 140, 125],
        [128, 120, 108],
        [170, 160, 140],
        [112, 104, 96],
        [160, 146, 120],
        [95, 90, 86],
      ];
      // A dust film over the outer band, patchy along the road (a sum of sines, periodic along v).
      if (o.dust > 0) {
        const img = cx.getImageData(0, 0, w, h);
        const band = 0.06 + 0.06 * o.dust;
        const ph = [rng.next(), rng.next(), rng.next(), rng.next()].map(
          (v) => v * Math.PI * 2,
        );
        for (let y = 0; y < h; y++) {
          const t = (y / h) * Math.PI * 2;
          for (const left of [true, false]) {
            const k = left ? 0 : 2;
            const wob =
              0.55 +
              0.25 * Math.sin(3 * t + ph[k]) +
              0.2 * Math.sin(7 * t + ph[k + 1]);
            const reach = band * (0.6 + 0.6 * wob) * w;
            for (let e = 0; e < reach; e++) {
              const x = left ? e : w - 1 - e;
              const f = 1 - e / reach;
              const a = Math.min(
                0.85,
                (0.15 + 0.7 * o.dust) * f * f * (0.7 + 0.6 * wob),
              );
              const i = (y * w + x) * 4;
              img.data[i] += (148 - img.data[i]) * a;
              img.data[i + 1] += (137 - img.data[i + 1]) * a;
              img.data[i + 2] += (119 - img.data[i + 2]) * a;
            }
          }
        }
        cx.putImageData(img, 0, 0);
      }
      // Small stones: dense over the dust band, then thinning out to nothing a band further in.
      const nd = Math.round(34000 * o.dust * S * S);
      for (let i = 0; i < nd; i++) {
        const left = rng.chance(0.5);
        const e = rng.chance(0.7)
          ? 0.08 * Math.pow(rng.next(), 1.3)
          : 0.08 + 0.08 * (1 - Math.sqrt(1 - rng.next()));
        const x = (left ? e : 1 - e) * w;
        const y = rng.next() * h;
        const r = Math.max(0.6, rng.range(0.35, 1.2) * S * coarse);
        const c = grit[rng.int(0, grit.length - 1)];
        ell(
          cx,
          x,
          y,
          r,
          r * rng.range(0.7, 1.2),
          rng.next() * 3,
          `rgba(${c[0]},${c[1]},${c[2]},${rng.range(0.6, 0.95)})`,
        );
        ell(hx, x, y, r, r, 0, grey(rng.range(120, 200)));
        ell(rx, x, y, r, r, 0, grey(245));
      }
      // Crumbling edges (`crumble` bites a side): gravel eats into the asphalt, so the edge is ragged, not ruled.
      for (let i = 0; i < Math.round((o.crumble ?? 0) * S); i++) {
        const left = rng.chance(0.5);
        const r = rng.range(4, 14) * S;
        const x = (left ? rng.range(-0.005, 0.03) : rng.range(0.97, 1.005)) * w;
        const y = rng.next() * h;
        // An irregular dusty bite (a few overlapping lobes), then loose stones in it.
        const lobes = [];
        for (let k = 0; k < 4; k++)
          lobes.push([
            x + rng.range(-0.6, 0.6) * r,
            y + rng.range(-1.2, 1.2) * r,
            r * rng.range(0.4, 0.8),
            r * rng.range(0.7, 1.2),
          ]);
        const stonesIn = [];
        for (let k = 0; k < 10; k++) {
          const c = grit[rng.int(0, grit.length - 1)];
          stonesIn.push([
            x + rng.range(-0.7, 0.7) * r,
            y + rng.range(-1.4, 1.4) * r,
            Math.max(0.8, rng.range(0.8, 2.6) * S * coarse),
            `rgba(${c[0]},${c[1]},${c[2]},${rng.range(0.6, 0.95)})`,
          ]);
        }
        for (const dy of [-h, 0, h]) {
          for (const [lx, ly, rx_, ry] of lobes) {
            ell(cx, lx, ly + dy, rx_, ry, 0, 'rgba(146,134,114,0.6)');
            ell(hx, lx, ly + dy, rx_, ry, 0, grey(100));
            ell(rx, lx, ly + dy, rx_, ry, 0, grey(250));
          }
          for (const [sx, sy, sr, col] of stonesIn) {
            ell(cx, sx, sy + dy, sr, sr * 0.85, 0, col);
            ell(hx, sx, sy + dy, sr, sr, 0, grey(170));
          }
        }
      }
    } else {
      // Edges: dust and loose grit drift in from the verge (fine and stochastic: no blobs).
      const grit = [
        [150, 140, 124],
        [128, 120, 106],
        [168, 158, 140],
        [104, 98, 90],
      ];
      const nd = Math.round(26000 * o.dust * S * S);
      for (let i = 0; i < nd; i++) {
        const left = rng.chance(0.5);
        const e = Math.pow(rng.next(), 2.2) * 0.13;
        const x = (left ? e : 1 - e) * w;
        const y = rng.next() * h;
        const r = Math.max(0.8, rng.range(0.7, 2.4) * S * coarse);
        const c = grit[rng.int(0, grit.length - 1)];
        ell(
          cx,
          x,
          y,
          r,
          r * rng.range(0.7, 1.2),
          rng.next() * 3,
          `rgba(${c[0]},${c[1]},${c[2]},${rng.range(0.35, 0.9)})`,
        );
        ell(hx, x, y, r, r, 0, grey(rng.range(120, 200)));
        ell(rx, x, y, r, r, 0, grey(245));
      }
      // A thin dust film over the outer 8 % each side.
      if (o.dust > 0)
        for (const [a, b] of [
          [0, 0.09],
          [1, 0.91],
        ]) {
          const g = cx.createLinearGradient(a * w, 0, b * w, 0);
          g.addColorStop(0, `rgba(150,138,118,${0.32 * o.dust + 0.05})`);
          g.addColorStop(1, 'rgba(150,138,118,0)');
          cx.fillStyle = g;
          cx.fillRect(Math.min(a, b) * w, 0, Math.abs(b - a) * w, h);
        }
    }

    // Painted lines: paint over the aggregate, stones showing through (drawn after the dust: lines stay readable).
    for (const L of o.lines ?? []) {
      const lw = Math.max(1, L.w * S);
      const period = L.dash ? ((L.dash[0] + L.dash[1]) / o.len) * h : h;
      const on = L.dash ? (L.dash[0] / o.len) * h : h;
      for (let y0 = 0; y0 < h; y0 += period) {
        cx.fillStyle = L.color;
        cx.fillRect(L.u * w - lw, y0, lw * 2, on);
        hx.fillStyle = grey(95);
        hx.fillRect(L.u * w - lw, y0, lw * 2, on);
        rx.fillStyle = grey(190);
        rx.fillRect(L.u * w - lw, y0, lw * 2, on);
      }
      for (let i = 0; i < 2200 * S * S; i++) {
        const x = L.u * w + rng.range(-lw - 1, lw + 1);
        const y = rng.next() * h;
        const r = Math.max(0.8, rng.range(0.8, 2.4) * S * coarse);
        const c = palette[rng.int(0, palette.length - 1)];
        ell(
          cx,
          x,
          y,
          r,
          r * rng.range(0.7, 1.3),
          rng.next() * 3,
          `rgba(${c[0]},${c[1]},${c[2]},${rng.range(0.4, 0.8)})`,
        );
        ell(hx, x, y, r, r, 0, grey(rng.range(110, 200)));
      }
    }

    // Fine per-pixel grain so no flat areas remain at close range.
    {
      const img = cx.getImageData(0, 0, w, h);
      const d = img.data;
      const r3 = new Rng(o.seed + 11);
      for (let i = 0; i < w * h; i++) {
        const k = 1 + r3.range(-0.09, 0.09);
        d[i * 4] *= k;
        d[i * 4 + 1] *= k;
        d[i * 4 + 2] *= k;
      }
      cx.putImageData(img, 0, 0);
    }

    return {
      color,
      normal: normalFromHeight(
        height,
        (size < 1024 ? 1.8 : 2.2) * (o.relief ?? 1),
      ),
      rough,
    };
  }

  /** Height canvas -> tangent-space normal map canvas (wraps, so it tiles). */
  function normalFromHeight(src, strength) {
    const w = src.width;
    const h = src.height;
    const d = src.getContext('2d').getImageData(0, 0, w, h).data;
    const [out, ox] = canvas(w);
    const img = ox.createImageData(w, h);
    const H = (x, y) => d[(((y + h) % h) * w + ((x + w) % w)) * 4];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (H(x + 1, y) - H(x - 1, y)) / 255;
        const dy = (H(x, y + 1) - H(x, y - 1)) / 255;
        const nx = -dx * strength;
        const ny = dy * strength;
        const inv = 1 / Math.hypot(nx, ny, 1);
        const i = (y * w + x) * 4;
        img.data[i] = (nx * inv * 0.5 + 0.5) * 255;
        img.data[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
        img.data[i + 2] = (inv * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    }
    ox.putImageData(img, 0, 0);
    return out;
  }

  const webp = (c, q) =>
    new Promise((res) =>
      c.toBlob(
        (b) => {
          const r = new FileReader();
          r.onload = () => res(String(r.result).split(',')[1]);
          r.readAsDataURL(b);
        },
        'image/webp',
        q,
      ),
    );

  window.asphaltIds = Object.keys(PRESETS);
  window.asphaltTile = async (id, size) => {
    const t = draw(PRESETS[id], size);
    return {
      color: await webp(t.color, 0.86),
      normal: await webp(t.normal, 0.92),
      rough: await webp(t.rough, 0.9),
    };
  };
})();
