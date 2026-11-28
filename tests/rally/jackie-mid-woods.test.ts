import { describe, expect, rs, test } from '@rstest/core';
import { appendFileSync } from 'node:fs';
import { getAsset } from '../../src/games/rally/assets/library';
import { jackie2Map } from '../../src/games/rally/maps/jackie-2/map';
import { newRoadQuery } from '../../src/games/rally/world/road';
import type { ScatterInstance } from '../../src/games/rally/world/scatter';
import { World } from '../../src/games/rally/world/world';
import { isTreeType, speciesOfType } from '../../src/games/rally/trees/species';
import { generateVariant } from '../../src/games/rally/trees/variants';

/**
 * Jackie 2's woods from 1 200 to 5 400 m: the trees and plants beside the stage road and the share of bare ground near
 * its edge. The self-checks run before each review pass; the numbers go in its report (JACKIE_LOG=<file>).
 */
const noCtx: unknown = new Proxy(
  {},
  {
    get: (_, p) =>
      p === 'measureText'
        ? (t: string) => ({ width: t.length * 10 })
        : p === 'createImageData' || p === 'getImageData'
          ? (w: number, h: number) => ({
              data: new Uint8ClampedArray(w * h * 4),
            })
          : () => noCtx,
    set: () => true,
  },
);
rs.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
  noCtx as never,
);
const report = (m: string) => {
  console.info(m);
  if (process.env.JACKIE_LOG) appendFileSync(process.env.JACKIE_LOG, `${m}\n`);
};

const FROM = 1200;
const TO = 5400;
const BIN = 200;
const world = new World(jackie2Map);
const road = world.road;
const scatter = world.scatter;
const rq = newRoadQuery();
const cs = scatter.chunkSize;

/** The scatter chunks within 60 m of the stage road from FROM to TO. */
const chunks = new Set<string>();
for (let s = FROM - 50; s <= TO + 50; s += 8) {
  const m = road.at(s);
  for (let dx = -60; dx <= 60; dx += 20)
    for (let dz = -60; dz <= 60; dz += 20)
      chunks.add(
        `${Math.floor((m.x + dx) / cs)},${Math.floor((m.z + dz) / cs)}`,
      );
}
/** Each instance with its stage metre and distance from the road edge (m), when it is beside FROM..TO. */
const near: { i: ScatterInstance; s: number; d: number }[] = [];
const seen = new Set<ScatterInstance>();
for (const k of chunks) {
  const [cx, cz] = k.split(',').map(Number);
  for (const i of [
    ...scatter.chunk(cx, cz).instances,
    ...scatter.detail(cx, cz),
  ]) {
    if (seen.has(i)) continue;
    seen.add(i);
    road.query(i.x, i.z, rq);
    if (!rq.found || rq.along < FROM || rq.along >= TO) continue;
    near.push({ i, s: rq.along, d: Math.max(0, rq.distance - rq.halfWidth) });
  }
}
const isTree = (i: ScatterInstance) => !!i.tree || isTreeType(i.asset);

/** Triangles of an asset's nearest LOD (variant 0), 0 when it cannot be built here. */
const trisCache = new Map<string, number>();
const trisOf = (asset: string): number => {
  let n = trisCache.get(asset);
  if (n === undefined) {
    n = 0;
    try {
      // (the fern cards bake from an image, asynchronously: not here - their few quads are left out)
      if (asset.startsWith('fern')) n = 0;
      else if (isTreeType(asset)) {
        // (the branches and the leaf sprites)
        const m = generateVariant(speciesOfType(asset), 0).meshes;
        n = (m.levels[0].index.length + m.sprites.index.length) / 3;
      } else
        for (const p of getAsset(asset, 0, 0).parts)
          n += p.geometry.index
            ? p.geometry.index.count / 3
            : p.geometry.getAttribute('position').count / 3;
    } catch {
      n = 0;
    }
    trisCache.set(asset, n);
  }
  return n;
};

