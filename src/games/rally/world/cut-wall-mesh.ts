import { DoubleSide, Group, MeshStandardMaterial } from 'three';
import { chainLinkTexture } from '../engine/structure-textures';
import {
  Builder,
  bridgeMaterials,
  railing,
  STONE,
  type Row,
} from './bridge-mesh';
import { newRoadQuery } from './road';
import { CUT_RISE, CUT_SETBACK } from './terrain-gen';
import type { World } from './world';

/**
 * Retaining walls of the sheer cuts (RoadDef.cutWalls): wherever the land beside the stage road - or beside
 * a mainline carriageway of the divided highway (the far side of a sunken parkway) - is much higher than
 * the road, the terrain carve stays level out to a wall line and rises sheer; this mesh is the stone face
 * standing on that line, with a coping slab covering the gap to the land behind it and a steel railing on
 * top (the 1930s parkway look: coursed stone, picket railing). One mesh per run of road, both sides.
 */

const STEP = 2;
/** Walls lower than this are not built (the terrain slope reads fine) (m). */
const MIN_H = 0.9;
/** Longest piece of one mesh (m of road). */
const PIECE = 120;
/** Chain-link fence on a concrete wall: height (m), post spacing (m), mesh texture repeat (m). */
const FENCE_H = 2.2;
const POST_GAP = 3;
const MESH_TS = 1.6;
const CONC: [number, number, number] = [0.8, 0.78, 0.75];
const STEEL: [number, number, number] = [0.52, 0.54, 0.55];

let fenceMaterial: MeshStandardMaterial | undefined;
function chainLinkMaterial(): MeshStandardMaterial {
  return (fenceMaterial ??= new MeshStandardMaterial({
    map: chainLinkTexture(),
    transparent: true,
    alphaTest: 0.35,
    roughness: 0.6,
    metalness: 0.4,
    side: DoubleSide,
  }));
}

interface WallRow {
  /** Road centre + tangent. */
  x: number;
  z: number;
  y: number;
  tx: number;
  tz: number;
  d: number;
  /** Lateral offset of the wall face from the centre (signed). */
  lat: number;
  /** Lateral offset of the back of the coping walk (behind the terrain's rise, signed). */
  back: number;
  /** Height of the land behind the wall. */
  top: number;
  /** Concrete wall + chain-link fence instead of stone + railing. */
  concrete: boolean;
}

/** A road the walls follow: the stage road or a carriageway path. */
interface Line {
  length: number;
  at(d: number): {
    x: number;
    z: number;
    y: number;
    tx: number;
    tz: number;
    hw: number;
  };
  /** No wall here (a bridge span). */
  skip(d: number): boolean;
  /** 0..1 how sheer the cut is at (x, z) with the land `rise` m above the road. */
  weight(x: number, z: number, rise: number, d: number): number;
  /** Wall line beyond the road edge (m). */
  offset: number;
  /** The wall at `d` (point x, z) is concrete + chain-link. */
  concrete(d: number, x: number, z: number): boolean;
}

