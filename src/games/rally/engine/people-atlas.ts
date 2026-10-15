import { Rng } from '../../../shared/rng';

/**
 * The people atlas (assets/builders/people.ts): 4 x 4 cells of 256 px, painted in grey so the vertex colours tint
 * them. Garment cells are UNWRAPPED: u runs round the body (0.5 = front, 0 / 1 = the back seam), v runs down it, so
 * zips, pockets, seams, creases and cuffs sit where they belong. The head owns two cells side by side (10 + 11).
 *
 *  0 jacket   1 knit / tee   2 hi-vis vest   3 sleeve
 *  4 jeans    5 trousers     6 skin          7 shoe upper
 *  8 sole     9 hair         10-11 head      12 cap / hat
 * 13 glove   14 reflective  15 bag
 */
export const PEOPLE_ATLAS_SIZE = 1024;
const S = 256;

type Ctx = CanvasRenderingContext2D;

export function drawPeopleAtlas(ctx: Ctx): void {
  const rng = new Rng(404);
  const P = {
    cell(
      i: number,
      base: number,
      wCells: number,
      fn: (ox: number, oy: number, w: number) => void,
    ) {
      const ox = (i % 4) * S;
      const oy = Math.floor(i / 4) * S;
      const w = S * wCells;
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, w, S);
      ctx.clip();
      ctx.fillStyle = `rgb(${base},${base},${base})`;
      ctx.fillRect(ox, oy, w, S);
      fn(ox, oy, w);
      ctx.restore();
    },
  };
  const line = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    style: string,
    width = 1,
    dash: number[] = [],
  ) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  /** A seam: a dark groove with a stitched highlight beside it. */
  const seam = (x0: number, y0: number, x1: number, y1: number, k = 1) => {
    line(x0, y0, x1, y1, `rgba(0,0,0,${0.5 * k})`, 2.6);
    line(
      x0 + 2.5,
      y0,
      x1 + 2.5,
      y1,
      `rgba(255,255,255,${0.35 * k})`,
      1.2,
      [4, 3],
    );
  };
  const blob = (
    cx: number,
    cy: number,
    r: number,
    rgba: string,
    sx = 1,
    sy = 1,
  ) => {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, rgba);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(sx, sy);
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
  };
  const speckle = (ox: number, oy: number, w: number, n: number, a: number) => {
    for (let k = 0; k < n; k++) {
      ctx.fillStyle =
        rng.next() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
      ctx.fillRect(ox + rng.next() * w, oy + rng.next() * S, 1.5, 1.5);
    }
  };
  /** Soft creases: dark band with a light edge, along a wobbly path. */
  const crease = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    a: number,
    wid: number,
  ) => {
    const mx = (x0 + x1) / 2 + rng.range(-8, 8);
    const my = (y0 + y1) / 2 + rng.range(-5, 5);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(0,0,0,${a})`;
    ctx.lineWidth = wid;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(mx, my, x1, y1);
    ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${a * 0.8})`;
    ctx.lineWidth = wid * 0.5;
    ctx.beginPath();
    ctx.moveTo(x0, y0 + wid);
    ctx.quadraticCurveTo(mx, my + wid, x1, y1 + wid);
    ctx.stroke();
    ctx.restore();
  };
  /** Edge shading where the garment turns away: the back seam (u 0 / 1) and the flanks. */
  const turn = (ox: number, oy: number, w: number) => {
    for (const [x, a] of [
      [0, 0.32],
      [w, 0.32],
    ] as const) {
      const g = ctx.createLinearGradient(
        ox + x,
        0,
        ox + (x === 0 ? w * 0.18 : w * 0.82),
        0,
      );
      g.addColorStop(0, `rgba(0,0,0,${a})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(ox, oy, w, S);
    }
  };
  const weave = (ox: number, oy: number, w: number, a: number, step = 2) => {
    for (let y = 0; y < S; y += step)
      line(ox, oy + y, ox + w, oy + y, `rgba(0,0,0,${a})`, 1);
    for (let x = 0; x < w; x += step + 1)
      line(ox + x, oy, ox + x, oy + S, `rgba(0,0,0,${a * 0.8})`, 1);
  };

  // 0 jacket: yoke, zip, slanted pockets, collar, rib hem, flank seams.
  P.cell(0, 250, 1, (ox, oy, w) => {
    weave(ox, oy, w, 0.045, 2);
    const g = ctx.createLinearGradient(0, oy, 0, oy + S);
    g.addColorStop(0, 'rgba(255,255,255,0.12)');
    g.addColorStop(0.55, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.16)');
    ctx.fillStyle = g;
    ctx.fillRect(ox, oy, w, S);
    seam(ox + w * 0.25, oy + S * 0.14, ox + w * 0.25, oy + S * 0.9);
    seam(ox + w * 0.75, oy + S * 0.14, ox + w * 0.75, oy + S * 0.9);
    seam(ox, oy + S * 0.2, ox + w, oy + S * 0.2, 0.7);
    // Zip with teeth, pull tab and the storm flap beside it.
    line(
      ox + w * 0.5,
      oy + S * 0.05,
      ox + w * 0.5,
      oy + S * 0.9,
      'rgba(0,0,0,0.65)',
      3,
    );
    line(
      ox + w * 0.5,
      oy + S * 0.05,
      ox + w * 0.5,
      oy + S * 0.9,
      'rgba(255,255,255,0.7)',
      1.2,
      [2, 2],
    );
    line(
      ox + w * 0.515,
      oy + S * 0.05,
      ox + w * 0.515,
      oy + S * 0.9,
      'rgba(0,0,0,0.25)',
      2,
    );
    ctx.fillStyle = 'rgba(30,30,30,0.9)';
    ctx.fillRect(ox + w * 0.5 - 2.5, oy + S * 0.06, 5, 12);
    // Slanted pockets.
    for (const s of [-1, 1]) {
      const x = ox + w * (0.5 + s * 0.2);
      line(
        x - s * 12,
        oy + S * 0.58,
        x + s * 20,
        oy + S * 0.74,
        'rgba(0,0,0,0.55)',
        2.4,
      );
      line(
        x + s * 20,
        oy + S * 0.74,
        x + s * 20,
        oy + S * 0.86,
        'rgba(0,0,0,0.45)',
        2,
      );
      line(
        x - s * 12,
        oy + S * 0.58 + 3,
        x + s * 20 - s * 2,
        oy + S * 0.74 + 3,
        'rgba(255,255,255,0.4)',
        1.2,
        [4, 3],
      );
    }
    // Collar stand and rib hem.
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(ox, oy, w, S * 0.07);
    for (let x = 0; x < w; x += 4)
      line(ox + x, oy + S * 0.9, ox + x, oy + S, 'rgba(0,0,0,0.3)', 1.5);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(ox, oy + S * 0.9, w, S * 0.1);
    for (let k = 0; k < 7; k++)
      crease(
        ox + rng.range(10, w - 10),
        oy + S * rng.range(0.45, 0.6),
        ox + rng.range(10, w - 10),
        oy + S * rng.range(0.52, 0.7),
        0.1,
        5,
      );
    turn(ox, oy, w);
    speckle(ox, oy, w, 300, 0.05);
  });

  // 1 knit / T-shirt: ribbed neckline, hem, belly creases.
  P.cell(1, 252, 1, (ox, oy, w) => {
    for (let x = 0; x < w; x += 2)
      line(ox + x, oy, ox + x, oy + S, 'rgba(0,0,0,0.06)', 1);
    for (let y = 0; y < S; y += 3)
      line(ox, oy + y, ox + w, oy + y, 'rgba(0,0,0,0.04)', 1);
    // Neckline.
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(ox + w * 0.5, oy, w * 0.14, S * 0.11, 0, 0, Math.PI);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(ox + w * 0.5, oy, w * 0.15, S * 0.12, 0, 0, Math.PI);
    ctx.stroke();
    seam(ox + w * 0.25, oy + S * 0.15, ox + w * 0.25, oy + S * 0.92, 0.6);
    seam(ox + w * 0.75, oy + S * 0.15, ox + w * 0.75, oy + S * 0.92, 0.6);
    line(ox, oy + S * 0.93, ox + w, oy + S * 0.93, 'rgba(0,0,0,0.35)', 2);
    line(
      ox,
      oy + S * 0.945,
      ox + w,
      oy + S * 0.945,
      'rgba(255,255,255,0.4)',
      1,
      [4, 3],
    );
    for (let k = 0; k < 9; k++) {
      const y = oy + S * rng.range(0.4, 0.8);
      crease(
        ox + w * rng.range(0.15, 0.4),
        y,
        ox + w * rng.range(0.55, 0.85),
        y + rng.range(-8, 8),
        0.1,
        6,
      );
    }
    turn(ox, oy, w);
    speckle(ox, oy, w, 400, 0.05);
  });

  // 2 hi-vis vest: mesh, front opening with a hook strip, hem, shoulder straps.
  P.cell(2, 252, 1, (ox, oy, w) => {
    for (let y = 2; y < S; y += 4)
      for (let x = (y / 4) % 2 ? 2 : 0; x < w; x += 4) {
        ctx.fillStyle = 'rgba(0,0,0,0.16)';
        ctx.fillRect(ox + x, oy + y, 2, 2);
      }
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(ox + w * 0.5 - 7, oy, 14, S);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(ox + w * 0.5 - 4, oy + S * 0.04, 8, S * 0.9);
    for (let y = S * 0.06; y < S * 0.92; y += 5)
      line(
        ox + w * 0.5 - 4,
        oy + y,
        ox + w * 0.5 + 4,
        oy + y,
        'rgba(0,0,0,0.28)',
        1,
      );
    seam(ox + w * 0.25, oy, ox + w * 0.25, oy + S, 0.7);
    seam(ox + w * 0.75, oy, ox + w * 0.75, oy + S, 0.7);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(ox, oy + S * 0.94, w, S * 0.06);
    line(
      ox,
      oy + S * 0.94,
      ox + w,
      oy + S * 0.94,
      'rgba(255,255,255,0.45)',
      1.5,
      [5, 3],
    );
    for (let k = 0; k < 6; k++)
      crease(
        ox + rng.range(10, w - 10),
        oy + S * rng.range(0.3, 0.7),
        ox + rng.range(10, w - 10),
        oy + S * rng.range(0.4, 0.75),
        0.1,
        6,
      );
    turn(ox, oy, w);
  });

  // 3 sleeve: u round the arm, v shoulder (0) to cuff (1): armhole seam, elbow creases, cuff.
  P.cell(3, 250, 1, (ox, oy, w) => {
    weave(ox, oy, w, 0.045, 2);
    seam(ox, oy + S * 0.06, ox + w, oy + S * 0.06, 0.8);
    seam(ox + w * 0.02, oy, ox + w * 0.02, oy + S, 0.6);
    for (let k = 0; k < 6; k++) {
      const y = oy + S * (0.42 + k * 0.035);
      crease(ox, y, ox + w, y + rng.range(-6, 6), 0.13, 5);
    }
    for (let k = 0; k < 5; k++) {
      const y = oy + S * (0.1 + k * 0.05);
      crease(ox + w * 0.2, y, ox + w * 0.8, y + 12, 0.07, 6);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(ox, oy + S * 0.86, w, S * 0.14);
    for (let x = 0; x < w; x += 4)
      line(ox + x, oy + S * 0.86, ox + x, oy + S, 'rgba(0,0,0,0.3)', 1.5);
    line(ox, oy + S * 0.86, ox + w, oy + S * 0.86, 'rgba(0,0,0,0.5)', 2);
    speckle(ox, oy, w, 250, 0.05);
  });

  // 4 jeans: twill, side seams with stitching, fly / pocket at the top, whiskers, knee creases, hem.
  P.cell(4, 238, 1, (ox, oy, w) => {
    for (let k = -S; k < w + S; k += 3)
      line(ox + k, oy, ox + k + S, oy + S, 'rgba(0,10,50,0.14)', 1);
    blob(ox + w * 0.5, oy + S * 0.15, 60, 'rgba(255,255,255,0.22)', 1.4, 1);
    blob(ox + w * 0.5, oy + S * 0.5, 40, 'rgba(255,255,255,0.18)', 1.6, 0.7);
    // Front pocket curve and rivets.
    ctx.strokeStyle = 'rgba(255,230,160,0.6)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(ox + w * 0.36, oy + S * 0.02, S * 0.2, 0.2, 1.4);
    ctx.stroke();
    ctx.setLineDash([]);
    seam(ox + w * 0.25, oy, ox + w * 0.25, oy + S * 0.96, 1.2);
    seam(ox + w * 0.75, oy, ox + w * 0.75, oy + S * 0.96, 1.2);
    // Whiskers at the hip and honeycomb creases behind the knee.
    for (let k = 0; k < 12; k++) {
      const x = ox + w * rng.range(0.3, 0.7);
      line(
        x,
        oy + S * 0.12,
        x + rng.range(-30, 30),
        oy + S * rng.range(0.22, 0.32),
        'rgba(255,255,255,0.22)',
        2,
      );
    }
    for (let k = 0; k < 7; k++)
      crease(
        ox + w * rng.range(0.28, 0.4),
        oy + S * (0.52 + k * 0.025),
        ox + w * rng.range(0.6, 0.72),
        oy + S * (0.52 + k * 0.025) + 6,
        0.16,
        4,
      );
    // Hem fold.
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(ox, oy + S * 0.93, w, S * 0.07);
    line(
      ox,
      oy + S * 0.93,
      ox + w,
      oy + S * 0.93,
      'rgba(255,230,160,0.7)',
      1.5,
      [5, 3],
    );
    turn(ox, oy, w);
    speckle(ox, oy, w, 400, 0.06);
  });

  // 5 trousers: crease line down the front, fine weave, knee creases, hem.
  P.cell(5, 248, 1, (ox, oy, w) => {
    weave(ox, oy, w, 0.05, 2);
    line(ox + w * 0.5, oy, ox + w * 0.5, oy + S * 0.93, 'rgba(0,0,0,0.18)', 3);
    line(
      ox + w * 0.5 + 3,
      oy,
      ox + w * 0.5 + 3,
      oy + S * 0.93,
      'rgba(255,255,255,0.25)',
      2,
    );
    seam(ox + w * 0.25, oy, ox + w * 0.25, oy + S * 0.96, 0.8);
    seam(ox + w * 0.75, oy, ox + w * 0.75, oy + S * 0.96, 0.8);
    for (let k = 0; k < 6; k++)
      crease(
        ox + w * 0.3,
        oy + S * (0.5 + k * 0.03),
        ox + w * 0.7,
        oy + S * (0.5 + k * 0.03) + 5,
        0.12,
        5,
      );
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(ox, oy + S * 0.93, w, S * 0.07);
    turn(ox, oy, w);
    speckle(ox, oy, w, 300, 0.05);
  });

  // 6 skin (arms, legs, neck, hands): warm mottling, a highlight along the front, elbow / knee shading.
  P.cell(6, 252, 1, (ox, oy, w) => {
    for (let k = 0; k < 50; k++)
      blob(
        ox + rng.next() * w,
        oy + rng.next() * S,
        rng.range(14, 30),
        `rgba(190,130,110,${0.03 + rng.next() * 0.04})`,
      );
    blob(ox + w * 0.5, oy + S * 0.5, 120, 'rgba(255,255,255,0.12)', 0.5, 1.6);
    blob(ox + w * 0.5, oy + S * 0.5, 30, 'rgba(120,70,50,0.18)', 3, 0.5);
    turn(ox, oy, w);
    speckle(ox, oy, w, 250, 0.04);
  });

  // 7 shoe upper (side view, heel left, toe right): grain, toe cap, laces, heel counter, collar.
  P.cell(7, 232, 1, (ox, oy, w) => {
    speckle(ox, oy, w, 900, 0.1);
    blob(ox + w * 0.3, oy + S * 0.3, 60, 'rgba(255,255,255,0.25)', 1.4, 0.7);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(
      ox + w * 0.85,
      oy + S * 0.75,
      w * 0.2,
      S * 0.3,
      0,
      Math.PI * 1.1,
      Math.PI * 1.9,
    );
    ctx.stroke();
    for (let k = 0; k < 6; k++) {
      const x = ox + w * (0.42 + k * 0.07);
      line(x, oy + S * 0.18, x + 6, oy + S * 0.42, 'rgba(255,255,255,0.7)', 3);
      line(x + 1, oy + S * 0.2, x + 7, oy + S * 0.44, 'rgba(0,0,0,0.3)', 1);
    }
    seam(ox + w * 0.2, oy + S * 0.1, ox + w * 0.14, oy + S * 0.9, 0.9);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(ox, oy, w * 0.3, S * 0.1);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(ox, oy + S * 0.9, w, S * 0.1);
  });

  // 8 sole: rubber, tread grooves.
  P.cell(8, 190, 1, (ox, oy, w) => {
    for (let y = 8; y < S; y += 12)
      line(ox, oy + y, ox + w, oy + y + 4, 'rgba(0,0,0,0.5)', 3);
    for (let x = 8; x < w; x += 20)
      line(ox + x, oy, ox + x, oy + S, 'rgba(0,0,0,0.18)', 2);
    speckle(ox, oy, w, 600, 0.1);
  });

  // 9 hair: strands with a sheen band, darker roots.
  P.cell(9, 200, 1, (ox, oy, w) => {
    for (let k = 0; k < 420; k++) {
      const x = ox + rng.next() * w;
      const y = oy + rng.next() * S * 0.8;
      ctx.strokeStyle =
        rng.next() < 0.6
          ? `rgba(0,0,0,${0.15 + rng.next() * 0.3})`
          : `rgba(255,255,255,${0.1 + rng.next() * 0.2})`;
      ctx.lineWidth = 0.8 + rng.next();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(
        x + rng.range(-5, 5),
        y + 40,
        x + rng.range(-8, 8),
        y + 50 + rng.next() * 70,
      );
      ctx.stroke();
    }
    const g = ctx.createLinearGradient(0, oy, 0, oy + S);
    g.addColorStop(0, 'rgba(0,0,0,0.4)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = g;
    ctx.fillRect(ox, oy, w, S);
  });

  // 10-11 head (two cells wide): u = angle round the head (0.5 = face), v = chin (1) to crown (0).
  P.cell(10, 252, 2, (ox, oy, w) => {
    const X = (fu: number) => ox + w * fu;
    const Y = (fv: number) => oy + S * fv;
    for (let k = 0; k < 70; k++)
      blob(
        ox + rng.next() * w,
        oy + rng.next() * S,
        rng.range(14, 30),
        `rgba(190,130,110,${0.025 + rng.next() * 0.035})`,
      );
    speckle(ox, oy, w, 500, 0.04);
    // Forehead highlight, temples, cheeks, jaw and neck shade.
    blob(X(0.5), Y(0.3), 60, 'rgba(255,255,255,0.18)', 1.5, 0.8);
    blob(X(0.4), Y(0.68), 26, 'rgba(210,110,100,0.3)');
    blob(X(0.6), Y(0.68), 26, 'rgba(210,110,100,0.3)');
    blob(X(0.5), Y(0.97), 90, 'rgba(80,40,30,0.4)', 2.2, 0.5);
    // Ears (u ~ 0.25 / 0.75).
    for (const fu of [0.25, 0.75]) {
      ctx.fillStyle = 'rgba(190,110,95,0.5)';
      ctx.beginPath();
      ctx.ellipse(X(fu), Y(0.5), 12, 24, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(90,40,30,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(X(fu), Y(0.5), 8, 0.5, 4.2);
      ctx.stroke();
    }
    // Eyes.
    for (const s of [-1, 1]) {
      const ex = X(0.5 + s * 0.058);
      const ey = Y(0.43);
      blob(ex, ey - 8, 20, 'rgba(110,60,50,0.28)', 1.3, 0.7);
      ctx.fillStyle = 'rgb(252,250,248)';
      ctx.beginPath();
      ctx.ellipse(ex, ey, 12, 6.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgb(88,62,44)';
      ctx.beginPath();
      ctx.arc(ex, ey, 5.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgb(18,14,14)';
      ctx.beginPath();
      ctx.arc(ex, ey, 2.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(ex - 3, ey - 3.5, 2.2, 2.2);
      ctx.strokeStyle = 'rgba(40,24,18,0.95)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.ellipse(ex, ey, 12.5, 7, 0, Math.PI * 1.02, Math.PI * 1.98);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(120,70,60,0.55)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(ex, ey + 1, 12, 7, 0, 0.1, Math.PI - 0.1);
      ctx.stroke();
      // Brow: thick, slanted up towards the temple.
      ctx.strokeStyle = 'rgba(35,22,16,0.9)';
      ctx.lineWidth = 4.4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ex - s * 14, Y(0.34) + 1);
      ctx.quadraticCurveTo(ex, Y(0.31), ex + s * 15, Y(0.345));
      ctx.stroke();
    }
    // Nose: bridge shade, nostrils, tip highlight.
    blob(X(0.5), Y(0.56), 11, 'rgba(110,60,45,0.28)', 0.6, 2);
    ctx.fillStyle = 'rgba(70,30,22,0.7)';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(X(0.5 + s * 0.016), Y(0.64), 3.6, 2.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    blob(X(0.5), Y(0.6), 9, 'rgba(255,255,255,0.3)');
    // Mouth.
    ctx.fillStyle = 'rgb(196,108,106)';
    ctx.beginPath();
    ctx.moveTo(X(0.5 - 0.044), Y(0.755));
    ctx.quadraticCurveTo(X(0.5 - 0.015), Y(0.735), X(0.5), Y(0.745));
    ctx.quadraticCurveTo(X(0.5 + 0.015), Y(0.735), X(0.5 + 0.044), Y(0.755));
    ctx.quadraticCurveTo(X(0.5), Y(0.8), X(0.5 - 0.044), Y(0.755));
    ctx.fill();
    ctx.strokeStyle = 'rgba(80,28,28,0.9)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(X(0.5 - 0.046), Y(0.756));
    ctx.quadraticCurveTo(X(0.5), Y(0.768), X(0.5 + 0.046), Y(0.756));
    ctx.stroke();
    blob(X(0.5), Y(0.84), 14, 'rgba(110,60,45,0.2)', 1.6, 0.7);
  });

  // 12 cap / beanie / hood fabric: panels meeting at the crown, brim stitching, band.
  P.cell(12, 250, 1, (ox, oy, w) => {
    weave(ox, oy, w, 0.05, 2);
    for (let k = 0; k < 6; k++)
      seam(ox + (k / 6) * w, oy, ox + (k / 6) * w, oy + S * 0.85, 0.9);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(ox, oy + S * 0.86, w, S * 0.14);
    for (let x = 0; x < w; x += 4)
      line(ox + x, oy + S * 0.86, ox + x, oy + S, 'rgba(0,0,0,0.25)', 1.5);
    blob(ox + w * 0.5, oy + S * 0.05, 30, 'rgba(0,0,0,0.3)');
    speckle(ox, oy, w, 250, 0.05);
  });

  // 13 gloves / leather: grain, finger seams, knuckle shading.
  P.cell(13, 205, 1, (ox, oy, w) => {
    speckle(ox, oy, w, 800, 0.1);
    for (let k = 1; k < 4; k++)
      line(
        ox + w * (k / 4),
        oy + S * 0.4,
        ox + w * (k / 4),
        oy + S,
        'rgba(0,0,0,0.45)',
        2.4,
      );
    seam(ox, oy + S * 0.4, ox + w, oy + S * 0.4, 0.6);
    blob(ox + w * 0.5, oy + S * 0.45, 70, 'rgba(255,255,255,0.18)', 1.6, 0.6);
  });

  // 14 reflective tape: silver with a fine micro-prism grid.
  P.cell(14, 250, 1, (ox, oy, w) => {
    for (let y = 0; y < S; y += 4)
      line(ox, oy + y, ox + w, oy + y + 2, 'rgba(0,0,0,0.12)', 1);
    for (let x = 0; x < w; x += 4)
      line(ox + x, oy, ox + x + 2, oy + S, 'rgba(0,0,0,0.1)', 1);
    const g = ctx.createLinearGradient(0, oy, 0, oy + S);
    g.addColorStop(0, 'rgba(255,255,255,0.3)');
    g.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = g;
    ctx.fillRect(ox, oy, w, S);
  });

  // 15 bag fabric: cordura weave, zip, pocket flap with a buckle strap.
  P.cell(15, 226, 1, (ox, oy, w) => {
    for (let k = -S; k < w + S; k += 3) {
      line(ox + k, oy, ox + k + S, oy + S, 'rgba(0,0,0,0.1)', 1);
      line(ox + k + S, oy, ox + k, oy + S, 'rgba(0,0,0,0.08)', 1);
    }
    seam(ox + w * 0.1, oy + S * 0.12, ox + w * 0.9, oy + S * 0.12, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(ox + w * 0.15, oy + S * 0.55, w * 0.7, S * 0.35);
    seam(ox + w * 0.15, oy + S * 0.55, ox + w * 0.85, oy + S * 0.55, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(ox + w * 0.46, oy + S * 0.5, w * 0.08, S * 0.12);
    turn(ox, oy, w);
  });
}

/** A tangent-space normal map from the atlas luminance (Sobel), for stitching, weave and creases. */
export function drawPeopleNormal(ctx: Ctx, src: HTMLCanvasElement): void {
  const n = PEOPLE_ATLAS_SIZE;
  const sctx = src.getContext('2d', { willReadFrequently: true })!;
  const a = sctx.getImageData(0, 0, n, n).data;
  const out = ctx.createImageData(n, n);
  const h = (x: number, y: number) =>
    a[
      (Math.min(n - 1, Math.max(0, y)) * n + Math.min(n - 1, Math.max(0, x))) *
        4
    ];
  const k = 0.9;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) / 255;
      const dy = (h(x, y + 1) - h(x, y - 1)) / 255;
      let nx = -dx * k * 4;
      let ny = dy * k * 4;
      const nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      const i = (y * n + x) * 4;
      out.data[i] = (nx * 0.5 + 0.5) * 255;
      out.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      out.data[i + 2] = ((nz / l) * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  ctx.putImageData(out, 0, 0);
}