describe('Jackie 2 woods, 1 200 - 5 400 m', () => {
  test('trees per 200 m within 40 m of the road edge', () => {
    const bins = new Map<number, number>();
    for (const { i, s, d } of near)
      if (isTree(i) && d <= 40) {
        const b = Math.floor(s / BIN) * BIN;
        bins.set(b, (bins.get(b) ?? 0) + 1);
      }
    const row: string[] = [];
    let total = 0;
    for (let b = FROM; b < TO; b += BIN) {
      row.push(`${b}:${bins.get(b) ?? 0}`);
      total += bins.get(b) ?? 0;
    }
    report(`trees within 40 m per 200 m: ${row.join(' ')} (${total} in all)`);
    expect(total).toBeGreaterThan(0);
  });

  test('share of bare ground (grass weight under 0.5) and of woods floor within 15 m of the road edge', () => {
    const out = new Float32Array(4);
    const bins = new Map<number, [number, number, number]>();
    for (let s = FROM; s < TO; s += 2) {
      const m = road.at(s);
      const hw = m.halfWidth;
      for (const side of [-1, 1])
        for (let e = 1; e <= 15; e += 2) {
          const l = side * (hw + e);
          const x = m.x - m.tz * l;
          const z = m.z + m.tx * l;
          road.query(x, z, rq);
          // (only the land beside this road, not another road, deck or the street space)
          if (rq.found && rq.distance - rq.halfWidth < e - 0.5) continue;
          if (world.gen.netField?.occupied(x, z, 0.5)) continue;
          // (as the terrain mesh paints its vertices: the height first, then the splat from the road query it left)
          world.gen.meshHeight(x, z);
          const q = world.gen.lastRoad;
          world.gen.splat(
            x,
            z,
            0,
            q.found ? q.distance : Infinity,
            q.halfWidth,
            out,
            0.75,
          );
          const b = Math.floor(s / BIN) * BIN;
          const c = bins.get(b) ?? [0, 0, 0];
          c[0]++;
          // (the woods floor - leaf litter, its own splat - counted apart from bare ground)
          if (out[1] > 0.4) c[2]++;
          else if (out[0] < 0.5) c[1]++;
          bins.set(b, c);
        }
    }
    let n = 0;
    let bare = 0;
    let woods = 0;
    const row: string[] = [];
    const wrow: string[] = [];
    for (let b = FROM; b < TO; b += BIN) {
      const c = bins.get(b) ?? [0, 0, 0];
      n += c[0];
      bare += c[1];
      woods += c[2];
      row.push(`${b}:${c[0] ? Math.round((100 * c[1]) / c[0]) : '-'}`);
      wrow.push(`${b}:${c[0] ? Math.round((100 * c[2]) / c[0]) : '-'}`);
    }
    report(
      `bare ground (grass < 0.5, not woods floor) within 15 m of the edge, % per 200 m: ${row.join(' ')} (${Math.round((100 * bare) / Math.max(1, n))}% of ${n} points)`,
    );
    report(
      `woods floor (leaf litter) within 15 m of the edge, % per 200 m: ${wrow.join(' ')} (${Math.round((100 * woods) / Math.max(1, n))}%)`,
    );
    expect(n).toBeGreaterThan(0);
  });

  test('tree and plant instances and triangles beside the road (within 40 m of the edge)', () => {
    const byAsset = new Map<string, number>();
    for (const { i, d } of near)
      if (d <= 40) byAsset.set(i.asset, (byAsset.get(i.asset) ?? 0) + 1);
    let inst = 0;
    let tris = 0;
    const rows = [...byAsset]
      .sort((a, b) => b[1] - a[1])
      .map(([a, c]) => {
        const t = trisOf(a);
        inst += c;
        tris += c * t;
        return `${a} ${c} x ${t}`;
      });
    report(
      `instances within 40 m: ${inst}, LOD0 triangles ${Math.round(tris / 1000)}k | ${rows.join(', ')}`,
    );
    expect(inst).toBeGreaterThan(0);
  });
});
