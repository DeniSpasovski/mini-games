import { BufferAttribute, BufferGeometry, Vector2 } from 'three';
import { Noise2D, smoothstep } from '../../../../shared/noise';
import { hash3 } from '../../../../shared/rng';
import type { StaticCollider } from '../../physics/types';
import { tileOf } from '../ajvatovci/start-row/build/materials';
import type { Local } from '../ajvatovci/hilltop/build/shapes';
import { toWorld, type Site } from '../ajvatovci/hilltop/site';

/**
 * Heaps of dumped material for any map (road closures, depots, construction sites): sand (steep, round-crested, damp
 * patches, weeds), crushed stone (lower, angular) or stone pushed flat by a loader. Each heap is one smooth-shaded
 * mesh in a landmark bucket over the scanned material (kit keys `sand` / `aggregate`: Poly Haven `dense_sand` /
 * `gravel_floor_02`, scripts/props/bake-piles.py), its toe sunk into the ground, a ragged spill decal of the same
 * material round its foot, weeds on it and a cylinder collider. Pure geometry: `Piles` is built from a list in a site's
 * frame (local x, z, radius, height, kind); `seed` keeps the lumps / bites / weeds of two sites apart.
 */
export type PileKind = 'sand' | 'stone' | 'spread';
/** Local x, z (site frame), radius, height (m), kind. */
export type PileDef = [number, number, number, number, PileKind];

/** Vertex tints over the scans: warm ochre sand (light), pale grey limestone chips. */
const TINT: Record<PileKind, string> = {
  sand: '#fbe2ad',
  stone: '#cfccc6',
  spread: '#c6c3bd',
};
const SPILL_TINT: Record<PileKind, string> = {
  sand: '#e6d1a8',
  stone: '#c4c1bb',
  spread: '#c4c1bb',
};

export class Piles {
  private readonly noise: Noise2D;
  constructor(
    readonly site: Site,
    readonly list: readonly PileDef[],
    readonly seed = 0,
  ) {
    this.noise = new Noise2D(5711 + seed);
  }

  /** Pile `i`'s foot (m from its centre) at angle `a`: lumpy, longer one way (dumped off a truck). */
  radius(i: number, a: number): number {
    const ph = i * 1.7 + 0.4 + this.seed;
    return (
      this.list[i][2] *
      (1 +
        0.2 * Math.cos(2 * (a - ph)) +
        0.06 * Math.sin(3 * a + 2 * ph) +
        0.04 * Math.sin(5 * a - ph))
    );
  }

  /**
   * Height of pile `i` over the ground at (dx, dz) m from its centre (site axes): a cone at the angle of repose with a
   * round crest (sand, stone) or a flat top (spread), a concave toe that runs out into the ground, a loader's bite out
   * of one side and lumps; 0 beyond the foot.
   */
  height(i: number, dx: number, dz: number): number {
    const [x0, z0, , h, kind] = this.list[i];
    const a = Math.atan2(dz, dx);
    const t = Math.hypot(dx, dz) / this.radius(i, a);
    if (t >= 1) return 0;
    let g: number;
    if (kind === 'spread') g = (1 - smoothstep(0.3, 1, t)) ** 1.1;
    else {
      const k = kind === 'sand' ? 0.32 : 0.22;
      const cone =
        1 - (Math.sqrt(t * t + k * k) - k) / (Math.sqrt(1 + k * k) - k);
      g = cone ** (kind === 'sand' ? 1.35 : 1.25);
    }
    // The bite: a loader took a bucket out of one flank.
    const ab = i * 1.7 + 2.6 + this.seed;
    const da = Math.atan2(Math.sin(a - ab), Math.cos(a - ab));
    const bite =
      kind === 'spread'
        ? 0
        : Math.exp(-((da / 0.5) ** 2)) * smoothstep(0.1, 0.6, t);
    // Sand slumps smooth; crushed stone stays lumpy.
    const lumpy = kind === 'sand' ? 0.05 : 0.09;
    const lumps =
      this.noise.fbm((x0 + dx) / 0.8 + i * 7, (z0 + dz) / 0.8, 3) *
      (kind === 'spread' ? 0.06 * (1 - t ** 4) : lumpy * 4 * t * (1 - t));
    return Math.max(
      0,
      h * g * (1 - 0.3 * bite) + lumps * Math.min(1, 6 * (1 - t)),
    );
  }

  /**
   * Weeds on the piles and round their feet: dry grass and tufts on the sand (sunk a little into the slope), tall weeds
   * at the feet (site-local x, z, asset, lift over the ground).
   */
  plants(): [number, number, string, number][] {
    return this.list.flatMap(([x0, z0, , , kind], i) => {
      const out: [number, number, string, number][] = [];
      const n = kind === 'sand' ? 6 : kind === 'spread' ? 2 : 1;
      for (let j = 0; j < n; j++) {
        const a = (hash3(i, j, 3, 61 + this.seed) % 628) / 100;
        const t = 0.35 + ((hash3(i, j, 5, 61 + this.seed) % 100) / 100) * 0.55;
        const r = this.radius(i, a) * t;
        const dx = Math.cos(a) * r;
        const dz = Math.sin(a) * r;
        out.push([
          x0 + dx,
          z0 + dz,
          j % 2 ? 'grass_tuft' : 'dry_grass',
          this.height(i, dx, dz) - 0.08,
        ]);
      }
      if (kind !== 'spread')
        for (let j = 0; j < 2; j++) {
          const a = (hash3(i, j, 7, 61 + this.seed) % 628) / 100;
          const r = this.radius(i, a) * 1.08;
          out.push([
            x0 + Math.cos(a) * r,
            z0 + Math.sin(a) * r,
            'tall_weeds',
            0,
          ]);
        }
      return out;
    });
  }

