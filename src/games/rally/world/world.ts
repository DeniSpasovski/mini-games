import { Vector3 } from 'three';
import type { MapDef } from '../maps/shared/types';
import { SURFACES, type SurfaceId } from '../physics/surfaces';
import type {
  GroundProvider,
  GroundSample,
  StaticCollider,
} from '../physics/types';
import { BuildingIndex, buildingCollider, buildingInstance } from './buildings';
import { AnalyticTerrain, Heightfield } from './heightfield';
import { landmarksOf, type Landmark } from './landmarks';
import {
  barrierColliders,
  barrierRuns,
  pathBarrierRuns,
  type BarrierRun,
} from './barriers';
import { newPathQuery } from './real-data';
import { newRoadQuery, type Road } from './road';
import {
  roadsideInstances,
  ScatterField,
  type ScatterInstance,
} from './scatter';
import { overheadSigns, type OverheadSigns } from './overhead-signs';
import { stageSigns, type StageSigns } from './stage-signs';
import { nearestRoadPoint } from './road-distance';
import {
  powerNetwork,
  supportInstances,
  type PowerSupport,
  type PowerSpan,
} from './power-lines';
import { streetDetail, type StreetDetail } from './street-detail';
import { goreCushions, goreWedges } from './gore';
import { streetDressingInstances } from './street-dressing';
import {
  DECK_OVERHANG,
  PARAPET_H,
  PARAPET_T,
  PIER_GAP,
  SLAB_T,
} from './portals';
import { DECK_DEPTH, TerrainGenerator } from './terrain-gen';

/**
 * Everything about a map that is not rendering: terrain, road, scatter,
 * colliders, stage layout. Implements the physics GroundProvider.
 * Safe to construct in tests (no DOM / WebGL).
 */
export interface Spawn {
  /** Ground position. */
  position: Vector3;
  /** Rotation about +Y (0 = facing +Z). */
  heading: number;
}

/** A bridge pier: column + cap beam under a deck (bridge-mesh.ts). */
export interface DeckPier {
  x: number;
  z: number;
  /** Bottom (a little below the ground) and top (underside of the girder). */
  y0: number;
  y1: number;
  /** Yaw of the deck direction (local +X along the deck). */
  rot: number;
  /** Column size along / across the deck (m). */
  length: number;
  width: number;
  /** false = a plain square column up to the soffit (portal piers), default: column + cap beam. */
  cap?: boolean;
}

export interface StageLayout {
  start: number;
  finish: number;
  /** Split distances along the road (excluding start/finish). */
  splits: number[];
}

/** Extra distance outside map bounds that is still rendered (horizon). */
export const RENDER_MARGIN = 260;

export class World implements GroundProvider {
  readonly gen: TerrainGenerator;
  readonly road: Road;
  readonly heightfield: Heightfield;
  /** Uncached terrain sampling for whole-map placement work (see AnalyticTerrain). */
  readonly analytic: AnalyticTerrain;
  readonly scatter: ScatterField;
  readonly stage: StageLayout;
  /** Start / finish gantries, painted lines and split boards (stage-signs.ts, drawn by stage-sign-mesh.ts). */
  readonly signs: StageSigns;
  /** Overhead guide signs on steel gantries (overhead-signs.ts, drawn by gantry-mesh.ts). */
  readonly overheadSigns: OverheadSigns;
  /** Real-world maps: buildings placed from footprints (empty index otherwise). */
  readonly buildings: BuildingIndex;
  /** Hand-modelled landmarks (MapDef.landmarks): lots, buildings and props drawn by road-mesh. */
  readonly landmarks: Landmark[];
  /** Continuous barriers (MapDef.barriers): drawn by barrier-mesh.ts, solid via box colliders. */
  readonly barrierRuns: BarrierRun[];
  /** City maps (MapDef.cityStreets): where the streets have kerbs / sidewalks / crosswalks / lamps. */
  readonly streetDetail?: StreetDetail;
  /** Power line supports + spans (MapDef.pylons / powerLines): instances here, cables by power-line-mesh.ts. */
  readonly power?: { supports: PowerSupport[]; spans: PowerSpan[] };
  /** Piers under the decks of other roads (drawn by bridge-mesh.ts, solid). */
  readonly piers: DeckPier[];
  /** Raised ground of the landmarks (kerbs, sidewalks): the physical height there. */
  private groundFns: ((x: number, z: number) => number)[] = [];
  /** Paved ground of the landmarks (a gravel courtyard, a court): the surface there. */
  private surfaceFns: ((x: number, z: number) => SurfaceId | undefined)[] = [];
  private splatTmp = new Float32Array(4);

