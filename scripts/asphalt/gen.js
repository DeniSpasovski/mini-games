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
  /**
   * len = metres per tile along the road (must match `texLength` in world/road-mesh.ts).
   * polish: bitumen film over the wheel paths; exposed: aggregate showing between them; grain: stone size
   * (1 = worn road, 0.6 = fine new surface); dust: grit along the edges; age: warm, sun-bleached.
   */
  const PRESETS = {
    road_tarmac: {
      seed: 7,
      len: 7,
      polish: 0.7,
      exposed: 0.55,
      cracks: 26,
      grain: 1,
      patches: 3,
      dust: 0.9,
      age: 0.7,
    },
    road_tarmac_lines: {
      seed: 7,
      len: 7,
      polish: 0.7,
      exposed: 0.55,
      cracks: 22,
      grain: 1,
      patches: 2,
      dust: 0.7,
      age: 0.7,
      lines: [
        { u: 0.05, w: 12, color: WHITE },
        { u: 0.5, w: 12, color: WHITE },
        { u: 0.95, w: 12, color: WHITE },
      ],
    },
    /** Three lanes (Vodno): worn edge lines and a dashed lane line each side of the middle lane. */
    road_tarmac_lanes: {
      seed: 9,
      len: 12,
      polish: 0.7,
      exposed: 0.55,
      cracks: 22,
      grain: 1,
      patches: 2,
      dust: 0.7,
      age: 0.7,
      lines: [
        { u: 0.05, w: 12, color: WHITE },
        { u: 0.95, w: 12, color: WHITE },
        { u: 0.34, w: 12, color: WHITE, dash: [3, 9] },
        { u: 0.66, w: 12, color: WHITE, dash: [3, 9] },
      ],
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

    // Bitumen base.
    const warm = o.age;
    cx.fillStyle = `rgb(${44 + warm * 10},${44 + warm * 8},${46 + warm * 4})`;
    cx.fillRect(0, 0, w, h);
    hx.fillStyle = grey(70);
    hx.fillRect(0, 0, w, h);
    rx.fillStyle = grey(235);
    rx.fillRect(0, 0, w, h);

    // Aggregate: dense crushed stone of mixed greys. Between the wheel paths more shows.
    const palette = [
      [50, 50, 52],
      [62, 61, 61],
      [74, 73, 71],
      [88, 86, 83],
      [96, 93, 89],
      [70, 67, 64],
    ].map(([r, g, b]) => [r + warm * 10, g + warm * 6, b - warm * 2]);
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
      const c = palette[Math.floor(Math.pow(rng.next(), 1.8) * palette.length)];
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

    // Wheel paths: a bitumen film that polishes (darker, roughness down, stones smoothed in the height).
    if (o.polish > 0)
      for (const u0 of [0.28, 0.72]) {
        for (const [ctx, c0] of [
          [cx, '30,30,32'],
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
          g.addColorStop(0.5, `rgba(${c0},${o.polish * 0.8})`);
          g.addColorStop(1, `rgba(${c0},0)`);
          ctx.fillStyle = g;
          ctx.fillRect((u0 - 0.1) * w, 0, 0.2 * w, h);
        }
      }

    // Slow tone variation (oxidation, binder bleed) as an overlay.
    {
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
      cx.globalAlpha = 0.55;
      cx.imageSmoothingEnabled = true;
      cx.drawImage(lo, 0, 0, w, h);
      cx.restore();
    }

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
          stroke(cx, snake ? 'rgba(14,14,16,0.85)' : 'rgba(12,12,14,0.8)', lw);
          stroke(hx, snake ? 'rgba(80,80,80,0.9)' : 'rgba(10,10,10,0.9)', lw);
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
        rng.range(1.0, 2.0),
        false,
      );
    }
    for (let i = 0; i < Math.round(o.cracks / 8); i++) {
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
    for (let i = 0; i < (o.anyDir ? 0 : 2); i++) {
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
      normal: normalFromHeight(height, size < 1024 ? 1.8 : 2.2),
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
