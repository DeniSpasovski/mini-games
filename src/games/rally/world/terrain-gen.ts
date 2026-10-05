import type { Vector3 } from 'three';
import { Noise2D, smoothstep } from '../../../shared/noise';
import { hash3 } from '../../../shared/rng';
import { roadSurfaceAt, type MapDef } from '../maps/shared/types';
import type { SurfaceId } from '../physics/surfaces';
import {
  Landcover,
  newPathQuery,
  PATH_REACH,
  PathNetwork,
  RealHeight,
  type PathQuery,
} from './real-data';
import { connectPaths, type Junction } from './junctions';
import { twinAt } from './twin-decks';
import {
  alignParallelDecks,
  alignTwinDeckEnds,
  bridgeOverUnderSpans,
  matchCarriagewayWidth,
  dropDuplicateDecks,
  trimMergingDecks,
} from './under-bridges';
import {
  LAKE_CREST,
  LAKE_DEPTH,
  LAKE_REACH,
  LAKE_RIM,
  LAKE_SHELF,
  Lakes,
  newLakeQuery,
  type LakeQuery,
} from './lakes';
import { PadField } from './pads';
import { buildPortals, Portals } from './portals';
import { newRoadQuery, Road, type RoadQuery } from './road';

/**
 * Pure height/surface function of a map: noise layers (+ real elevation) + flat
 * areas + edge rise + water channels, then the road is carved in (flat crowned
 * surface, loose verge, ditch, and a smooth embankment back to the natural terrain).
 *
 * Everything else (heightfield cache, physics, rendering) samples this.
 */

/** Splat channels used by the terrain shader (order matters). */
export const SPLAT_GRASS = 0;
export const SPLAT_DIRT = 1;
export const SPLAT_ROCK = 2;
export const SPLAT_GRAVEL = 3;

/** Channel depth (m) per waterway kind. */
const CHANNEL_DEPTH: Record<string, number> = {
  canal: 2.4,
  drain: 1.8,
  river: 2.5,
  stream: 1.2,
  ditch: 0.7,
};
/** Channel banks reach this far beyond the channel's own width (m). */
const CHANNEL_BANK = 2.5;
/** Water surface sits this fraction of the channel depth below the banks. */
const WATER_FREEBOARD = 0.5;
/** A drain ending in another channel drops to its bank line over this run (m). */
const TRIBUTARY_RUN = 60;
/** Channel bank line smoothing (m). */
const CHANNEL_SMOOTHING = 80;

/** Height profile of other roads: [smoothing window (m), max grade] per OSM kind. */
const PATH_PROFILE: Record<string, [number, number]> = {
  motorway: [220, 0.04],
  trunk: [180, 0.05],
  primary: [140, 0.06],
  motorway_link: [90, 0.06],
  trunk_link: [90, 0.06],
  primary_link: [80, 0.07],
  secondary: [100, 0.08],
  tertiary: [70, 0.1],
  unclassified: [50, 0.12],
  residential: [40, 0.14],
  living_street: [30, 0.14],
  service: [30, 0.15],
  track: [25, 0.18],
};
const PATH_PROFILE_DEFAULT: [number, number] = [14, 0.3];
/** Depth of the girder under a deck surface (m): the underside of a bridge sits this far below the road. */
export const DECK_DEPTH = 1.5;
/** A sheer cut rises from the road to the land over this distance (m): the retaining wall hides it. */
export const CUT_RISE = 1.0;
/**
 * The terrain's sheer rise starts this far BEHIND the wall face (m): the terrain mesh samples the step on a 1-2 m
 * grid and its triangles saw-tooth up to a cell in front of the step - behind the wall face they are hidden.
 */
export const CUT_SETBACK = 1.5;
/** A mainline carriageway keeps a flat verge this wide beyond its edge whatever other road overlaps it (m). */
const CARRIAGEWAY_VERGE = 2.0;
/** Free height under a bridge deck (m): street clearance (real viaducts over a sunken parkway are ~10 m above the street below). */
const BRIDGE_CLEARANCE = 10;
/** Where a stage-road bridge starts / ends, the fill slopes down to the lowered ground over this length (m). */
const BRIDGE_RAMP = 14;
/** A deck crosses a road when their directions differ by more than ~22 degrees (|cos| below this); a shallower one runs alongside. */
const CROSS_COS = 0.93;
/** Streets dip into an underpass at this grade (5 %: a 10 m clearance is reached over ~200 m of street), starting where the deck edge is. */
const DIP_GRADE = 0.05;
/** Ends of street ways within this distance (m) are one joint (the dip continues across it). */
const JOINT_TOL = 1.5;
/** Other roads' bridge decks: lifted to clear lower roads crossing beneath (m between deck top and road below). */
const DECK_CLEARANCE = 5.6;
/** Deck profile grade limit (decks climb their approaches no steeper than this). */
const DECK_GRADE = 0.07;
/** Parallel carriageways of the stage road follow its height within this lateral distance (m). */
const PARALLEL_REACH = 45;
/** Profile sample spacing (m). */
const PROFILE_STEP = 4;
/** The ground under a deck stays this far below its road surface inside its footprint (m). */
const DECK_SOFFIT_GAP = 0.35;
/** Where a road meets / crosses a more important one it is eased to its height over at least this length (m). */
const JUNCTION_EASE = 30;

export class TerrainGenerator {
  readonly road: Road;
  private noise: Noise2D;
  private detailNoise: Noise2D;
  private q: RoadQuery = newRoadQuery();
  private pq: PathQuery = newPathQuery();
  private pq2: PathQuery = newPathQuery();
  private cq: PathQuery = newPathQuery();
  private dq: RoadQuery = newRoadQuery();
  /** 1 = path is a bridge deck (OSM bridge=yes): not carved into the ground, lifted over lower roads. */
  private deckFlag = new Uint8Array(0);
  private hasDeckPaths = false;
  private readonly capQ = newPathQuery();
  private readonly capQ2 = newPathQuery();
  private readonly isDeckPath = (pi: number): boolean =>
    this.deckFlag[pi] === 1;
  /** 1 = a deck that crosses a portal slab: a street at the structure's level, never lifted over / dipped under anything else. */
  private portalDeck = new Uint8Array(0);
  /** Path accept filters (decks are not ground). */
  private readonly onGround = (pi: number): boolean => this.deckFlag[pi] === 0;
  /** A mainline carriageway of the divided highway (ground level): cut sheer like the stage road, walls beyond it. */
  isCarriageway(pi: number): boolean {
    const p = this.paths!.paths[pi];
    return (
      !p.bridge &&
      p.surface === 'tarmac' &&
      (p.kind === 'motorway' || p.kind === 'trunk')
    );
  }
  /** A street deck crossing a portal slab (a street at the structure's level). */
  isPortalDeck(pi: number): boolean {
    return this.portalDeck[pi] === 1;
  }
  /** The stage road is inside an `under` span at `along` (a portal: the walls stay sheer whatever runs on top). */
  underSpanAt(along: number): boolean {
    for (const sp of this.underSpans)
      if (along >= sp.from - 2 && along <= sp.to + 2) return true;
    return false;
  }
  /** Real-world elevation (maps with terrain.heightmap). */
  readonly real?: RealHeight;
  readonly landcover?: Landcover;
  /** Other roads / tracks (not the stage road). */
  readonly paths?: PathNetwork;
  /** Canals / drains / streams (carved channels). */
  readonly channels?: PathNetwork;
  /** Lakes / ponds / reservoirs (carved basins, one water level each). */
  readonly lakes?: Lakes;
  private lq: LakeQuery = newLakeQuery();
  /** Where other roads / tracks meet the stage road, sorted along the stage. */
  readonly junctions: Junction[] = [];
  /** Structures the stage road runs under (`RoadSpan` kind `under`): slab, walls, pad (portals.ts). */
  readonly portals: Portals;
  private readonly underSpans: { from: number; to: number }[];
  /** Smoothed, grade-limited height of each path every PROFILE_STEP m (other roads are flat, not DEM bumps). */
  private pathProfiles: Float32Array[] = [];
  /** Bank height of each channel every PROFILE_STEP m: smoothed, never rising downstream. */
  private bankProfiles: Float32Array[] = [];
  private coverSplatTable?: Float32Array;
  private fieldZones?: Uint8Array;
  /** Graded lots (terrain.pads); set last, so the road and path profiles are taken from the land. */
  private pads?: PadField;

