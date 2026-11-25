import type { SurfaceId } from '../../physics/surfaces';
import type { PackId, TagSet } from './types';

/**
 * Road engine v2 building blocks: cross-section templates (the "assembly" swept along a road) and the region packs that
 * pick one per OSM class. A template says what lies across the road from the reference line outwards (lanes, parking,
 * shoulders, kerb, tree lawn, sidewalk, verge), how it is painted, what guards it, how its height line is designed and
 * what happens where the land beside it is far above / below it (the daylight rule: a slope, or past `maxCut` /
 * `maxFill` a retaining wall). Everything else (meshes, terrain, physics surfaces, walls, props) derives from it.
 */

export type ElemKind =
  | 'lane'
  | 'parking'
  | 'shoulder'
  | 'kerb'
  | 'lawn'
  | 'sidewalk'
  | 'median'
  | 'verge';

/** Mesh material of an element; `terrain` = no mesh (the terrain is shaped to it and painted by the splat). */
export type ElemMat = 'asphalt' | 'asphalt_hw' | 'concrete' | 'terrain';

export interface Elem {
  kind: ElemKind;
  /** Width (m). */
  w: number;
  /** Height of its top above the pavement edge it starts from (kerb, sidewalk: the kerb height). */
  rise: number;
  surface: SurfaceId;
  mat: ElemMat;
}

/** What a cut / fill beside the road becomes (Civil 3D's conditional daylight subassembly). */
export interface Daylight {
  /** Cut slope: horizontal run per metre of rise (1.5 = 1:1.5). */
  cut: number;
  /** Deeper cuts (m, land above the road edge) get a retaining wall. */
  maxCut: number;
  /** Fill slope: run per metre of drop. */
  fill: number;
  /** Higher fills (m) get a wall. */
  maxFill: number;
  wall: 'stone' | 'concrete';
  /** Wall face this far beyond the outer edge of the section (m). */
  wallOffset: number;
  /** On top of a cut wall: picket railing (old parkway), chain-link, or nothing. */
  fence: 'railing' | 'chainlink' | 'none';
}

export type BarrierKind = 'jersey' | 'guard_rail';

export interface Template {
  id: string;
  /** Importance: the higher rank keeps its height at a junction, wins a merge, is drawn on top. */
  rank: number;
  laneW: number;
  /** Default travel lanes [with, against] the way direction ([n, 0] one-way). */
  lanes: [number, number];
  onewayLanes: number;
  /** Parking lane width (0 = no parking lanes). */
  parkW: number;
  /** Shoulder left / right of the travel lanes (m, paved). */
  shoulder: [number, number];
  /** Kerb height (0 = no kerb, the pavement edge meets the verge). */
  kerbH: number;
  lawnW: number;
  sidewalkW: number;
  /** Unpaved strip beyond everything (terrain at the section's outer height). */
  vergeW: number;
  pave: ElemMat;
  surface: SurfaceId;
  /** Paint: motorway edge lines (yellow left, white right) / NYC street centre line. */
  edgeLines: boolean;
  centreLine: 'double_yellow' | 'none';
  /** Barrier on the left / right edge (none on a side that has a wall or a deck parapet). */
  barrier: [BarrierKind | undefined, BarrierKind | undefined];
  daylight: Daylight;
  /** Vertical design: minimum vertical curve length (m), grade limit and how far the designed profile may leave the
   * ground (m; default by class in `profileTol`). */
  smoothing: number;
  maxGrade: number;
  tolerance?: number;
  /** Superelevation: max banking in bends (0 = none). */
  bank: number;
  /** Free height a structure over this road must leave (m, surface to soffit). */
  clearance: number;
  /** Deck look when this road crosses over something. */
  deck: 'stone' | 'concrete';
  /** Street lamps every n m (0 = none), on the sidewalk / verge. */
  lampEvery: number;
  /** Lamps on one side only (the right of the way's direction), `lampOff` m past the pavement edge (default: both
   * sides alternating, at the kerb side of the sidewalk / verge). */
  lampSide?: 'right';
  lampOff?: number;
  /** Barrier along the way's cut walls (none by default: the wall is the edge). */
  cutBarrier?: 'jersey';
  /** The lamp asset (default `street_lamp`). */
  lampAsset?: string;
  /**
   * Dashed lane lines turn into a double solid white line where the way curves tighter than this radius (m), held
   * through the short straights between such curves (`solidLaneRuns`; drive videos: no lane changes in the bends).
   */
  solidLaneRadius?: number;
  /** Street trees in the lawn / sidewalk every n m (0 = none). */
  treeEvery: number;
  /** Parked cars in the parking lanes (share of slots). */
  parked: number;
}

