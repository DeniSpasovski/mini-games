import { DoubleSide, Group, MeshStandardMaterial } from 'three';
import { chainLinkTexture } from '../engine/structure-textures';
import {
  Builder,
  bridgeMaterials,
  railing,
  STONE,
  type Row,
} from './bridge-mesh';
import { SLAB_T } from './portals';
import { newRoadQuery } from './road';
import { newPathQuery } from './real-data';
import { newWallQuery } from './retaining-walls';
import {
  APPROACH_WALL,
  CUT_RISE,
  CUT_SETBACK,
  UNDERPASS_WALL,
} from './terrain-gen';
import type { World } from './world';

/**
 * Retaining walls of the sheer cuts (RoadDef.cutWalls): wherever the land beside the stage road - or beside
 * a mainline carriageway of the divided highway (the far side of a sunken parkway) - is much higher than
 * the road, the terrain carve stays level out to a wall line and rises sheer; this mesh is the stone face
 * standing on that line, with a coping slab covering the gap to the land behind it and a steel railing on
 * top (the 1930s parkway look: coursed stone, picket railing). One mesh per run of road, both sides.
 */

const STEP = 2;
/** Street kinds that get walled overpass approaches. */
const STREETS = new Set([
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'living_street',
  'service',
]);
/** Walls lower than this are not built (the terrain slope reads fine) (m). */
const MIN_H = 0.9;
/** A carriageway's cut wall row with a surveyed wall this close behind its face is left to the survey (m). */
const SURVEY_NEAR = 3;
/** Underpass wall lines run this far past the ends of their way (m): a small overlap at the mitred joints. */
const WALL_EXT = 0.3;
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
  /** A railing / fence on top (the parkway's own walls; not the underpass walls: the road above is a plain wall top). */
  fence: boolean;
}

/** A road the walls follow: the stage road or a carriageway path. */
interface Line {
  length: number;
  /** The path this line runs beside (none = the stage road). */
  path?: number;
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
  /** No railing / fence on top of this line's walls (underpass trenches). */
  noFence?: boolean;
  /** The wall face stands at a constant offset from the road edge (underpass trenches: a straight wall, never re-fitted to the land). */
  straight?: boolean;
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

  // A wall under a deck stops below its soffit: its top (and the coping walk) must never come up through the road above.
  const dq = newPathQuery();
  const oq = newPathQuery();
  const soffitAt = (x: number, z: number): number => {
    let y = Infinity;
    const stage = gen.deckHeightAt(x, z);
    if (!Number.isNaN(stage)) y = stage - 0.3;
    if (net) {
      net.query(x, z, dq, 'tarmac', (qi) => !!net.paths[qi].bridge);
      if (dq.found && dq.distance <= dq.halfWidth + 1)
        y = Math.min(y, gen.pathHeight(dq.path, dq.along) - 0.3);
    }
    return y;
  };
  // Beside the parkway (the stage road or a carriageway, within its verge + cut-wall zone) an underpass wall never
  // stands above that road: the land higher up behind is the parkway's own cut, not the trench's.
  const wq = newRoadQuery();
  const sq = newWallQuery();
  const cq = newPathQuery();
  const zone = def.shoulder + cw.offset + CUT_SETBACK + 2;
  const parkwayCap = (x: number, z: number): number => {
    let y = Infinity;
    road.query(x, z, wq);
    if (wq.found && wq.distance <= wq.halfWidth + zone)
      y = road.at(wq.along).y + 0.2;
    if (net) {
      net.query(
        x,
        z,
        cq,
        'tarmac',
        (qi) => gen.isCarriageway(qi) || gen.isCarriagewayDeck(qi),
      );
      if (cq.found && cq.distance <= cq.halfWidth + zone)
        y = Math.min(y, gen.pathHeight(cq.path, cq.along) + 0.2);
    }
    return y;
  };