  constructor(readonly map: MapDef) {
    this.noise = new Noise2D(map.seed);
    this.detailNoise = new Noise2D(map.seed + 101);
    if (map.terrain.heightmap)
      this.real = new RealHeight(map.terrain.heightmap);
    const lcDef = map.landcover;
    if (lcDef) {
      const lc = (this.landcover = new Landcover(lcDef));
      const table = (this.coverSplatTable = new Float32Array(
        lcDef.zones.length * 4,
      ));
      lcDef.zones.forEach((z, i) =>
        table.set(lcDef.splat[z.cover] ?? [1, 0, 0, 0], i * 4),
      );
      this.fieldZones = lc.zoneMask(lcDef.fields?.covers ?? []);
    }
    // The stage road follows the terrain without water channels (it bridges them).
    this.road = new Road(map.road, (x, z) => this.naturalHeight(x, z, false));
    this.underSpans = (map.road.spans ?? []).filter(
      (sp) => sp.kind === 'under',
    );
    this.portals = new Portals([], this.road);
    if (map.paths) {
      // Side roads are extended up to the stage road (junctions).
      // Streets over a parkway that runs under them become bridge decks, then side roads are joined to the stage road.
      const joined = connectPaths(
        alignTwinDeckEnds(
          alignParallelDecks(
            trimMergingDecks(
              dropDuplicateDecks(
                bridgeOverUnderSpans(
                  matchCarriagewayWidth(
                    dropDuplicateDecks(map.paths),
                    this.road,
                  ),
                  this.road,
                ).paths,
              ),
            ),
            this.road,
          ),
        ),
        this.road,
      );
      this.junctions = joined.junctions;
      this.paths = new PathNetwork(
        joined.paths.filter((p) => p.surface !== 'water'),
      );
      this.deckFlag = Uint8Array.from(this.paths.paths, (p) =>
        p.bridge ? 1 : 0,
      );
      this.hasDeckPaths = this.deckFlag.some((f) => f === 1);
      const water = joined.paths.filter((p) => p.surface === 'water');
      if (water.length) {
        this.channels = new PathNetwork(water);
        this.bankProfiles = water.map((_, i) => this.buildBankProfile(i));
        this.joinTributaries();
      }
      // Portals (the slab the street grid sits on where the parkway is sunken) before the profiles: decks are
      // lifted onto them, streets on the structure are raised with the land.
      this.portals = new Portals(
        buildPortals(this.road, this.paths, {
          clearance: DECK_CLEARANCE,
          wallOffset: map.road.shoulder + (map.road.cutWalls?.offset ?? 1.6),
          isCarriageway: (pi) => this.isCarriageway(pi),
        }),
        this.road,
      );
      this.portalDeck = Uint8Array.from(this.paths.paths, (p, pi) => {
        if (!p.bridge || this.portals.empty) return 0;
        const pt = { x: 0, z: 0 };
        const L = this.paths!.lengths[pi];
        for (let a = 0; a <= L; a += PROFILE_STEP) {
          this.paths!.pointAt(pi, a, pt);
          if (this.portals.inside(pt.x, pt.z)) return 1;
        }
        return 0;
      });
      this.buildPathProfiles(this.paths);
    }
    if (map.lakes?.length) {
      const lakes = (this.lakes = new Lakes(map.lakes));
      lakes.levels = lakes.polys.map((p) => this.lakeLevel(p));
    }
    if (map.terrain.pads?.length)
      this.pads = new PadField(map.terrain.pads, this.road);
  }