const STREET_DAYLIGHT: Daylight = {
  cut: 2,
  maxCut: 1.4,
  fill: 2,
  maxFill: 1.4,
  wall: 'concrete',
  wallOffset: 0.3,
  fence: 'none',
};

const BASE: Omit<Template, 'id'> = {
  rank: 3,
  laneW: 3.0,
  lanes: [1, 1],
  onewayLanes: 1,
  parkW: 2.4,
  shoulder: [0, 0],
  kerbH: 0.15,
  lawnW: 0,
  sidewalkW: 2.4,
  vergeW: 0.6,
  pave: 'asphalt',
  surface: 'asphalt_city',
  edgeLines: false,
  centreLine: 'double_yellow',
  barrier: [undefined, undefined],
  daylight: STREET_DAYLIGHT,
  smoothing: 40,
  maxGrade: 0.12,
  bank: 0,
  clearance: 4.6,
  deck: 'concrete',
  lampEvery: 34,
  treeEvery: 0,
  parked: 0.55,
};

const t = (id: string, o: Partial<Template>): Template => ({
  ...BASE,
  ...o,
  id,
});

/** Every template by id (`setTemplate` patches name them). */
export const TEMPLATES: Record<string, Template> = Object.fromEntries(
  [
    // The 1930s parkway: two narrow lanes, a concrete median barrier, stone walls in the cuts, stone-faced bridges.
    t('nyc_parkway', {
      rank: 10,
      laneW: 3.35,
      lanes: [2, 0],
      onewayLanes: 2,
      parkW: 0,
      shoulder: [0.45, 0.75],
      kerbH: 0,
      sidewalkW: 0,
      vergeW: 0.8,
      pave: 'asphalt_hw',
      surface: 'tarmac',
      edgeLines: true,
      centreLine: 'none',
      barrier: ['jersey', 'guard_rail'],
      daylight: {
        cut: 1.5,
        maxCut: 2.2,
        fill: 2,
        maxFill: 3,
        wall: 'stone',
        wallOffset: 0.6,
        fence: 'railing',
      },
      smoothing: 120,
      maxGrade: 0.07,
      bank: 0.04,
      clearance: 4.6,
      deck: 'stone',
      // cobra-head lamps on the outer verge (drive videos: right side only, none on the median)
      lampEvery: 42,
      cutBarrier: 'jersey',
      lampSide: 'right',
      lampAsset: 'cobra_lamp',
      solidLaneRadius: 130,
      lampOff: 2.4,
      parked: 0,
    }),
    // The opposite carriageway beside the stage road: the stage road's median barrier is the shared one.
    t('nyc_parkway_twin', {
      rank: 9,
      laneW: 3.35,
      lanes: [2, 0],
      onewayLanes: 2,
      parkW: 0,
      shoulder: [0.45, 0.75],
      kerbH: 0,
      sidewalkW: 0,
      vergeW: 0.8,
      pave: 'asphalt_hw',
      surface: 'tarmac',
      edgeLines: true,
      centreLine: 'none',
      barrier: [undefined, 'guard_rail'],
      daylight: {
        cut: 1.5,
        maxCut: 2.2,
        fill: 2,
        maxFill: 3,
        wall: 'stone',
        wallOffset: 0.6,
        fence: 'railing',
      },
      smoothing: 120,
      maxGrade: 0.07,
      bank: 0.04,
      deck: 'stone',
      lampEvery: 42,
      cutBarrier: 'jersey',
      lampSide: 'right',
      lampAsset: 'cobra_lamp',
      solidLaneRadius: 130,
      lampOff: 2.4,
      parked: 0,
    }),
    // Modern expressway (Grand Central, Van Wyck): wide lanes and shoulders, concrete walls and barriers.
    t('nyc_highway', {
      rank: 9,
      laneW: 3.6,
      lanes: [3, 0],
      onewayLanes: 3,
      parkW: 0,
      shoulder: [0.9, 1.8],
      kerbH: 0,
      sidewalkW: 0,
      vergeW: 0.8,
      pave: 'asphalt_hw',
      surface: 'tarmac',
      edgeLines: true,
      centreLine: 'none',
      barrier: ['jersey', 'guard_rail'],
      daylight: {
        cut: 2,
        maxCut: 2,
        fill: 2,
        maxFill: 2.5,
        wall: 'concrete',
        wallOffset: 0.5,
        fence: 'chainlink',
      },
      smoothing: 160,
      maxGrade: 0.05,
      bank: 0.04,
      clearance: 4.9,
      deck: 'concrete',
      lampEvery: 0,
      parked: 0,
    }),
    // Exit / entry ramps.
    t('nyc_ramp', {
      rank: 7,
      laneW: 3.6,
      lanes: [1, 0],
      onewayLanes: 1,
      parkW: 0,
      shoulder: [0.6, 1.0],
      kerbH: 0,
      sidewalkW: 0,
      vergeW: 0.8,
      pave: 'asphalt_hw',
      surface: 'tarmac',
      edgeLines: true,
      centreLine: 'none',
      barrier: [undefined, 'guard_rail'],
      daylight: {
        cut: 2,
        maxCut: 2.2,
        fill: 2,
        maxFill: 2.5,
        wall: 'concrete',
        wallOffset: 0.5,
        fence: 'chainlink',
      },
      smoothing: 60,
      maxGrade: 0.085,
      bank: 0.03,
      deck: 'concrete',
      lampEvery: 0,
      parked: 0,
    }),
    // A street's lanes in a tunnel beside the parkway (Union Turnpike under Queens Blvd): lanes and shoulders only.
    t('nyc_tunnel_lane', {
      rank: 6,
      laneW: 3.3,
      lanes: [1, 1],
      onewayLanes: 2,
      parkW: 0,
      shoulder: [0.3, 0.5],
      kerbH: 0,
      sidewalkW: 0,
      vergeW: 0.3,
      pave: 'asphalt_hw',
      surface: 'asphalt_city',
      edgeLines: true,
      centreLine: 'double_yellow',
      daylight: {
        cut: 2,
        maxCut: 1.4,
        fill: 2,
        maxFill: 1.4,
        wall: 'concrete',
        wallOffset: 0.3,
        fence: 'none',
      },
      smoothing: 60,
      maxGrade: 0.08,
      lampEvery: 0,
      parked: 0,
    }),
    // Boulevards and avenues (primary / secondary / tertiary): wide lanes, parking, wide sidewalks.
    t('nyc_avenue', {
      rank: 6,
      laneW: 3.2,
      lanes: [2, 2],
      onewayLanes: 3,
      sidewalkW: 3.6,
      smoothing: 80,
      maxGrade: 0.08,
      lampEvery: 30,
      treeEvery: 11,
      parked: 0.6,
    }),
    t('nyc_street', {
      rank: 4,
      laneW: 3.1,
      lanes: [1, 1],
      onewayLanes: 2,
      sidewalkW: 3.0,
      smoothing: 60,
      maxGrade: 0.1,
      lampEvery: 32,
      treeEvery: 10,
    }),
    // Residential street: one lane each way, parking both sides, a grass tree lawn, a narrow sidewalk.
    t('nyc_residential', {
      rank: 3,
      laneW: 3.0,
      lanes: [1, 1],
      onewayLanes: 1,
      lawnW: 1.2,
      sidewalkW: 1.8,
      treeEvery: 9,
    }),
    // Service roads (cemetery / park lanes, alleys): narrow, no kerb, no paint.
    t('nyc_service', {
      rank: 1,
      laneW: 2.7,
      lanes: [1, 1],
      onewayLanes: 1,
      parkW: 0,
      kerbH: 0,
      sidewalkW: 0,
      vergeW: 0.6,
      centreLine: 'none',
      smoothing: 30,
      maxGrade: 0.15,
      daylight: { ...STREET_DAYLIGHT, maxCut: 1.8, maxFill: 1.8 },
      lampEvery: 0,
      parked: 0,
    }),
    // Unpaved park track: terrain only (shaped + dirt splat), no mesh.
    t('park_track', {
      rank: 0,
      laneW: 2.8,
      lanes: [1, 0],
      onewayLanes: 1,
      parkW: 0,
      kerbH: 0,
      sidewalkW: 0,
      vergeW: 0.3,
      pave: 'terrain',
      surface: 'dirt',
      centreLine: 'none',
      smoothing: 25,
      maxGrade: 0.18,
      daylight: { ...STREET_DAYLIGHT, maxCut: 3, maxFill: 3 },
      lampEvery: 0,
      parked: 0,
    }),
    // North Macedonia: old village / country tarmac with a loose gravel verge and a ditch, no kerbs.
    t('mk_rural_tarmac', {
      rank: 6,
      laneW: 2.9,
      lanes: [1, 1],
      onewayLanes: 1,
      parkW: 0,
      kerbH: 0,
      sidewalkW: 0,
      vergeW: 1.1,
      pave: 'asphalt',
      surface: 'tarmac_gravel',
      centreLine: 'none',
      daylight: {
        cut: 1.5,
        maxCut: 4,
        fill: 2,
        maxFill: 4,
        wall: 'stone',
        wallOffset: 0.4,
        fence: 'none',
      },
      smoothing: 60,
      maxGrade: 0.13,
      lampEvery: 0,
      parked: 0,
    }),
    t('mk_hill_gravel', {
      rank: 5,
      laneW: 2.6,
      lanes: [1, 1],
      onewayLanes: 1,
      parkW: 0,
      kerbH: 0,
      sidewalkW: 0,
      vergeW: 0.8,
      pave: 'terrain',
      surface: 'gravel',
      centreLine: 'none',
      daylight: {
        cut: 1,
        maxCut: 5,
        fill: 1.5,
        maxFill: 4,
        wall: 'stone',
        wallOffset: 0.3,
        fence: 'none',
      },
      smoothing: 40,
      maxGrade: 0.16,
      lampEvery: 0,
      parked: 0,
    }),
    t('mk_village_street', {
      rank: 3,
      laneW: 2.8,
      lanes: [1, 1],
      onewayLanes: 1,
      parkW: 0,
      kerbH: 0,
      sidewalkW: 0,
      vergeW: 0.8,
      pave: 'asphalt',
      surface: 'tarmac_gravel',
      centreLine: 'none',
      smoothing: 30,
      maxGrade: 0.16,
      lampEvery: 0,
      parked: 0,
    }),
  ].map((x) => [x.id, x]),
);

