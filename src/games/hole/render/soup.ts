import { BufferGeometry, Color, Float32BufferAttribute } from 'three';

export type V3 = [number, number, number];

/**
 * Triangle soup with a flat colour per triangle: the ground, skirt, decals and
 * curbs are all built from it (one non-indexed geometry, flat shaded).
 */
export class Soup {
  pos: number[] = [];
  col: number[] = [];
  private c = new Color();

  get triangles(): number {
    return this.pos.length / 9;
  }

  tri(a: V3, b: V3, d: V3, color: number): void {
    this.c.setHex(color);
    for (const p of [a, b, d]) {
      this.pos.push(p[0], p[1], p[2]);
      this.col.push(this.c.r, this.c.g, this.c.b);
    }
  }

  /** Triangle wound so that its normal points to `n` (single-sided materials need the right winding). */
  triN(a: V3, b: V3, d: V3, color: number, n: V3): void {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = d[0] - a[0];
    const vy = d[1] - a[1];
    const vz = d[2] - a[2];
    const dot =
      (uy * vz - uz * vy) * n[0] +
      (uz * vx - ux * vz) * n[1] +
      (ux * vy - uy * vx) * n[2];
    if (dot >= 0) this.tri(a, b, d, color);
    else this.tri(a, d, b, color);
  }

  /** Axis-aligned flat quad facing up. */
  flat(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    y: number,
    color: number,
  ): void {
    this.tri([x0, y, z0], [x0, y, z1], [x1, y, z1], color);
    this.tri([x0, y, z0], [x1, y, z1], [x1, y, z0], color);
  }

  /** Any flat quad facing up (corners in order around it). */
  quad(p: [number, number][], y: number, color: number): void {
    const a: V3 = [p[0][0], y, p[0][1]];
    const b: V3 = [p[1][0], y, p[1][1]];
    const c: V3 = [p[2][0], y, p[2][1]];
    const d: V3 = [p[3][0], y, p[3][1]];
    this.triN(a, b, c, color, [0, 1, 0]);
    this.triN(a, c, d, color, [0, 1, 0]);
  }

  /** Flat disc / ring sector set facing up. `r0` > 0 makes a ring. */
  disc(
    cx: number,
    cz: number,
    r1: number,
    y: number,
    color: number,
    segments = 16,
    r0 = 0,
  ): void {
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const p1: [number, number] = [
        cx + Math.cos(a0) * r1,
        cz + Math.sin(a0) * r1,
      ];
      const p2: [number, number] = [
        cx + Math.cos(a1) * r1,
        cz + Math.sin(a1) * r1,
      ];
      if (r0 <= 0) {
        this.triN(
          [cx, y, cz],
          [p1[0], y, p1[1]],
          [p2[0], y, p2[1]],
          color,
          [0, 1, 0],
        );
      } else {
        const q1: [number, number] = [
          cx + Math.cos(a0) * r0,
          cz + Math.sin(a0) * r0,
        ];
        const q2: [number, number] = [
          cx + Math.cos(a1) * r0,
          cz + Math.sin(a1) * r0,
        ];
        this.quad([q1, p1, p2, q2], y, color);
      }
    }
  }

  /** Axis-aligned box without a bottom: top colour on +y, side colour on the four walls. */
  box(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    y0: number,
    y1: number,
    top: number,
    side: number,
  ): void {
    this.triN([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], top, [0, 1, 0]);
    this.triN([x0, y1, z0], [x1, y1, z1], [x1, y1, z0], top, [0, 1, 0]);
    const wall = (a: V3, b: V3, c: V3, d: V3, n: V3) => {
      this.triN(a, b, c, side, n);
      this.triN(a, c, d, side, n);
    };
    wall([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
    wall([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1]);
    wall([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [1, 0, 0]);
    wall([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]);
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return g;
  }
}
