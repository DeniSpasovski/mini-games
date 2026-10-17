import { BufferAttribute, BufferGeometry } from 'three';
import type { SpriteData } from './mesh';
import { headingAt, packSprite } from './sprite-attr';

/**
 * Cheap stand-ins derived from a crown's sprites at load (trees/Performance.md#mitigations), nothing baked or cached:
 *
 * - `quadSprites`: the same sprites as plain quads (4 vertices, 2 triangles) around each sprite's atlas outline. Far
 *   crowns draw these: the tight 6-8 vertex outline saves pixels that fail the alpha test, but a far crown is bound by
 *   vertices, not pixels. Every pixel the outline keeps, the quad keeps too (alpha-tested: the same image).
 * - `crownProxy`: the crown's shadow caster, a closed lathe (SIDES around, up to RINGS high) through the 90th
 *   percentile of the sprites' reach per height slice, so a cone crown casts a cone and a round one a ball, at ~100
 *   triangles instead of every sprite in the shadow pass. Its depth material punches leafy holes in it
 *   (trees/materials.ts `treeDepthMaterial('proxy')`).
 */

/** Vertices of sprite j in rank order: fans of `ends[j] - ends[j - 1]` indices = that / 3 + 2 vertices. */
function spriteVertices(s: SpriteData): Uint32Array {
  const first = new Uint32Array(s.count + 1);
  let v = 0;
  for (let j = 0; j < s.count; j++) {
    first[j] = v;
    v += (s.ends[j] - (j ? s.ends[j - 1] : 0)) / 3 + 2;
  }
  first[s.count] = v;
  return first;
}

export function quadSprites(s: SpriteData): {
  geometry: BufferGeometry;
  ends: Uint32Array;
} {
  const n = s.count;
  const first = spriteVertices(s);
  const pos = new Float32Array(n * 12);
  const nrm = new Float32Array(n * 12);
  const uv = new Float32Array(n * 8);
  const col = new Float32Array(n * 12);
  const wind = new Float32Array(n * 16);
  const spr = new Float32Array(n * 16);
  const rank = new Float32Array(n * 4);
  const index = new Uint32Array(n * 6);
  const ends = new Uint32Array(n);
  for (let j = 0; j < n; j++) {
    const v0 = first[j];
    const v1 = first[j + 1];
    // The outline's box in sprite offsets (x, y) and its uv: the atlas maps each axis linearly.
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    let u0 = 0;
    let u1 = 0;
    let w0 = 0;
    let w1 = 0;
    for (let v = v0; v < v1; v++) {
      const x = s.sprite[v * 4];
      const y = s.sprite[v * 4 + 1];
      if (x < x0) [x0, u0] = [x, s.uv[v * 2]];
      if (x > x1) [x1, u1] = [x, s.uv[v * 2]];
      if (y < y0) [y0, w0] = [y, s.uv[v * 2 + 1]];
      if (y > y1) [y1, w1] = [y, s.uv[v * 2 + 1]];
    }
    const corners: [number, number, number, number][] = [
      [x0, y0, u0, w0],
      [x1, y0, u1, w0],
      [x1, y1, u1, w1],
      [x0, y1, u0, w1],
    ];
    corners.forEach(([x, y, u, w], c) => {
      const q = j * 4 + c;
      pos.set(s.position.subarray(v0 * 3, v0 * 3 + 3), q * 3);
      nrm.set(s.normal.subarray(v0 * 3, v0 * 3 + 3), q * 3);
      col.set(s.color.subarray(v0 * 3, v0 * 3 + 3), q * 3);
      wind.set(s.wind.subarray(v0 * 4, v0 * 4 + 4), q * 4);
      packSprite(
        x,
        y,
        s.sprite[v0 * 4 + 2],
        headingAt(s.heading, v0),
        spr,
        q * 4,
      );
      uv[q * 2] = u;
      uv[q * 2 + 1] = w;
      rank[q] = s.rank[v0];
    });
    index.set(
      [j * 4, j * 4 + 1, j * 4 + 2, j * 4, j * 4 + 2, j * 4 + 3],
      j * 6,
    );
    ends[j] = (j + 1) * 6;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nrm, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.setAttribute('treeWind', new BufferAttribute(wind, 4));
  g.setAttribute('treeSprite', new BufferAttribute(spr, 4));
  g.setAttribute('treeRank', new BufferAttribute(rank, 1));
  g.setIndex(new BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return { geometry: g, ends };
}

const SIDES = 8;
const RINGS = 8;
/** A sprite's leaves reach about this share of its size from its centre (the outline is smaller than the quad). */
const SPRITE_REACH = 0.35;

export function crownProxy(s: SpriteData): BufferGeometry | null {
  const n = s.count;
  if (!n) return null;
  const first = spriteVertices(s);
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let j = 0; j < n; j++) {
    const v = first[j];
    const r = s.sprite[v * 4 + 2] * SPRITE_REACH;
    y0 = Math.min(y0, s.position[v * 3 + 1] - r);
    y1 = Math.max(y1, s.position[v * 3 + 1] + r);
  }
  const rings = Math.max(2, Math.min(RINGS, Math.round((y1 - y0) / 0.75)));
  // Per ring height: the reach of every sprite overlapping it; the ring radius is its 90th percentile.
  const reach: number[][] = Array.from({ length: rings + 1 }, () => []);
  for (let j = 0; j < n; j++) {
    const v = first[j];
    const r = s.sprite[v * 4 + 2] * SPRITE_REACH;
    const x = s.position[v * 3];
    const y = s.position[v * 3 + 1];
    const z = s.position[v * 3 + 2];
    const out = Math.hypot(x, z) + r;
    for (let k = 0; k <= rings; k++) {
      const ry = y0 + ((y1 - y0) * k) / rings;
      if (Math.abs(ry - y) <= r) reach[k].push(out);
    }
  }
  const radius = reach.map((list) => {
    if (!list.length) return 0;
    list.sort((a, b) => a - b);
    return list[Math.floor((list.length - 1) * 0.9)];
  });
  // Bottom and top close to a point on the axis.
  radius[0] = 0;
  radius[rings] = 0;
  const pos: number[] = [];
  const index: number[] = [];
  for (let k = 0; k <= rings; k++) {
    const y = y0 + ((y1 - y0) * k) / rings;
    for (let a = 0; a < SIDES; a++) {
      const t = (a / SIDES) * Math.PI * 2;
      pos.push(Math.cos(t) * radius[k], y, Math.sin(t) * radius[k]);
    }
  }
  for (let k = 0; k < rings; k++)
    for (let a = 0; a < SIDES; a++) {
      const i = k * SIDES + a;
      const j = k * SIDES + ((a + 1) % SIDES);
      index.push(i, i + SIDES, j, j, i + SIDES, j + SIDES);
    }
  const count = pos.length / 3;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(count * 2), 2));
  g.setAttribute(
    'color',
    new BufferAttribute(new Float32Array(count * 3).fill(1), 3),
  );
  // No limb sway (treeWind.z = 0): the trunk bend only, AO 1.
  const wind = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) wind[i * 4 + 3] = 1;
  g.setAttribute('treeWind', new BufferAttribute(wind, 4));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}
