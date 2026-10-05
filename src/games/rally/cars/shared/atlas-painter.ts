/**
 * Shared painter for STL-based cars: draws in car model space (metres, +X left,
 * +Y up, +Z forward) into the projection atlas written by
 * scripts/car-model/stl-to-glb.mjs (layout: the car's model.source.json "atlas"
 * block). Side shapes are drawn on both sides, top / end shapes are mirrored
 * across x = 0 unless `mirror` is false.
 */
export interface AtlasLayout {
  pxPerMetre: number;
  width: number;
  height: number;
  bounds: { x: number[]; y: number[]; z: number[] };
  charts: Record<string, number[]>;
}

export type Pt = [number, number];
/** One or several contours; several are filled even-odd (holes / islands). */
export type Shape = Pt[] | Pt[][];
type SideName = 'left' | 'right';

const contoursOf = (s: Shape): Pt[][] =>
  Array.isArray(s[0]?.[0]) ? (s as Pt[][]) : [s as Pt[]];

/** Flat `[a0, b0, a1, b1, ...]` contour (livery-shapes.json) -> points. */
export const flatPts = (flat: number[]): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
};

export const rect = (a0: number, b0: number, a1: number, b1: number): Pt[] => [
  [a0, b0],
  [a1, b0],
  [a1, b1],
  [a0, b1],
];

export function atlasKit(A: AtlasLayout) {
  const K = A.pxPerMetre;
  const B = A.bounds;
  const CH = A.charts as Record<
    'left' | 'right' | 'top' | 'front' | 'rear' | 'bottom',
    [number, number]
  >;
  const SIZE = {
    side: [B.z[1] - B.z[0], B.y[1] - B.y[0]],
    top: [B.z[1] - B.z[0], B.x[1] - B.x[0]],
    end: [B.x[1] - B.x[0], B.y[1] - B.y[0]],
  };

  /** Canvas px of a side point (z, y). */
  const sidePx = (s: SideName, z: number, y: number): Pt => [
    (CH[s][0] + (s === 'left' ? B.z[1] - z : z - B.z[0])) * K,
    (CH[s][1] + B.y[1] - y) * K,
  ];
  /** Canvas px of a top point (z, x). */
  const topPx = (z: number, x: number): Pt => [
    (CH.top[0] + B.z[1] - z) * K,
    (CH.top[1] + x - B.x[0]) * K,
  ];
  /** Canvas px of a front (x, y) / rear (x, y) point. */
  const frontPx = (x: number, y: number): Pt => [
    (CH.front[0] + x - B.x[0]) * K,
    (CH.front[1] + B.y[1] - y) * K,
  ];
  const rearPx = (x: number, y: number): Pt => [
    (CH.rear[0] + B.x[1] - x) * K,
    (CH.rear[1] + B.y[1] - y) * K,
  ];

  class Painter {
    constructor(readonly ctx: CanvasRenderingContext2D) {}

    private clipped(
      x: number,
      y: number,
      w: number,
      h: number,
      draw: () => void,
    ) {
      const c = this.ctx;
      c.save();
      c.beginPath();
      c.rect(x * K, y * K, w * K, h * K);
      c.clip();
      draw();
      c.restore();
    }

    private poly(contours: Pt[][], fill: string | CanvasPattern) {
      const c = this.ctx;
      c.fillStyle = fill;
      c.beginPath();
      for (const pts of contours) {
        pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
        c.closePath();
      }
      c.fill('evenodd');
    }

    /** Polygon(s) of (z, y) points on both sides, or only the car's `which` side. */
    side(
      shape: Shape,
      fill: string | CanvasPattern,
      which: SideName | 'both' = 'both',
    ) {
      const contours = contoursOf(shape);
      for (const s of ['left', 'right'] as const) {
        if (which !== 'both' && which !== s) continue;
        this.clipped(CH[s][0], CH[s][1], SIZE.side[0], SIZE.side[1], () =>
          this.poly(
            contours.map((pts) => pts.map(([z, y]) => sidePx(s, z, y))),
            fill,
          ),
        );
      }
    }

    sideCircle(z: number, y: number, r: number, fill: string) {
      const n = 24;
      this.side(
        Array.from({ length: n }, (_, i) => {
          const a = (i / n) * Math.PI * 2;
          return [z + Math.cos(a) * r, y + Math.sin(a) * r] as Pt;
        }),
        fill,
      );
    }

    /** Polygon of (z, x) points on the top chart; mirrored across x = 0 unless `mirror` is false. */
    top(shape: Shape, fill: string | CanvasPattern, mirror = true) {
      const contours = contoursOf(shape);
      this.clipped(CH.top[0], CH.top[1], SIZE.top[0], SIZE.top[1], () => {
        this.poly(
          contours.map((pts) => pts.map(([z, x]) => topPx(z, x))),
          fill,
        );
        if (mirror)
          this.poly(
            contours.map((pts) => pts.map(([z, x]) => topPx(z, -x))),
            fill,
          );
      });
    }

    /** Polygon of (x, y) points on the front / rear chart, mirrored unless `mirror` is false. */
    end(
      which: 'front' | 'rear',
      shape: Shape,
      fill: string | CanvasPattern,
      mirror = true,
    ) {
      const px = which === 'front' ? frontPx : rearPx;
      const contours = contoursOf(shape);
      this.clipped(CH[which][0], CH[which][1], SIZE.end[0], SIZE.end[1], () => {
        this.poly(
          contours.map((pts) => pts.map(([x, y]) => px(x, y))),
          fill,
        );
        if (mirror)
          this.poly(
            contours.map((pts) => pts.map(([x, y]) => px(-x, y))),
            fill,
          );
      });
    }

    endCircle(
      which: 'front' | 'rear',
      x: number,
      y: number,
      r: number,
      fill: string,
    ) {
      const n = 20;
      this.end(
        which,
        Array.from({ length: n }, (_, i) => {
          const a = (i / n) * Math.PI * 2;
          return [x + Math.cos(a) * r, y + Math.sin(a) * r] as Pt;
        }),
        fill,
      );
    }
  }
  /**
   * Matte-black texel patch (bottom chart origin): wheel arches and anything else the
   * converter maps to the `matte` chart. Painted black here, made rough + clearcoat-free
   * in car-model.ts through CarAtlas.matteRect.
   */
  const matteRect: [number, number, number, number] = (() => {
    const w = Math.ceil(A.width * K);
    const h = Math.ceil(A.height * K);
    const x = Math.round(CH.bottom[0] * K) - 12;
    const y = Math.round(CH.bottom[1] * K) - 11;
    return [x, y, Math.min(20, w - x), Math.min(18, h - y)];
  })();
  return { matteRect, Painter, K, B, CH, sidePx, topPx, frontPx, rearPx };
}