/** Region pack: template id per OSM class (the stage road's own template is the pack's `stage`). */
interface Pack {
  stage: string;
  twin: string;
  byKind: Record<string, string>;
  fallback: string;
}

const PACKS: Record<PackId, Pack> = {
  nyc: {
    stage: 'nyc_parkway',
    twin: 'nyc_parkway_twin',
    byKind: {
      motorway: 'nyc_highway',
      trunk: 'nyc_highway',
      motorway_link: 'nyc_ramp',
      trunk_link: 'nyc_ramp',
      primary_link: 'nyc_ramp',
      secondary_link: 'nyc_street',
      tertiary_link: 'nyc_street',
      primary: 'nyc_avenue',
      secondary: 'nyc_avenue',
      tertiary: 'nyc_street',
      unclassified: 'nyc_street',
      residential: 'nyc_residential',
      living_street: 'nyc_residential',
      service: 'nyc_service',
      track: 'park_track',
    },
    fallback: 'nyc_service',
  },
  'mk-rural': {
    stage: 'mk_rural_tarmac',
    twin: 'mk_rural_tarmac',
    byKind: {
      primary: 'mk_rural_tarmac',
      secondary: 'mk_rural_tarmac',
      tertiary: 'mk_rural_tarmac',
      unclassified: 'mk_village_street',
      residential: 'mk_village_street',
      service: 'mk_village_street',
      track: 'mk_hill_gravel',
    },
    fallback: 'mk_village_street',
  },
};