  // A paved road (street, ramp, carriageway) at height `y` under (x, z): no fence there.
  const fq = newPathQuery();
  const onStreet = (x: number, z: number, y: number): boolean => {
    if (!net) return false;
    net.query(x, z, fq, 'tarmac');
    return (
      fq.found &&
      fq.distance < net.halfWidthAt(fq.path, fq.along) &&
      Math.abs(gen.pathHeight(fq.path, fq.along) - y) < 1
    );
  };

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
    // One railing per run of consecutive fenced rows: filtering them into one list drew a single railing straight
    // across every gap (the rim fence ran over the junction plaza on top of a portal slab).
    const runs: WallRow[][] = [[]];
    for (const r of rows) {
      if (r.fence && r.top - r.y >= 1.4) runs[runs.length - 1].push(r);
      else if (runs[runs.length - 1].length) runs.push([]);
    }
    for (const high of runs) {
      if (high.length < 2) continue;
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

  interface FillRow {
    x: number;
    z: number;
    y: number;
    tx: number;
    tz: number;
    d: number;
    lat: number;
    bot: number;
  }
  /** One run of a retaining wall under the road edge: face and cap (no fence). */
  const buildFill = (rows: FillRow[]): void => {
    if (rows.length < 2) return;
    const conc = new Builder(4);
    const at = (r: FillRow, l: number) => ({
      x: r.x + r.tz * l,
      z: r.z - r.tx * l,
    });
    const sgn = Math.sign(rows[0].lat);
    // Face: from the foot (below the land) up to the sidewalk level.
    conc.wall(
      rows.map((r) => ({ ...at(r, r.lat), bot: r.bot, top: r.y + 0.14 })),
      CONC,
    );
    // Cap: a 0.4 m concrete course on the face line.
    const cr: Row[] = rows.map((r) => {
      const p = at(r, r.lat - sgn * 0.2);
      return {
        x: p.x,
        y: r.y + 0.14,
        z: p.z,
        tx: r.tx,
        tz: r.tz,
        d: r.d,
        hw: 0,
      };
    });
    conc.strip(
      cr,
      [-sgn * 0.2, 0, 0],
      [sgn * 0.2, 0, 0],
      [0.9, 0.88, 0.84],
      false,
    );
    // Square ends: the wall stops with a flat end face 0.4 m deep (a one-sided strip showed its open back as a slanted sliver
    // where the approach street meets the land).
    for (const r of [rows[0], rows[rows.length - 1]]) {
      const f = at(r, r.lat);
      const b = at(r, r.lat - sgn * 0.4);
      const top = r.y + 0.14;
      conc.wall(
        [
          { ...f, bot: r.bot, top },
          { ...b, bot: r.bot, top },
        ],
        CONC,
      );
    }
    group.add(conc.build(mats.concrete));
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
      const under = gen.isUnderpass(pi);
      if (!gen.isCarriageway(pi) && !gen.isCarriagewayDeck(pi) && !under)
        return;
      const L = net.lengths[pi];
      if (L < 8) return;
      // Direction of the underpass way that continues each end (start, end), pointing the same way as this one.
      const joint: ([number, number] | undefined)[] = [undefined, undefined];
      if (under)
        for (const [ei, at] of [
          [0, 0],
          [1, L],
        ] as const) {
          net.pointAt(pi, at, pa);
          net.paths.forEach((_q, qi) => {
            if (qi === pi || !gen.isUnderpass(qi)) return;
            const QL = net.lengths[qi];
            for (const qEnd of [false, true]) {
              net.pointAt(qi, qEnd ? QL : 0, pb);
              if (Math.hypot(pb.x - pa.x, pb.z - pa.z) > 0.5) continue;
              const c = { x: 0, z: 0 };
              net.pointAt(qi, qEnd ? QL - 3 : 3, c);
              // Away from the joint along q; flip so it continues this way's direction.
              let dx = c.x - pb.x;
              let dz = c.z - pb.z;
              if (ei === 0) [dx, dz] = [-dx, -dz];
              const n = Math.hypot(dx, dz) || 1;
              joint[ei] = [dx / n, dz / n];
            }
          });
        }
      lines.push({
        length: L,
        path: pi,
        at: (d) => {
          net.pointAt(pi, Math.max(0, d - 1.5), pa);
          net.pointAt(pi, Math.min(L, d + 1.5), pb);
          const tl = Math.hypot(pb.x - pa.x, pb.z - pa.z) || 1;
          let tx = (pb.x - pa.x) / tl;
          let tz = (pb.z - pa.z) / tl;
          // At a joint with the next way of the street the end is mitred to the mean direction: both walls end on
          // one face point (square ends left a slot / a fin at every bend).
          const j = d >= L - 1.5 ? joint[1] : d <= 1.5 ? joint[0] : undefined;
          if (j) {
            const k =
              1 - Math.min(1, Math.max(0, d >= L - 1.5 ? L - d : d) / 1.5);
            tx += (j[0] - tx) * 0.5 * k;
            tz += (j[1] - tz) * 0.5 * k;
            const n = Math.hypot(tx, tz) || 1;
            tx /= n;
            tz /= n;
          }
          net.pointAt(pi, d, pa);
          // Past an end (underpass lines overrun their way by WALL_EXT): along the end tangent.
          const over = d < 0 ? d : d > L ? d - L : 0;
          return {
            x: pa.x + tx * over,
            z: pa.z + tz * over,
            y: gen.pathHeight(pi, Math.min(L, Math.max(0, d))),
            tx,
            tz,
            hw: net.halfWidthAt(pi, d),
          };
        },
        skip: () => false,
        weight: (x, z, rise) => gen.pathCutWeightAt(x, z, rise, pi),
        offset: under ? UNDERPASS_WALL : cw.offset,
        noFence: under,
        straight: under,
        // An underpass street has concrete walls (NYC style); a carriageway path follows the stage road's style
        // where it runs beside it.
        concrete: (_d, x, z) =>
          under ||
          (road.query(x, z, rq).found &&
            rq.distance < 60 &&
            rq.along >= concreteFrom),
      });
    });
  }

  for (const line of lines) {
    for (const side of [1, -1] as const) {
      let rows: WallRow[] = [];
      let gap = 0;
      // Underpass walls overrun their way's ends: at a joint the next way's wall starts at another angle, square ends
      // left a wedge-shaped slot in the wall.
      const ext = line.straight ? WALL_EXT : 0;
      const last = line.length + ext;
      for (let d0 = -ext; d0 < last + STEP - 1e-6; d0 += STEP) {
        // The last sample is always the line's end (2 m steps stopped up to 2 m short: a slot at every joint).
        const d = Math.min(d0, last);
        const s = line.at(d);
        let top = NaN;
        let lat = side * (s.hw + line.offset - 0.05);
        let back = lat + side * (CUT_SETBACK + CUT_RISE + 0.35);
        // A carriageway's cut wall gives way to a surveyed wall standing there (one wall, the real line).
        const surveyed =
          line.path !== undefined &&
          !!gen.walls?.query(
            s.x + s.tz * (lat + side * 1.5),
            s.z - s.tx * (lat + side * 1.5),
            SURVEY_NEAR,
            sq,
          ).found;
        if (!line.skip(d) && !surveyed) {
          const lq = lat + side * (CUT_SETBACK + CUT_RISE + 0.45);
          const qx = s.x + s.tz * lq;
          const qz = s.z - s.tx * lq;
          const h = gen.height(qx, qz);
          // Only where the cut is really sheer (not at a side road's mouth, where the embankment stays gentle).
          const w = line.weight(s.x + s.tz * lat, s.z - s.tx * lat, h - s.y, d);
          if (h - s.y > MIN_H && w > 0.6) {
            // Under a deck: below its soffit (checked on the face line and on the coping walk behind it).
            // The highest land just behind the wall (a fill rising towards an abutment beyond the coping walk showed
            // as a rock edge over a wall that stopped at the nearer, lower land).
            let land = h;
            if (line.straight)
              for (const extra of [2, 4]) {
                const l2 = lq + side * extra;
                land = Math.max(
                  land,
                  Math.min(
                    gen.height(s.x + s.tz * l2, s.z - s.tx * l2),
                    soffitAt(s.x + s.tz * l2, s.z - s.tx * l2),
                  ),
                );
              }
            top = Math.min(
              land,
              soffitAt(s.x + s.tz * lat, s.z - s.tx * lat),
              soffitAt(s.x + s.tz * lq, s.z - s.tx * lq),
            );
            if (line.straight)
              top = Math.min(
                top,
                parkwayCap(s.x + s.tz * lat, s.z - s.tx * lat),
              );
            // Under a portal slab: below its soffit (the coping stood up through the street / junction box on top).
            const ph = gen.portals.at(s.x + s.tz * lat, s.z - s.tx * lat);
            if (
              ph &&
              ph.outside === 0 &&
              ph.lateral <= ph.latL + 1 &&
              ph.lateral >= ph.latR - 1
            )
              top = Math.min(top, ph.top - SLAB_T);
            // The face stands well in front of where the land actually rises - the mesh smears a
            // step over a cell, and a street at the rim overlapping the carriageway's edge can pull the step closer
            // than the wall line - never closer to the road than the verge.
            for (
              let l = s.hw + 0.3;
              !line.straight && l < Math.abs(lq) + 1;
              l += 0.25
            ) {
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
        // Never on another road: a ramp merging beside the parkway, a street at a junction mouth (the fence stood
        // across the merge lane).
        if (!Number.isNaN(top) && net) {
          const fx = s.x + s.tz * lat;
          const fz = s.z - s.tx * lat;
          net.query(
            fx,
            fz,
            oq,
            'tarmac',
            (qi) => qi !== line.path && !net.paths[qi].bridge,
          );
          if (
            oq.found &&
            oq.distance <= oq.halfWidth + 0.3 &&
            Math.abs(gen.pathHeight(oq.path, oq.along) - s.y) < 2
          )
            top = NaN;
          // ... nor on the stage road / its shoulder (an underpass wall's end reached into the parkway's edge).
          if (line.path !== undefined && !Number.isNaN(top)) {
            road.query(fx, fz, wq);
            if (
              wq.found &&
              !road.bridgeAt(wq.along) &&
              wq.distance <= wq.halfWidth + def.shoulder + 0.5
            )
              top = NaN;
          }
        }
        // A straight (underpass) wall does not open for a single sample that misses the test: hold the last top.
        if (Number.isNaN(top) && line.straight && rows.length && gap < 1) {
          gap++;
          top = Math.max(rows[rows.length - 1].top, s.y + MIN_H);
        } else if (!Number.isNaN(top)) gap = 0;
        const concrete = !Number.isNaN(top) && line.concrete(d, s.x, s.z);
        if (
          Number.isNaN(top) ||
          rows.length >= PIECE / STEP ||
          (rows.length && rows[0].concrete !== concrete)
        ) {
          const last = rows[rows.length - 1];
          const split =
            !Number.isNaN(top) && last && last.concrete === concrete;
          build(rows);
          // A piece boundary of a continuous wall: the next piece starts on the last row (no 2 m slot).
          rows = split ? [last] : [];
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
          // (not where a junction plaza paves over the wall top: the street continues at grade there; never on a street
          // at the wall top's level - a fence keeps a street off the drop, it never stands on one)
          fence:
            !line.noFence &&
            !gen.plazas.inside(s.x + s.tz * lat, s.z - s.tx * lat, 1) &&
            !onStreet(
              s.x + s.tz * (lat + Math.sign(lat) * 0.3),
              s.z - s.tx * (lat + Math.sign(lat) * 0.3),
              top,
            ),
        });
        if (Math.round(d + ext) % 100 === 0) yield;
      }
      build(rows);
      yield;
    }
  }
  // Surveyed retaining walls (MapDef.retainingWalls): the face on the line, from the foot to the top of the terrain's
  // step (TerrainGenerator.applyWalls), the coping walk over the step behind it; the parkway's style where they stand.
  const walls = gen.walls;
  if (walls) {
    const p = { x: 0, z: 0, tx: 0, tz: 0 };
    const sideAt = (w: number, a: number): number => {
      const acc = walls.acc[w];
      let i = 0;
      while (i < acc.length - 2 && acc[i + 1] < a) i++;
      return walls.sides[w][i] || walls.sides[w][i + 1];
    };
    for (let w = 0; w < walls.length; w++) {
      const acc = walls.acc[w];
      const L = acc[acc.length - 1];
      let rows: WallRow[] = [];
      for (let a0 = 0; a0 < L + STEP - 1e-6; a0 += STEP) {
        const a = Math.min(a0, L);
        walls.pointAt(w, a, p);
        const side = sideAt(w, a);
        const low = walls.valueAt(walls.lows[w], w, a);
        let top = walls.valueAt(walls.highs[w], w, a);
        const back = side * (CUT_SETBACK + CUT_RISE + 0.35);
        if (side) {
          const bx = p.x + p.tz * back;
          const bz = p.z - p.tx * back;
          top = Math.min(top, soffitAt(p.x, p.z), soffitAt(bx, bz));
          road.query(p.x, p.z, wq);
          // Not across a road (the line reaches a junction / the parkway's edge), nor where the stage road's own cut
          // wall already stands (a trench fill at the overlook): one wall, not two half a metre apart.
          const zone = def.shoulder + cw.offset + CUT_SETBACK + 2;
          if (
            (wq.found && wq.distance <= wq.halfWidth + def.shoulder) ||
            (wq.found &&
              wq.distance <= wq.halfWidth + zone &&
              gen.cutWeightAt(
                p.x,
                p.z,
                gen.naturalHeight(p.x, p.z, false) - wq.height,
                wq.along,
                wq.height,
              ) > 0.6) ||
            (net &&
              net.query(p.x, p.z, oq, 'tarmac', (qi) => !net.paths[qi].bridge)
                .found &&
              oq.distance <= oq.halfWidth + 0.3)
          )
            top = NaN;
        }
        if (!side || !(top - low > MIN_H)) {
          build(rows);
          rows = [];
          continue;
        }
        road.query(p.x, p.z, rq);
        rows.push({
          x: p.x,
          z: p.z,
          y: low,
          tx: p.tx,
          tz: p.tz,
          d: a,
          lat: side * 0.001,
          back,
          top,
          concrete: rq.found && rq.distance < 120 && rq.along >= concreteFrom,
          fence: !onStreet(
            p.x + p.tz * side * 0.3,
            p.z - p.tx * side * 0.3,
            top,
          ),
        });
        if (rows.length >= PIECE / STEP) {
          const last = rows[rows.length - 1];
          build(rows);
          rows = [last];
        }
      }
      build(rows);
      yield;
    }
  }
  // Overpass approaches: the streets within APPROACH_LEN m of an overpass deck end climb on a fill held by a concrete
  // retaining wall on each side (sheer terrain drop beyond APPROACH_WALL, see TerrainGenerator.carvePaths).
  if (net && gen.approaches.length) {
    const pa = { x: 0, z: 0 };
    const pb = { x: 0, z: 0 };
    for (const [pi, p] of net.paths.entries()) {
      if (p.bridge || p.surface !== 'tarmac' || !STREETS.has(p.kind)) continue;
      const L = net.lengths[pi];
      // Skip streets that never come near a deck end.
      let near = false;
      for (let a = 0; a <= L && !near; a += 6) {
        net.pointAt(pi, a, pa);
        near = gen.approachWeightAt(pa.x, pa.z) > 0.3;
      }
      if (!near) continue;
      for (const side of [1, -1] as const) {
        let rows: FillRow[] = [];
        const flush = () => {
          buildFill(rows);
          rows = [];
        };
        for (let a = 0; a <= L; a += STEP) {
          net.pointAt(pi, Math.max(0, a - 1.5), pa);
          net.pointAt(pi, Math.min(L, a + 1.5), pb);
          const tl = Math.hypot(pb.x - pa.x, pb.z - pa.z) || 1;
          const tx = (pb.x - pa.x) / tl;
          const tz = (pb.z - pa.z) / tl;
          net.pointAt(pi, a, pa);
          const y = gen.pathHeight(pi, a);
          const lat = side * (net.halfWidthAt(pi, a) + APPROACH_WALL - 0.05);
          // Land just beyond the wall: the wall stands only where the road is well above it.
          const g = gen.height(
            pa.x + tz * (lat + side * 1.4),
            pa.z - tx * (lat + side * 1.4),
          );
          if (y - g < MIN_H || gen.approachWeightAt(pa.x, pa.z) < 0.3) {
            flush();
            continue;
          }
          rows.push({ x: pa.x, z: pa.z, y, tx, tz, d: a, lat, bot: g - 0.5 });
          if (rows.length >= PIECE / STEP) {
            const last = rows[rows.length - 1];
            flush();
            rows.push(last); // the next piece starts on the last row: no slot in the wall
          }
        }
        flush();
      }
      yield;
    }
  }
  return group.children.length ? group : undefined;
}