  /** One cylinder per heap (a spread heap is low: a smaller one), from `y0` (world) up. */
  colliders(
    cylinder: (
      site: Site,
      x: number,
      z: number,
      y: number,
      r: number,
      h: number,
    ) => StaticCollider,
    y0: number,
  ): StaticCollider[] {
    return this.list.map(([x, z, r, h, kind]) =>
      cylinder(
        this.site,
        x,
        z,
        y0,
        r * (kind === 'spread' ? 0.6 : 0.75),
        h + 0.4,
      ),
    );
  }

  /** Every heap and its spill into `l` (a frame on `site`). */
  build(l: Local, ground: (x: number, z: number) => number): void {
    this.list.forEach((_, i) => this.heap(l, ground, i));
    this.spill(l, ground);
  }

  /**
   * Pile `i`: one smooth-shaded mesh (polar grid, `height` over the ground) in its scan, a little darker towards the foot,
   * sand with damp darker patches, the last ring sunk into the ground so it runs out under the road instead of ending on
   * an edge.
   */
  private heap(
    l: Local,
    ground: (x: number, z: number) => number,
    i: number,
  ): void {
    const RINGS = 14;
    const SEG = 44;
    const [x0, z0, , , kind] = this.list[i];
    const key = kind === 'sand' ? 'sand' : 'aggregate';
    const [tu, tv] = tileOf(key);
    const pos: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const vertex = (t: number, a: number): void => {
      const r = this.radius(i, a) * t;
      const dx = Math.cos(a) * r;
      const dz = Math.sin(a) * r;
      const [wx, wz] = toWorld(this.site, x0 + dx, z0 + dz);
      const sink = t > 1 ? 0.05 : 0;
      pos.push(
        x0 + dx,
        ground(wx, wz) - l.baseY + this.height(i, dx, dz) - sink,
        z0 + dz,
      );
      uv.push((x0 + dx + i * 3.7) / tu, (z0 + dz) / tv);
      let k =
        (1 - 0.14 * smoothstep(0.65, 1, t)) *
        (1 + 0.06 * this.noise.noise2(wx / 1.6 + i, wz / 1.6));
      if (kind === 'sand')
        // damp patches (rain soaks the lower flanks and the shaded side) and a paler, dried crest
        k *=
          (1 -
            0.22 *
              smoothstep(
                0.25,
                0.65,
                this.noise.fbm(wx / 1.3 + 40, wz / 1.3, 2),
              ) *
              smoothstep(0.3, 0.8, t)) *
          (1 + 0.06 * (1 - smoothstep(0, 0.4, t)));
      col.push(k, k, k);
    };
    vertex(0, 0);
    for (let k = 1; k <= RINGS; k++)
      for (let j = 0; j < SEG; j++)
        vertex(
          k === RINGS ? 1.06 : (k / (RINGS - 1)) ** 0.9,
          (j / SEG) * Math.PI * 2,
        );
    const idx: number[] = [];
    const at = (k: number, j: number) => 1 + (k - 1) * SEG + (j % SEG);
    // Counter-clockwise seen from above.
    for (let j = 0; j < SEG; j++) idx.push(0, at(1, j + 1), at(1, j));
    for (let k = 1; k < RINGS; k++)
      for (let j = 0; j < SEG; j++)
        idx.push(
          at(k, j),
          at(k, j + 1),
          at(k + 1, j),
          at(k, j + 1),
          at(k + 1, j + 1),
          at(k + 1, j),
        );
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
    g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    l.add(key, g, TINT[kind]);
  }

  /**
   * Material spilled round the heaps' feet onto the ground: one ragged decal of the heap's own scan round each (sand
   * round the sand), draped on the ground; it ends where the ground leaves the heap's level (a bank behind a heap), so it stays on the flat.
   */
  private spill(l: Local, ground: (x: number, z: number) => number): void {
    const SEG = 36;
    this.list.forEach(([x0, z0, , , kind], i) => {
      const outline: Vector2[] = [];
      const [cx, cz] = toWorld(this.site, x0, z0);
      const y0 = ground(cx, cz);
      const fan = kind === 'sand' ? 1.2 : 1.14;
      for (let j = 0; j < SEG; j++) {
        const a = (j / SEG) * Math.PI * 2;
        const reach =
          this.radius(i, a) *
          (fan +
            0.12 *
              this.noise.noise2(Math.cos(a) * 1.5 + i * 5, Math.sin(a) * 1.5));
        // Walk out from the heap and stop before the first step where the ground leaves the heap's level (a bank behind
        // it, a ditch): the spill lies on the flat it was tipped on, never up a slope.
        let r = 0.5;
        let [wx, wz] = toWorld(
          this.site,
          x0 + Math.cos(a) * r,
          z0 + Math.sin(a) * r,
        );
        while (r < reach) {
          const n = Math.min(reach, r + 0.25);
          const [nx, nz] = toWorld(
            this.site,
            x0 + Math.cos(a) * n,
            z0 + Math.sin(a) * n,
          );
          if (Math.abs(ground(nx, nz) - y0) > 0.15) break;
          r = n;
          wx = nx;
          wz = nz;
        }
        outline.push(new Vector2(wx - this.site.x, wz - this.site.z));
      }
      l.frame.polygon(
        kind === 'sand' ? 'sandSpill' : 'stoneSpill',
        outline,
        0,
        SPILL_TINT[kind],
        {
          lift: (x, z) => ground(x + this.site.x, z + this.site.z) + 0.09,
          step: 0.6,
        },
      );
    });
  }
}