export function packTemplate(
  pack: PackId,
  kind: string,
  role: 'stage' | 'twin' | 'way' = 'way',
): Template {
  const p = PACKS[pack];
  const id =
    role === 'stage'
      ? p.stage
      : role === 'twin'
        ? p.twin
        : (p.byKind[kind] ?? p.fallback);
  return TEMPLATES[id];
}

/** One painted line along a way: lateral position (m, + = left of the way direction). */
export interface PaintLine {
  t: number;
  /** White / yellow, solid / dashed (3 m dash, 9 m gap), single / double. */
  color: 'white' | 'yellow';
  dash: boolean;
  double: boolean;
  /** Line width (m). */
  w: number;
  /** The pavement edge line: broken where a ramp runs alongside (the lane change). */
  edge?: boolean;
}

/** A way's cross-section: the template applied to its tags and its surroundings. */
export interface Section {
  tpl: Template;
  lanesF: number;
  lanesB: number;
  oneway: boolean;
  /** Elements from the pavement edge outwards, left and right (the pavement itself = lanes + parking + shoulder). */
  left: Elem[];
  right: Elem[];
  /** Pavement half widths (reference line to kerb face / pavement edge), left and right. */
  paveL: number;
  paveR: number;
  /** Reference line to the outer edge of the whole section. */
  footL: number;
  footR: number;
  paint: PaintLine[];
  /** Barriers on each edge (undefined = none). */
  barrier: [BarrierKind | undefined, BarrierKind | undefined];
}