export function* cutWallMeshJob(
  world: World,
): Generator<void, Group | undefined> {
  const def = world.map.road;
  const cw = def.cutWalls;
  if (!cw) return undefined;
  const road = world.road;
  const gen = world.gen;
  const net = gen.paths;
  const group = new Group();
  group.name = 'cut-walls';
  const mats = bridgeMaterials();
  const concreteFrom = cw.concreteFrom ?? Infinity;
  const rq = newRoadQuery();

  const build = (rows: WallRow[]): void => {
    if (rows.length < 2) return;
    const stone = new Builder(2);
    const conc = new Builder(4);
    const metal = new Builder(1);
    const mesh = new Builder(MESH_TS);
    const concrete = rows[0].concrete;
    const at = (r: WallRow, l: number) => ({
      x: r.x + r.tz * l,
      z: r.z - r.tx * l,
    });
    // Face: from just below the road surface up to the land.
    (concrete ? conc : stone).wall(
      rows.map((r) => ({ ...at(r, r.lat), bot: r.y - 0.2, top: r.top })),
      concrete ? CONC : STONE,
    );
    // Coping: a concrete walk from the face to behind the sheer rise (the sidewalk behind the railing).
    const v0 = conc.pos.length / 3;
    for (const r of rows) {
      for (const l of [r.lat, r.back]) {
        const p = at(r, l);
        conc.pos.push(p.x, r.top + 0.02, p.z);
        conc.col.push(0.76, 0.75, 0.72);
        conc.uv.push(l / 4, r.d / 4);
      }
    }
    for (let i = 0; i < rows.length - 1; i++) {
      const p = v0 + i * 2;
      conc.idx.push(p, p + 2, p + 3, p, p + 3, p + 1);
    }
    // Coping course along the face edge (0.4 m wide, 0.12 m proud of the walk).
    const cr: Row[] = rows.map((r) => {
      const p = at(r, r.lat + Math.sign(r.lat) * 0.2);
      return { x: p.x, y: r.top, z: p.z, tx: r.tx, tz: r.tz, d: r.d, hw: 0 };
    });
    const sgn = Math.sign(rows[0].lat);
    const cope = concrete ? conc : stone;
    const copeCol = concrete ? CONC : STONE;
    cope.strip(cr, [-sgn * 0.2, 0, 0], [-sgn * 0.2, 0.14, 0], copeCol);
    cope.strip(
      cr,
      [-sgn * 0.2, 0.14, 0],
      [sgn * 0.2, 0.14, 0],
      [0.9, 0.88, 0.84],
      false,
    );
    cope.strip(cr, [sgn * 0.2, 0.14, 0], [sgn * 0.2, 0, 0], copeCol);
    // Railing / fence on the coping (set back 0.3 m from the face), on walls a driver can see over the parapet of.
    const high = rows.filter((r) => r.top - r.y >= 1.4);
    if (high.length >= 2) {
      const rr: Row[] = high.map((r) => {
        const l = r.lat + Math.sign(r.lat) * 0.3;
        const p = at(r, l);
        return { x: p.x, y: r.top, z: p.z, tx: r.tx, tz: r.tz, d: r.d, hw: 0 };
      });
      if (concrete) {
        // The mesh, a top rail and a post every 3 m (galvanised steel).
        const top = 0.14 + FENCE_H;
        mesh.strip(rr, [0, 0.14, 0], [0, top, 0], [1, 1, 1]);
        metal.strip(rr, [0, top, 0], [0, top + 0.05, 0], STEEL);
        let next = rr[0].d;
        for (const r of rr) {
          if (r.d < next) continue;
          next = r.d + POST_GAP;
          metal.box(
            r.x,
            r.z,
            r.tx,
            r.tz,
            0.05,
            0.05,
            r.y + 0.1,
            r.y + top + 0.05,
            STEEL,
          );
        }
      } else railing(metal, rr, 0, 0.02, 0);
    }
    if (!stone.empty()) group.add(stone.build(mats.stone));
    if (!conc.empty()) group.add(conc.build(mats.concrete));
    if (!metal.empty()) group.add(metal.build(mats.metal));
    if (!mesh.empty()) {
      const m = mesh.build(chainLinkMaterial());
      m.castShadow = false;
      group.add(m);
    }
  };

  const lines: Line[] = [
    {
      length: road.length,
      at: (d) => {
        const s = road.at(d);
        return { x: s.x, z: s.z, y: s.y, tx: s.tx, tz: s.tz, hw: s.halfWidth };
      },
      skip: (d) => !!road.bridgeAt(d),
      weight: (x, z, rise, d) => gen.cutWeightAt(x, z, rise, d, road.at(d).y),
      offset: def.shoulder + cw.offset,
      concrete: (d) => d >= concreteFrom,
    },
  ];
  if (net) {
    const pa = { x: 0, z: 0 };
    const pb = { x: 0, z: 0 };
    net.paths.forEach((_p, pi) => {
      if (!gen.isCarriageway(pi)) return;
      const L = net.lengths[pi];
      if (L < 8) return;
      lines.push({
        length: L,
        at: (d) => {
          net.pointAt(pi, Math.max(0, d - 1.5), pa);
          net.pointAt(pi, Math.min(L, d + 1.5), pb);
          const tl = Math.hypot(pb.x - pa.x, pb.z - pa.z) || 1;
          const tx = (pb.x - pa.x) / tl;
          const tz = (pb.z - pa.z) / tl;
          net.pointAt(pi, d, pa);
          return {
            x: pa.x,
            z: pa.z,
            y: gen.pathHeight(pi, d),
            tx,
            tz,
            hw: net.halfWidthAt(pi, d),
          };
        },
        skip: () => false,
        weight: (x, z, rise) => gen.pathCutWeightAt(x, z, rise, pi),
        offset: cw.offset,
        // A carriageway path follows the stage road's style where it runs beside it.
        concrete: (_d, x, z) =>
          road.query(x, z, rq).found &&
          rq.distance < 60 &&
          rq.along >= concreteFrom,
      });
    });
  }

  for (const line of lines) {
    for (const side of [1, -1] as const) {
      let rows: WallRow[] = [];
      for (let d = 0; d <= line.length; d += STEP) {
        const s = line.at(d);
        let top = NaN;
        let lat = side * (s.hw + line.offset - 0.05);
        let back = lat + side * (CUT_SETBACK + CUT_RISE + 0.35);
        if (!line.skip(d)) {
          const lq = lat + side * (CUT_SETBACK + CUT_RISE + 0.45);
          const qx = s.x + s.tz * lq;
          const qz = s.z - s.tx * lq;
          const h = gen.height(qx, qz);
          // Only where the cut is really sheer (not at a side road's mouth, where the embankment stays gentle).
          const w = line.weight(s.x + s.tz * lat, s.z - s.tx * lat, h - s.y, d);
          if (h - s.y > MIN_H && w > 0.6) {
            top = h;
            // The face stands well in front of where the land actually rises - the mesh smears a
            // step over a cell, and a street at the rim overlapping the carriageway's edge can pull the step closer
            // than the wall line - never closer to the road than the verge.
            for (let l = s.hw + 0.3; l < Math.abs(lq) + 1; l += 0.25) {
              const hx = gen.height(
                s.x + s.tz * l * side,
                s.z - s.tx * l * side,
              );
              if (hx - s.y > 0.8) {
                // 1.6 m: the smear of a step covers the cell before it too (the grid is not aligned to the road).
                lat = side * Math.max(s.hw + 0.3, l - 1.6);
                back = side * (l + CUT_RISE + 0.35);
                break;
              }
            }
          }
        }
        const concrete = !Number.isNaN(top) && line.concrete(d, s.x, s.z);
        if (
          Number.isNaN(top) ||
          rows.length >= PIECE / STEP ||
          (rows.length && rows[0].concrete !== concrete)
        ) {
          build(rows);
          rows = [];
          if (Number.isNaN(top)) continue;
        }
        rows.push({
          x: s.x,
          z: s.z,
          y: s.y,
          tx: s.tx,
          tz: s.tz,
          d,
          lat,
          back,
          top,
          concrete,
        });
        if (d % 100 === 0) yield;
      }
      build(rows);
      yield;
    }
  }
  return group.children.length ? group : undefined;
}