  constructor(readonly map: MapDef) {
    this.gen = new TerrainGenerator(map);
    this.road = this.gen.road;
    this.heightfield = new Heightfield(this.gen);
    this.analytic = new AnalyticTerrain(this.gen);
    this.landmarks = landmarksOf(map);
    this.buildings = new BuildingIndex(
      (map.buildings ?? []).filter(
        (b) => !this.landmarks.some((l) => l.replaces(b)),
      ),
    );
    const b = map.bounds;
    const m = RENDER_MARGIN * 0.6;
    this.scatter = new ScatterField(
      this.analytic,
      this.road,
      map.seed,
      map.scatter,
      (x, z) =>
        x > b.minX - m && x < b.maxX + m && z > b.minZ - m && z < b.maxZ + m,
      (x, z) =>
        map.terrain.flatAreas.some(
          (f) => Math.hypot(x - f.x, z - f.z) < f.radius + 4,
        ) ||
        this.buildings.contains(x, z, 1.5) ||
        this.landmarks.some((l) => l.occupies(x, z, 1.5)),
      this.heightfield,
      {
        landcover: this.gen.landcover,
        paths: this.gen.paths,
        channels: this.gen.channels,
        lakes: this.gen.lakes,
      },
    );
    for (const inst of roadsideInstances(
      this.road,
      this.analytic,
      map.roadside,
      map.seed,
      this.gen.junctions,
      this.gen.paths,
    )) {
      this.scatter.addFixed(inst);
    }
    for (const inst of this.propInstances()) this.scatter.addFixed(inst);
    this.barrierRuns = barrierRuns(
      this.road,
      map.barriers ?? [],
      this.gen.junctions,
    );
    if (map.pathBarriers && this.gen.paths)
      this.barrierRuns.push(
        ...pathBarrierRuns(
          this.gen.paths,
          this.road,
          (pi) => !!this.gen.paths!.paths[pi].bridge,
          map.pathBarriers,
        ),
      );
    for (const c of barrierColliders(
      { road: this.road, net: this.gen.paths },
      this.analytic,
      this.barrierRuns,
    ))
      this.scatter.addFixedCollider(c);
    for (const inst of this.junctionInstances()) this.scatter.addFixed(inst);
    if (map.pylons?.length && map.powerLines?.length) {
      this.power = powerNetwork(map.pylons, map.powerLines);
      const seen = new Set<string>();
      for (const inst of supportInstances(this.power.supports, (x, z) =>
        this.analytic.height(x, z),
      )) {
        const k = `${Math.round(inst.x)},${Math.round(inst.z)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        this.scatter.addFixed(inst);
      }
    }
    if (map.cityStreets && this.gen.paths) {
      const near = nearestRoadPoint(this.road);
      this.streetDetail = streetDetail(map.cityStreets, {
        road: this.road,
        net: this.gen.paths,
        roadDistance: (x, z) => near(x, z).d,
        blocked: (x, z, r) => this.buildings.contains(x, z, r),
      });
    }
    if (map.streetDressing)
      for (const inst of streetDressingInstances(map.streetDressing, {
        seed: map.seed,
        road: this.road,
        net: this.gen.paths,
        junctions: this.gen.junctions,
        height: (x, z) => this.analytic.height(x, z),
        pathHeight: (pi, a) => this.gen.pathHeight(pi, a),
        blocked: (x, z, r) =>
          this.buildings.contains(x, z, r) || this.keptClear(x, z),
        streetDetail: this.streetDetail,
        sidewalk: map.cityStreets?.sidewalk ?? 1.5,
        lampEvery: map.cityStreets?.lampEvery ?? 0,
      }))
        this.scatter.addFixed(inst);
    if (map.goreAreas && this.gen.paths)
      for (const inst of goreCushions(
        goreWedges(this.road, this.gen.paths),
        (x, z) => this.analytic.height(x, z),
      ))
        this.scatter.addFixed(inst);
    this.hasDecks = this.gen.hasDecks;
    this.piers = this.deckPiers();
    for (const c of this.pierColliders(this.piers))
      this.scatter.addFixedCollider(c);
    for (const c of this.parapetColliders()) this.scatter.addFixedCollider(c);
    for (const bd of this.buildings.buildings) {
      if (bd.kind) {
        // Mesh building (building-mesh.ts draws it): only its collider goes into the scatter chunks.
        this.scatter.addFixedCollider(buildingCollider(bd, this.analytic));
      } else this.scatter.addFixed(buildingInstance(bd, this.analytic));
    }

    for (const landmark of this.landmarks) {
      for (const c of landmark.colliders(this.analytic))
        this.scatter.addFixedCollider(c);
      for (const inst of landmark.instances(this.analytic))
        this.scatter.addFixed(inst);
      const lift = landmark.groundOverride?.(this.analytic);
      if (lift) this.groundFns.push(lift);
      if (landmark.surfaceAt)
        this.surfaceFns.push(landmark.surfaceAt.bind(landmark));
    }

    const finish = this.road.length - map.stage.finishFromEnd;
    const start = map.stage.start;
    const splits: number[] = [];
    for (let i = 1; i <= map.stage.splits; i++)
      splits.push(start + ((finish - start) * i) / (map.stage.splits + 1));
    this.stage = { start, finish, splits };
    this.signs = stageSigns(map, this.road, this.analytic, this.stage);
    for (const c of this.signs.colliders) this.scatter.addFixedCollider(c);
    this.overheadSigns = overheadSigns(
      map,
      this.road,
      this.analytic,
      this.gen.paths,
      this.gen.junctions,
    );
    for (const c of this.overheadSigns.colliders)
      this.scatter.addFixedCollider(c);
  }

  /** A landmark keeps junction dressing off (x, z) (Landmark.keepsClear). */
  private keptClear(x: number, z: number): boolean {
    return this.landmarks.some((l) => l.keepsClear?.(x, z));
  }

  /** Side-road mouths closed with a row of barriers (MapDef.junctionBarriers). */
  junctionInstances(): ScatterInstance[] {
    const rule = this.map.junctionBarriers;
    if (!rule) return [];
    const out: ScatterInstance[] = [];
    const q = newRoadQuery();
    const pq = newPathQuery();
    for (const j of this.gen.junctions) {
      if (j.width < (rule.minWidth ?? 2.5)) continue;
      // Walk up the side road until the near end of the row clears the stage road edge by
      // `setback` (a row across an oblique junction leans towards the road by up to width / 2).
      // Front (+Z) faces the stage road, length runs across the side road.
      const rotY = Math.atan2(-j.dx, -j.dz);
      const n = Math.max(1, Math.ceil(j.width / rule.length));
      // Both ends of the row must clear the road edge: a ramp merging at a shallow angle runs
      // beside the road, so its row has to be pushed far up the ramp (or dropped if it never clears).
      const half = (n * rule.length) / 2;
      const gap = (t: number): number => {
        let g = Infinity;
        for (const off of [-half, 0, half]) {
          const x = j.x + j.dx * t + Math.cos(rotY) * off;
          const z = j.z + j.dz * t - Math.sin(rotY) * off;
          this.road.query(x, z, q);
          if (q.found) g = Math.min(g, q.distance - q.halfWidth);
          // ... and from the carriageways of a divided highway beside it (the opposite lanes).
          const net = this.gen.paths;
          if (net) {
            net.query(x, z, pq, undefined, (qi) => {
              const k = net.paths[qi].kind;
              return (
                (k === 'motorway' || k === 'trunk') && !net.paths[qi].bridge
              );
            });
            if (pq.found) g = Math.min(g, pq.distance - pq.halfWidth);
          }
        }
        return g;
      };
      const setback = rule.setback ?? 4;
      let t = 0;
      while (t < 60 && gap(t) < setback) t += 0.5;
      if (gap(t) < setback) continue;
      const cx = j.x + j.dx * t;
      const cz = j.z + j.dz * t;
      if (this.keptClear(cx, cz)) continue;
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * rule.length;
        const x = cx + Math.cos(rotY) * off;
        const z = cz - Math.sin(rotY) * off;
        out.push({
          asset: rule.asset,
          variant: 0,
          x,
          y: this.analytic.height(x, z),
          z,
          rotY,
          scale: 1,
          tiltX: 0,
          tiltZ: 0,
        });
      }
    }
    return out;
  }

  /**
   * Piers under the elevated decks of other roads (OSM bridge=yes): a column with a cap beam every ~24 m
   * wherever the deck is well above the ground, never on the stage road or on a road beneath.
   * `bridge-mesh.ts` draws them, the colliders are added in the constructor.
   */
  deckPiers(): DeckPier[] {
    const net = this.gen.paths;
    if (!net) return [];
    const out: DeckPier[] = [];
    const rq = newRoadQuery();
    const pq = newPathQuery();
    const a = { x: 0, z: 0 };
    const b = { x: 0, z: 0 };
    for (const pi of this.gen.deckPaths()) {
      const p = net.paths[pi];
      const L = net.lengths[pi];
      // A street deck over a portal slab is a street at grade: the slab's piers stand in the median.
      if (L < 14 || this.gen.isPortalDeck(pi)) continue;
      const n = Math.max(1, Math.round(L / 24));
      for (let k = 0; k < n; k++) {
        const at = ((k + 0.5) / n) * L;
        net.pointAt(pi, Math.max(0, at - 1.5), a);
        net.pointAt(pi, Math.min(L, at + 1.5), b);
        net.pointAt(pi, at, a);
        const ground = this.analytic.height(a.x, a.z);
        // Column from the ground up to the underside of the girder.
        const top = this.gen.pathHeight(pi, at) - DECK_DEPTH;
        const h = top - ground;
        if (h < 1.2) continue;
        this.road.query(a.x, a.z, rq);
        if (rq.found && rq.distance < rq.halfWidth + 3) continue;
        net.query(a.x, a.z, pq, undefined, (qi) => !net.paths[qi].bridge);
        if (pq.found && pq.distance < pq.halfWidth + 2) continue;
        out.push({
          x: a.x,
          z: a.z,
          y0: ground - 0.3,
          y1: top,
          // Local +X runs along the deck (three.js yaw: x -> (cos t, -sin t)).
          rot: -Math.atan2(b.z - a.z, b.x - a.x),
          length: 1.6,
          width: Math.min(p.width * 0.5, 4.5),
        });
      }
    }
    // Portal slabs: a row of square columns in the median between the carriageways (where there is room
    // beside the barriers), every PIER_GAP m along the road.
    for (const portal of this.gen.portals.list) {
      let next = portal.from + PIER_GAP / 2;
      for (const r of portal.rows) {
        if (r.along < next) continue;
        next += PIER_GAP;
        const s = this.road.at(r.along);
        // Walk left from the stage road's barrier until the opposite carriageway's barrier.
        const inner = s.halfWidth + 0.9;
        let hit = NaN;
        for (let l = inner; l < r.latL; l += 0.25) {
          net.query(s.x + s.tz * l, s.z - s.tx * l, pq, 'tarmac', (qi) =>
            this.gen.isCarriageway(qi),
          );
          if (pq.found && pq.distance <= pq.halfWidth + 0.9) {
            hit = l;
            break;
          }
        }
        if (Number.isNaN(hit)) continue;
        const gap = hit - inner;
        if (gap < 1.3) continue;
        const lat = inner + gap / 2;
        const x = s.x + s.tz * lat;
        const z = s.z - s.tx * lat;
        out.push({
          x,
          z,
          y0: this.analytic.height(x, z) - 0.3,
          y1: r.top - SLAB_T,
          rot: -Math.atan2(s.tz, s.tx),
          length: 0.9,
          width: Math.min(1, gap - 0.4),
          cap: false,
        });
      }
    }
    return out;
  }

  /**
   * Parapets of the decks of other roads and of the portal slabs are solid (free roam over an overpass stays on
   * it): one box per ~4 m along each edge, like the barrier colliders.
   */
  private parapetColliders(): StaticCollider[] {
    const out: StaticCollider[] = [];
    const net = this.gen.paths;
    if (!net) return out;
    const pq = newPathQuery();
    const box = (
      ax: number,
      az: number,
      bx: number,
      bz: number,
      y: number,
    ): void => {
      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.hypot(dx, dz);
      if (len < 0.5) return;
      const hx = len / 2 + 0.05;
      const hz = PARAPET_T / 2;
      out.push({
        kind: 'box',
        x: (ax + bx) / 2,
        z: (az + bz) / 2,
        y: y - 0.1,
        h: PARAPET_H + 0.1,
        hx,
        hz,
        rot: -Math.atan2(dz, dx),
        r: Math.hypot(hx, hz),
      });
    };
    const a = { x: 0, z: 0 };
    const b = { x: 0, z: 0 };
    // Decks: the parapet centre line is OVERHANG - T/2 outside the road edge; none where the deck is on a slab.
    for (const pi of this.gen.deckPaths()) {
      if (this.gen.isPortalDeck(pi)) continue;
      const L = net.lengths[pi];
      for (const side of [1, -1] as const) {
        for (let d = 0; d < L; d += 4) {
          const e = Math.min(L, d + 4);
          const at = (s: number, o: { x: number; z: number }) => {
            net.pointAt(pi, Math.max(0, s - 1), a);
            net.pointAt(pi, Math.min(L, s + 1), b);
            const tl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
            const lat =
              side *
              (this.gen.deckHalfWidth(pi, s) + DECK_OVERHANG - PARAPET_T / 2);
            net.pointAt(pi, s, o);
            o.x += ((b.z - a.z) / tl) * lat;
            o.z -= ((b.x - a.x) / tl) * lat;
          };
          const p0 = { x: 0, z: 0 };
          const p1 = { x: 0, z: 0 };
          at(d, p0);
          at(e, p1);
          box(p0.x, p0.z, p1.x, p1.z, this.gen.pathHeight(pi, (d + e) / 2));
        }
      }
    }
    // Portal slabs: along both long edges, open where a street deck crosses the edge.
    const isDeck = (qi: number) => !!net.paths[qi].bridge;
    for (const portal of this.gen.portals.list) {
      for (const side of [1, -1] as const) {
        const rows = portal.rows;
        for (let i = 0; i + 1 < rows.length; i++) {
          const r0 = rows[i];
          const r1 = rows[i + 1];
          const lat = (r: (typeof rows)[number]) =>
            side > 0 ? r.latL - PARAPET_T / 2 : r.latR + PARAPET_T / 2;
          const p = (r: (typeof rows)[number]) => ({
            x: r.x + r.tz * lat(r),
            z: r.z - r.tx * lat(r),
          });
          const q0 = p(r0);
          const q1 = p(r1);
          net.query((q0.x + q1.x) / 2, (q0.z + q1.z) / 2, pq, 'tarmac', isDeck);
          if (pq.found && pq.distance <= pq.halfWidth + 0.6) continue;
          box(q0.x, q0.z, q1.x, q1.z, (r0.top + r1.top) / 2);
        }
      }
    }
    return out;
  }

  /** Box colliders of the deck piers (cars hit them). */
  private pierColliders(piers: DeckPier[]): StaticCollider[] {
    return piers.map((p) => {
      const hx = p.length / 2;
      const hz = p.width / 2;
      return {
        kind: 'box',
        x: p.x,
        z: p.z,
        y: p.y0,
        h: p.y1 - p.y0,
        hx,
        hz,
        rot: p.rot,
        r: Math.hypot(hx, hz),
      };
    });
  }

  private propInstances(): ScatterInstance[] {
    return this.map.props.map((p, i) => {
      let x = p.x ?? 0;
      let z = p.z ?? 0;
      let rotY = ((p.rotY ?? 0) * Math.PI) / 180;
      if (p.along !== undefined) {
        const along = p.along < 0 ? this.road.length + p.along : p.along;
        const s = this.road.at(along);
        const lat = p.lateral ?? 0;
        x = s.x + s.tz * lat;
        z = s.z - s.tx * lat;
        rotY += Math.atan2(s.tx, s.tz);
      }
      // Arches etc. stand on the road centre height so they don't float over ditches.
      return {
        asset: p.asset,
        variant: p.variant ?? i,
        x,
        y: this.analytic.height(x, z),
        z,
        rotY,
        scale: p.scale ?? 1,
        tiltX: 0,
        tiltZ: 0,
      };
    });
  }

  // --- GroundProvider ----------------------------------------------------------------

  sampleGround(
    x: number,
    z: number,
    out: GroundSample,
    fromY = Infinity,
  ): GroundSample {
    const hf = this.heightfield;
    hf.splatAt(x, z, this.splatTmp);
    out.surface = SURFACES[this.gen.surfaceAt(x, z, this.splatTmp)];
    for (const surface of this.surfaceFns) {
      const id = surface(x, z);
      if (id) {
        out.surface = SURFACES[id];
        break;
      }
    }
    // On a bridge of the stage road the heightfield is the ground beneath the deck: drive on the deck.
    const deck = this.gen.deckHeightAt(x, z);
    if (!Number.isNaN(deck)) {
      out.height = deck;
      this.gen.deckNormal(x, z, out.normal);
      return out;
    }
    out.height = hf.height(x, z);
    hf.normal(x, z, out.normal);
    // On the deck of another road (an overpass): its surface when it is above the ground here and the probe is
    // not underneath it (a car on the street below keeps the street).
    const over = this.pathDeckHeight(x, z, fromY === Infinity);
    if (over > out.height && over <= fromY + 0.6) {
      out.height = over;
      out.normal.set(0, 1, 0);
      out.surface = SURFACES.tarmac;
      return out;
    }
    // Kerbs and sidewalks of a landmark: the raised surface the street mesh draws.
    for (const lift of this.groundFns) {
      const h = lift(x, z);
      if (!Number.isNaN(h)) {
        out.height = h;
        break;
      }
    }
    return out;
  }

  waterLevel(x: number, z: number): number {
    return this.gen.waterSurfaceAt(x, z);
  }

  queryColliders(
    x: number,
    z: number,
    radius: number,
    out: StaticCollider[],
  ): number {
    const cs = this.scatter.chunkSize;
    let n = 0;
    const cx0 = Math.floor((x - radius - 2) / cs);
    const cx1 = Math.floor((x + radius + 2) / cs);
    const cz0 = Math.floor((z - radius - 2) / cs);
    const cz1 = Math.floor((z + radius + 2) / cs);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        for (const c of this.scatter.chunk(cx, cz).colliders) {
          const r = radius + c.r;
          if (Math.abs(c.x - x) > r || Math.abs(c.z - z) > r) continue;
          out[n++] = c;
        }
      }
    }
    return n;
  }

  // --- helpers ------------------------------------------------------------------------

  /** Ground height (the deck on a stage-road bridge, the deck of another road where it is above the ground). */
  heightAt(x: number, z: number): number {
    const deck = this.gen.deckHeightAt(x, z);
    if (!Number.isNaN(deck)) return deck;
    return Math.max(this.heightfield.height(x, z), this.pathDeckHeight(x, z));
  }

  private deckQuery = newPathQuery();
  private hasDecks = false;
  private readonly isDeckPath = (pi: number): boolean =>
    !!this.gen.paths!.paths[pi].bridge;
  private groundQuery = newPathQuery();
  private readonly isGroundPath = (pi: number): boolean =>
    !this.gen.paths!.paths[pi].bridge;
  /**
   * Surface height of the deck of another road at (x, z), -Infinity off any deck. Without a probe height
   * (`blind`: map viewer picks, spawns, tests) a point on a road beneath the deck keeps that road.
   */
  private pathDeckHeight(x: number, z: number, blind = true): number {
    const net = this.gen.paths;
    if (!net || !this.hasDecks) return -Infinity;
    const q = net.query(x, z, this.deckQuery, 'tarmac', this.isDeckPath);
    if (!q.found || q.distance > net.halfWidthAt(q.path, q.along) + 0.3)
      return -Infinity;
    if (blind) {
      const rq = this.road.query(x, z, this.rq);
      if (rq.found && rq.distance <= rq.halfWidth + 1) return -Infinity;
      const g = net.query(x, z, this.groundQuery, 'tarmac', this.isGroundPath);
      if (g.found && g.distance <= g.halfWidth + 1) return -Infinity;
    }
    return this.gen.pathHeight(q.path, q.along) + 0.03;
  }
  private rq = newRoadQuery();

  /** Spawn on the road at `along` metres (default: just behind the start line). */
  roadSpawn(along = this.stage.start - 9): Spawn {
    const s = this.road.at(along);
    return {
      position: new Vector3(s.x, this.heightAt(s.x, s.z), s.z),
      heading: Math.atan2(s.tx, s.tz),
    };
  }

  /** Named spawn: "start", a flat-area name (e.g. "pad"), or a number = metres along the road. */
  spawn(name: string | number): Spawn {
    if (typeof name === 'number' || /^\d+(\.\d+)?$/.test(name))
      return this.roadSpawn(Number(name));
    const f = this.map.terrain.flatAreas.find((a) => a.name === name);
    if (f)
      return {
        position: new Vector3(f.x, this.heightAt(f.x, f.z), f.z),
        heading: 0,
      };
    return this.roadSpawn();
  }

  /** Nearest road point as a reset spawn (used by "reset car"). */
  resetSpawn(x: number, z: number, fallbackAlong: number): Spawn {
    const q = this.road.query(x, z, {
      found: false,
      lateral: 0,
      distance: 0,
      along: 0,
      height: 0,
      halfWidth: 0,
      index: 0,
    });
    return this.roadSpawn(q.found ? q.along : fallbackAlong);
  }
}