export interface SectionOpts {
  oneway: boolean;
  tags: TagSet;
  /** A side faces another road running alongside (a divided road's other carriageway, a service road): no parking,
   * no sidewalk, a narrow planted median strip instead. [left, right]. */
  median: [boolean, boolean];
  /** Room on each side up to the neighbour road's section (m beyond the pavement; Infinity = open). */
  room?: [number, number];
  /** Mostly a bridge deck: no parking lanes, no tree lawn, a narrow sidewalk. */
  deck?: boolean;
}

/** The section of a way: lanes from its tags (else the template's), parking / sidewalks unless a side faces a road. */
export function buildSection(tpl: Template, o: SectionOpts): Section {
  const tg = o.tags;
  let lanesF: number;
  let lanesB: number;
  if (o.oneway) {
    lanesF = tg.lanesFwd ?? tg.lanes ?? tpl.onewayLanes;
    lanesB = 0;
  } else if (tg.lanesFwd !== undefined || tg.lanesBack !== undefined) {
    lanesF = tg.lanesFwd ?? 1;
    lanesB = tg.lanesBack ?? 1;
  } else if (tg.lanes !== undefined) {
    lanesF = Math.max(1, Math.ceil(tg.lanes / 2));
    lanesB = Math.max(1, tg.lanes - lanesF);
  } else [lanesF, lanesB] = tpl.lanes;
  lanesF = Math.max(1, Math.min(6, lanesF));
  lanesB = Math.max(0, Math.min(6, lanesB));
  const lw = tpl.laneW;
  // Travel lanes: two-way = back lanes left of the reference line (the centre line), forward lanes right of it;
  // one-way = the lanes centred on it.
  let laneL: number;
  let laneR: number;
  if (o.oneway || lanesB === 0) {
    laneL = (lanesF * lw) / 2;
    laneR = laneL;
  } else {
    laneL = lanesB * lw;
    laneR = lanesF * lw;
  }
  // A street width tag (curb to curb) wins when it is plausible: the lanes are scaled to it.
  const parkTag = tg.parking;
  const sideParking = (side: 0 | 1): boolean =>
    tpl.parkW > 0 &&
    !o.deck &&
    !o.median[side] &&
    (parkTag ? parkTag[side] === 1 : true) &&
    // a one-way avenue with many lanes keeps parking on both sides; a ramp-like link never has any
    !(o.oneway && lanesF >= 4);
  const parkL = sideParking(0) ? tpl.parkW : 0;
  const parkR = sideParking(1) ? tpl.parkW : 0;
  let paveL = laneL + parkL + tpl.shoulder[0];
  let paveR = laneR + parkR + tpl.shoulder[1];
  if (tg.width && tg.width > 4 && tg.width < 40) {
    const k = tg.width / (paveL + paveR);
    if (k > 0.75 && k < 1.4) {
      paveL *= k;
      paveR *= k;
    }
  }
  const sw = (side: 0 | 1): boolean => {
    if (tpl.sidewalkW <= 0 || o.median[side]) return false;
    const s = tg.sidewalk;
    if (s === 'no') return false;
    if (s === 'left') return side === 0;
    if (s === 'right') return side === 1;
    return true;
  };
  const outer = (side: 0 | 1): Elem[] => {
    const out: Elem[] = [];
    const kerb = tpl.kerbH;
    if (o.median[side]) {
      // Facing another carriageway: kerbed planted strip (or a plain verge on a motorway), at most half the room.
      const room = o.room?.[side] ?? Infinity;
      if (kerb > 0) {
        const w = Math.max(0, Math.min(1.2, room / 2 - 0.2));
        out.push({
          kind: 'kerb',
          w: 0.2,
          rise: kerb,
          surface: 'concrete',
          mat: 'concrete',
        });
        if (w > 0.2)
          out.push({
            kind: 'median',
            w,
            rise: kerb,
            surface: 'grass',
            mat: 'terrain',
          });
      } else {
        const w = Math.max(0, Math.min(tpl.vergeW, room / 2));
        if (w > 0.1)
          out.push({
            kind: 'verge',
            w,
            rise: 0,
            surface: 'grass',
            mat: 'terrain',
          });
      }
      return out;
    }
    if (kerb > 0)
      out.push({
        kind: 'kerb',
        w: 0.2,
        rise: kerb,
        surface: 'concrete',
        mat: 'concrete',
      });
    if (sw(side)) {
      if (tpl.lawnW > 0 && !o.deck)
        out.push({
          kind: 'lawn',
          w: tpl.lawnW,
          rise: kerb,
          surface: 'grass',
          mat: 'terrain',
        });
      out.push({
        kind: 'sidewalk',
        w: o.deck ? Math.min(tpl.sidewalkW, 1.8) : tpl.sidewalkW,
        rise: kerb,
        surface: 'concrete',
        mat: 'concrete',
      });
    }
    if (tpl.vergeW > 0)
      out.push({
        kind: 'verge',
        w: tpl.vergeW,
        rise: kerb,
        surface: tpl.surface === 'dirt' ? 'dirt' : 'grass',
        mat: 'terrain',
      });
    return out;
  };
  const left = outer(0);
  const right = outer(1);
  const sum = (es: Elem[]) => es.reduce((a, e) => a + e.w, 0);
  // Paint.
  const paint: PaintLine[] = [];
  if (tpl.pave !== 'terrain') {
    const W = 0.12;
    if (o.oneway || lanesB === 0) {
      const n = lanesF;
      const lw2 = (laneL * 2) / n;
      for (let i = 1; i < n; i++)
        paint.push({
          t: laneL - i * lw2,
          color: 'white',
          dash: true,
          double: false,
          w: W,
        });
      if (tpl.edgeLines) {
        paint.push({
          t: laneL - 0.1,
          color: 'yellow',
          dash: false,
          double: false,
          w: W,
          edge: true,
        });
        paint.push({
          t: -laneR + 0.1,
          color: 'white',
          dash: false,
          double: false,
          w: W,
          edge: true,
        });
      }
    } else {
      if (tpl.centreLine === 'double_yellow' && laneL + laneR >= 5.6)
        paint.push({
          t: 0,
          color: 'yellow',
          dash: false,
          double: true,
          w: 0.1,
        });
      for (let i = 1; i < lanesB; i++)
        paint.push({
          t: (i * laneL) / lanesB,
          color: 'white',
          dash: true,
          double: false,
          w: W,
        });
      for (let i = 1; i < lanesF; i++)
        paint.push({
          t: -(i * laneR) / lanesF,
          color: 'white',
          dash: true,
          double: false,
          w: W,
        });
    }
  }
  return {
    tpl,
    lanesF,
    lanesB,
    oneway: o.oneway || lanesB === 0,
    left,
    right,
    paveL,
    paveR,
    footL: paveL + sum(left),
    footR: paveR + sum(right),
    paint,
    barrier: [
      o.median[0] && tpl.kerbH > 0 ? undefined : tpl.barrier[0],
      tpl.barrier[1],
    ],
  };
}