  /**
   * Water level of a lake: the median land height along its shore (sampled every 2 m),
   * so the basin is cut into the high side and dammed on the low side.
   */
  private lakeLevel(p: Float32Array): number {
    const hs: number[] = [];
    const n = p.length / 2;
    for (let i = 0; i < n; i++) {
      const ax = p[i * 2];
      const az = p[i * 2 + 1];
      const bx = p[((i + 1) % n) * 2];
      const bz = p[((i + 1) % n) * 2 + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2));
      for (let s = 0; s < steps; s++)
        hs.push(
          this.naturalHeight(
            ax + ((bx - ax) * s) / steps,
            az + ((bz - az) * s) / steps,
            false,
          ),
        );
    }
    hs.sort((a, b) => a - b);
    return hs[hs.length >> 1] - LAKE_RIM;
  }

  /**
   * Height lines of the other roads: the land along each centreline (bridging channels),
   * smoothed + grade limited like the stage road. Then each one is eased to the height of the
   * roads it meets or crosses (stage road first, then finished roads), so junctions and crossings
   * have no steps.
   *
   * Two passes: first the bridge decks (OSM bridge=yes), lowest layer first - lifted to clear
   * whatever crosses beneath them, parallel carriageways locked to the stage road - then all the
   * ground roads, widest first, which ease to the finished decks at their ends (the approach fill).
   */
  private buildPathProfiles(net: PathNetwork): void {
    const pt = { x: 0, z: 0 };
    const profiles = (this.pathProfiles = net.paths.map((p, pi) => {
      const L = net.lengths[pi];
      const n = Math.max(2, Math.ceil(L / PROFILE_STEP) + 1);
      const step = L / (n - 1) || 1;
      const [window, grade] = PATH_PROFILE[p.kind] ?? PATH_PROFILE_DEFAULT;
      // Streets on top of a portal structure follow the raised land (the pad); the carriageways in the trench and
      // streets running inside the trench do not.
      const raise = !this.trenchPath(net, pi);
      // OSM splits a road into many ways: smooth each with the land along the ways it
      // continues into, so neighbouring ways agree where they meet.
      const ext = window * 0.75;
      const before = this.continuation(
        net,
        pi,
        false,
        ext,
        step,
        raise,
      ).reverse();
      const after = this.continuation(net, pi, true, ext, step, raise);
      const all = new Float32Array(before.length + n + after.length);
      all.set(before);
      for (let i = 0; i < n; i++) {
        net.pointAt(pi, i * step, pt);
        all[before.length + i] = this.naturalHeight(pt.x, pt.z, false, raise);
      }
      all.set(after, before.length + n);
      smoothProfile(all, window / step);
      limitProfileGrade(all, grade * step);
      smoothProfile(all, 8 / step);
      return all.slice(before.length, before.length + n);
    }));
    const done = new Uint8Array(net.paths.length);
    const rq = newRoadQuery();
    const pq = newPathQuery();
    const tp = { x: 0, z: 0 };
    const accept = (pi: number) => done[pi] === 1;
    /** Unit direction of path `pi` at `a` metres. */
    const dirAt = (pi: number, a: number, out: number[]) => {
      net.pointAt(pi, a - 3, pt);
      net.pointAt(pi, a + 3, tp);
      const dx = tp.x - pt.x;
      const dz = tp.z - pt.z;
      const l = Math.hypot(dx, dz) || 1;
      out[0] = dx / l;
      out[1] = dz / l;
    };
    const d0 = [0, 0];
    const d1 = [0, 0];

    /** Ease path `pi` to the stage road / finished roads it meets; returns the samples locked to the stage road. */
    const anchor = (pi: number): Uint8Array => {
      const p = net.paths[pi];
      const ys = profiles[pi];
      const n = ys.length;
      const step = net.lengths[pi] / (n - 1) || 1;
      const locked = new Uint8Array(n);
      const motorway = p.kind === 'motorway' || p.kind === 'motorway_link';
      // Anchors: samples lying on the stage road / a finished road -> height difference.
      const at: number[] = [];
      const dy: number[] = [];
      for (let i = 0; i < n; i++) {
        net.pointAt(pi, i * step, pt);
        this.road.query(pt.x, pt.z, rq);
        if (p.junction !== false && rq.found) {
          let onRoad = rq.distance <= rq.halfWidth + 1.5;
          // The other carriageway of a divided highway runs beside the stage road at its level.
          if (!onRoad && motorway && rq.distance <= PARALLEL_REACH) {
            dirAt(pi, i * step, d0);
            const s = this.road.samples[rq.index];
            onRoad = Math.abs(d0[0] * s.tx + d0[1] * s.tz) > 0.9;
            if (onRoad) locked[i] = 1;
          }
          if (onRoad) {
            at.push(i * step);
            dy.push(rq.height - ys[i]);
            continue;
          }
        }
        net.query(pt.x, pt.z, pq, undefined, accept);
        const tol = 0.5;
        if (pq.found && pq.distance <= pq.halfWidth + tol) {
          // A road passing under a deck is not joined to it: only the deck ends count.
          if (
            this.deckFlag[pq.path] &&
            pq.along > 4 &&
            pq.along < net.lengths[pq.path] - 4
          )
            continue;
          at.push(i * step);
          dy.push(this.pathHeight(pq.path, pq.along) - ys[i]);
        }
      }
      // Correction: exact at the anchors, linear between neighbouring anchors, fading out
      // with distance from the nearest one (longer for big height differences, so the
      // ramp stays near the road's grade limit).
      if (at.length) {
        const grade = (PATH_PROFILE[p.kind] ?? PATH_PROFILE_DEFAULT)[1];
        let maxDy = 0;
        for (const d of dy) maxDy = Math.max(maxDy, Math.abs(d));
        const ease = Math.min(
          150,
          Math.max(JUNCTION_EASE, (1.5 * maxDy) / grade),
        );
        let k = 0;
        for (let i = 0; i < n; i++) {
          const a = i * step;
          while (k + 1 < at.length && at[k + 1] <= a) k++;
          const l = at[k] <= a ? k : -1;
          const r = l < 0 ? 0 : l + 1 < at.length ? l + 1 : -1;
          const dl = l >= 0 ? a - at[l] : Infinity;
          const dr = r >= 0 ? at[r] - a : Infinity;
          const fade = 1 - smoothstep(0, ease, Math.min(dl, dr));
          if (fade <= 0) continue;
          const d =
            l >= 0 && r >= 0
              ? dy[l] + ((dy[r] - dy[l]) * dl) / (dl + dr || 1)
              : dy[l >= 0 ? l : r];
          ys[i] += d * fade;
        }
      }
      return locked;
    };

    /** Lift deck `pi` clear of the roads crossing beneath it (never lowers; never moves locked samples). */
    const lift = (pi: number, locked: Uint8Array) => {
      const p = net.paths[pi];
      const ys = profiles[pi];
      const n = ys.length;
      const step = net.lengths[pi] / (n - 1) || 1;
      const req = new Float32Array(n).fill(-Infinity);
      let any = false;
      for (let i = 0; i < n; i++) {
        if (locked[i]) continue;
        const a = i * step;
        net.pointAt(pi, a, pt);
        dirAt(pi, a, d0);
        const reach = p.width / 2 + 1;
        // A street deck over a portal slab: street level is the slab top, whatever runs beneath; outside the
        // slab it is an ordinary street on the structure's pad (nothing to clear).
        if (this.portalDeck[pi]) {
          const ph = this.portals.at(pt.x, pt.z);
          // The first sample beside the slab counts too (the land there is the level pad): the deck is
          // interpolated between its samples, so its entry onto the slab must not dip under the top.
          if (
            ph &&
            ph.outside === 0 &&
            ph.lateral <= ph.latL + PROFILE_STEP &&
            ph.lateral >= ph.latR - PROFILE_STEP
          ) {
            // 0.2 m: the slab top is interpolated between rows, the deck between its 4 m samples.
            req[i] = Math.max(req[i], ph.top + 0.2);
            any = true;
          }
          continue;
        }
        // Crossing the stage road.
        this.road.query(pt.x, pt.z, rq);
        if (rq.found && rq.distance <= rq.halfWidth + reach) {
          const s = this.road.samples[rq.index];
          if (Math.abs(d0[0] * s.tx + d0[1] * s.tz) < CROSS_COS) {
            req[i] = Math.max(req[i], rq.height + DECK_CLEARANCE);
            any = true;
          }
        }
        // Crossing a lower road: any ground road, or a deck of a lower layer (already finished).
        net.query(
          pt.x,
          pt.z,
          pq,
          undefined,
          (qi) =>
            qi !== pi &&
            (this.deckFlag[qi] === 0 ||
              (done[qi] === 1 && (net.paths[qi].layer ?? 1) < (p.layer ?? 1))),
        );
        // A road that only ends at the deck (a street meeting a small bridge at grade) does not pass beneath it.
        const thru =
          pq.found &&
          pq.along > reach + 2 &&
          pq.along < net.lengths[pq.path] - reach - 2;
        if (thru && pq.distance <= pq.halfWidth + reach) {
          dirAt(pq.path, pq.along, d1);
          if (Math.abs(d0[0] * d1[0] + d0[1] * d1[1]) < CROSS_COS) {
            req[i] = Math.max(
              req[i],
              this.pathHeight(pq.path, pq.along) + DECK_CLEARANCE,
            );
            any = true;
          }
        }
      }
      if (!any) return;
      const lim = DECK_GRADE * step;
      for (let i = 0; i < n; i++) if (req[i] > ys[i]) ys[i] = req[i];
      for (let pass = 0; pass < 8; pass++) {
        let changed = false;
        for (let i = 1; i < n; i++) {
          if (!locked[i] && ys[i] < ys[i - 1] - lim)
            [ys[i], changed] = [ys[i - 1] - lim, true];
        }
        for (let i = n - 2; i >= 0; i--) {
          if (!locked[i] && ys[i] < ys[i + 1] - lim)
            [ys[i], changed] = [ys[i + 1] - lim, true];
        }
        if (!changed) break;
      }
    };

    const all = net.paths.map((_, i) => i);
    const decks = all
      .filter((i) => this.deckFlag[i])
      .sort(
        (a, b) =>
          (net.paths[a].layer ?? 1) - (net.paths[b].layer ?? 1) ||
          net.paths[b].width - net.paths[a].width ||
          a - b,
      );
    for (const pi of decks) {
      lift(pi, anchor(pi));
      done[pi] = 1;
    }
    this.matchTwinDecks(net, profiles);
    const ground = all
      .filter((i) => !this.deckFlag[i])
      .sort((a, b) => net.paths[b].width - net.paths[a].width || a - b);
    for (const pi of ground) {
      anchor(pi);
      done[pi] = 1;
    }
    this.dipUnderBridges(net, profiles);
    // The dips moved the streets: ramps and other ground roads that join a dipped street follow it again
    // (their ends were eased to the street's old height). Only the streets count as anchors now - the other
    // joints were met in the first pass, and two anchors at one joint would fight.
    done.fill(0);
    for (const pi of all) if (this.underStreet(pi)) done[pi] = 1;
    for (const pi of ground) if (!this.underStreet(pi)) anchor(pi);
    this.snapDeckEnds(net, profiles);
  }

  /**
   * Last pass: a ground way that continues onto a bridge deck meets the deck end at exactly the deck height (the
   * passes above - dips, re-anchoring, the twin mean - can leave a step of up to a metre there, the most visible
   * glitch of a bridge). The difference is faded out over the next 10-40 m of the way, never reaching its far end.
   */
  private snapDeckEnds(net: PathNetwork, profiles: Float32Array[]): void {
    const pd = { x: 0, z: 0 };
    const pg = { x: 0, z: 0 };
    net.paths.forEach((_p, di) => {
      if (!this.deckFlag[di]) return;
      const ydeck = profiles[di];
      for (const atEnd of [false, true]) {
        net.pointAt(di, atEnd ? net.lengths[di] : 0, pd);
        const yd = ydeck[atEnd ? ydeck.length - 1 : 0];
        net.paths.forEach((_q, gi) => {
          if (this.deckFlag[gi]) return;
          const G = net.lengths[gi];
          const ys = profiles[gi];
          const n = ys.length;
          const step = G / (n - 1) || 1;
          for (const gEnd of [false, true]) {
            net.pointAt(gi, gEnd ? G : 0, pg);
            if (Math.hypot(pg.x - pd.x, pg.z - pd.z) > 2.5) continue;
            const diff = yd - ys[gEnd ? n - 1 : 0];
            if (Math.abs(diff) < 0.02) continue;
            const e = Math.min(
              Math.max(10, Math.abs(diff) / 0.06),
              40,
              G * 0.8,
            );
            for (let i = 0; i < n; i++) {
              const d = gEnd ? G - i * step : i * step;
              if (d >= e) continue;
              ys[i] += diff * (1 - smoothstep(0, e, d));
            }
          }
        });
      }
    });
  }

  /**
   * Twin decks (the two directions of an overpass street, side by side, see twin-decks.ts) share one height line:
   * each sample takes the mean of its own height and its twin's at the nearest point, so the bridge is flat across
   * and the ground streets that join the decks afterwards meet one level. Both were lifted over the same road, so
   * the mean keeps the clearance (the difference is the approach ground, not the crossing).
   */
  private matchTwinDecks(net: PathNetwork, profiles: Float32Array[]): void {
    const isStreetDeck = (pi: number) =>
      !!this.deckFlag[pi] &&
      !this.portalDeck[pi] &&
      net.paths[pi].surface === 'tarmac' &&
      !/^(motorway|trunk)/.test(net.paths[pi].kind);
    const mean = new Map<number, Float32Array>();
    for (const pi of net.paths.keys()) {
      if (!isStreetDeck(pi)) continue;
      const ys = profiles[pi];
      const n = ys.length;
      const L = net.lengths[pi];
      const step = L / (n - 1) || 1;
      const delta = new Float32Array(n).fill(NaN);
      let any = false;
      for (let i = 0; i < n; i++) {
        const t = twinAt(
          net,
          (q) =>
            isStreetDeck(q) &&
            (net.paths[q].layer ?? 1) === (net.paths[pi].layer ?? 1),
          pi,
          i * step,
          net.halfWidthAt(pi, i * step),
        );
        if (!t) continue;
        const yo = profiles[t.other];
        const f = Math.min(
          yo.length - 1,
          Math.max(0, (t.along / net.lengths[t.other]) * (yo.length - 1)),
        );
        const k = Math.floor(f);
        const y2 =
          yo[k] + (yo[Math.min(yo.length - 1, k + 1)] - yo[k]) * (f - k);
        delta[i] = (y2 - ys[i]) / 2;
        any = true;
      }
      if (!any) continue;
      // Samples without a twin (the ends of the deck, where the other one starts later / stops earlier) take the
      // nearest twin sample's adjustment, fading out over 16 m: no cliff where the shared height line begins.
      const out = ys.slice();
      for (let i = 0; i < n; i++) {
        let d = delta[i];
        if (Number.isNaN(d)) {
          let best = Infinity;
          let bj = -1;
          for (let j = 0; j < n; j++)
            if (!Number.isNaN(delta[j]) && Math.abs(i - j) < best)
              [best, bj] = [Math.abs(i - j), j];
          d = delta[bj] * (1 - smoothstep(0, 16, best * step));
        }
        out[i] = ys[i] + d;
      }
      mean.set(pi, out);
    }
    for (const [pi, ys] of mean) profiles[pi].set(ys);
  }

  /**
   * Streets under a bridge (a stage-road span or the deck of another road): where a street passes under the
   * deck its profile may not be higher than `deck - BRIDGE_CLEARANCE`, and from there the allowed height rises
   * along the street at DIP_GRADE, so the street dips into the underpass gradually (~200 m) instead of falling
   * off a cliff at the abutments. The ceiling is a V along the street (a function of the distance along it), so
   * it is continuous, never touches a street that does not pass under, and neighbouring ways of one street
   * agree at their joints (the crossing is found from the positions, whatever way it belongs to).
   */
  private dipUnderBridges(net: PathNetwork, profiles: Float32Array[]): void {
    const spans = this.road.bridges;
    // Decks of other roads: sample points (every 4 m) with height, half width and direction.
    const deckPts: {
      x: number;
      z: number;
      y: number;
      hw: number;
      tx: number;
      tz: number;
    }[] = [];
    const pt = { x: 0, z: 0 };
    const ta = { x: 0, z: 0 };
    const tb = { x: 0, z: 0 };
    const nx = { x: 0, z: 0 };
    const pv = { x: 0, z: 0 };
    for (const di of net.paths.keys()) {
      // Portal decks are streets at grade on the structure: nothing dips under them.
      if (!this.deckFlag[di] || this.portalDeck[di]) continue;
      const L = net.lengths[di];
      const prof = profiles[di];
      // The ends of a deck (the first / last 8 m) are where its approach roads join: nothing passes under them.
      for (let a = 8; a <= L - 8; a += 4) {
        net.pointAt(di, a, pt);
        net.pointAt(di, Math.max(0, a - 2), ta);
        net.pointAt(di, Math.min(L, a + 2), tb);
        const tl = Math.hypot(tb.x - ta.x, tb.z - ta.z) || 1;
        deckPts.push({
          x: pt.x,
          z: pt.z,
          y: prof[
            Math.min(prof.length - 1, Math.round((a / L) * (prof.length - 1)))
          ],
          hw: net.paths[di].width / 2,
          tx: (tb.x - ta.x) / tl,
          tz: (tb.z - ta.z) / tl,
        });
      }
    }
    if (!spans.length && !deckPts.length) return;
    // Deck points in a grid (cell >= the widest deck reach): each street sample checks the 3 x 3 cells around it
    // instead of every deck point of the map (a town has hundreds of streets, the A2 dozens of decks).
    let reach = 0;
    for (const d of deckPts) reach = Math.max(reach, d.hw + 0.5);
    const cell = Math.max(8, reach);
    const deckGrid = new Map<number, number[]>();
    const cellKey = (cx: number, cz: number) => cx * 73856093 + cz * 19349663;
    deckPts.forEach((d, k) => {
      const key = cellKey(Math.floor(d.x / cell), Math.floor(d.z / cell));
      const list = deckGrid.get(key);
      if (list) list.push(k);
      else deckGrid.set(key, [k]);
    });
    // Stage-road spans as boxes (+ the widest reach): a street sample outside every box cannot be under one.
    const spanBoxes = spans.map((sp) => {
      const b = [Infinity, -Infinity, Infinity, -Infinity];
      for (const s of this.road.samples) {
        if (s.dist < sp.from || s.dist > sp.to) continue;
        const m = s.halfWidth + 1;
        b[0] = Math.min(b[0], s.x - m);
        b[1] = Math.max(b[1], s.x + m);
        b[2] = Math.min(b[2], s.z - m);
        b[3] = Math.max(b[3], s.z + m);
      }
      return b;
    });
    const rq = newRoadQuery();
    // Per street way: the ceiling (Infinity = free) and its sample step.
    const caps = new Map<number, Float32Array>();
    const steps = new Map<number, number>();
    const finite = new Set<number>();
    net.paths.forEach((_p, pi) => {
      if (!this.underStreet(pi)) return;
      const n = profiles[pi].length;
      const step = net.lengths[pi] / (n - 1) || 1;
      // Heights the street must not exceed where it is under a deck.
      const cap = new Float32Array(n).fill(Infinity);
      for (let i = 0; i < n; i++) {
        net.pointAt(pi, i * step, pt);
        const gx = Math.floor(pt.x / cell);
        const gz = Math.floor(pt.z / cell);
        // Cheap reject: no stage-road span box and no deck point near this sample (most of a town's streets).
        let near = spanBoxes.some(
          (b) => pt.x >= b[0] && pt.x <= b[1] && pt.z >= b[2] && pt.z <= b[3],
        );
        for (let cx = gx - 1; cx <= gx + 1 && !near; cx++)
          for (let cz = gz - 1; cz <= gz + 1 && !near; cz++)
            near = deckGrid.has(cellKey(cx, cz));
        if (!near) continue;
        net.pointAt(pi, Math.min(net.lengths[pi], (i + 1) * step), nx);
        net.pointAt(pi, Math.max(0, (i - 1) * step), pv);
        const dl = Math.hypot(nx.x - pv.x, nx.z - pv.z) || 1;
        const dx = (nx.x - pv.x) / dl;
        const dz = (nx.z - pv.z) / dl;
        for (const sp of spans) {
          this.road.queryRange(pt.x, pt.z, sp.from, sp.to, rq);
          if (rq.distance > rq.halfWidth + 0.5) continue;
          const t = this.road.samples[rq.index];
          if (Math.abs(dx * t.tx + dz * t.tz) > CROSS_COS) continue;
          cap[i] = Math.min(cap[i], rq.height - BRIDGE_CLEARANCE);
        }
        for (let cx = gx - 1; cx <= gx + 1; cx++)
          for (let cz = gz - 1; cz <= gz + 1; cz++)
            for (const k of deckGrid.get(cellKey(cx, cz)) ?? []) {
              const d = deckPts[k];
              if (Math.hypot(pt.x - d.x, pt.z - d.z) > d.hw + 0.5) continue;
              if (Math.abs(dx * d.tx + dz * d.tz) > CROSS_COS) continue;
              cap[i] = Math.min(cap[i], d.y - BRIDGE_CLEARANCE);
            }
      }
      caps.set(pi, cap);
      steps.set(pi, step);
      if (cap.some((v) => v !== Infinity)) finite.add(pi);
    });
    if (!finite.size) return;
    // The V: the ceiling rises from every crossing at DIP_GRADE along the street.
    const vee = (pi: number): void => {
      const cap = caps.get(pi)!;
      const n = cap.length;
      const lim = DIP_GRADE * steps.get(pi)!;
      for (let i = 1; i < n; i++) cap[i] = Math.min(cap[i], cap[i - 1] + lim);
      for (let i = n - 2; i >= 0; i--)
        cap[i] = Math.min(cap[i], cap[i + 1] + lim);
    };
    // A street is usually several ways (a short piece under the bridge, longer ones either side): the dip
    // continues across the joints (ends within 1.5 m of each other), so no way is left at deck level.
    const ends: { pi: number; last: boolean; x: number; z: number }[] = [];
    for (const pi of caps.keys()) {
      net.pointAt(pi, 0, pt);
      ends.push({ pi, last: false, x: pt.x, z: pt.z });
      net.pointAt(pi, net.lengths[pi], pt);
      ends.push({ pi, last: true, x: pt.x, z: pt.z });
    }
    // Joints via a grid of the ends (cell >= JOINT_TOL), neighbours in index order like a full scan.
    const jc = Math.max(JOINT_TOL, 1);
    const jKey = (cx: number, cz: number) => cx * 73856093 + cz * 19349663;
    const endGrid = new Map<number, number[]>();
    ends.forEach((e, k) => {
      const g = jKey(Math.floor(e.x / jc), Math.floor(e.z / jc));
      const list = endGrid.get(g);
      if (list) list.push(k);
      else endGrid.set(g, [k]);
    });
    const joined = ends.map((e) => {
      const near: number[] = [];
      const cx = Math.floor(e.x / jc);
      const cz = Math.floor(e.z / jc);
      for (let gx = cx - 1; gx <= cx + 1; gx++)
        for (let gz = cz - 1; gz <= cz + 1; gz++)
          for (const k of endGrid.get(jKey(gx, gz)) ?? []) {
            const o = ends[k];
            if (o.pi !== e.pi && Math.hypot(o.x - e.x, o.z - e.z) <= JOINT_TOL)
              near.push(k);
          }
      return near.sort((a, b) => a - b).map((k) => ends[k]);
    });
    for (const pi of finite) vee(pi);
    for (let iter = 0; iter < 12; iter++) {
      let changed = false;
      ends.forEach((e, ei) => {
        const cap = caps.get(e.pi)!;
        const k = e.last ? cap.length - 1 : 0;
        for (const o of joined[ei]) {
          const oc = caps.get(o.pi)!;
          const v = oc[o.last ? oc.length - 1 : 0];
          if (v < cap[k] - 0.01) {
            cap[k] = v;
            finite.add(e.pi);
            changed = true;
          }
        }
      });
      if (!changed) break;
      for (const pi of finite) vee(pi);
    }
    for (const pi of finite) {
      const ys = profiles[pi];
      const cap = caps.get(pi)!;
      const n = ys.length;
      const step = steps.get(pi)!;
      for (let i = 0; i < n; i++) if (cap[i] < ys[i]) ys[i] = cap[i];
      // Round the corners of the dip, never above the ceiling.
      const smooth = ys.slice();
      smoothProfile(smooth, 48 / step);
      for (let i = 0; i < n; i++)
        if (smooth[i] < ys[i] || ys[i] === cap[i])
          ys[i] = Math.min(smooth[i], cap[i], ys[i] + 0.5);
    }
  }

  /** Carriageways / ramps of the highway, and ground streets with a sample inside a portal footprint (in the trench). */
  private trenchPath(net: PathNetwork, pi: number): boolean {
    const p = net.paths[pi];
    if (
      p.kind === 'motorway' ||
      p.kind === 'trunk' ||
      p.kind === 'motorway_link' ||
      p.kind === 'trunk_link'
    )
      return true;
    if (this.portals.empty || this.deckFlag[pi]) return false;
    // A street that only touches the footprint with one end stands on the rim; one that runs inside it is a
    // service lane in the trench (a third of its length or more).
    const pt = { x: 0, z: 0 };
    const L = net.lengths[pi];
    let inside = 0;
    let n = 0;
    for (let a = 0; a <= L; a += PROFILE_STEP) {
      net.pointAt(pi, a, pt);
      n++;
      if (this.portals.inside(pt.x, pt.z)) inside++;
    }
    return inside >= 2 && inside >= n / 3;
  }

  /** Way ends of a path network in a 4 m grid (built once per network, for `continuation`). */
  private endGrids = new WeakMap<PathNetwork, Map<number, number[]>>();

  /** Indices (ascending) of the ways with an end within 4 m of (x, z) - a superset of the 1.5 m matches. */
  private waysEndingNear(net: PathNetwork, x: number, z: number): number[] {
    const C = 4;
    const key = (cx: number, cz: number) => cx * 73856093 + cz * 19349663;
    let grid = this.endGrids.get(net);
    if (!grid) {
      grid = new Map();
      net.paths.forEach((q, qi) => {
        const k = q.pts.length;
        if (k < 4) return;
        for (const [qx, qz] of [
          [q.pts[0], q.pts[1]],
          [q.pts[k - 2], q.pts[k - 1]],
        ]) {
          const g = key(Math.floor(qx / C), Math.floor(qz / C));
          const list = grid!.get(g);
          if (!list) grid!.set(g, [qi]);
          else if (list[list.length - 1] !== qi) list.push(qi);
        }
      });
      this.endGrids.set(net, grid);
    }
    const out = new Set<number>();
    const cx = Math.floor(x / C);
    const cz = Math.floor(z / C);
    for (let gx = cx - 1; gx <= cx + 1; gx++)
      for (let gz = cz - 1; gz <= cz + 1; gz++)
        for (const qi of grid.get(key(gx, gz)) ?? []) out.add(qi);
    return [...out].sort((a, b) => a - b);
  }

  /**
   * Land heights (every `step` m, moving away) along the ways that continue path `pi`
   * past its start / end: at each end the way leaving the shared point straightest.
   */
  private continuation(
    net: PathNetwork,
    pi: number,
    atEnd: boolean,
    len: number,
    step: number,
    raise = true,
  ): number[] {
    const out: number[] = [];
    const pt = { x: 0, z: 0 };
    const seen = new Set([pi]);
    let cur = pi;
    let curEnd = atEnd;
    let left = len;
    while (left > step) {
      const c = net.paths[cur].pts;
      const m = c.length;
      // Shared point + outward direction of the current way there.
      const ex = curEnd ? c[m - 2] : c[0];
      const ez = curEnd ? c[m - 1] : c[1];
      let dx = ex - (curEnd ? c[m - 4] : c[2]);
      let dz = ez - (curEnd ? c[m - 3] : c[3]);
      const dl = Math.hypot(dx, dz) || 1;
      dx /= dl;
      dz /= dl;
      let best = -1;
      let bestEnd = false;
      let bestDot = 0.5;
      // Ways with an end near (ex, ez), in index order (same result as scanning every way).
      for (const qi of this.waysEndingNear(net, ex, ez)) {
        const q = net.paths[qi];
        if (seen.has(qi) || q.pts.length < 4) continue;
        const k = q.pts.length;
        for (const qEnd of [false, true]) {
          const qx = qEnd ? q.pts[k - 2] : q.pts[0];
          const qz = qEnd ? q.pts[k - 1] : q.pts[1];
          if (Math.abs(qx - ex) > 1.5 || Math.abs(qz - ez) > 1.5) continue;
          let ox = (qEnd ? q.pts[k - 4] : q.pts[2]) - qx;
          let oz = (qEnd ? q.pts[k - 3] : q.pts[3]) - qz;
          const ol = Math.hypot(ox, oz) || 1;
          ox /= ol;
          oz /= ol;
          const dot = ox * dx + oz * dz;
          if (dot > bestDot) [best, bestEnd, bestDot] = [qi, qEnd, dot];
        }
      }
      if (best < 0) break;
      const Lq = net.lengths[best];
      for (let d = step; d <= Math.min(Lq, left); d += step) {
        net.pointAt(best, bestEnd ? Lq - d : d, pt);
        out.push(this.naturalHeight(pt.x, pt.z, false, raise));
      }
      left -= Lq;
      seen.add(best);
      cur = best;
      curEnd = !bestEnd;
    }
    return out;
  }

  /**
   * Bank line of a canal / drain / river: the land along it, smoothed, then made to
   * fall steadily from its higher end (water stands level or flows downhill, never up).
   * The banks are cut into / built up to this line, the water sits a fixed depth below.
   */
  private buildBankProfile(ci: number): Float32Array {
    const net = this.channels!;
    const L = net.lengths[ci];
    const n = Math.max(2, Math.ceil(L / PROFILE_STEP) + 1);
    const step = L / (n - 1) || 1;
    const ys = new Float32Array(n);
    const pt = { x: 0, z: 0 };
    for (let i = 0; i < n; i++) {
      net.pointAt(ci, i * step, pt);
      ys[i] = this.naturalHeight(pt.x, pt.z, false);
    }
    smoothProfile(ys, CHANNEL_SMOOTHING / step);
    if (ys[0] >= ys[n - 1])
      for (let i = 1; i < n; i++) ys[i] = Math.min(ys[i], ys[i - 1]);
    else for (let i = n - 2; i >= 0; i--) ys[i] = Math.min(ys[i], ys[i + 1]);
    smoothProfile(ys, 12 / step);
    return ys;
  }

  /**
   * A drain that ends in another channel (a confluence) drops to that channel's bank line over its last
   * TRIBUTARY_RUN m, so its water meets the main channel's instead of standing above it behind a dam.
   */
  private joinTributaries(): void {
    const net = this.channels!;
    const q = newPathQuery();
    const pt = { x: 0, z: 0 };
    const lowered = this.bankProfiles.map((ys, ci) => {
      const L = net.lengths[ci];
      const n = ys.length;
      const step = L / (n - 1) || 1;
      let out: Float32Array | undefined;
      for (const end of [0, 1]) {
        net.pointAt(ci, end * L, pt);
        const o = net.query(pt.x, pt.z, q, undefined, (qi) => qi !== ci);
        if (!o.found || o.distance > o.halfWidth + CHANNEL_BANK) continue;
        const main = profileAt(
          this.bankProfiles[o.path],
          net.lengths[o.path],
          o.along,
        );
        const mouth = end ? n - 1 : 0;
        if (main >= ys[mouth]) continue;
        out ??= Float32Array.from(ys);
        for (let i = 0; i < n; i++) {
          const d = Math.abs(i - mouth) * step;
          if (d > TRIBUTARY_RUN) continue;
          const t = smoothstep(0, TRIBUTARY_RUN, d);
          out[i] = Math.min(out[i], main + (ys[i] - main) * t);
        }
        // Water still falls steadily towards the lowest end.
        if (out[0] >= out[n - 1])
          for (let i = 1; i < n; i++) out[i] = Math.min(out[i], out[i - 1]);
        else
          for (let i = n - 2; i >= 0; i--)
            out[i] = Math.min(out[i], out[i + 1]);
      }
      return out ?? ys;
    });
    this.bankProfiles = lowered;
  }

  /** Water surface height of channel `ci` at `along` metres. */
  channelWaterLevel(ci: number, along: number): number {
    const kind = this.channels!.paths[ci].kind;
    return (
      profileAt(this.bankProfiles[ci], this.channels!.lengths[ci], along) -
      (CHANNEL_DEPTH[kind] ?? 1) * WATER_FREEBOARD
    );
  }

  /**
   * Half width of the water surface of channel `ci` (m): where the channel bed
   * crosses the water level, i.e. 1 - smoothstep(0.35, 1, u) = WATER_FREEBOARD.
   */
  channelWaterHalfWidth(ci: number): number {
    return (this.channels!.paths[ci].width / 2 + CHANNEL_BANK) * 0.675;
  }

  /**
   * Water surface height of the channel at (x, z), NaN outside its water width. Also
   * returned under bridges / culverts (the road is above it there).
   */
  waterSurfaceAt(x: number, z: number): number {
    if (this.lakes?.query(x, z, this.lq) && this.lq.sd <= 0)
      return this.lakes.levels[this.lq.lake];
    if (!this.channels) return NaN;
    const pq = this.channels.query(x, z, this.pq);
    if (!pq.found || pq.distance > this.channelWaterHalfWidth(pq.path))
      return NaN;
    return this.channelWaterLevel(pq.path, pq.along);
  }

  /** Water surface height at (x, z), or NaN if there is no open water there. */
  waterLevelAt(x: number, z: number): number {
    const w = this.waterSurfaceAt(x, z);
    return w > this.height(x, z) ? w : NaN;
  }

  /** Profile height of path `pi` at `along` metres (road surface; for decks the deck top). */
  pathHeight(pi: number, along: number): number {
    return profileAt(this.pathProfiles[pi], this.paths!.lengths[pi], along);
  }

  /**
   * Half width of deck `pi` at `along` (bridge-mesh rows, parapet colliders). A `concrete` style deck keeps its own
   * width end to end - parallel railings - unless the map asks for `bridgeCorners` (then it follows the taper to a
   * continuing way of another width, like the road itself).
   */
  deckHalfWidth(pi: number, along: number): number {
    const net = this.paths!;
    if (this.map.bridgeStyle === 'concrete' && !this.map.bridgeCorners)
      return net.paths[pi].width / 2;
    return net.halfWidthAt(pi, along);
  }

  /** Paths (indices into `paths.paths`) that are bridge decks. */
  deckPaths(): number[] {
    const out: number[] = [];
    this.deckFlag.forEach((f, i) => f && out.push(i));
    return out;
  }

  /** Any deck of another road in the map (cheap check for the per-sample ground lookups). */
  get hasDecks(): boolean {
    return this.deckFlag.some((f) => f === 1);
  }

  /**
   * Other roads: flat at their profile height, embankment blending back to the land. Beside a mainline
   * carriageway a deep cut is sheer like the stage road's (`cutWalls`: the far wall of the sunken parkway).
   * `along` = stage road distance at (x, z) when near it (portal check).
   */
  private carvePaths(x: number, z: number, base: number, along = NaN): number {
    const net = this.paths!;
    let pq = net.queryTwo(x, z, this.pq, this.pq2, this.onGround);
    if (!pq.found) return base;
    let pq2 = this.pq2;
    // A carriageway's verge wins over a street that overlaps its edge (OSM draws the service road of a sunken
    // parkway right on the carriageway's edge): the carriageway stays flat out to its verge, the step comes after.
    if (
      pq2.found &&
      !this.isCarriageway(pq.path) &&
      this.isCarriageway(pq2.path) &&
      pq2.distance - pq2.halfWidth <= CARRIAGEWAY_VERGE &&
      // ... only a street up on the rim (not a ramp / junction at grade).
      Math.abs(
        this.pathHeight(pq.path, pq.along) -
          this.pathHeight(pq2.path, pq2.along),
      ) > 2
    )
      [pq, pq2] = [pq2, pq];
    const ph = this.pathHeight(pq.path, pq.along);
    const verge = this.isCarriageway(pq.path) ? CARRIAGEWAY_VERGE : 0;
    const e = pq.distance - pq.halfWidth - verge;
    if (e <= 0) return ph;
    const a1 =
      1 -
      smoothstep(0.3, Math.min(PATH_REACH, 1.5 + Math.abs(base - ph) * 1.6), e);
    let h = base + (ph - base) * a1;
    if (pq2.found) {
      // A second road close by (at another height): both pull the ground, weighted by how near each is, so the
      // terrain does not tear along the line where they are equally far (no cliffs / spikes between roads).
      const ph2 = this.pathHeight(pq2.path, pq2.along);
      const e2 = pq2.distance - pq2.halfWidth;
      const a2 =
        e2 <= 0
          ? 1
          : 1 -
            smoothstep(
              0.3,
              Math.min(PATH_REACH, 1.5 + Math.abs(base - ph2) * 1.6),
              e2,
            );
      if (a2 > 0) {
        const blended =
          base + (a1 * (ph - base) + a2 * (ph2 - base)) / Math.max(1, a1 + a2);
        // Right at the edge of the nearest road it is exactly that road's surface.
        h = blended + (ph - blended) * (1 - smoothstep(0, 0.3, e));
      }
    }
    const w = this.pathCutWeight(pq.path, base - ph, pq2, along, ph);
    if (w > 0) {
      const off = this.map.road.cutWalls!.offset + CUT_SETBACK - verge;
      const cut = ph + (base - ph) * smoothstep(off, off + CUT_RISE, e);
      h += (cut - h) * w;
    }
    // A street / track along a drain bank: its embankment stops at the channel's water, the channel stays
    // open (only the road's own surface fills it - a crossing / culvert).
    if (this.channels && h > base) {
      const cq = this.channels.query(x, z, this.cq);
      if (cq.found) {
        const open =
          1 -
          smoothstep(
            this.channelWaterHalfWidth(cq.path),
            cq.halfWidth + CHANNEL_BANK,
            cq.distance,
          );
        h += (base - h) * open;
      }
    }
    return h;
  }

  /**
   * 0..1: how sheer the cut beside carriageway `pi` is where the land is `rise` m above it. Gentle near another
   * ground road (a ramp / street running down to it) unless inside a portal (the walls carry the slab there).
   */
  private pathCutWeight(
    pi: number,
    rise: number,
    other: PathQuery | undefined,
    along: number,
    carriagewayY: number,
  ): number {
    const cw = this.map.road.cutWalls;
    if (!cw || !this.isCarriageway(pi)) return 0;
    let w = smoothstep(cw.minHeight, cw.minHeight + 1.5, rise);
    if (
      w > 0 &&
      other?.found &&
      !this.isCarriageway(other.path) &&
      !(Number.isFinite(along) && this.underSpanAt(along)) &&
      // A street up on the land (as high as the cut is deep) runs along the top of the wall, not into it.
      this.pathHeight(other.path, other.along) - carriagewayY < rise - 1.5
    )
      w *= smoothstep(4, PATH_REACH, other.distance - other.halfWidth);
    return w;
  }

  /** `pathCutWeight` for a point beside carriageway `pi` (cut-wall-mesh.ts: where its retaining wall stands). */
  pathCutWeightAt(x: number, z: number, rise: number, pi: number): number {
    if (!this.paths) return 0;
    const other = this.paths.query(
      x,
      z,
      this.pq2,
      undefined,
      (qi) => qi !== pi && this.deckFlag[qi] === 0,
    );
    const q = this.road.query(x, z, this.q);
    const own = this.paths.query(x, z, this.pq, undefined, (qi) => qi === pi);
    return this.pathCutWeight(
      pi,
      rise,
      other,
      q.found ? q.along : NaN,
      own.found ? this.pathHeight(pi, own.along) : -Infinity,
    );
  }

  /** Noise layers (+ real elevation): the land before pads, roads and channels. */
  private landHeight(x: number, z: number): number {
    const t = this.map.terrain;
    let h = t.baseHeight + (this.real ? this.real.height(x, z) : 0);
    for (let i = 0; i < t.layers.length; i++) {
      const l = t.layers[i];
      const nx = x / l.scale + i * 17.3;
      const nz = z / l.scale - i * 9.1;
      h += l.ridged
        ? (this.noise.ridged(nx, nz, l.octaves) - 0.5) * 2 * l.amplitude
        : this.noise.fbm(nx, nz, l.octaves) * l.amplitude;
    }
    return h;
  }

  /** Terrain before the road is carved in; `channels` = with canals / rivers / lakes carved. */
  naturalHeight(x: number, z: number, channels = true, portals = true): number {
    const t = this.map.terrain;
    let h = this.landHeight(x, z);
    // Rise outside the bounds so the horizon is hilly, not a cliff.
    const b = this.map.bounds;
    const out = Math.max(b.minX - x, x - b.maxX, b.minZ - z, z - b.maxZ, 0);
    if (out > 0 && t.edgeRise)
      h +=
        (out / 100) ** 1.3 *
        t.edgeRise *
        (0.7 + 0.3 * this.noise.noise2(x / 90, z / 90));
    // Flat pads.
    for (const f of t.flatAreas) {
      const d = Math.hypot(x - f.x, z - f.z);
      if (d > f.radius + f.blend) continue;
      const target = f.height ?? this.flatHeight(f);
      h += (target - h) * (1 - smoothstep(f.radius, f.radius + f.blend, d));
    }
    // Graded lots.
    if (this.pads) h = this.pads.apply(x, z, h);
    // The top of a portal structure (street level) around the sunken parkway.
    if (portals && this.portals && !this.portals.empty)
      h = this.portals.padRaise(x, z, h);
    // Canals / drains / streams: a channel with sloped banks, cut into / built up to its
    // bank line, blending back to the land.
    if (channels && this.channels) {
      const pq = this.channels.query(x, z, this.pq);
      if (pq.found) {
        const depth = CHANNEL_DEPTH[this.channels.paths[pq.path].kind] ?? 1;
        const bank = profileAt(
          this.bankProfiles[pq.path],
          this.channels.lengths[pq.path],
          pq.along,
        );
        const outer = pq.halfWidth + CHANNEL_BANK;
        const e = pq.distance - outer;
        if (e <= 0)
          h = bank - depth * (1 - smoothstep(0.35, 1, pq.distance / outer));
        else {
          const blendEnd = Math.min(
            PATH_REACH - CHANNEL_BANK,
            1.5 + Math.abs(h - bank) * 1.6,
          );
          h = bank + (h - bank) * smoothstep(0, blendEnd, e);
        }
      }
    }
    // Lakes: basin below the water level, shore rim just above it, blending to the land.
    if (channels && this.lakes && this.lakes.query(x, z, this.lq)) {
      const top = this.lakes.levels[this.lq.lake] + LAKE_RIM;
      const sd = this.lq.sd;
      if (sd <= 0)
        h = top - (LAKE_RIM + LAKE_DEPTH) * smoothstep(0, LAKE_SHELF, -sd);
      else {
        const blendEnd = Math.min(
          LAKE_REACH - LAKE_CREST,
          1.5 + Math.abs(h - top) * 1.6,
        );
        h = top + (h - top) * smoothstep(LAKE_CREST, LAKE_CREST + blendEnd, sd);
      }
    }
    return h;
  }

  private flatCache = new Map<object, number>();
  private flatHeight(f: object & { x: number; z: number }): number {
    let h = this.flatCache.get(f);
    if (h === undefined) {
      // Natural height at the centre without the pad itself.
      h = this.landHeight(f.x, f.z);
      this.flatCache.set(f, h);
    }
    return h;
  }

  /**
   * Final height including the carved road. Also leaves the road query in `lastRoad`.
   * On a bridge of the stage road this is the GROUND UNDER the deck (a street runs beneath it);
   * the deck itself is `deckHeightAt`.
   */
  height(x: number, z: number): number {
    return this.capUnderDecks(x, z, this.heightUncapped(x, z));
  }

  private heightUncapped(x: number, z: number): number {
    let base = this.naturalHeight(x, z);
    const q = this.road.query(x, z, this.q);
    if (this.paths) base = this.carvePaths(x, z, base, q.found ? q.along : NaN);
    if (!q.found) return base;
    const carved = this.carveRoad(x, z, base, q);
    const span = this.road.bridges.length
      ? this.road.bridgeAt(q.along)
      : undefined;
    if (!span) return carved;
    // Under the deck: no embankment, the land drops away to clear the street (at least BRIDGE_CLEARANCE
    // under the deck) and the fill ramps down to it over BRIDGE_RAMP m from each abutment.
    const hw = q.halfWidth;
    // ... but only where a street / channel passes beneath: a bridge over nothing sits on solid ground (no pit).
    // A ground road beside the span (the other carriageway, a ramp) keeps its own ground: the road takes precedence over the pit (never under the stage deck itself).
    const near =
      this.crossingNear(x, z) *
      (1 - this.roadHold(x, z) * smoothstep(hw + 0.5, hw + 2.5, q.distance));
    const side = (1 - smoothstep(hw + 1.5, hw + 12, q.distance)) * near;
    const under = Math.min(base, q.height - BRIDGE_CLEARANCE);
    const ground = base + (under - base) * side;
    const e = Math.min(q.along - span.from, span.to - q.along);
    // Short spans (a 12 m road bridge) get a proportionally short ramp.
    const ramp = Math.min(BRIDGE_RAMP, (span.to - span.from) * 0.3);
    // On a street's own width the ground is its profile all the way (a street crossing near a span end stays flat across).
    const raw =
      carved +
      (ground - carved) *
        Math.max(smoothstep(0, ramp, e), smoothstep(0.9, 1, near));
    // Never above the deck inside its footprint (a hump of natural ground under a bridge over nothing came up through
    // the lane: gravel in the road); no cap right at the abutments, where the ground meets the road.
    const cap = q.height - DECK_SOFFIT_GAP * smoothstep(0, 4, e);
    const w = 1 - smoothstep(hw, hw + 2.5, q.distance);
    return w > 0 && raw > cap ? raw - (raw - cap) * w : raw;
  }

  /**
   * The ground under the deck of another road (OSM bridge=yes): never above the deck inside its footprint (+ 2.5 m,
   * blended), except at the deck ends where the way meets the ground road. Terrain is not carved for decks, so a
   * hump of natural ground used to come up through them.
   */
  private capUnderDecks(x: number, z: number, h: number): number {
    const net = this.paths;
    if (!net || !this.hasDeckPaths) return h;
    const dq = net.query(x, z, this.capQ, undefined, this.isDeckPath);
    if (!dq.found) return h;
    const over = dq.distance - dq.halfWidth;
    if (over > 2.5) return h;
    const L = net.lengths[dq.path];
    const end = Math.min(dq.along, L - dq.along);
    // Beyond / at a deck end the nearest point is the end itself: that is the ground road's land, not under the deck.
    if (end < 1) return h;
    // A ground road's own land (a street beside / meeting the deck) follows that road, not this cap.
    const gq = net.query(x, z, this.capQ2, undefined, this.onGround);
    if (gq.found && gq.distance - gq.halfWidth <= 1) return h;
    const cap =
      this.pathHeight(dq.path, dq.along) -
      DECK_SOFFIT_GAP * smoothstep(1, 8, end);
    if (h <= cap) return h;
    const w = 1 - smoothstep(0, 2.5, over);
    return h - (h - cap) * w;
  }

  /**
   * 0..1: how sheer the cut is at (x, z) where the land is `rise` m above the road (0 = gentle embankment, or
   * no cutWalls). Near another road (a ramp / side street running down to the parkway) the cut stays gentle.
   */
  cutWeightAt(
    x: number,
    z: number,
    rise: number,
    along = NaN,
    roadY = NaN,
  ): number {
    const cw = this.map.road.cutWalls;
    if (!cw) return 0;
    let w = smoothstep(cw.minHeight, cw.minHeight + 1.5, rise);
    // Inside a portal the walls carry the slab: sheer whatever street runs on top.
    if (
      w > 0 &&
      this.paths &&
      !(Number.isFinite(along) && this.underSpanAt(along))
    ) {
      const pq = this.paths.query(x, z, this.pq, undefined, this.onGround);
      // A street up on the land (as high as the cut is deep) runs along the top of the wall, not into it.
      if (
        pq.found &&
        (Number.isNaN(roadY) ||
          this.pathHeight(pq.path, pq.along) - roadY < rise - 1.5)
      )
        w *= smoothstep(4, PATH_REACH, pq.distance - pq.halfWidth);
    }
    return w;
  }

  /** 0..1: how much (x, z) lies on a ground road that is not a street passing under a bridge (full on its width + 0.5 m, none 6 m beyond). */
  private roadHold(x: number, z: number): number {
    if (!this.paths) return 0;
    const pq = this.paths.query(
      x,
      z,
      this.pq,
      undefined,
      (qi) => this.deckFlag[qi] === 0 && !this.underStreet(qi),
    );
    if (!pq.found) return 0;
    return 1 - smoothstep(0.5, 6, pq.distance - pq.halfWidth);
  }

  /** 0..1: how close (x, z) is to a street / channel that can pass under a bridge (full within 1 m of its edge, none beyond 9 m). */
  private crossingNear(x: number, z: number): number {
    let w = 0;
    if (this.paths) {
      const pq = this.paths.query(x, z, this.pq, undefined, (qi) =>
        this.underStreet(qi),
      );
      if (pq.found) w = 1 - smoothstep(1, 9, pq.distance - pq.halfWidth);
    }
    if (this.channels) {
      const cq = this.channels.query(x, z, this.pq);
      if (cq.found)
        w = Math.max(w, 1 - smoothstep(1, 9, cq.distance - cq.halfWidth));
    }
    return w;
  }

  /** Ground streets (not carriageways / ramps of the highway, not decks) are the ones that pass under a bridge. */
  private underStreet(pi: number): boolean {
    const p = this.paths!.paths[pi];
    return (
      !p.bridge &&
      p.surface === 'tarmac' &&
      p.kind !== 'motorway' &&
      p.kind !== 'trunk' &&
      p.kind !== 'motorway_link' &&
      p.kind !== 'trunk_link'
    );
  }

  /** The stage road carved into `base`: crowned surface, verge, embankment and ditch. */
  private carveRoad(x: number, z: number, base: number, q: RoadQuery): number {
    const r = this.map.road;
    const d = q.distance;
    const hw = q.halfWidth;
    if (d <= hw) {
      const u = d / hw;
      return q.height + r.crown * (1 - u * u);
    }
    // Embankment: blend back to natural terrain; steeper differences get a wider blend.
    const diff = Math.abs(base - q.height);
    const blendEnd = Math.min(
      this.road.influence - 1,
      hw + r.shoulder + 4 + diff * 1.6,
    );
    const s = smoothstep(hw + r.shoulder * 0.5, blendEnd, d);
    let h = q.height + (base - q.height) * s;
    // Deep cuts are sheer (a retaining wall stands at their foot, cut-wall-mesh.ts).
    const w = this.cutWeightAt(x, z, base - q.height, q.along, q.height);
    if (w > 0) {
      const wall = hw + r.shoulder + r.cutWalls!.offset + CUT_SETBACK;
      const cut =
        q.height + (base - q.height) * smoothstep(wall, wall + CUT_RISE, d);
      return h + (cut - h) * w;
    }
    // Ditch just outside the verge, fading where the embankment is tall (no ditch on fills).
    const ditchCentre = hw + r.shoulder + 0.7;
    const x01 = (d - ditchCentre) / 1.1;
    if (x01 > -1 && x01 < 1) {
      const bell = (1 - x01 * x01) ** 2;
      let ditch =
        r.ditch * bell * Math.max(0, 1 - Math.max(0, base - q.height) / 3);
      // Side roads cross the ditch on a culvert: fill it in at their mouth.
      if (ditch > 0.002 && this.paths) {
        const pq = this.paths.query(x, z, this.pq, undefined, this.onGround);
        if (pq.found)
          ditch *= smoothstep(0, 2.5, Math.max(0, pq.distance - pq.halfWidth));
      }
      h -= ditch;
    }
    return h;
  }

  /**
   * Height of the deck of a stage-road bridge at (x, z), NaN when the point is not on one.
   * (Physics and the road mesh use this over `height`, which is the ground beneath.)
   */
  deckHeightAt(x: number, z: number): number {
    if (!this.road.bridges.length) return NaN;
    const q = this.road.query(x, z, this.dq);
    if (!q.found || q.distance > q.halfWidth + 0.01) return NaN;
    if (!this.road.bridgeAt(q.along)) return NaN;
    const u = q.distance / q.halfWidth;
    return q.height + this.map.road.crown * (1 - u * u);
  }

  /** Top surface: the deck of a stage-road bridge where there is one, else the ground (`height`). */
  surfaceHeight(x: number, z: number): number {
    const d = this.deckHeightAt(x, z);
    return Number.isNaN(d) ? this.height(x, z) : d;
  }

  /** Surface normal of the stage-road deck at (x, z) (up when the neighbours are off the deck). */
  deckNormal(x: number, z: number, out: Vector3): Vector3 {
    const h = this.deckHeightAt(x, z);
    const f = (px: number, pz: number) => {
      const v = this.deckHeightAt(px, pz);
      return Number.isNaN(v) ? h : v;
    };
    return out
      .set(f(x - 1, z) - f(x + 1, z), 2, f(x, z - 1) - f(x, z + 1))
      .normalize();
  }

  get lastRoad(): RoadQuery {
    return this.q;
  }

  /**
   * Splat weights [grass, dirt, rock, gravel] for a point, given the slope
   * (1 - normal.y) and the road distance / half width (Infinity if no road near).
   */
  splat(
    x: number,
    z: number,
    slope: number,
    roadDist: number,
    roadHw: number,
    out: Float32Array | number[],
  ): void {
    const r = this.map.road;
    const near = roadDist < Infinity;
    let gravel = 0;
    if (near)
      gravel =
        1 -
        smoothstep(
          roadHw + r.shoulder - 0.3,
          roadHw + r.shoulder + 1.6,
          roadDist,
        );
    for (const f of this.map.terrain.flatAreas) {
      if (f.surface === 'gravel' || f.surface === 'gravel_loose') {
        const d = Math.hypot(x - f.x, z - f.z);
        gravel = Math.max(
          gravel,
          1 - smoothstep(f.radius - 2, f.radius + 3, d),
        );
      }
    }
    const [rockLo, rockHi] = this.map.terrain.rockSlope ?? [0.22, 0.38];
    const rock = smoothstep(rockLo, rockHi, slope);
    const n = this.detailNoise.fbm(x / 45, z / 45, 3);
    if (this.landcover && this.coverSplat(x, z, out)) {
      this.realSplat(
        x,
        z,
        n,
        rock,
        gravel,
        near ? roadDist - roadHw : Infinity,
        out,
      );
      return;
    }
    let dirt = smoothstep(0.15, 0.55, n) * 0.85;
    // Worn, muddy strip next to the road.
    if (near)
      dirt = Math.max(
        dirt,
        (1 - smoothstep(roadHw + r.shoulder, roadHw + 6, roadDist)) * 0.7,
      );
    const rest = 1 - gravel;
    const rk = rock * rest;
    const dr = dirt * (rest - rk);
    out[SPLAT_GRAVEL] = gravel;
    out[SPLAT_ROCK] = rk;
    out[SPLAT_DIRT] = dr;
    out[SPLAT_GRASS] = Math.max(0, 1 - gravel - rk - dr);
  }

  /** Land cover base weights (already in `out`) + road / path / channel paint + slope rock. */
  private realSplat(
    x: number,
    z: number,
    n: number,
    rock: number,
    gravel: number,
    roadEdge: number,
    out: Float32Array | number[],
  ): void {
    const nv = n * 0.18;
    // Ripe crop = weight the cover left unused; it shares what is left for grass below.
    const g0 = out[SPLAT_GRASS];
    const crop = Math.max(
      0,
      1 - g0 - out[SPLAT_DIRT] - out[SPLAT_ROCK] - out[SPLAT_GRAVEL],
    );
    const grassShare = crop > 1e-3 ? g0 / (g0 + crop) : 1;
    let d = Math.max(0, out[SPLAT_DIRT] + nv);
    let rk = Math.max(out[SPLAT_ROCK], rock);
    let gv = Math.max(out[SPLAT_GRAVEL], gravel);
    const sh = this.map.road.shoulder;
    if (roadEdge < Infinity)
      d = Math.max(d, (1 - smoothstep(sh, sh + 4, roadEdge)) * 0.55);
    if (this.paths) {
      const pq = this.paths.query(x, z, this.pq, undefined, this.onGround);
      if (pq.found) {
        const e = pq.distance - pq.halfWidth;
        if (this.paths.paths[pq.path].surface === 'tarmac')
          gv = Math.max(gv, 1 - smoothstep(-0.5, 1.2, e));
        else d = Math.max(d, 1 - smoothstep(-0.6, 0.8, e));
      }
    }
    if (this.channels) {
      const pq = this.channels.query(x, z, this.pq);
      if (pq.found)
        d = Math.max(
          d,
          1 - smoothstep(pq.halfWidth, pq.halfWidth + 3, pq.distance),
        );
    }
    // Muddy lake shore / bed.
    if (this.lakes?.query(x, z, this.lq))
      d = Math.max(d, 1 - smoothstep(0, 2.5, this.lq.sd));
    // Priority: gravel > rock > dirt > grass.
    gv = Math.min(1, gv);
    rk = Math.min(rk, 1 - gv);
    d = Math.min(d, 1 - gv - rk);
    out[SPLAT_GRAVEL] = gv;
    out[SPLAT_ROCK] = rk;
    out[SPLAT_DIRT] = d;
    out[SPLAT_GRASS] = Math.max(0, 1 - gv - rk - d) * grassShare;
  }

  /**
   * Land cover base splat at a point: bilinear blend of the 4 nearest cells' class
   * weights; field cells use the procedural parcel patchwork. False outside the raster.
   */
  private coverSplat(
    x: number,
    z: number,
    out: Float32Array | number[],
  ): boolean {
    const lc = this.landcover!;
    const d = lc.def;
    const fx = (x - d.originX) / d.cell - 0.5;
    const fz = (z - d.originZ) / d.cell - 0.5;
    if (fx < -0.5 || fz < -0.5 || fx > d.cols - 0.5 || fz > d.rows - 0.5)
      return false;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    out[0] = out[1] = out[2] = out[3] = 0;
    let fieldW = 0;
    const tab = this.coverSplatTable!;
    for (let k = 0; k < 4; k++) {
      const ii = Math.min(d.cols - 1, Math.max(0, i + (k & 1)));
      const jj = Math.min(d.rows - 1, Math.max(0, j + (k >> 1)));
      const w = (k & 1 ? tx : 1 - tx) * (k >> 1 ? tz : 1 - tz);
      const zone = lc.zones[jj * d.cols + ii];
      if (this.fieldZones![zone]) fieldW += w;
      else for (let c = 0; c < 4; c++) out[c] += tab[zone * 4 + c] * w;
    }
    if (fieldW > 0) {
      const f = this.fieldSplat(x, z);
      for (let c = 0; c < 4; c++) out[c] += f[c] * fieldW;
    }
    return true;
  }

  private fieldTmp = [0, 0, 0, 0];
  /** Patchwork of long field strips; each parcel picks a palette entry, with weedy margins. */
  private fieldSplat(x: number, z: number): number[] {
    const f = this.map.landcover!.fields!;
    const ca = Math.cos(f.angle);
    const sa = Math.sin(f.angle);
    const seed = this.map.seed;
    const h01 = (a: number, b: number, c: number) =>
      (hash3(a, b, c, seed) % 10007) / 10007;
    // v along the strips, u across them (boundaries gently wavy, like real parcels).
    const v = x * ca + z * sa;
    const u = -x * sa + z * ca + this.detailNoise.noise2(v / 420, 0.5) * 18;
    // Bands of max width, each split into 1-3 strips -> irregular widths.
    const band = f.width[1] * 1.6;
    const col = Math.floor(u / band);
    const k = 1 + Math.floor(h01(col, 1, 3) * 3);
    const fb = (u / band - col) * k;
    const sub = Math.floor(fb);
    const fu = fb - sub;
    const w = band / k;
    // Strip length varies per strip; ends staggered between strips.
    const L = f.length[0] + (f.length[1] - f.length[0]) * h01(col, sub, 5);
    const vv = v / L + h01(col, sub, 7);
    const row = Math.floor(vv);
    const fv = vv - row;
    const p = f.palette[hash3(col * 4 + sub, row, 11, seed) % f.palette.length];
    const o = this.fieldTmp;
    // Weedy grass margins between parcels (~1 m).
    const edge = Math.min(fu * w, (1 - fu) * w, fv * L, (1 - fv) * L);
    const m = (1 - smoothstep(0.3, 1.4, edge)) * 0.8;
    o[0] = p[0] + (1 - p[0]) * m;
    o[1] = p[1] * (1 - m);
    o[2] = p[2] * (1 - m);
    o[3] = p[3] * (1 - m);
    return o;
  }

  /** Physics surface at a point (road edge is exact, terrain from splat weights). */
  surfaceAt(x: number, z: number, splat: ArrayLike<number>): SurfaceId {
    const q = this.road.query(x, z, this.q);
    const r = this.map.road;
    if (q.found) {
      if (q.distance <= q.halfWidth) return roadSurfaceAt(r, q.along).surface;
      if (q.distance <= q.halfWidth + r.shoulder) return 'gravel_loose';
    }
    for (const f of this.map.terrain.flatAreas) {
      if (f.surface && Math.hypot(x - f.x, z - f.z) <= f.radius)
        return f.surface;
    }
    if (this.paths) {
      const pq = this.paths.query(x, z, this.pq, undefined, this.onGround);
      if (pq.found && pq.distance <= pq.halfWidth)
        return this.paths.paths[pq.path].surface === 'tarmac'
          ? 'tarmac'
          : 'dirt';
    }
    // Canal / river / lake bed under the water: mud.
    if (this.lakes?.query(x, z, this.lq) && this.lq.sd <= 0) return 'mud';
    if (this.channels) {
      const cq = this.channels.query(x, z, this.pq);
      if (cq.found && cq.distance <= this.channelWaterHalfWidth(cq.path))
        return 'mud';
    }
    // Grass = everything the other channels leave (ripe crop parcels drive like grass).
    let best = SPLAT_GRASS;
    let bestW = 1 - splat[SPLAT_DIRT] - splat[SPLAT_ROCK] - splat[SPLAT_GRAVEL];
    for (let i = 1; i < 4; i++)
      if (splat[i] > bestW) {
        best = i;
        bestW = splat[i];
      }
    return best === SPLAT_GRAVEL
      ? 'gravel_loose'
      : best === SPLAT_ROCK
        ? 'rock'
        : best === SPLAT_DIRT
          ? 'dirt'
          : 'grass';
  }
}

/** Three box-filter passes (~gaussian) over a profile, `window` in samples. */
function smoothProfile(ys: Float32Array, window: number): void {
  const r = Math.max(1, Math.round(window / 2 / 3));
  const src = new Float32Array(ys.length);
  for (let pass = 0; pass < 3; pass++) {
    src.set(ys);
    for (let i = 0; i < ys.length; i++) {
      let sum = 0;
      for (let j = i - r; j <= i + r; j++)
        sum += src[Math.min(ys.length - 1, Math.max(0, j))];
      ys[i] = sum / (2 * r + 1);
    }
  }
}

/** Clamp the height change between neighbouring samples to `lim` (forward + backward passes). */
function limitProfileGrade(ys: Float32Array, lim: number): void {
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (let i = 1; i < ys.length; i++) {
      const y = Math.min(ys[i - 1] + lim, Math.max(ys[i - 1] - lim, ys[i]));
      if (Math.abs(y - ys[i]) > 1e-4) [ys[i], changed] = [y, true];
    }
    for (let i = ys.length - 2; i >= 0; i--) {
      const y = Math.min(ys[i + 1] + lim, Math.max(ys[i + 1] - lim, ys[i]));
      if (Math.abs(y - ys[i]) > 1e-4) [ys[i], changed] = [y, true];
    }
    if (!changed) break;
  }
}

/** Linear lookup in a profile sampled evenly over `length` metres. */
function profileAt(ys: Float32Array, length: number, along: number): number {
  const f = (length > 0 ? along / length : 0) * (ys.length - 1);
  const i = Math.min(ys.length - 2, Math.max(0, Math.floor(f)));
  const t = Math.min(1, Math.max(0, f - i));
  return ys[i] + (ys[i + 1] - ys[i]) * t;
}
