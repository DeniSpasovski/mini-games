import type { Road } from '../road';
import {
  type Alignment,
  alignPolyline,
  designProfile,
  Grid,
  inPolygon,
  limitGrade,
  type Projection,
  projectOnSegment,
  sampleAt,
  smooth1d,
  smoothstep,
  STEP,
  valueAt,
  withFrames,
} from './alignment';
import {
  type ArmGeo,
  clusterOutline,
  type CornerGeo,
  junctionCuts,
  junctionOutline,
  sortArms,
  unionOutline,
} from './junction';
import { applyPatches } from './patches';
import {
  buildSection,
  packTemplate,
  type Section,
  type Template,
  TEMPLATES,
} from './templates';
import type {
  EdgeData,
  NetPark,
  NetworkData,
  NetworkDef,
  TagSet,
} from './types';

/**
 * Road engine v2: the solved road network of a map (`MapDef.network`). Built once at load, pure (node tests build it):
 *
 *  1. ways = the imported edges (+ the stage road) as smooth reference lines with a template and a cross-section;
 *  2. nodes -> junctions: arms cut back to one paved polygon per node (clusters for divided roads), merges onto the
 *     stage road keep their ends;
 *  3. crossings without a shared node are grade separations: the upper way gets a deck over the lower one, a long
 *     stage-road tunnel gets a slab the streets run on;
 *  4. vertical design: each way's height line from the land under it (decks interpolated over, smoothed, grade-limited),
 *     clearances enforced at crossings, one height per junction node, the ways eased to it;
 *  5. cross slopes (crown, crossfall, banking; flat into junctions) and the retaining walls (cut / fill deeper than the
 *     template's daylight rule).
 *
 * `field.ts` answers the terrain and physics queries from this, the mesh jobs draw it.
 */

export const ST_GROUND = 0;
export const ST_DECK = 1;
export const ST_TUNNEL = 2;
/** Deck surface to soffit (m). */
export const DECK_DEPTH = 1.3;
/** `wallsOf`: an underpass wall under a deck only where its soffit stands this far above the road (m). */
const UNDERPASS_MIN = 2.5;
/** ... and only under a deck crossing at least this steeply (sin of the angle): one running alongside is a viaduct. */
const UNDERPASS_SIN = 0.5;
/** ... except this close to the deck's end (m along it): there the deck rests on the wall (its abutment). */
const DECK_END_REST = 12;
/** A cut wall under another road's edge stops this far under its pavement (its coping stands 0.12 over the top, m). */
const WALL_UNDER_ROAD = 0.15;
/** ... a road whose pavement edge lies within this behind the wall's face (m, its coping) counts as over it. */
const WALL_ROAD_BACK = 0.5;
/** ... and carries no fence where a road beside / over it stands less than this over its top (the fence's height, m). */
const WALL_FENCE_CLEAR = 2.5;
/** Tunnel roof slab thickness (m). */
export const SLAB = 0.7;
/** A stage-road `under` stretch at least this long is a tunnel (slab + streets on top); shorter = a street deck over it. */
const TUNNEL_MIN = 40;
/** The stage run-out's own profile eases from the route's end height over this many m. */
const RUNOUT_EASE = 40;
/**
 * Survey (network_survey.py): a surveyed spot counts for a way's profile within its pavement and SPOT_ALONG m of a
 * sample, and only when within SPOT_TRUST m of the bare-earth land there (a spot on a deck or a structure above it is
 * left to the crossing rules). A spot over a bore's line and above the land is its roof (`surveyHeights`).
 */
const SPOT_ALONG = 6;
const SPOT_TRUST = 3;
/** Near a tunnel a spot more than this over the land is on its roof, not its floor (m). */
const SPOT_ROOF = 0.5;
/** A survey plaza's level also takes the spots this far outside its rim (the street ends it meets, m). */
const PLAZA_RIM = 8;
/** The stage's surveyed width holds off this far along from its own tunnel: the Queens Blvd bores keep the section (m). */
const TUNNEL_HOLD = 150;
/** A street's surveyed width holds off this far from a tunnel's line: the bores and their portals keep the template (m). */
const WIDTH_HOLD = 25;
/** A survey spot this near a tunnel's line (and over the land) lies on its roof (m). */
const TUNNEL_ROOF = 12;
/**
 * Surveyed walls: within the survey's stretch the parkway's cut / fill wall stands only where a surveyed wall line runs
 * alongside on that side - within WALL_SURVEY_REACH m of the centreline, within WALL_SURVEY_ALONG m along, at most
 * WALL_SURVEY_SKEW off parallel (|cos|); elsewhere the land stays a bank (drive videos: vine banks, no stone).
 */
const WALL_SURVEY_REACH = 22;
/** A surveyed wall line this much further out than the template's wall (m) moves the wall out to it, up to the max. */
const WALL_VERGE_MIN = 0.8;
const WALL_VERGE_MAX = 12;
/** The verge width is smoothed over this length (m). */
const WALL_VERGE_SMOOTH = 12;
const WALL_SURVEY_ALONG = 6;
const WALL_SURVEY_SKEW = 0.75;
/** Stage width per station: the narrowest pavement scale, and the ease back to the template near a tunnel (m). */
const WIDTH_MIN_K = 0.6;
const WIDTH_EASE = 100;
/** ... and held where another way's pavement lies within this many m past the stage's template edge. */
const WIDTH_CONTACT = 0.3;
/** A mainline's surveyed width eases back to its template over this many m into an end at a junction / bore (m). */
const WIDTH_END_EASE = 40;

/** Pavement scale of way `w` at s m along from its surveyed widths per station (1 = template / none). */
function widthK(w: Way, s: number): number {
  const wd = w.widths;
  if (!wd?.st.length) return 1;
  if (wd.pre) return valueAt(w.al, wd.pre, s);
  const raw = surveyK(w, s * wd.scale);
  const L = w.al.length;
  let e = 1;
  if (wd.ease?.[0]) e = Math.min(e, smoothstep(0, WIDTH_END_EASE, s));
  if (wd.ease?.[1]) e = Math.min(e, smoothstep(0, WIDTH_END_EASE, L - s));
  return 1 + (raw - 1) * e;
}

/** The raw scale of way `w`'s surveyed width at station m (its own metres), clamped. */
function surveyK(w: Way, m: number): number {
  const ws = w.widths!.st;
  let width: number;
  if (m <= ws[0][0]) width = ws[0][1];
  else if (m >= ws[ws.length - 1][0]) width = ws[ws.length - 1][1];
  else {
    let j = 0;
    while (j + 1 < ws.length && ws[j + 1][0] < m) j++;
    const t = (m - ws[j][0]) / (ws[j + 1][0] - ws[j][0] || 1);
    width = ws[j][1] + (ws[j + 1][1] - ws[j][1]) * t;
  }
  return Math.min(
    1,
    Math.max(WIDTH_MIN_K, width / (w.sec.paveL + w.sec.paveR)),
  );
}

/**
 * An edge's tag set with its surveyed width (curb to curb) in place of OSM's, except on the parkway classes
 * (motorway / trunk mainlines: the stage corridor and the Queens Blvd tunnel keep their template sections) and tunnel
 * streets.
 */
function surveyed(e: EdgeData, t: TagSet, sets: TagSet[]): TagSet {
  if (
    !e.surveyWidth ||
    /^(motorway|trunk)$/.test(e.kind) ||
    e.tags.some(([, ti]) => sets[ti]?.tunnel)
  )
    return t;
  return { ...t, width: e.surveyWidth, widthSurveyed: true };
}
/** A merging ramp's taper (m before its merge node) and its overlap under the host's edge where alongside. */
const MERGE_TAPER = 55;
const MERGE_OVERLAP = 0.3;
/** A merging way's gore is paved while its host's edge is this close to its own (m); past it the roads part (verge). */
const GORE_MAX = 9;
/** How far from its merge node a way looks for its gore (m along it). */
const GORE_REACH = 220;
/** Pavement gap between two roadways running side by side without merging (m): room for one barrier / lane wall. */
const NEIGHBOUR_GAP = 0.8;
/** A street junction beside a roadway: slack beyond the sections' gap (m), the most a node moves, the ease along its arms. */
const NODE_CLEAR = 1.0;
const NODE_PUSH_MAX = 12;
/** The most a way is pushed sideways off a higher-ranked road (m). */
const SEP_PUSH_MAX = 14;
/** Near a crossing under a stage-road bridge a way never yields to the roads on the deck: m along either side. */
const CROSS_CLEAR = 40;
/** ...and eases back into yielding over this much further (m). */
const CROSS_EASE = 80;
/** A way whose OSM line crosses a higher-ranked road at another layer is not pushed off it within this of the crossing (m). */
const CROSS_HOLD = 40;
/** A one-off deck (`NetworkDef.decks`): the lower road's band reaches this far behind its wall line (the coping), and the
 * deck runs on this far past that footprint onto its abutment seats (m). */
const FOOTPRINT_BACK = 2.4;
const DECK_SEAT = 2;
const NODE_EASE = 30;
/** OSM ramps (`*_link`): the only ways that merge into another road. */
const isRamp = (w: Way) => /_link$/.test(w.kind);
/** Right of way: template rank, kerbless roadways above kerbed streets of the same rank, the stage road above all. */
const effRank = (w: Way) =>
  (w.stage ? 100 : 0) + w.tpl.rank + (w.tpl.kerbH === 0 ? 0.5 : 0);
/** A motorway / trunk way running along the stage road within this centre distance (m) is its other carriageway
 * (a mainline converging from further out has its own profile and crossings). */
const CORRIDOR = 18;
/** A highway ramp takes the pavement of the stage road within this distance (m, `NetworkDef.pavement`). */
const PAVEMENT_REACH = 120;
/** A bore's soffit where the map's `tunnels` name none: plain beams this deep (m), and how far from the stage road a
 * bore takes the stage's stretch (m, `girderAt`). */
export const TUNNEL_GIRDER_DEFAULT = 0.5;
const TUNNEL_REACH = 40;
/** A spot height on the stage road's deck stands at least this far over the land under it (m, `surveyHeights`). */
/** A crossing whose deck and road the survey measured keeps at least this under the deck's soffit (m). */
const SURVEYED_CLEARANCE_MIN = 3.6;
/** The stage road's other carriageway, eased onto it, keeps within this many times its own grade. */
const CORRIDOR_GRADE = 1.3;
/** How far past a stage dip's flat its vertical curves reach (m): the stage's profile is eased that far. */
const DIP_CURVE_REACH = 160;
/** ... less this much (m): the profiles' fit to their spots, not a clearance to make up. */
const SURVEYED_SLACK = 0.3;
/** `surveyGaps`: a surveyed height off the line through its neighbours (SURVEY_NEAR..SURVEY_FAR m either side) by
 * more than SURVEY_OFF m is a stray (a deck's edge, a wall top); a gap in the survey up to SURVEY_HOLE m long whose land
 * strays as far from the line across it is a hole (under a deck, the ground's fill) and takes that line. */
const SURVEY_NEAR = 5;
const SURVEY_FAR = 20;
const SURVEY_OFF = 0.8;
const SURVEY_HOLE = 40;

/** The median of the finite values of `got` from sample `i` on, `dir` (+-1) way, with |s - s[i]| in [near, far]. */
function medianIn(
  s: ArrayLike<number>,
  got: Float64Array,
  i: number,
  dir: number,
  near: number,
  far: number,
): number {
  const ys: number[] = [];
  for (let k = i; k >= 0 && k < got.length; k += dir) {
    const d = Math.abs(s[k] - s[i]);
    if (d > far) break;
    if (d >= near && Number.isFinite(got[k])) ys.push(got[k]);
  }
  if (!ys.length) return NaN;
  ys.sort((p, q) => p - q);
  return ys[ys.length >> 1];
}

/** A way's surveyed heights cleaned up (SURVEY_OFF): strays dropped, holes in the survey bridged by the line across. */
function surveyGaps(
  s: ArrayLike<number>,
  raw: Float64Array,
  valid: boolean[],
  got: Float64Array,
): void {
  const n = got.length;
  // (the line through the medians either side)
  const line = (i: number) => {
    const a = medianIn(s, got, i, -1, SURVEY_NEAR, SURVEY_FAR);
    const b = medianIn(s, got, i, 1, SURVEY_NEAR, SURVEY_FAR);
    return Number.isFinite(a) && Number.isFinite(b) ? (a + b) / 2 : NaN;
  };
  const stray: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(got[i])) continue;
    const y = line(i);
    if (Number.isFinite(y) && Math.abs(got[i] - y) > SURVEY_OFF) stray.push(i);
  }
  for (const i of stray) {
    got[i] = NaN;
    valid[i] = false;
  }
  for (let i = 0; i < n;) {
    if (Number.isFinite(got[i]) || !valid[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && !Number.isFinite(got[j])) j++;
    if (i > 0 && j < n && s[j] - s[i - 1] <= SURVEY_HOLE) {
      const ya = got[i - 1];
      const yb = got[j];
      let off = 0;
      for (let k = i; k < j; k++) {
        const f = (s[k] - s[i - 1]) / (s[j] - s[i - 1]);
        if (valid[k])
          off = Math.max(off, Math.abs(raw[k] - (ya + (yb - ya) * f)));
      }
      if (off > SURVEY_OFF) for (let k = i; k < j; k++) valid[k] = false;
    }
    i = j;
  }
}

/** `y` held to `g` grade: the mean of a forward and a backward capped pass (each within it, so is their mean). */
function gradeCap(
  y: Float64Array,
  s: ArrayLike<number>,
  g: number,
): Float64Array {
  const n = y.length;
  const f = y.slice();
  const b = y.slice();
  for (let i = 1; i < n; i++) {
    const m = g * (s[i] - s[i - 1]);
    f[i] = Math.min(f[i - 1] + m, Math.max(f[i - 1] - m, f[i]));
  }
  for (let i = n - 2; i >= 0; i--) {
    const m = g * (s[i + 1] - s[i]);
    b[i] = Math.min(b[i + 1] + m, Math.max(b[i + 1] - m, b[i]));
  }
  for (let i = 0; i < n; i++) y[i] = (f[i] + b[i]) / 2;
  return y;
}

/** Spot heights [x, z, y] -> points (x, y, z) + a grid of their reach. */
function spotsOf(
  hs: [number, number, number][] | undefined,
): { pts: Float64Array; grid: Grid<number> } | undefined {
  if (!hs?.length) return undefined;
  const pts = new Float64Array(hs.length * 3);
  const grid = new Grid<number>(16);
  hs.forEach(([x, z, y], k) => {
    pts.set([x, y, z], k * 3);
    grid.add(
      k,
      x - SPOT_ALONG - 12,
      z - SPOT_ALONG - 12,
      x + SPOT_ALONG + 12,
      z + SPOT_ALONG + 12,
    );
  });
  return { pts, grid };
}

/** The median of a way's surveyed heights (NaN where none) within SPOT_ALONG m of `s`, NaN if it has none there. */
function nearestOf(al: Alignment, got: Float64Array, s: number): number {
  const ys: number[] = [];
  for (let i = 0; i < al.n; i++)
    if (Math.abs(al.s[i] - s) <= SPOT_ALONG && Number.isFinite(got[i]))
      ys.push(got[i]);
  if (!ys.length) return NaN;
  ys.sort((a, b) => a - b);
  return ys[ys.length >> 1];
}
/** The stage profile's residual to its survey is smoothed over this window before it is added back (m, `profiles`). */
const RESIDUAL_WINDOW = 30;
/** A carriageway node takes the stage road's height when one of its last this many samples has a corridor station. */
const CORR_END_LOOK = 4;
/**
 * A street running alongside the stage road in its cut (within this, m; parallel, at its level within SIDE_LEVEL m)
 * takes the stage's wall look there: one cut, one wall (drive video 5:22-5:24, the ashlar cut before Queens Blvd).
 */
const SIDE_REACH = 30;
const SIDE_LEVEL = 3;
/** Tunnelled roadways within this of each other (m) share one slab. */
const TRENCH_REACH = 40;
/** The other carriageway blends from the stage road's profile back to its own over this length (m). */
const CORRIDOR_EASE = 60;
/** A carriageway whose land runs more than this above / below the stage road's is on another level (a ramp). */
const CORRIDOR_LEVEL = 1.5;
/** A shorter break in that level test (a bridge hole in the bare-earth DEM) keeps the carriageway in the corridor. */
const CORRIDOR_GAP = 60;
/** Two decks of one way closer than this (m) join into one span (the median of a divided road below). */
const DECK_JOIN = 30;
/** Ways within this of each other (edge to edge, m) and parallel face each other: no parking / sidewalk on that side. */
const MEDIAN_REACH = 9;
/** Wall decisions: probe distances beyond the wall line (m). */
const PROBES = [1.5, 4.5, 9];
/** The probes up to here set a cut wall's height (the far one only decides whether it needs one). */
const NEAR_PROBE = 4.5;
/** Two unrelated roads run alongside (`Network.unrelated`) at this |cos| between their directions or more. */
const DIVIDE_COS = 0.9;
/** ... and such a wall shorter than this (m) is dropped. */
const DIVIDE_MIN = 8;
/**
 * A gap in the wall survey shorter than this (m) between two walls of the same road, where the cut is too tall for a
 * bank (twice its `maxCut`), is closed: v1's lines end at its own structures (a deck's abutment), the land between
 * two wall ends would stand as a spike.
 */
const SURVEY_GAP = 10;
/** A cut wall's top rises from its least height at an open end by this much per metre along it. */
const WALL_END_SLOPE = 0.35;
/** A fill wall ending within this of a deck end on its side (m) runs on to the deck. */
const WALL_DECK_JOIN = 12;
/** A deck runs on this far at most where the way's own section still reaches over a road beneath (`decksOverLanes`, m). */
const DECK_REACH = 30;
/** ...a road this far below its edge (m). */
const UNDER_STOREY = 3;
/** ...or that road's sidewalks and cut wall: m beyond its wall line the deck still clears (the abutment stands behind). */
const DECK_WALL_CLEAR = 1;
// a cut wall top this little over the street it holds is brought down to that street's edge
const CARRIED_HUMP = 1.2;
// a raised wall runs on along the street it holds while that street stands this much (m) over the road (past ROAD_STEP)
const SOFT_RISE = 0.85;
// a cut wall left uncarried this long (m) between two carried stretches is carried across
const CARRIED_GAP = 16;
// a structure range reaches this far (m) past its ends: a sample on its end vertex is in it
const RANGE_EPS = 1e-6;
// a carried wall's top sunk this far (m) under both neighbours is a notch, filled
const CARRIED_NOTCH = 0.2;
// a node this near (m) the stage road's last sample, its arms within this turn (rad) of the stage's end: the road runs on
const STAGE_END_JOIN = 3;
const STAGE_END_TURN = 0.45;
/** A cut wall at most this far (m) in front of a higher road's fill wall gives way to it (`facedWalls`). */
const FACE_GAP = 6;
/** A projection this much further from a way's line than its lateral offset lies past the way's end (m). */
const PAST_END = 1;
// a surveyed wall line within this of a road's own wall line keeps that wall (facedWalls)
const WALL_SURVEY_HOLD = 2;
// ... and nearer to it than the street's face by this much
const WALL_SURVEY_PICK = 0.5;
// (a break in the surveyed line up to twice this long counts as the line)
const WALL_SURVEY_BRIDGE = 8;
/** Lateral offsets beyond the wall line where another road at this level makes one platform (no wall). */
const PLATFORM_PROBES = [0.3, 1.6, 3.2];
/**
 * Two roads side by side are one platform within this height step (m); a higher step between them leaves no room
 * for a slope and is walled (below the template's `maxCut`, which is for open land).
 */
export const ROAD_STEP = 0.8;
/** A way ending against another one stops this far beyond the last overlap (room for the other's wall). */
const q0WallRoom = 1.5;
/** A cut wall's top stands this far above the land behind it (m). */
const WALL_PARAPET = 0.8;
export const WALL_NONE = 0;
export const WALL_CUT = 1;
export const WALL_FILL = 2;

export interface Way {
  index: number;
  id: string;
  kind: string;
  name?: string;
  stage: boolean;
  oneway: boolean;
  tpl: Template;
  sec: Section;
  tags: TagSet;
  /** Node ids at the start / end (-1 = none: the stage road). */
  nodes: [number, number];
  al: Alignment;
  /** Centreline height, cross slope (one-way: + = left side higher, y + a t) and crown (two-way: y - c |t|). */
  y: Float64Array;
  a: Float64Array;
  c: Float64Array;
  /** Structure per sample (ST_*). */
  st: Uint8Array;
  /** Slab top over a tunnel stretch. */
  slab?: Float64Array;
  /** m at the start / end inside a junction polygon (the way's own surface stops there). */
  cut0: number;
  cut1: number;
  /** Cut back to a survey plaza's rim (`trimToPlazas`): its junction cuts before that (its paint runs on over the plaza). */
  plazaCut?: [number, number];
  /** Merge ends (a ramp onto the stage road or a through road): the end overlaps the higher road, drawn under it. */
  merge0: boolean;
  merge1: boolean;
  /** The way each merge end runs into [start, end]. */
  into: [Way | null, Way | null];
  /** Divided road: the stage road's station beside each sample (NaN where this way is no carriageway of it). */
  corr?: Float64Array;
  /** Both ends inside one junction cluster: no surface of its own. */
  internal: boolean;
  /** Walls per side [left, right]: WALL_* per sample, and the wall top height. */
  wall: [Uint8Array, Uint8Array];
  wallTop: [Float64Array, Float64Array];
  /** Per side: the cut wall carries another road's edge (a street at the rim), no parapet. */
  wallCarried: [Uint8Array, Uint8Array];
  /** Per side: the wall is a lane wall in a tunnel (thin, between this roadway and the higher-ranked one beside it). */
  wallLane: [Uint8Array, Uint8Array];
  /** Per side: no cut wall here, a higher road's fill wall stands this far out from the foot (m; 0 = none) and is the
   * one face down to this road (the land between lies at this road's level). */
  wallFaced: [Float32Array, Float32Array];
  /**
   * Per side: the wall stands this much further out than the template's `wallOffset` (m): a verge at the road's level
   * out to the surveyed wall line (`surveyVerges`); undefined = none.
   */
  wallOut?: [Float32Array, Float32Array];
  /**
   * Pavement scale per sample (the stage road: surveyed width per station / the template's, `stageScale`); undefined = 1.
   * Laterals are in SECTION metres everywhere (the template's section); `worldT` / `sectionT` convert at the world
   * boundary (a point's position, a projection): the pavement narrows by k, the elements beyond it move in with its edge.
   */
  k?: Float64Array;
  /**
   * A merging way's gore: per sample the lateral (this way's frame, + = left) of its host's near pavement edge, where
   * that edge lies within GORE_MAX of this way's pavement (NaN elsewhere), the host's surface there and the side it
   * lies on. The pavement reaches out to it (`goreAt`): the wedge between ramp and host is paved, no verge, no slab side.
   */
  gore?: { t: Float64Array; h: Float64Array; side: Int8Array };
  /**
   * Surveyed width per station (the stage: `stage.widths`; a parkway mainline: its edge's `widths`), m along = s * scale
   * (`widthK`): the right-of-way pass keeps neighbours apart at these widths, `stageScale` / `mainlineScale` narrow to them.
   */
  widths?: {
    st: [number, number][];
    scale: number;
    /** The stage: its scale per sample before the contact holds (`stageScale` with the tunnel holds only). */
    pre?: Float64Array;
    /** A mainline: its ends that ease back to the template (a junction, a bore, a way without survey widths). */
    ease?: [boolean, boolean];
  };
}

/**
 * Way `w`'s gore pavement at sample i + fraction f on the side `left`: the lateral |t| it reaches (beyond its own
 * pavement edge) and the host's surface there; undefined where it has none on that side.
 */
export function goreAt(
  w: Way,
  i: number,
  f: number,
  left: boolean,
): { u: number; h: number } | undefined {
  const g = w.gore;
  if (!g) return undefined;
  const j = Math.min(w.al.n - 1, i + 1);
  const a = Number.isNaN(g.t[i]) || g.side[i] > 0 !== left ? -1 : i;
  const b = Number.isNaN(g.t[j]) || g.side[j] > 0 !== left ? -1 : j;
  if (a < 0 && b < 0) return undefined;
  const k = a < 0 ? b : b < 0 ? a : -1;
  const u =
    k >= 0 ? Math.abs(g.t[k]) : Math.abs(g.t[a] + (g.t[b] - g.t[a]) * f);
  const h = k >= 0 ? g.h[k] : g.h[a] + (g.h[b] - g.h[a]) * f;
  // (the host's edge inside this way's pavement, or past its centre: nothing to pave)
  const pave = left ? w.sec.paveL : w.sec.paveR;
  const sgOk = (k >= 0 ? g.t[k] : g.t[a]) * (left ? 1 : -1) > 0;
  return sgOk && u > pave + 0.02 ? { u, h } : undefined;
}

/** Pavement scale of way `w` at sample i + fraction f (1 = its template section). */
export function scaleAt(w: Way, i: number, f = 0): number {
  const k = w.k;
  if (!k) return 1;
  const j = Math.min(k.length - 1, Math.max(0, i));
  return k[j] + (k[Math.min(k.length - 1, j + 1)] - k[j]) * f;
}

/** World lateral (m from the centreline, + left) of section lateral t on way `w` at sample i + f. */
export function worldT(w: Way, i: number, f: number, t: number): number {
  if (!w.k) return t;
  const k = scaleAt(w, i, f);
  const pave = t >= 0 ? w.sec.paveL : w.sec.paveR;
  const u = Math.abs(t);
  return Math.sign(t) * (u <= pave ? u * k : u - pave * (1 - k));
}

/** Way `w`'s wall line past its foot on one side at sample i (section m): the template's offset + the verge (`wallOut`). */
export function wallOff(w: Way, i: number, side: 0 | 1): number {
  const o = w.wallOut?.[side];
  return (
    w.tpl.daylight.wallOffset +
    (o ? o[Math.min(o.length - 1, Math.max(0, i))] : 0)
  );
}

/** The widest verge of way `w` (m, `wallOut`). */
export function maxVerge(w: Way): number {
  let m = 0;
  if (w.wallOut)
    for (const o of w.wallOut) for (const v of o) m = Math.max(m, v);
  return m;
}

/** Section lateral of world lateral t on way `w` at sample i + f (inverse of `worldT`). */
export function sectionT(w: Way, i: number, f: number, t: number): number {
  if (!w.k) return t;
  const k = scaleAt(w, i, f);
  const pave = t >= 0 ? w.sec.paveL : w.sec.paveR;
  const u = Math.abs(t);
  return Math.sign(t) * (u <= pave * k ? u / k : u + pave * (1 - k));
}

export interface NetNode {
  id: number;
  x: number;
  z: number;
  flags: number;
  /** m along the stage road, -1 = not on it. */
  stage: number;
  ends: { way: Way; atEnd: boolean }[];
  /** Height all ways meeting here are pinned to. */
  h: number;
  junction?: Junction;
  kind: 'end' | 'joint' | 'junction' | 'stage';
  /** Ramps merge into a through road here (no junction polygon). */
  merge?: boolean;
}

export interface JunctionArm extends ArmGeo {
  way: Way;
  atEnd: boolean;
  node: NetNode;
}

export interface Junction {
  index: number;
  nodes: NetNode[];
  arms: JunctionArm[];
  poly: number[];
  corners: (CornerGeo & { rise: number })[];
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  /** Paving surface (the dominant arm's). */
  surface: Way['tpl']['surface'];
  rank: number;
  /** Inside a survey plaza (`NetworkDef.plazas`): the plaza's surface stands for it (not drawn, no ground of its own). */
  plaza?: boolean;
}

/** A piece of city street space (`NetworkDef.streetSpace`) with its box: paved under the roads. */
export interface Under {
  kind: 'road' | 'walk';
  area: number[];
  holes: number[][];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** A survey plaza (`NetworkDef.plazas`) with its box. */
export interface Plaza {
  area: number[];
  islands: { kind: string; pts: number[] }[];
  /** OSM zebra crossings over it (x, z polylines). */
  crosswalks: number[][];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** The street ends on its rim: point, height (the street's surface across its pavement there). */
  rim: { x: number; z: number; y: number }[];
  /** Its surveyed paving height at (x, z) (`plazaDips`: the spots of its top), undefined without spots. */
  level?: (x: number, z: number) => number;
  /** The spots of its top (x, z, y; `plazaDips`). */
  spots?: [number, number, number][];
}

export interface Crossing {
  upper: Way;
  lower: Way;
  sU: number;
  sL: number;
  /** |sin| of the crossing angle. */
  sin: number;
  x: number;
  z: number;
  /** The upper way runs on a tunnel slab (not on a deck of its own). */
  overSlab: boolean;
}

export type NaturalHeight = (x: number, z: number) => number;

/** How far a road class's designed profile may leave the land (m): a parkway is built, a lane follows the ground. */
function profileTol(rank: number): number {
  return rank >= 7 ? 0.6 : rank >= 5 ? 0.45 : 0.35;
}

/** A crossing's height demand on a way at station s: dip to / rise to / hold y, flat over +-flat, grade g. */
export interface Dip {
  w: Way;
  s: number;
  y: number;
  flat: number;
  g: number;
  mode: 'down' | 'up' | 'force';
}

export class Network {
  readonly ways: Way[] = [];
  readonly nodes = new Map<number, NetNode>();
  readonly junctions: Junction[] = [];
  /** Survey plazas (`NetworkDef.plazas`). */
  readonly plazas: Plaza[];
  /** City street space (`NetworkDef.streetSpace`): paved under the roads. */
  readonly under: Under[];
  /** Its raised medians (outlines). */
  readonly underMedians: number[][];
  /** Small city parks (`NetworkDef.parks`): footpaths and fountains. */
  readonly parks: NetPark[];
  /** Protected bike lanes on street centrelines (`NetworkDef.bikeLanes`). */
  readonly bikeLanes: number[][];
  /** Red bus lanes (`NetworkDef.busLanes`). */
  readonly busLanes: number[][];
  /** Painted median outlines (`NetworkDef.paintedMedians`). */
  readonly paintedMedians: number[][];
  /** The roads in the trench under a plaza (`trimToPlazas`): their open cut is never paved over. */
  readonly trench = new Set<Way>();
  readonly crossings: Crossing[] = [];
  /** Stage road = ways[0]. */
  readonly stage: Way;
  /** Stage sample where the run-out (`RoadDef.runout`) begins: its profile is a piece of its own; n = none. */
  private runoutFrom = Infinity;
  /** Centreline segments (way, sample) for proximity queries. */
  lines = new Grid<number>(24);
  /** Patches whose target was not found (dev warning, test). */
  readonly missingPatches: unknown[];
  /** Solver state kept for the map viewer / tests: land profiles per way and the crossing dips applied. */
  readonly debug: {
    base: Float64Array[];
    dips: Dip[];
    trace: string[];
    /** Profile samples set by surveyed spot heights. */
    surveyed: number;
    /** Stage samples held at the template width (`stageScale`: tunnel, contact), m along to the nearest. */
    widthHeld?: Float64Array;
    /** The stage's land profile with its survey, before the design fit. */
    raw?: Float64Array;
  } = {
    base: [],
    dips: [],
    trace: [],
    surveyed: 0,
  };
  private readonly natural: NaturalHeight;
  /** Surveyed spot heights (x, y, z flat) and their grid (network_survey.py). */
  private spots?: { pts: Float64Array; grid: Grid<number> };
  /** The survey's deck tops (`survey.decks`): only the samples of a way on its own deck take them. */
  private deckSpots?: { pts: Float64Array; grid: Grid<number> };
  /** Surveyed retaining wall segments [x0, z0, x1, z1] flat + grid, the stage metres the survey covers. */
  private surveyWalls?: { segs: number[]; grid: Grid<number>; until: number };
  private readonly wallStyles: NonNullable<NetworkDef['wallStyles']>;
  private readonly deckStyles: NonNullable<NetworkDef['deckStyles']>;
  private readonly pavement: NonNullable<NetworkDef['pavement']>;
  private readonly tunnelDefs: NonNullable<NetworkDef['tunnels']>;
  private readonly openBeside: NonNullable<NetworkDef['openBeside']>;
  private readonly medianFences: NonNullable<NetworkDef['medianFences']>;
  private readonly paveNear = new Map<number, Projection>();
  /** Wall samples beside another, unrelated road at their level (`dividingWalls`): way, side, sample, that road. */
  private divides: [Way, 0 | 1, number, Way][] = [];

  constructor(def: NetworkDef, road: Road, natural: NaturalHeight) {
    this.natural = natural;
    this.plazas = (def.plazas ?? []).map((p) => {
      const xs = p.area.filter((_, i) => i % 2 === 0);
      const zs = p.area.filter((_, i) => i % 2 === 1);
      return {
        area: p.area,
        islands: p.islands ?? [],
        crosswalks: p.crosswalks ?? [],
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minZ: Math.min(...zs),
        maxZ: Math.max(...zs),
        rim: [],
      };
    });
    const box = (area: number[]) => {
      const xs = area.filter((_, i) => i % 2 === 0);
      const zs = area.filter((_, i) => i % 2 === 1);
      return {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minZ: Math.min(...zs),
        maxZ: Math.max(...zs),
      };
    };
    const sp = def.streetSpace;
    this.under = [
      ...(sp?.road ?? []).map((u) => ({ kind: 'road' as const, ...u })),
      ...(sp?.walk ?? []).map((u) => ({ kind: 'walk' as const, ...u })),
    ]
      .filter((u) => u.area.length >= 6)
      .map((u) => ({
        kind: u.kind,
        area: u.area,
        holes: u.holes ?? [],
        ...box(u.area),
      }));
    this.underMedians = (sp?.medians ?? []).filter((m) => m.length >= 6);
    this.parks = def.parks ?? [];
    this.bikeLanes = def.bikeLanes ?? [];
    this.busLanes = def.busLanes ?? [];
    this.paintedMedians = def.paintedMedians ?? [];
    this.wallStyles = def.wallStyles ?? [];
    this.deckStyles = def.deckStyles ?? [];
    this.pavement = def.pavement ?? [];
    this.tunnelDefs = def.tunnels ?? [];
    this.openBeside = def.openBeside ?? [];
    this.medianFences = def.medianFences ?? [];
    const sw = def.data.survey;
    if (sw?.walls?.length && sw.wallsUntil) {
      const segs: number[] = [];
      const grid = new Grid<number>(32);
      for (const l of sw.walls)
        for (let k = 0; k + 3 < l.length; k += 2) {
          const [x0, z0, x1, z1] = [l[k], l[k + 1], l[k + 2], l[k + 3]];
          const r = WALL_SURVEY_REACH;
          grid.add(
            segs.length / 4,
            Math.min(x0, x1) - r,
            Math.min(z0, z1) - r,
            Math.max(x0, x1) + r,
            Math.max(z0, z1) + r,
          );
          segs.push(x0, z0, x1, z1);
        }
      this.surveyWalls = {
        segs,
        grid,
        until:
          sw.wallsUntil *
          (road.runoutFrom / Math.max(1, def.data.stage.length)),
      };
    }
    const { data, pins, structures, missing } = applyPatches(
      def.data,
      def.patches,
    );
    this.missingPatches = missing;
    this.spots = spotsOf(def.data.survey?.heights);
    this.deckSpots = spotsOf(def.data.survey?.decks);
    // --- 1. ways ---------------------------------------------------------------------------------------------
    this.stage = this.addStage(def, road);
    // the OSM layers before any structure is solved (right of way needs them: a road crossing under a bridge is no neighbour)
    this.tagSets = data.tagSets;
    this.deckDefs = def.decks ?? [];
    const sc = road.runoutFrom / Math.max(1, data.stage.length);
    this.stageSpans = data.stage.spans.map((sp) => [
      sp.from * sc,
      sp.to * sc,
      sp.kind === 'bridge' ? 1 : -1,
    ]);
    {
      const sc = road.runoutFrom / Math.max(1, data.stage.length);
      this.stageBridges = data.stage.spans
        .filter((sp) => sp.kind === 'bridge')
        .map((sp) => [sp.from * sc, sp.to * sc]);
    }
    if (road.runoutFrom < road.length)
      this.runoutFrom = Math.max(1, sampleAt(this.stage.al, road.runoutFrom));
    this.holdTunnels(data, road);
    if (data.stage.widths?.length) {
      const w = this.stage;
      w.widths = {
        st: data.stage.widths,
        scale: data.stage.length / Math.max(1, road.runoutFrom),
      };
      const d = this.heldDistance(this.stageTunnelHeld(data, road));
      const pre = new Float64Array(w.al.n);
      for (let i = 0; i < w.al.n; i++)
        pre[i] =
          1 +
          (surveyK(w, w.al.s[i] * w.widths.scale) - 1) *
            smoothstep(0, WIDTH_EASE, d[i]);
      w.widths.pre = pre;
    }
    for (const e of data.edges) {
      if (e.pts.length < 4) continue;
      this.addWay(e, data.tagSets, def);
    }
    this.indexLines();
    // --- nodes ----------------------------------------------------------------------------------------------------
    const scale = road.runoutFrom / Math.max(1, data.stage.length);
    for (const [id, x, z, flags, along] of data.nodes)
      this.nodes.set(id, {
        id,
        x,
        z,
        flags,
        stage: along >= 0 ? along * scale : -1,
        ends: [],
        h: 0,
        kind: 'end',
      });
    for (const w of this.ways) {
      if (w.stage) continue;
      this.nodes.get(w.nodes[0])?.ends.push({ way: w, atEnd: false });
      this.nodes.get(w.nodes[1])?.ends.push({ way: w, atEnd: true });
    }
    // a mainline's surveyed width carries on only through a joint with another surveyed one
    for (const w of this.ways)
      if (!w.stage && w.widths)
        w.widths.ease = [0, 1].map((k) => {
          const nd = this.nodes.get(w.nodes[k]);
          const other = nd?.ends.filter((e) => e.way !== w) ?? [];
          return (
            !nd || nd.stage >= 0 || other.length !== 1 || !other[0].way.widths
          );
        }) as [boolean, boolean];
    // --- sections (templates, divided-road sides) ------------------------------------------------------------------
    this.assignRoles();
    this.buildSections();
    this.stageNodes();
    // --- right of way: a road alongside a higher-ranked one is moved off it, then the sections are redone ----------
    this.lines = new Grid<number>(24);
    this.indexLines();
    if (this.separate()) {
      this.lines = new Grid<number>(24);
      this.indexLines();
    }
    this.buildSections();
    // the stage pavement and the parkway mainlines at their surveyed widths (after the layout passes: every alignment
    // stays where it was)
    this.mainlineScale();
    this.stageScale(data, road);
    // --- 2. junctions ---------------------------------------------------------------------------------------------
    this.buildJunctions();
    // --- 3. structures ---------------------------------------------------------------------------------------------
    this.corridor();
    this.structuresFromTags(data, structures, def, road);
    this.tagSets = data.tagSets;
    this.findCrossings();
    this.joinDecks();
    this.nearCrossings();
    // --- 4. vertical design -----------------------------------------------------------------------------------------
    this.profiles(pins);
    this.unifySlabs();
    this.coupleCorridor();
    this.trimToPlazas();
    // --- 5. cross slopes, walls ------------------------------------------------------------------------------------
    this.crossSlopes();
    this.coupleMerges();
    this.gores();
    this.surveyVerges();
    for (let i = 0; i < road.samples.length; i++) {
      const s = road.samples[i];
      s.y = valueAt(this.stage.al, this.stage.y, s.dist);
    }
  }

  /** Must run after the field index exists (walls probe neighbouring ways). */
  decideWalls(
    surfaceAt: (
      x: number,
      z: number,
      self: Way,
      ref: number,
    ) => number | undefined,
    onRoad: (x: number, z: number, y: number, self: Way) => Way | undefined,
    land: (x: number, z: number, self: Way) => number,
  ): void {
    this.decksOverLanes();
    this.divides = [];
    this.portalRuns = [];
    for (const w of this.ways) this.wallsOf(w, surfaceAt, onRoad, land);
    this.facedPortals();
    this.dividingWalls(land);
    this.facedWalls();
    // (a verge leads only to a cut wall of the way's own: none in front of a fill wall, a lane wall or open land)
    for (const w of this.ways)
      if (w.wallOut)
        for (const side of [0, 1] as const)
          for (let i = 0; i < w.al.n; i++)
            if (w.wall[side][i] !== WALL_CUT || w.wallLane[side][i])
              w.wallOut[side][i] = 0;
  }

  /**
   * Two roads with nothing to do with each other (no shared node, neither merging into the other) running alongside at
   * one level: the parkway and the Union Tpke underpass lanes before Queens Blvd, each down in its own trench.
   */
  private unrelated(w: Way, q: Way, i: number): boolean {
    if (w.nodes.some((n) => n >= 0 && q.nodes.includes(n))) return false;
    if (w.into.includes(q) || q.into.includes(w)) return false;
    // (the stage road's two carriageways share a barrier)
    if ((w.stage || w.corr) && (q.stage || q.corr)) return false;
    const p = this.nearLines(
      w.al.x[i],
      w.al.z[i],
      40,
      this.paveNear,
      (o) => o !== q,
    ).get(q.index);
    if (!p) return false;
    const k = Math.min(q.al.n - 1, p.f < 0.5 ? p.i : p.i + 1);
    return (
      Math.abs(w.al.tx[i] * q.al.tx[k] + w.al.tz[i] * q.al.tz[k]) >= DIVIDE_COS
    );
  }

  /**
   * The wall between the stage road's carriageways and an unrelated road side by side at their level in a cut
   * (`unrelated`; drive video 5:22-5:24: the parkway alone between ashlar walls, the Union Tpke lanes down behind): its
   * lane wall, a thin wall up to the cut's rim on the far side of the other road (its own cut wall's top, else the
   * land just beyond it) - only where that rim stands ROAD_STEP or more above both.
   */
  private dividingWalls(
    land: (x: number, z: number, self: Way) => number,
  ): void {
    const near = new Map<number, Projection>();
    const built = new Set<Way>();
    for (const [w, side, i, q] of this.divides) {
      // (the stage road's carriageways only: the parkway in its cut; not where the map has it open, `openBeside`)
      if (!(w.stage || w.corr) || w.st[i] !== ST_GROUND) continue;
      const st = this.stationOf(w, i);
      if (this.openBeside.some((r) => st >= r.from && st <= r.to)) continue;
      const sg = side === 0 ? 1 : -1;
      const foot = side === 0 ? w.sec.footL : w.sec.footR;
      const lw = worldT(w, i, 0, (foot + wallOff(w, i, side)) * sg);
      const px = w.al.x[i] + w.al.tz[i] * lw;
      const pz = w.al.z[i] - w.al.tx[i] * lw;
      const p = this.nearLines(px, pz, 40, near, (o) => o !== q).get(q.index);
      if (!p) continue;
      const k = Math.min(q.al.n - 1, p.f < 0.5 ? p.i : p.i + 1);
      if (q.st[k] !== ST_GROUND) continue;
      // q's far side from the wall: the side p.t does not point to
      const far: 0 | 1 = p.t >= 0 ? 1 : 0;
      const qsg = far === 0 ? 1 : -1;
      const qFoot = far === 0 ? q.sec.footL : q.sec.footR;
      // (the higher of that road's far cut wall and the land just beyond it: a plaza or street over its coping)
      const t = worldT(q, p.i, p.f, (qFoot + wallOff(q, k, far) + 1.5) * qsg);
      let rim = land(q.al.x[k] + q.al.tz[k] * t, q.al.z[k] - q.al.tx[k] * t, q);
      if (q.wall[far][k] === WALL_CUT) rim = Math.max(rim, q.wallTop[far][k]);
      const E = this.surfaceAt(w, i, 0, sg * foot);
      const Eq = this.surfaceAt(q, p.i, p.f, 0);
      if (rim < Math.max(E, Eq) + ROAD_STEP) continue;
      w.wall[side][i] = WALL_CUT;
      w.wallTop[side][i] = rim;
      w.wallLane[side][i] = 1;
      w.wallCarried[side][i] = 0;
      built.add(w);
    }
    this.divides = [];
    // (a stub of a few metres is no wall: dropped)
    for (const w of built)
      for (const side of [0, 1] as const) {
        const lane = new Uint8Array(w.al.n);
        for (let i = 0; i < w.al.n; i++)
          lane[i] =
            w.wall[side][i] === WALL_CUT &&
            w.wallLane[side][i] &&
            w.st[i] === ST_GROUND
              ? 1
              : 0;
        for (const [a, b] of runsOf(lane, 1))
          if (w.al.s[b] - w.al.s[a] < DIVIDE_MIN)
            for (let i = a; i <= b; i++) {
              w.wall[side][i] = WALL_NONE;
              w.wallLane[side][i] = 0;
            }
      }
  }

  /**
   * At a skew the upper way's own section reaches over the road beneath before its deck (sized on the lower road)
   * starts: its fill wall would stand in that road's lanes. The deck runs on (heights unchanged) to the last station
   * within DECK_REACH of its end whose section edge lies over a road more than a storey below.
   */
  private decksOverLanes(): void {
    const near = new Map<number, Projection>();
    const reach = Math.round(DECK_REACH / STEP);
    const overLane = (w: Way, i: number): boolean => {
      const { x, z, tx, tz } = w.al;
      const parkway = w.stage || !!w.corr;
      for (const side of [0, 1] as const) {
        const sg = side === 0 ? 1 : -1;
        const foot = side === 0 ? w.sec.footL : w.sec.footR;
        const E = this.surfaceAt(w, i, 0, sg * foot);
        const lw = worldT(w, i, 0, sg * (foot + 0.6));
        this.nearLines(
          x[i] + tz[i] * lw,
          z[i] - tx[i] * lw,
          16,
          near,
          (q) => q === w || q.internal,
        );
        for (const [qi, p] of near) {
          const q = this.ways[qi];
          if (p.s < q.cut0 || p.s > q.al.length - q.cut1) continue;
          if (
            q.st[p.f < 0.5 ? p.i : Math.min(q.al.n - 1, p.i + 1)] !== ST_GROUND
          )
            continue;
          const pave = p.t >= 0 ? q.sec.paveL : q.sec.paveR;
          const edge = Math.abs(worldT(q, p.i, p.f, Math.sign(p.t) * pave));
          // (a parkway deck over a street: its sidewalks and the wall of its cut too, the abutment stands behind them)
          const foot = p.t >= 0 ? q.sec.footL : q.sec.footR;
          const reachT = !parkway
            ? edge + 0.3
            : Math.max(
                edge + 0.3,
                Math.abs(
                  worldT(
                    q,
                    p.i,
                    p.f,
                    Math.sign(p.t) *
                      (foot + q.tpl.daylight.wallOffset + DECK_WALL_CLEAR),
                  ),
                ),
              );
          if (Math.abs(p.t) > reachT) continue;
          if (
            this.surfaceAt(
              q,
              p.i,
              p.f,
              Math.sign(p.t) * Math.min(pave, Math.abs(p.t)),
            ) <
            E - UNDER_STOREY
          )
            return true;
        }
      }
      return false;
    };
    // from sample `from` on in direction dir: decked up to the last sample within reach still over a road beneath
    const runOn = (w: Way, from: number, dir: number): void => {
      const n = w.al.n;
      let last = -1;
      for (
        let k = from, m = 0;
        k >= 0 && k < n && m < reach && w.st[k] === ST_GROUND;
        k += dir, m++
      )
        if (overLane(w, k)) last = k;
      if (last < 0) return;
      for (
        let k = from;
        k !== last + dir * 2 && k >= 0 && k < n && w.st[k] === ST_GROUND;
        k += dir
      )
        w.st[k] = ST_DECK;
    };
    for (const w of this.ways) {
      if (w.internal) continue;
      for (const [i0, i1] of runsOf(w.st, ST_DECK))
        for (const dir of [-1, 1]) runOn(w, dir < 0 ? i0 - 1 : i1 + 1, dir);
    }
    // a deck reaching a way's end at a joint (the same road going on as another way, OSM splits it there; a ramp may
    // merge at the same node) runs on onto that way while it still spans the road beneath
    for (const w of this.ways) {
      if (w.internal || w.stage) continue;
      for (const atEnd of [false, true] as const) {
        if (w.st[atEnd ? w.al.n - 1 : 0] !== ST_DECK) continue;
        const nd = this.nodes.get(w.nodes[atEnd ? 1 : 0]);
        if (!nd) continue;
        // (the parkway's carriageways: a way of its own in OSM on each side of every joint)
        if (!w.corr) continue;
        const on = nd.ends.filter(
          (o) =>
            o.way !== w &&
            o.way.kind === w.kind &&
            !o.way.internal &&
            !o.way.stage &&
            !o.way.into.includes(w) &&
            !w.into.includes(o.way),
        );
        if (on.length !== 1) continue;
        const e = on[0];
        const q = e.way;
        runOn(q, e.atEnd ? q.al.n - 1 : 0, e.atEnd ? -1 : 1);
      }
    }
  }

  /** Runs of cut wall kept beside a street's own bore (`wallsOf`): way, side, first and last sample. */
  private portalRuns: [Way, 0 | 1, number, number][] = [];

  /**
   * A portal cut's wall (`portalRuns`) stands where no road above brings a face of its own: where a road over the bore
   * beside the run has its fill wall / parapet towards the street, that face stands, not a second wall (the run goes).
   * After every way's walls: the road above may come later in the list.
   */
  private facedPortals(): void {
    const near = new Map<number, Projection>();
    for (const [w, side, i0, i1] of this.portalRuns) {
      const sg = side === 0 ? 1 : -1;
      const foot = side === 0 ? w.sec.footL : w.sec.footR;
      const { x, z, tx, tz } = w.al;
      let faced = false;
      for (let i = i0; i <= i1 && !faced; i++) {
        const lw = worldT(w, i, 0, (foot + wallOff(w, i, side)) * sg);
        const E = this.surfaceAt(w, i, 0, sg * foot);
        for (const [qi, p] of this.nearLines(
          x[i] + tz[i] * lw,
          z[i] - tx[i] * lw,
          30,
          near,
          (q) => q === w || q.internal,
        )) {
          const q = this.ways[qi];
          const qFoot = p.t >= 0 ? q.sec.footL : q.sec.footR;
          if (Math.abs(p.t) > qFoot + WALL_ROAD_BACK) continue;
          if (this.surfaceAt(q, p.i, p.f, 0) < E + ROAD_STEP) continue;
          const k = Math.min(q.al.n - 1, p.f < 0.5 ? p.i : p.i + 1);
          if (q.wall[p.t >= 0 ? 0 : 1][k] === WALL_FILL) faced = true;
        }
      }
      if (faced) for (let i = i0; i <= i1; i++) w.wall[side][i] = WALL_NONE;
    }
  }

  /**
   * A cut wall standing a few metres in front of a higher road's fill wall (a street below the parkway's retaining
   * wall): two stone faces with a strip of land between them. The lower-ranked road's wall goes; the land between drops to the
   * lower road (field.ts) and the higher road's fill wall is the one face from its parapet down to the street. The other
   * way round (a street's fill wall above the parkway's cut): the parkway's wall is the one face, up to the street's
   * edge, and the street's fill wall goes (v1: one ashlar wall along the parkway).
   */
  private facedWalls(): void {
    const near = new Map<number, Projection>();
    // fill wall samples of lower-ranked streets standing over a higher road's wall: dropped after the pass (with the
    // road and side whose carried wall replaces them)
    const drop: [Way, 0 | 1, number, Way, 0 | 1][] = [];
    for (const w of this.ways) {
      if (w.internal) continue;
      for (const side of [0, 1] as const) {
        const sg = side === 0 ? 1 : -1;
        const foot = side === 0 ? w.sec.footL : w.sec.footR;
        const type = w.wall[side];
        const faced = w.wallFaced[side];
        faced.fill(0);
        // samples this pass turned into this road's wall (from none) / lifted (its cut wall carried up to the street)
        const raised = new Uint8Array(w.al.n);
        const lifted = new Uint8Array(w.al.n);
        // (bare samples beside a street too low over this road for a wall of their own: its rise, and that street)
        const soft = new Float32Array(w.al.n);
        const softDrop: ([Way, 0 | 1, number] | undefined)[] = new Array(
          w.al.n,
        );
        for (let i = 0; i < w.al.n; i++) {
          // (a road with no wall of its own on that side - a bank by the survey - below a street's fill wall: the same
          // strip at its level up to that face, not a slope sawing into it)
          const bare = type[i] === WALL_NONE;
          if ((type[i] !== WALL_CUT && !bare) || w.st[i] !== ST_GROUND)
            continue;
          const off = wallOff(w, i, side);
          const lw = worldT(w, i, 0, sg * (foot + off));
          const px = w.al.x[i] + w.al.tz[i] * lw;
          const pz = w.al.z[i] - w.al.tx[i] * lw;
          const E = this.surfaceAt(w, i, 0, sg * foot);
          this.nearLines(px, pz, 20, near, (q) => q === w || q.internal);
          for (const [qi, p] of [...near].sort((a, b) => a[1].d - b[1].d)) {
            const q = this.ways[qi];
            const k = p.f < 0.5 ? p.i : Math.min(q.al.n - 1, p.i + 1);
            const qs = p.t >= 0 ? 0 : 1;
            if (q.st[k] !== ST_GROUND) continue;
            // (a street with no fill wall here: only for a raised wall running on along it, below)
            const noFill = q.wall[qs][k] !== WALL_FILL;
            if (noFill && !bare) continue;
            // (only the higher-ranked road's wall stands: the stage road keeps its own walls)
            // (the stage road's carriageways: the parkway's wall is the one face; elsewhere the street's fill wall
            // stays and a lower road's own wall stays in front of it)
            let mine = effRank(q) <= effRank(w);
            if (
              Math.abs(w.al.tx[i] * q.al.tx[k] + w.al.tz[i] * q.al.tz[k]) < 0.7
            )
              continue;
            const qFoot = qs === 0 ? q.sec.footL : q.sec.footR;
            const face = Math.abs(
              worldT(
                q,
                p.i,
                p.f,
                (qs === 0 ? 1 : -1) * (qFoot + wallOff(q, k, qs)),
              ),
            );
            const gap = Math.abs(p.t) - face;
            if (gap < 0 || gap > FACE_GAP) continue;
            // (the survey's wall line at this road's own wall, nearer than at the street's face: this road's wall
            // holds the street's edge, whichever ranks higher - one face, never two with a strip between)
            const sl = bare
              ? undefined
              : this.surveyWallLat(w, i, side, WALL_SURVEY_BRIDGE);
            const own = Math.abs(lw);
            if (
              sl !== undefined &&
              Math.abs(sl - own) <= WALL_SURVEY_HOLD &&
              Math.abs(own + gap - sl) > Math.abs(sl - own) + WALL_SURVEY_PICK
            )
              mine = true;
            else if (mine && !w.stage && Number.isNaN(w.corr?.[i] ?? NaN))
              continue;
            const rise =
              this.surfaceAt(q, p.i, p.f, (qs === 0 ? 1 : -1) * qFoot) - E;
            // (with no wall of its own: only where the bank up to that face would be steeper than 1:1 - a cliff the
            // 1 m terrain mesh draws as teeth against the face; a gentler bank stays)
            if (noFill || rise < 1 || (bare && rise < off + gap)) {
              // (kept: the wall raised beside it may run on along this street while it still stands over this road)
              if (bare && mine && rise >= SOFT_RISE && !soft[i]) {
                soft[i] = rise;
                softDrop[i] = [q, qs, k];
              }
              continue;
            }
            if (mine) {
              // this road's wall holds the street's edge; the street's fill wall over it goes
              if (bare) raised[i] = 1;
              else if (E + rise - 0.15 > w.wallTop[side][i]) lifted[i] = 1;
              type[i] = WALL_CUT;
              w.wallCarried[side][i] = 1;
              // (a cut wall a little over the street it holds stands at that street's edge: one coping along the
              // street, no hump where the survey's bank rose behind it)
              const held = E + rise - 0.15;
              const own0 = bare ? -Infinity : w.wallTop[side][i];
              w.wallTop[side][i] =
                own0 > held && own0 - held < CARRIED_HUMP
                  ? held
                  : Math.max(own0, held);
              for (const kk of [k - 1, k, k + 1])
                if (kk >= 0 && kk < q.al.n) drop.push([q, qs, kk, w, side]);
              break;
            }
            type[i] = WALL_NONE;
            faced[i] = off + gap;
            break;
          }
        }
        // a raised wall runs on at each end while the street it holds still stands over this road (its face down to
        // where the two meet, no wall end stepping down into a bank between them)
        for (const [i0, i1] of runsOf(w.wallCarried[side], 1))
          for (const [from, dir] of [
            [i0 - 1, -1],
            [i1 + 1, 1],
          ] as const)
            for (
              let i = from;
              i >= 0 && i < w.al.n && !w.wallCarried[side][i];
              i += dir
            ) {
              // (one sample missed between: the next one's street)
              const j = soft[i]
                ? i
                : soft[i + dir] && type[i] !== WALL_FILL
                  ? i + dir
                  : -1;
              if (j < 0) break;
              const E = this.surfaceAt(w, i, 0, sg * foot);
              raised[i] = 1;
              type[i] = WALL_CUT;
              w.wallCarried[side][i] = 1;
              w.wallTop[side][i] = E + soft[j] - 0.15;
              const [q, qs, k] = softDrop[j]!;
              for (const kk of [k - 1, k, k + 1])
                if (kk >= 0 && kk < q.al.n) drop.push([q, qs, kk, w, side]);
            }
        // the raised wall: one run over short gaps (tops between), stepping down at an end on open land as wallsOf's
        const top = w.wallTop[side];
        const runs = runsOf(type, WALL_CUT);
        for (let r = 0; r + 1 < runs.length; r++) {
          const a = runs[r][1];
          const b = runs[r + 1][0];
          if (b - a - 1 > 3 || !(raised[a] || raised[b])) continue;
          for (let i = a + 1; i < b; i++) {
            if (w.st[i] !== ST_GROUND) break;
            const f = (i - a) / (b - a);
            type[i] = WALL_CUT;
            raised[i] = 1;
            top[i] = top[a] + (top[b] - top[a]) * f;
            w.wallCarried[side][i] =
              w.wallCarried[side][a] & w.wallCarried[side][b];
          }
        }
        // (a few samples of the cut wall left uncarried between two carried stretches: carried too, the top straight
        // across - no tooth standing up out of one coping)
        const carried = w.wallCarried[side];
        const cr = runsOf(carried, 1);
        for (let r = 0; r + 1 < cr.length; r++) {
          const a = cr[r][1];
          const b = cr[r + 1][0];
          if (w.al.s[b] - w.al.s[a] > CARRIED_GAP) continue;
          let ok = true;
          for (let i = a + 1; i < b; i++)
            if (type[i] !== WALL_CUT || w.st[i] !== ST_GROUND) ok = false;
          if (!ok) continue;
          for (let i = a + 1; i < b; i++) {
            const f = (i - a) / (b - a);
            top[i] = Math.min(top[i], top[a] + (top[b] - top[a]) * f);
            carried[i] = 1;
          }
        }
        for (const [i0, i1] of runsOf(type, WALL_CUT)) {
          const open0 = i0 > 0 && type[i0 - 1] === WALL_NONE && !faced[i0 - 1];
          const open1 =
            i1 < w.al.n - 1 && type[i1 + 1] === WALL_NONE && !faced[i1 + 1];
          for (let i = i0; i <= i1; i++) {
            if (!raised[i]) continue;
            const along = Math.min(
              open0 ? w.al.s[i] - w.al.s[i0] : Infinity,
              open1 ? w.al.s[i1] - w.al.s[i] : Infinity,
            );
            const E = this.surfaceAt(w, i, 0, sg * foot);
            top[i] = Math.min(top[i], E + 0.6 + along * WALL_END_SLOPE);
          }
        }
        // a lifted stretch eases back to the wall top beside it at each end, as a raised wall steps down to open land
        // (no sheer block standing up out of the cut wall where the street it holds turns away)
        for (const [i0, i1] of runsOf(lifted, 1)) {
          const a = i0 - 1;
          const b = i1 + 1;
          const base0 = a >= 0 && type[a] === WALL_CUT ? top[a] : Infinity;
          const base1 = b < w.al.n && type[b] === WALL_CUT ? top[b] : Infinity;
          for (let i = i0; i <= i1; i++) {
            const cap = Math.min(
              a >= 0
                ? base0 + (w.al.s[i] - w.al.s[a]) * WALL_END_SLOPE
                : Infinity,
              b < w.al.n
                ? base1 + (w.al.s[b] - w.al.s[i]) * WALL_END_SLOPE
                : Infinity,
            );
            top[i] = Math.min(top[i], cap);
          }
        }
        // (one sample of a carried wall's top sunk under both its neighbours - two holds meeting: level with the lower
        // neighbour, no notch in the coping)
        for (let i = 1; i + 1 < w.al.n; i++)
          if (carried[i - 1] && carried[i] && carried[i + 1]) {
            const m = Math.min(top[i - 1], top[i + 1]);
            if (top[i] < m - CARRIED_NOTCH) top[i] = m;
          }
        // a short stub of the cut wall left beside the faced stretch goes with it (no lone block on the strip)
        for (const [i0, i1] of runsOf(type, WALL_CUT)) {
          if (w.al.s[i1] - w.al.s[i0] > 2 * FACE_GAP) continue;
          const a = i0 > 0 ? faced[i0 - 1] : 0;
          const b = i1 < w.al.n - 1 ? faced[i1 + 1] : 0;
          if (!a && !b) continue;
          for (let i = i0; i <= i1; i++) {
            type[i] = WALL_NONE;
            faced[i] = Math.max(a, b);
          }
        }
      }
    }
    const touched = new Set<Way>();
    // ... and on along the street while its fill wall still stands within FACE_GAP of that carried wall (no stub of it
    // left standing in front of the carried face where the street bends away: a block end beside the wall)
    const carriedNear = (q: Way, qs: 0 | 1, k: number, w: Way, side: 0 | 1) => {
      const qFoot = qs === 0 ? q.sec.footL : q.sec.footR;
      const lq = worldT(
        q,
        k,
        0,
        (qs === 0 ? 1 : -1) * (qFoot + wallOff(q, k, qs)),
      );
      const px = q.al.x[k] + q.al.tz[k] * lq;
      const pz = q.al.z[k] - q.al.tx[k] * lq;
      const p = this.nearLines(px, pz, FACE_GAP + 10, near, (o) => o !== w).get(
        w.index,
      );
      if (!p || (p.t >= 0 ? 0 : 1) !== side) return false;
      const j = p.f < 0.5 ? p.i : Math.min(w.al.n - 1, p.i + 1);
      if (!w.wallCarried[side][j]) return false;
      const foot = side === 0 ? w.sec.footL : w.sec.footR;
      const face = Math.abs(worldT(w, p.i, p.f, foot + wallOff(w, j, side)));
      return Math.abs(Math.abs(p.t) - face) <= FACE_GAP;
    };
    for (const [q, qs, k, w, side] of drop) {
      if (q.wall[qs][k] === WALL_FILL) {
        q.wall[qs][k] = WALL_NONE;
        touched.add(q);
      }
      for (const dir of [-1, 1]) {
        for (let kk = k + dir; kk >= 0 && kk < q.al.n; kk += dir) {
          if (q.wall[qs][kk] !== WALL_FILL || !carriedNear(q, qs, kk, w, side))
            break;
          q.wall[qs][kk] = WALL_NONE;
          touched.add(q);
        }
      }
    }
    // (no short leftover of a dropped fill wall)
    for (const q of touched)
      for (const qs of [0, 1] as const) cleanRuns(q.wall[qs], 0, 4);
  }

  // --------------------------------------------------------------------------------------------------------------------

  private newWay(
    id: string,
    kind: string,
    al: Alignment,
    tpl: Template,
    tags: TagSet,
    oneway: boolean,
    nodes: [number, number],
    stage: boolean,
    name?: string,
  ): Way {
    const n = al.n;
    const w: Way = {
      index: this.ways.length,
      id,
      kind,
      name,
      stage,
      oneway,
      tpl,
      sec: buildSection(tpl, { oneway, tags, median: [false, false] }),
      tags,
      nodes,
      al,
      y: new Float64Array(n),
      a: new Float64Array(n),
      c: new Float64Array(n),
      st: new Uint8Array(n),
      cut0: 0,
      cut1: 0,
      merge0: false,
      merge1: false,
      into: [null, null],
      internal: false,
      wall: [new Uint8Array(n), new Uint8Array(n)],
      wallTop: [new Float64Array(n), new Float64Array(n)],
      wallCarried: [new Uint8Array(n), new Uint8Array(n)],
      wallLane: [new Uint8Array(n), new Uint8Array(n)],
      wallFaced: [new Float32Array(n), new Float32Array(n)],
    };
    this.ways.push(w);
    return w;
  }

  private addStage(def: NetworkDef, road: Road): Way {
    const src = road.samples;
    const pick = src.filter((_, i) => i % STEP === 0 || i === src.length - 1);
    const n = pick.length;
    const x = new Float64Array(n);
    const z = new Float64Array(n);
    const s = new Float64Array(n);
    pick.forEach((p, i) => {
      x[i] = p.x;
      z[i] = p.z;
      s[i] = p.dist;
    });
    const al = withFrames({ n, x, z, s, length: road.length });
    return this.newWay(
      'stage',
      'motorway',
      al,
      packTemplate(def.pack, 'motorway', 'stage'),
      {},
      true,
      [-1, -1],
      true,
      'stage',
    );
  }

  private addWay(e: EdgeData, sets: TagSet[], def: NetworkDef): void {
    const al = alignPolyline(e.pts);
    // dominant tag set (by segment count)
    const count = new Map<number, number>();
    const nseg = e.pts.length / 2 - 1;
    e.tags.forEach(([seg, ti], k) => {
      const end = k + 1 < e.tags.length ? e.tags[k + 1][0] : nseg;
      count.set(ti, (count.get(ti) ?? 0) + (end - seg));
    });
    let dom = e.tags[0]?.[1] ?? 0;
    let best = -1;
    for (const [ti, c] of count) {
      const t = sets[ti];
      // the deck / tunnel stretches do not set the lanes
      const c2 = t?.bridge || t?.tunnel ? c * 0.3 : c;
      if (c2 > best) {
        best = c2;
        dom = ti;
      }
    }
    // a street mostly in a tunnel is its lanes only (no parking / sidewalks down there)
    const tunnelStreet =
      !!sets[dom]?.tunnel &&
      !/^(motorway|trunk)/.test(e.kind) &&
      def.pack === 'nyc';
    const tpl = e.template
      ? (TEMPLATES[e.template] ?? packTemplate(def.pack, e.kind))
      : tunnelStreet
        ? TEMPLATES.nyc_tunnel_lane
        : packTemplate(def.pack, e.kind);
    const w = this.newWay(
      e.id,
      e.kind,
      al,
      tpl,
      this.nearTunnel(e.pts)
        ? (sets[dom] ?? {})
        : surveyed(e, sets[dom] ?? {}, sets),
      !!e.oneway,
      e.nodes,
      false,
      e.name,
    );
    (w as Way & { edge: EdgeData }).edge = e;
    if (e.widths?.length) w.widths = { st: e.widths, scale: 1 };
  }

  private indexLines(): void {
    for (const w of this.ways) {
      const { x, z, n } = w.al;
      for (let i = 0; i + 1 < n; i++)
        this.lines.add(
          w.index * 65536 + i,
          Math.min(x[i], x[i + 1]) - 1,
          Math.min(z[i], z[i + 1]) - 1,
          Math.max(x[i], x[i + 1]) + 1,
          Math.max(z[i], z[i + 1]) + 1,
        );
    }
  }

  /** Nearest centreline point of every way near (x, z) within `reach` (m): way index -> projection. */
  nearLines(
    x: number,
    z: number,
    reach: number,
    out: Map<number, Projection>,
    skip?: (w: Way) => boolean,
  ): Map<number, Projection> {
    out.clear();
    const seen = new Set<number>();
    const c = this.lines.cell;
    const r = Math.ceil(reach / c);
    const pr: Projection = { s: 0, t: 0, i: 0, f: 0, d: 0 };
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        for (const key of this.lines.at(x + dx * c, z + dz * c)) {
          if (seen.has(key)) continue;
          seen.add(key);
          const w = this.ways[Math.floor(key / 65536)];
          if (skip?.(w)) continue;
          // (a way re-aligned since the index was built has a few samples more or less: clamp the segment)
          projectOnSegment(w.al, Math.min(key % 65536, w.al.n - 2), x, z, pr);
          if (pr.d > reach) continue;
          if (w.k) pr.t = sectionT(w, pr.i, pr.f, pr.t);
          const old = out.get(w.index);
          if (!old || pr.d < old.d) out.set(w.index, { ...pr });
        }
      }
    return out;
  }

  // --- roles + sections -------------------------------------------------------------------------------------------

  private assignRoles(): void {
    // The opposite carriageway: a one-way motorway / trunk running against the stage road within 35 m of it.
    const near = new Map<number, Projection>();
    for (const w of this.ways) {
      if (w.stage || !/^(motorway|trunk)$/.test(w.kind) || !w.oneway) continue;
      let hits = 0;
      let tot = 0;
      for (let i = 0; i < w.al.n; i += 3) {
        tot++;
        this.nearLines(w.al.x[i], w.al.z[i], 35, near, (q) => !q.stage);
        const p = near.get(0);
        if (!p) continue;
        const k = p.i;
        const dot =
          w.al.tx[i] * this.stage.al.tx[k] + w.al.tz[i] * this.stage.al.tz[k];
        if (dot < -0.85) hits++;
      }
      if (tot && hits / tot > 0.5)
        w.tpl =
          TEMPLATES[
            w.tpl.id === 'nyc_highway' ? 'nyc_parkway_twin' : w.tpl.id
          ] ?? w.tpl;
    }
  }

  private buildSections(): void {
    const near = new Map<number, Projection>();
    const halfOf = (q: Way) =>
      ((q.oneway ? q.tpl.onewayLanes : q.tpl.lanes[0] + q.tpl.lanes[1]) *
        q.tpl.laneW) /
      2;
    for (const w of this.ways) {
      const tpl = w.tpl;
      const halfLanes = halfOf(w);
      const hits = [0, 0];
      const rooms: number[][] = [[], []];
      let probes = 0;
      for (let i = 1; i + 1 < w.al.n; i += 4) {
        probes++;
        const x = w.al.x[i];
        const z = w.al.z[i];
        const tx = w.al.tx[i];
        const tz = w.al.tz[i];
        // the nearest parallel way on each side within reach
        const best = [Infinity, Infinity];
        this.nearLines(
          x,
          z,
          halfLanes + MEDIAN_REACH + 12,
          near,
          (q) => q === w,
        );
        for (const [qi, p] of near) {
          const q = this.ways[qi];
          const k = Math.min(q.al.n - 1, p.f < 0.5 ? p.i : p.i + 1);
          if (Math.abs(tx * q.al.tx[k] + tz * q.al.tz[k]) < 0.85) continue;
          // q's nearest point, seen from w: side by the left normal (tz, -tx)
          const qx =
            q.al.x[p.i] +
            (q.al.x[Math.min(q.al.n - 1, p.i + 1)] - q.al.x[p.i]) * p.f;
          const qz =
            q.al.z[p.i] +
            (q.al.z[Math.min(q.al.n - 1, p.i + 1)] - q.al.z[p.i]) * p.f;
          const lat = (qx - x) * tz - (qz - z) * tx;
          const room = Math.abs(lat) - halfLanes - halfOf(q);
          if (room > MEDIAN_REACH) continue;
          const side = lat >= 0 ? 0 : 1;
          best[side] = Math.min(best[side], Math.max(0, room));
        }
        for (const side of [0, 1] as const)
          if (best[side] < Infinity) {
            hits[side]++;
            rooms[side].push(best[side]);
          }
      }
      const median: [boolean, boolean] = [false, false];
      const room: [number, number] = [Infinity, Infinity];
      for (const side of [0, 1] as const) {
        if (probes && hits[side] / probes > 0.4) {
          median[side] = true;
          const r = rooms[side].sort((a, b) => a - b);
          room[side] = r[r.length >> 1];
        }
      }
      w.sec = buildSection(tpl, {
        oneway: w.oneway,
        tags: w.tags,
        median,
        room,
        deck: !!w.tags.bridge,
      });
    }
  }

  // --- stage-road nodes: merges / diverges -------------------------------------------------------------------------

  /**
   * Nodes on the stage road: an arm leaving / joining it at a shallow angle is a merge (a ramp, a carriageway joining):
   * it runs alongside the stage road edge to edge (`separate`) and takes its surface where they touch (`coupleMerges`);
   * a steep arm ends at the stage road's edge (`buildJunctions`). The stage road is never cut.
   */
  private stageNodes(): void {
    const stage = this.stage;
    for (const node of this.nodes.values()) {
      if (node.stage < 0 || !node.ends.length) continue;
      node.kind = 'stage';
      const i = Math.min(stage.al.n - 1, Math.round(node.stage / STEP));
      const tx = stage.al.tx[i];
      const tz = stage.al.tz[i];
      // a ramp or a motorway ending on the stage road at a shallow angle merges (a ramp, the mainline joining the
      // route); a street or service lane sharing the node runs on beside the stage road as a neighbour
      // (at the stage road's own ends, a way running on straight ahead / back is the road carrying on, not a merge:
      // stitched to the stage road's edge it would lose its pavement - the run-out end at the interchange)
      const tip =
        node.stage >= stage.al.length - 1 ? 1 : node.stage <= 1 ? -1 : 0;
      for (const e of node.ends) {
        const arm = this.armOf(node, e.way, e.atEnd);
        const dot = arm.dx * tx + arm.dz * tz;
        if (Math.abs(dot) <= 0.82) continue;
        if (tip && dot * tip > 0) continue;
        if (isRamp(e.way) || /^(motorway|trunk)$/.test(e.way.kind))
          this.setMerge(e.way, e.atEnd, stage);
      }
    }
    this.mergeNodes();
    this.clearNodes();
  }

  /** Nodes at the stage road's end where the road runs straight on (`runsOnFromStageEnd`): joined to the stage there. */
  private readonly stageRunOn = new Set<number>();

  /** Node at the stage road's last sample whose every arm leaves in line with the stage's end (the road running on). */
  private runsOnFromStageEnd(node: NetNode): boolean {
    const st = this.stage.al;
    const n = st.n - 1;
    if (Math.hypot(node.x - st.x[n], node.z - st.z[n]) > STAGE_END_JOIN)
      return false;
    return node.ends.every((e) => {
      const a = e.way.al;
      const k = e.atEnd ? a.n - 1 : 0;
      const sg = e.atEnd ? -1 : 1;
      return (
        a.tx[k] * sg * st.tx[n] + a.tz[k] * sg * st.tz[n] >
        Math.cos(STAGE_END_TURN)
      );
    });
  }

  /**
   * A street-grid junction lying on or against a roadway's section (OSM draws the service road's junctions at the
   * parkway's edge): the node moves off the roadway by the gap the sections need, and every arm follows it, eased in
   * over NODE_EASE m - the street never touches the highway, so its junction polygon and corners do not either.
   */
  private clearNodes(): void {
    const near = new Map<number, Projection>();
    for (const node of this.nodes.values()) {
      if (!node.ends.length) continue;
      // a node on the stage road whose arms all run on beside it (a lane's end, a service road's joint) is no stage
      // junction: it moves off like any other
      if (node.stage >= 0) {
        if (node.ends.some((e) => e.way.into.includes(this.stage))) continue;
        node.stage = -1;
        node.kind = 'end';
        // (the stage's own end with the road running straight on from it: it stays there, the road paved on past the
        // finish - pushed off the stage it would leave a gap of bare land in front of a stopped car)
        if (this.runsOnFromStageEnd(node)) {
          this.stageRunOn.add(node.id);
          continue;
        }
      } else if (node.ends.length < 2) continue;
      let hw = 0;
      let rank = -Infinity;
      for (const e of node.ends) {
        const kerbed = e.way.tpl.kerbH > 0;
        // (a surveyed mainline at its surveyed width there)
        const k = kerbed ? 1 : widthK(e.way, e.atEnd ? e.way.al.length : 0);
        hw = Math.max(
          hw,
          kerbed ? e.way.sec.footL : e.way.sec.paveL * k,
          kerbed ? e.way.sec.footR : e.way.sec.paveR * k,
        );
        rank = Math.max(rank, effRank(e.way));
      }
      this.nearLines(
        node.x,
        node.z,
        30,
        near,
        (q) =>
          q.internal ||
          effRank(q) <= rank ||
          q.tpl.kerbH > 0 ||
          node.ends.some((e) => e.way === q || e.way.into.includes(q)),
      );
      let px = 0;
      let pz = 0;
      let best = 0;
      for (const [qi, p] of near) {
        const q = this.ways[qi];
        const k = Math.min(q.al.n - 1, p.f < 0.5 ? p.i : p.i + 1);
        // the side of q the node belongs to: the side its most one-sided arm runs on (a street crossing q counts
        // for neither side; the node itself may sit on q's line)
        let side = 0;
        const pr: Projection = { s: 0, t: 0, i: 0, f: 0, d: 0 };
        for (const e of node.ends) {
          const a = e.way.al;
          let sum = 0;
          let cnt = 0;
          for (let j = 0; j < a.n; j += 2) {
            const d = e.atEnd ? a.length - a.s[j] : a.s[j];
            if (d > 40) continue;
            projectOnSegment(
              q.al,
              Math.max(0, Math.min(q.al.n - 2, p.i)),
              a.x[j],
              a.z[j],
              pr,
            );
            sum += Math.sign(pr.t) * Math.min(1, Math.abs(pr.t) / 3);
            cnt++;
          }
          if (cnt && Math.abs(sum / cnt) > Math.abs(side)) side = sum / cnt;
        }
        const sg = side !== 0 ? Math.sign(side) : p.t >= 0 ? 1 : -1;
        const qSide = (sg > 0 ? q.sec.paveL : q.sec.paveR) * widthK(q, p.s);
        // a street junction keeps slack for its corner fans; a lane's joint only the gap
        const slack = node.ends.every((e) => e.way.tpl.kerbH === 0)
          ? 0
          : NODE_CLEAR;
        const push = Math.min(
          NODE_PUSH_MAX,
          qSide + NEIGHBOUR_GAP + hw + slack - p.t * sg,
        );
        if (push <= best) continue;
        best = push;
        px = q.al.tz[k] * sg * push;
        pz = -q.al.tx[k] * sg * push;
      }
      if (best <= 0.05) continue;
      node.x += px;
      node.z += pz;
      for (const e of node.ends) this.shiftEnd(e.way, e.atEnd, px, pz);
    }
  }

  /** Move one end of a way by (dx, dz), eased in over NODE_EASE m (the far end stays). */
  private shiftEnd(w: Way, atEnd: boolean, dx: number, dz: number): void {
    const { n, x, z, s } = w.al;
    const L = w.al.length;
    const reach = Math.min(NODE_EASE, L * 0.5);
    const pts: number[] = [];
    for (let i = 0; i < n; i++) {
      const from = atEnd ? L - s[i] : s[i];
      const f = 1 - smoothstep(0, reach, from);
      pts.push(x[i] + dx * f, z[i] + dz * f);
    }
    w.al = alignPolyline(pts);
    const nn = w.al.n;
    w.y = new Float64Array(nn);
    w.a = new Float64Array(nn);
    w.c = new Float64Array(nn);
    w.st = new Uint8Array(nn);
    w.wall = [new Uint8Array(nn), new Uint8Array(nn)];
    w.wallTop = [new Float64Array(nn), new Float64Array(nn)];
    w.wallCarried = [new Uint8Array(nn), new Uint8Array(nn)];
    w.wallLane = [new Uint8Array(nn), new Uint8Array(nn)];
    w.wallFaced = [new Float32Array(nn), new Float32Array(nn)];
  }

  private setMerge(w: Way, atEnd: boolean, into: Way): void {
    if (atEnd) w.merge1 = true;
    else w.merge0 = true;
    w.into[atEnd ? 1 : 0] = into;
  }

  /**
   * Nodes off the stage road where ramps join / leave a through road (two arms in line, every other arm at a shallow
   * angle to one of them and not ranked above it): each ramp merges into its through way like a stage-road merge and
   * the node is a joint, not a junction.
   */
  private mergeNodes(): void {
    for (const node of this.nodes.values()) {
      if (node.stage >= 0 || node.ends.length < 3) continue;
      const arms = node.ends.map((e) => ({
        e,
        a: this.armOf(node, e.way, e.atEnd),
      }));
      let pair: [number, number] | undefined;
      let score = -Infinity;
      for (let p = 0; p < arms.length; p++)
        for (let q = p + 1; q < arms.length; q++) {
          const dot = arms[p].a.dx * arms[q].a.dx + arms[p].a.dz * arms[q].a.dz;
          if (dot > -0.94) continue;
          const sc = arms[p].e.way.tpl.rank + arms[q].e.way.tpl.rank - dot;
          if (sc > score) {
            score = sc;
            pair = [p, q];
          }
        }
      if (!pair) continue;
      const through = [arms[pair[0]], arms[pair[1]]];
      const merges: [(typeof arms)[number], Way][] = [];
      for (let k = 0; k < arms.length; k++) {
        if (k === pair[0] || k === pair[1]) continue;
        const b = arms[k];
        const host = through.find(
          (t) => b.a.dx * t.a.dx + b.a.dz * t.a.dz > 0.88,
        );
        // only a ramp merges, and only into a kerbless roadway; a street meets a street in a junction
        if (
          !host ||
          host.e.way.tpl.rank < b.e.way.tpl.rank ||
          host.e.way.tpl.kerbH > 0 ||
          !isRamp(b.e.way)
        )
          break;
        merges.push([b, host.e.way]);
      }
      if (merges.length !== arms.length - 2) continue;
      for (const [b, host] of merges) this.setMerge(b.e.way, b.e.atEnd, host);
      node.merge = true;
    }
  }

  /**
   * A merging way's stretch alongside the road it merges into takes that road's plane: its height is the host's
   * surface extended to its centre, its crossfall the host's; blended back to its own line over EASE m beyond.
   */
  private coupleMerges(): void {
    const near = new Map<number, Projection>();
    const EASE = 60;
    for (const w of this.ways) {
      if (!w.merge0 && !w.merge1) continue;
      const n = w.al.n;
      const L = w.al.length;
      const adj = new Uint8Array(n);
      const ty = new Float64Array(n).fill(NaN);
      const ta = new Float64Array(n);
      const has = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const s = w.al.s[i];
        const d0 = w.merge0 ? s : Infinity;
        const d1 = w.merge1 ? L - s : Infinity;
        if (Math.min(d0, d1) > 220) continue;
        const host = (d0 <= d1 ? w.into[0] : w.into[1])!;
        this.nearLines(w.al.x[i], w.al.z[i], 40, near, (q) => q !== host);
        const p = near.get(host.index);
        if (!p) continue;
        const dot = w.al.tx[i] * host.al.tx[p.i] + w.al.tz[i] * host.al.tz[p.i];
        const sideHost = p.t >= 0 ? host.sec.paveL : host.sec.paveR;
        const touch = sideHost + Math.max(w.sec.paveL, w.sec.paveR) + 1.5;
        const k1 = Math.min(host.al.n - 1, p.i + 1);
        const yc = host.y[p.i] + (host.y[k1] - host.y[p.i]) * p.f;
        const ac = host.a[p.i] + (host.a[k1] - host.a[p.i]) * p.f;
        ty[i] = yc + ac * p.t;
        ta[i] = dot > 0 ? ac : -ac;
        has[i] = 1;
        if (Math.abs(p.t) <= touch && Math.abs(dot) > 0.8) adj[i] = 1;
      }
      if (!adj.includes(1)) continue;
      // weight: 1 alongside, easing out over EASE m along the way beyond the alongside stretch
      const dist = new Float64Array(n).fill(Infinity);
      let last = -Infinity;
      for (let i = 0; i < n; i++) {
        if (adj[i]) last = w.al.s[i];
        dist[i] = Math.min(dist[i], w.al.s[i] - last);
      }
      last = Infinity;
      for (let i = n - 1; i >= 0; i--) {
        if (adj[i]) last = w.al.s[i];
        dist[i] = Math.min(dist[i], last - w.al.s[i]);
      }
      let lastY = NaN;
      let lastA = 0;
      for (let i = 0; i < n; i++) {
        if (has[i]) {
          lastY = ty[i];
          lastA = ta[i];
        } else if (!Number.isNaN(lastY)) {
          ty[i] = lastY;
          ta[i] = lastA;
        }
      }
      for (let i = 0; i < n; i++) {
        if (dist[i] >= EASE || Number.isNaN(ty[i])) continue;
        const k = 1 - smoothstep(0, EASE, dist[i]);
        w.y[i] += (ty[i] - w.y[i]) * k;
        w.a[i] += (ta[i] - w.a[i]) * k;
        w.c[i] *= 1 - k;
      }
      // the other end keeps its junction height; the grade limit holds both ends
      const n0 = this.nodes.get(w.nodes[0]);
      const n1 = this.nodes.get(w.nodes[1]);
      const pin0 = !!n0 && n0.kind !== 'end';
      const pin1 = !!n1 && n1.kind !== 'end';
      if (pin0 && !w.merge0) w.y[0] = n0!.h;
      if (pin1 && !w.merge1) w.y[n - 1] = n1!.h;
      pinnedGrade(
        w.y,
        w.al.s,
        w.tpl.maxGrade * 1.05,
        pin0 || w.merge0,
        pin1 || w.merge1,
      );
    }
  }

  /** Each merging way's gore (`Way.gore`), from the final heights: its host's near pavement edge where close enough. */
  private gores(): void {
    const near = new Map<number, Projection>();
    for (const w of this.ways) {
      // (the stage road keeps its own edge rules: verges, kerbs, barriers by station)
      if (w.stage || (!w.merge0 && !w.merge1)) continue;
      const n = w.al.n;
      const L = w.al.length;
      let g: Way['gore'];
      for (let i = 0; i < n; i++) {
        const s = w.al.s[i];
        const d0 = w.merge0 ? s : Infinity;
        const d1 = w.merge1 ? L - s : Infinity;
        if (Math.min(d0, d1) > GORE_REACH) continue;
        const host = (d0 <= d1 ? w.into[0] : w.into[1])!;
        this.nearLines(w.al.x[i], w.al.z[i], 40, near, (q) => q !== host);
        const p = near.get(host.index);
        if (!p || p.s < host.cut0 || p.s > host.al.length - host.cut1) continue;
        const k1 = Math.min(host.al.n - 1, p.i + 1);
        if (
          Math.abs(
            w.al.tx[i] * host.al.tx[p.i] + w.al.tz[i] * host.al.tz[p.i],
          ) < 0.7
        )
          continue;
        const hx = host.al.x[p.i] + (host.al.x[k1] - host.al.x[p.i]) * p.f;
        const hz = host.al.z[p.i] + (host.al.z[k1] - host.al.z[p.i]) * p.f;
        // the host's centre and its near edge (world metres) as laterals in this way's frame
        const tH =
          (hx - w.al.x[i]) * w.al.tz[i] - (hz - w.al.z[i]) * w.al.tx[i];
        const sg = Math.sign(tH) || 1;
        const tE =
          Math.sign(p.t) * (p.t >= 0 ? host.sec.paveL : host.sec.paveR);
        const edge = tH - sg * Math.abs(worldT(host, p.i, p.f, tE));
        const inner = sg > 0 ? w.sec.paveL : w.sec.paveR;
        if (sg * edge - inner >= GORE_MAX) continue;
        g ??= {
          t: new Float64Array(n).fill(NaN),
          h: new Float64Array(n),
          side: new Int8Array(n),
        };
        g.t[i] = edge;
        g.h[i] = this.surfaceAt(host, p.i, p.f, tE);
        g.side[i] = sg;
      }
      if (g) w.gore = g;
    }
  }

  // --- right of way ----------------------------------------------------------------------------------------------------

  /** (x, z) within `r` m of a node the two ways share, or of a stage-road node one of them ends on (a merge). */
  private nearSharedNode(
    w: Way,
    q: Way,
    x: number,
    z: number,
    r: number,
  ): boolean {
    for (const id of w.nodes) {
      const n = this.nodes.get(id);
      if (!n) continue;
      const shared =
        q.nodes.includes(id) ||
        (q.stage && (n.stage >= 0 || this.stageRunOn.has(id)));
      if (shared && Math.hypot(n.x - x, n.z - z) < r) return true;
    }
    if (w.stage)
      for (const id of q.nodes) {
        const n = this.nodes.get(id);
        if (n && n.stage >= 0 && Math.hypot(n.x - x, n.z - z) < r) return true;
      }
    return false;
  }

  /**
   * A way passing under a stage-road bridge span (OSM: the parkway on a deck over a street) crosses the stage road and
   * the roads beside it there (the other carriageway, the ways joined to those near the crossing) on another level:
   * the stations along w (m) of those crossings, per way index. Empty for every other way.
   */
  private crossStations(w: Way): Map<number, number[]> {
    const out = new Map<number, number[]>();
    if (!this.stageBridges.length) return out;
    const { n, x, z, s } = w.al;
    // every crossing of w's line with q's: [station on w, x, z, station on q]
    const hits = (q: Way): [number, number, number, number][] => {
      const r: [number, number, number, number][] = [];
      if (this.sharesNode(w, q)) return r;
      const a = q.al;
      for (let i = 0; i + 1 < n; i++) {
        const ex = x[i + 1] - x[i];
        const ez = z[i + 1] - z[i];
        for (let k = 0; k + 1 < a.n; k++) {
          const fx = a.x[k + 1] - a.x[k];
          const fz = a.z[k + 1] - a.z[k];
          const det = ex * fz - ez * fx;
          if (Math.abs(det) < 1e-9) continue;
          const cx = a.x[k] - x[i];
          const cz = a.z[k] - z[i];
          const t = (cx * fz - cz * fx) / det;
          const u = (cx * ez - cz * ex) / det;
          if (t < 0 || t > 1 || u < 0 || u > 1) continue;
          r.push([
            s[i] + (s[i + 1] - s[i]) * t,
            x[i] + ex * t,
            z[i] + ez * t,
            a.s[k] + (a.s[k + 1] - a.s[k]) * u,
          ]);
        }
      }
      return r;
    };
    const under = hits(this.stage).filter(([, , , sq]) =>
      this.stageBridges.some(([a, b]) => sq >= a - 5 && sq <= b + 5),
    );
    if (!under.length) return out;
    const add = (qi: number, st: number) => {
      const l = out.get(qi) ?? [];
      l.push(st);
      out.set(qi, l);
    };
    for (const [st] of under) add(this.stage.index, st);
    const cand = new Set<number>();
    const near = new Map<number, Projection>();
    for (const [, cx, cz] of under)
      for (const qi of this.nearLines(cx, cz, CROSS_CLEAR, near).keys())
        cand.add(qi);
    for (const qi of cand) {
      const q = this.ways[qi];
      if (q === w || q.stage) continue;
      for (const [st, hx, hz] of hits(q)) {
        if (
          !under.some(
            ([, cx, cz]) => Math.hypot(hx - cx, hz - cz) < CROSS_CLEAR,
          )
        )
          continue;
        add(qi, st);
        // (the same road continuing as another way, a ramp merging there: joined to it near the crossing)
        for (const id of q.nodes) {
          const nd = this.nodes.get(id);
          if (!nd || Math.hypot(nd.x - hx, nd.z - hz) > CROSS_CLEAR) continue;
          for (const e of nd.ends)
            if (e.way !== w && e.way !== q && !this.sharesNode(w, e.way))
              add(e.way.index, st);
        }
      }
    }
    return out;
  }

  /**
   * OSM draws a divided road's carriageways, ramps and service roads beside each other as centre lines that are often
   * closer than their real pavements: the lower-ranked way is moved sideways until its pavement clears the other one
   * (+ room for a barrier between them), smoothed along it and eased out towards its junction ends (the nodes stay).
   * Returns true when anything moved.
   */
  private separate(): boolean {
    const near = new Map<number, Projection>();
    let moved = false;
    // highest right of way first (a lane yields to the carriageway, the service road to the lane): every way moves
    // off the final line of the roads above it. Kerbless roadways outrank kerbed streets of the same class.
    const order = [...this.ways].sort(
      (a, b) => effRank(b) - effRank(a) || a.index - b.index,
    );
    for (const w of order) {
      if (w.stage) continue;
      const { n, x, z, tx, tz } = w.al;
      const off = new Float64Array(n);
      let any = false;
      const reach = Math.max(w.sec.paveL, w.sec.paveR) + 18;
      const outranks = (q: Way) => effRank(q) > effRank(w);
      // a street under a stage-road bridge crosses the roads on the deck: near that crossing it is never alongside
      // them, whatever the skew (it keeps its OSM line under the deck, no S-bend)
      const crossAt = this.crossStations(w);
      // the side of each higher-ranked road this way runs on, over its whole length: a way whose line wanders onto
      // the road (OSM has the lane's end on the parkway's line) is pushed out to that side, not flipped
      const sideOf = new Map<number, number>();
      // ... and, where the way straddles that road's line, the side away from the highest-ranked road beside it (the
      // service road belongs outside the lane, the lane outside the carriageway)
      const away = new Map<number, number>();
      const pr: Projection = { s: 0, t: 0, i: 0, f: 0, d: 0 };
      // ... and wherever its line crosses a higher-ranked road's at another OSM layer (it passes under / over it, no
      // node): a grade separation, not a neighbour; no push there (same map as the stage-bridge crossings)
      const lastT = new Map<number, [number, number]>();
      const crossing = (qi: number, s: number) =>
        crossAt.get(qi)?.some((c) => Math.abs(c - s) < CROSS_HOLD) ?? false;
      for (let i = 0; i < n; i += 2) {
        this.nearLines(x[i], z[i], reach, near, (q) => q === w || !outranks(q));
        for (const [qi, p] of near) {
          const q = this.ways[qi];
          const inside = p.s > 1 && p.s < q.al.length - 1 && p.d < 15;
          const prev = lastT.get(qi);
          lastT.set(qi, inside ? [w.al.s[i], p.t] : [NaN, NaN]);
          if (!inside || !prev || !(w.al.s[i] - prev[0] < 3 * STEP + 0.5))
            continue;
          if (Math.sign(prev[1]) === Math.sign(p.t)) continue;
          const sX =
            prev[0] +
            ((w.al.s[i] - prev[0]) * Math.abs(prev[1])) /
              (Math.abs(prev[1]) + Math.abs(p.t) || 1);
          if (this.tagLayer(w, sX) === this.tagLayer(q, p.s)) continue;
          const list = crossAt.get(qi) ?? [];
          list.push(sX);
          crossAt.set(qi, list);
        }
      }
      for (let i = 0; i < n; i += 2) {
        this.nearLines(x[i], z[i], reach, near, (q) => q === w || !outranks(q));
        let top: Way | undefined;
        for (const [qi] of near)
          if (!top || effRank(this.ways[qi]) > effRank(top))
            top = this.ways[qi];
        for (const [qi, p] of near) {
          const q = this.ways[qi];
          const k = p.f < 0.5 ? p.i : Math.min(q.al.n - 1, p.i + 1);
          if (Math.abs(tx[i] * q.al.tx[k] + tz[i] * q.al.tz[k]) < 0.7) continue;
          if (crossing(qi, w.al.s[i])) continue;
          sideOf.set(
            qi,
            (sideOf.get(qi) ?? 0) +
              Math.sign(p.t) * Math.min(1, Math.abs(p.t) / 3),
          );
          if (top && top !== q && !away.has(qi)) {
            const pt = near.get(top.index)!;
            const j = Math.min(top.al.n - 1, pt.i + 1);
            const rx = top.al.x[pt.i] + (top.al.x[j] - top.al.x[pt.i]) * pt.f;
            const rz = top.al.z[pt.i] + (top.al.z[j] - top.al.z[pt.i]) * pt.f;
            projectOnSegment(
              q.al,
              Math.max(0, Math.min(q.al.n - 2, p.i)),
              rx,
              rz,
              pr,
            );
            if (Math.abs(pr.t) > 1) away.set(qi, -Math.sign(pr.t));
          }
        }
      }
      for (let i = 0; i < n; i++) {
        this.nearLines(x[i], z[i], reach, near, (q) => q === w || !outranks(q));
        let best = 0;
        let bestRank = -Infinity;
        for (const [qi, p] of near) {
          const q = this.ways[qi];
          const k = p.f < 0.5 ? p.i : Math.min(q.al.n - 1, p.i + 1);
          const dot = tx[i] * q.al.tx[k] + tz[i] * q.al.tz[k];
          if (crossing(qi, w.al.s[i])) continue;
          // a merge end runs edge to edge with its host, then tapers in under it over the last MERGE_TAPER m
          const s = w.al.s[i];
          const dEnd =
            w.into[0] === q ? s : w.into[1] === q ? w.al.length - s : Infinity;
          const merging = dEnd < Infinity;
          if (!merging && this.nearSharedNode(w, q, x[i], z[i], 45)) continue;
          // (eased back in beyond the crossing: no kink where the yielding starts again)
          let fade = 1;
          for (const c of crossAt.get(qi) ?? [])
            fade = Math.min(
              fade,
              smoothstep(
                CROSS_CLEAR,
                CROSS_CLEAR + CROSS_EASE,
                Math.abs(s - c),
              ),
            );
          if (fade === 0) continue;
          const dom = sideOf.get(qi) ?? 0;
          const sgn =
            Math.abs(dom) > 0.5
              ? Math.sign(dom)
              : (away.get(qi) ?? (p.t >= 0 ? 1 : -1));
          // alongside (parallel), or run onto the road from its own side at any angle under 45 degrees
          const onto = p.t * sgn < Math.max(q.sec.paveL, q.sec.paveR);
          if (Math.abs(dot) < (onto ? 0.7 : 0.9)) continue;
          // q's side facing w, w's side facing q
          const qLeft = sgn > 0;
          const towardQ = -sgn * (q.al.tz[k] * tz[i] + -q.al.tx[k] * -tx[i]);
          const wLeft = towardQ > 0;
          // whole sections (sidewalks, verges) + room for a wall or barrier between them; a merge runs edge to edge
          const qSide = merging
            ? qLeft
              ? q.sec.paveL
              : q.sec.paveR
            : qLeft
              ? q.sec.footL
              : q.sec.footR;
          const wSide = merging
            ? wLeft
              ? w.sec.paveL
              : w.sec.paveR
            : wLeft
              ? w.sec.footL
              : w.sec.footR;
          // two kerbless roadways (a carriageway and the lane / service road beside it) keep a narrow gap with the
          // higher one's barrier in it; kerbed streets keep their whole sections apart
          const roadways = q.tpl.kerbH === 0 && w.tpl.kerbH === 0;
          const need = merging
            ? qSide +
              wSide * (2 * smoothstep(0, MERGE_TAPER, dEnd) - 1) -
              MERGE_OVERLAP
            : roadways
              ? (qLeft ? q.sec.paveL : q.sec.paveR) * widthK(q, p.s) +
                (wLeft ? w.sec.paveL : w.sec.paveR) * widthK(w, s) +
                NEIGHBOUR_GAP
              : qSide + wSide + 0.9;
          const cur = p.t * sgn;
          if (cur >= need) continue;
          const push = (need - cur) * (wLeft ? -1 : 1) * fade;
          // the highest-ranked road beside it decides; lower ones move themselves later
          const r = effRank(q);
          if (
            r > bestRank ||
            (r === bestRank && Math.abs(push) > Math.abs(best))
          ) {
            best = push;
            bestRank = r;
          }
        }
        off[i] = Math.max(-SEP_PUSH_MAX, Math.min(SEP_PUSH_MAX, best));
        if (best) any = true;
      }
      if (!any) continue;
      // hold the largest push over +-8 m, smooth over ~24 m, ease out to the junction ends
      const held = new Float64Array(n);
      const r = Math.round(8 / STEP);
      for (let i = 0; i < n; i++) {
        let m = 0;
        for (let k = Math.max(0, i - r); k <= Math.min(n - 1, i + r); k++)
          if (Math.abs(off[k]) > Math.abs(m)) m = off[k];
        held[i] = m;
      }
      smooth1d(held, 12 / STEP);
      const L = w.al.length;
      const n0 = this.nodes.get(w.nodes[0]);
      const n1 = this.nodes.get(w.nodes[1]);
      // a junction end holds (the push eases out to it); a joint (the same roadway continuing as another way) moves
      // with it and takes the continuing way's end along, so a lane beside the parkway keeps its gap over its whole
      // length and not only mid-way
      const fixed = (nd: NetNode | undefined, merge: boolean) =>
        !!nd &&
        !merge &&
        (nd.ends.length > 2 || nd.stage >= 0 || this.stageRunOn.has(nd.id));
      const fixed0 = fixed(n0, w.merge0);
      const fixed1 = fixed(n1, w.merge1);
      const pts: number[] = [];
      for (let i = 0; i < n; i++) {
        const s = w.al.s[i];
        let f = 1;
        if (fixed0) f = Math.min(f, smoothstep(0, Math.min(30, L / 2), s));
        if (fixed1) f = Math.min(f, smoothstep(0, Math.min(30, L / 2), L - s));
        const o = held[i] * f;
        pts.push(x[i] + tz[i] * o, z[i] - tx[i] * o);
      }
      for (const [nd, i, atEnd] of [
        [n0, 0, false],
        [n1, n - 1, true],
      ] as const) {
        if (
          !nd ||
          fixed(nd, atEnd ? w.merge1 : w.merge0) ||
          nd.ends.length !== 2
        )
          continue;
        const dx = pts[i * 2] - x[i];
        const dz = pts[i * 2 + 1] - z[i];
        if (Math.hypot(dx, dz) < 0.05) continue;
        nd.x += dx;
        nd.z += dz;
        for (const e of nd.ends)
          if (e.way !== w) this.shiftEnd(e.way, e.atEnd, dx, dz);
      }
      const len0 = w.al.length;
      w.al = alignPolyline(pts);
      if (w.widths) w.widths.scale *= len0 / Math.max(1, w.al.length);
      const nn = w.al.n;
      w.y = new Float64Array(nn);
      w.a = new Float64Array(nn);
      w.c = new Float64Array(nn);
      w.st = new Uint8Array(nn);
      w.wall = [new Uint8Array(nn), new Uint8Array(nn)];
      w.wallTop = [new Float64Array(nn), new Float64Array(nn)];
      w.wallCarried = [new Uint8Array(nn), new Uint8Array(nn)];
      w.wallLane = [new Uint8Array(nn), new Uint8Array(nn)];
      w.wallFaced = [new Float32Array(nn), new Float32Array(nn)];
      moved = true;
    }
    return moved;
  }

  // --- junctions ------------------------------------------------------------------------------------------------------

  private armOf(node: NetNode, way: Way, atEnd: boolean): JunctionArm {
    const al = way.al;
    // direction away from the node: averaged over the first few metres (a bent end does not swing the arm)
    const k = atEnd ? al.n - 1 : 0;
    const k2 = atEnd ? Math.max(0, al.n - 4) : Math.min(al.n - 1, 3);
    let dx = al.x[k2] - al.x[k];
    let dz = al.z[k2] - al.z[k];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const sec = way.sec;
    const sideW = (els: Section['left']) =>
      els[0]?.kind === 'kerb'
        ? els
            .filter((e) => e.kind !== 'verge' && e.kind !== 'median')
            .reduce((a, e) => a + e.w, 0)
        : 0;
    const swWayL = sideW(sec.left);
    const swWayR = sideW(sec.right);
    const r =
      way.tpl.kerbH > 0
        ? way.tpl.rank >= 6
          ? 5.5
          : way.tpl.rank >= 4
            ? 4.5
            : 3.5
        : way.tpl.rank >= 7
          ? 9
          : 3;
    return {
      way,
      atEnd,
      node,
      ox: node.x,
      oz: node.z,
      dx,
      dz,
      hwL: atEnd ? sec.paveR : sec.paveL,
      hwR: atEnd ? sec.paveL : sec.paveR,
      swL: atEnd ? swWayR : swWayL,
      swR: atEnd ? swWayL : swWayR,
      radius: r,
      maxCut: Math.min(45, al.length * 0.45),
      cut: 0,
    };
  }

  private buildJunctions(): void {
    const stage = this.stage;
    const pr = { x: 0, z: 0, tx: 0, tz: 0 };
    for (const node of this.nodes.values()) {
      if (!node.ends.length) continue;
      if (node.stage >= 0) {
        // the arms that end at the stage road's edge (a T into it)
        const s = node.stage;
        const i = Math.min(stage.al.n - 1, Math.round(s / STEP));
        pr.tx = stage.al.tx[i];
        pr.tz = stage.al.tz[i];
        for (const e of node.ends) {
          if (e.atEnd ? e.way.merge1 : e.way.merge0) continue;
          const arm = this.armOf(node, e.way, e.atEnd);
          const cos = Math.abs(arm.dx * pr.tx + arm.dz * pr.tz);
          const side =
            (arm.dx * pr.tz - arm.dz * pr.tx > 0
              ? stage.sec.paveL
              : stage.sec.paveR) * scaleAt(stage, i);
          const cut = Math.min(
            arm.maxCut,
            side / Math.max(0.3, Math.sqrt(1 - cos * cos)) + 0.2,
          );
          if (e.atEnd) e.way.cut1 = cut;
          else e.way.cut0 = cut;
        }
        continue;
      }
      if (node.ends.length === 1) {
        // (the road running on from the stage's end: joined to it, at its height)
        node.kind = this.stageRunOn.has(node.id) ? 'joint' : 'end';
        continue;
      }
      if (node.merge) {
        node.kind = 'joint';
        continue;
      }
      const arms = sortArms(
        node.ends.map((e) => this.armOf(node, e.way, e.atEnd)),
      );
      if (arms.length === 2) {
        const [a, b] = arms;
        const straight = a.dx * b.dx + a.dz * b.dz < -0.94;
        const same =
          Math.abs(a.hwL - b.hwR) < 0.6 &&
          Math.abs(a.hwR - b.hwL) < 0.6 &&
          a.swL === b.swR &&
          a.swR === b.swL;
        // the same street continues, or a ramp changes width / loses its sidewalk in a gentle bend: no polygon, the
        // wider surface simply runs on (a polygon there cut both arms back and left a gap)
        const gentle = a.dx * b.dx + a.dz * b.dz < -0.9;
        if (
          (straight && same) ||
          (gentle && a.way.tpl.kerbH === 0 && b.way.tpl.kerbH === 0)
        ) {
          node.kind = 'joint';
          continue;
        }
      }
      node.kind = 'junction';
      junctionCuts(arms);
      for (const a of arms) {
        if (a.atEnd) a.way.cut1 = a.cut;
        else a.way.cut0 = a.cut;
      }
      const j = this.makeJunction([node], arms);
      const { poly, corners } = junctionOutline(arms);
      this.finishJunction(j, poly, corners);
    }
    // Clusters: a way whose cuts eat it (divided roads crossing) merges the junctions at its two ends.
    const parent = new Map<NetNode, NetNode>();
    const find = (n: NetNode): NetNode => {
      let r = n;
      while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!;
      return r;
    };
    let merged = false;
    for (const w of this.ways) {
      if (w.stage) continue;
      const a = this.nodes.get(w.nodes[0]);
      const b = this.nodes.get(w.nodes[1]);
      if (!a?.junction || !b?.junction || a === b) continue;
      if (w.cut0 + w.cut1 > w.al.length - 2) {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) {
          parent.set(ra, rb);
          parent.set(rb, rb);
          merged = true;
        }
      }
    }
    if (!merged) return;
    const groups = new Map<NetNode, NetNode[]>();
    for (const n of this.nodes.values()) {
      if (!n.junction || !parent.has(n)) continue;
      const r = find(n);
      const g = groups.get(r) ?? [];
      g.push(n);
      groups.set(r, g);
    }
    const dropped = new Set<Junction>();
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      const set = new Set(members);
      for (const m of members) dropped.add(m.junction!);
      const arms: JunctionArm[] = [];
      for (const m of members)
        for (const e of m.ends) {
          const other = this.nodes.get(
            e.atEnd ? e.way.nodes[0] : e.way.nodes[1],
          );
          if (other && set.has(other)) {
            e.way.internal = true;
            continue;
          }
          const arm = this.armOf(m, e.way, e.atEnd);
          arm.cut = e.atEnd ? e.way.cut1 : e.way.cut0;
          arms.push(arm);
        }
      if (arms.length < 2) continue;
      // The union of the members' own polygons, the short ways between them and a lip into every arm.
      const parts: number[][] = members.map((m) => m.junction!.poly);
      for (const m of members)
        for (const e of m.ends)
          if (e.way.internal) parts.push(this.pavementOutline(e.way));
      for (const a of arms) {
        const lx = a.dz;
        const lz = -a.dx;
        const q = (c: number, l: number): [number, number] => [
          a.ox + a.dx * c + lx * l,
          a.oz + a.dz * c + lz * l,
        ];
        parts.push(
          [
            q(a.cut - 0.3, -a.hwR),
            q(a.cut + 0.5, -a.hwR),
            q(a.cut + 0.5, a.hwL),
            q(a.cut - 0.3, a.hwL),
          ].flat(),
        );
      }
      const j = this.makeJunction(members, arms);
      const poly = unionOutline(parts);
      const { corners } = clusterOutline(arms, false);
      for (const a of arms) {
        if (a.atEnd) a.way.cut1 = a.cut;
        else a.way.cut0 = a.cut;
      }
      this.finishJunction(j, poly, corners);
    }
    // renumber without the merged single-node junctions
    const keep = this.junctions.filter(
      (j) => !dropped.has(j) || j.nodes.length > 1,
    );
    this.junctions.length = 0;
    keep.forEach((j, i) => {
      j.index = i;
      this.junctions.push(j);
      for (const n of j.nodes) n.junction = j;
    });
  }

  /** A way's pavement as a closed outline (left edge out, right edge back). */
  private pavementOutline(w: Way): number[] {
    const { n, x, z, tx, tz } = w.al;
    const left: number[] = [];
    const right: number[] = [];
    for (let i = 0; i < n; i++) {
      const l = w.sec.paveL * scaleAt(w, i);
      const r = w.sec.paveR * scaleAt(w, i);
      left.push(x[i] + tz[i] * l, z[i] - tx[i] * l);
      right.push(x[i] - tz[i] * r, z[i] + tx[i] * r);
    }
    const out = [...left];
    for (let i = n - 1; i >= 0; i--) out.push(right[i * 2], right[i * 2 + 1]);
    return out;
  }

  private makeJunction(nodes: NetNode[], arms: JunctionArm[]): Junction {
    const j: Junction = {
      index: this.junctions.length,
      nodes,
      arms,
      poly: [],
      corners: [],
      minX: 0,
      minZ: 0,
      maxX: 0,
      maxZ: 0,
      surface: 'asphalt_city',
      rank: 0,
    };
    let best = -1;
    for (const a of arms)
      if (a.way.tpl.rank > best) {
        best = a.way.tpl.rank;
        j.surface = a.way.tpl.surface;
      }
    j.rank = best;
    for (const n of nodes) n.junction = j;
    this.junctions.push(j);
    return j;
  }

  private finishJunction(
    j: Junction,
    poly: number[],
    corners: CornerGeo[],
  ): void {
    j.poly = poly;
    const kerb = Math.max(...j.arms.map((a) => a.way.tpl.kerbH));
    j.corners = corners.map((c) => ({ ...c, rise: kerb }));
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    const grow = (p: number[]) => {
      for (let k = 0; k < p.length; k += 2) {
        minX = Math.min(minX, p[k]);
        maxX = Math.max(maxX, p[k]);
        minZ = Math.min(minZ, p[k + 1]);
        maxZ = Math.max(maxZ, p[k + 1]);
      }
    };
    grow(poly);
    for (const c of corners) grow(c.poly);
    Object.assign(j, { minX, minZ, maxX, maxZ });
  }

  // --- structures -------------------------------------------------------------------------------------------------------

  /** Per-sample arc length of every original polyline vertex (chord lengths scaled to the curve length). */
  private vertexS(w: Way): number[] {
    const e = (w as Way & { edge?: EdgeData }).edge;
    if (!e) return [];
    const out = [0];
    let acc = 0;
    for (let k = 2; k + 1 < e.pts.length; k += 2) {
      acc += Math.hypot(e.pts[k] - e.pts[k - 2], e.pts[k + 1] - e.pts[k - 1]);
      out.push(acc);
    }
    const f = w.al.length / (acc || 1);
    return out.map((v) => v * f);
  }

  private markRange(w: Way, from: number, to: number, kind: number): void {
    // (a range ending on a vertex holds the sample there: the vertex and sample stations are summed differently, a last
    // bit apart, and which way that bit falls differs between engines)
    const a = Math.max(0, from) - RANGE_EPS;
    const b = Math.min(w.al.length, to) + RANGE_EPS;
    for (let i = 0; i < w.al.n; i++) {
      const s = w.al.s[i];
      if (s >= a && s <= b) w.st[i] = kind;
    }
  }

  /**
   * The stage road's other carriageway (a motorway / trunk way alongside it, either direction, within CORRIDOR m) is
   * one corridor with it: it takes the stage road's land profile and its over / under at the same station (Civil 3D's
   * offset profile), so the two carriageways never drift apart in height.
   */
  private corridor(): void {
    const stage = this.stage;
    const near = new Map<number, Projection>();
    for (const w of this.ways) {
      if (w.stage || !/^(motorway|trunk)$/.test(w.kind)) continue;
      const n = w.al.n;
      const corr = new Float64Array(n).fill(NaN);
      const cand = new Float64Array(n).fill(NaN);
      const dz = new Float64Array(n);
      let any = false;
      for (let i = 0; i < n; i++) {
        this.nearLines(w.al.x[i], w.al.z[i], CORRIDOR, near, (q) => !q.stage);
        const p = near.get(0);
        if (!p) continue;
        // (the run-out past the route's end is no corridor: the carriageways there keep their own heights)
        if (p.i >= this.runoutFrom) continue;
        const j = Math.min(stage.al.n - 1, p.f < 0.5 ? p.i : p.i + 1);
        const dot = w.al.tx[i] * stage.al.tx[j] + w.al.tz[i] * stage.al.tz[j];
        if (Math.abs(dot) < 0.85) continue;
        cand[i] = p.s;
        // the land under both: a carriageway on another level (a ramp above the main line) is no corridor member
        const sx = stage.al.x[p.i] + (stage.al.x[j] - stage.al.x[p.i]) * p.f;
        const sz = stage.al.z[p.i] + (stage.al.z[j] - stage.al.z[p.i]) * p.f;
        dz[i] = this.natural(w.al.x[i], w.al.z[i]) - this.natural(sx, sz);
        if (Math.abs(dz[i]) <= CORRIDOR_LEVEL) {
          corr[i] = p.s;
          any = true;
        }
      }
      if (!any) continue;
      // a short gap (the bare-earth DEM's hole under a bridge, a street crossing) stays in the corridor
      const maxGap = Math.round(CORRIDOR_GAP / STEP);
      for (let i = 0; i < n;) {
        if (!Number.isNaN(corr[i]) || Number.isNaN(cand[i])) {
          i++;
          continue;
        }
        let j = i;
        while (j < n && Number.isNaN(corr[j]) && !Number.isNaN(cand[j])) j++;
        const closed =
          i > 0 &&
          !Number.isNaN(corr[i - 1]) &&
          j < n &&
          !Number.isNaN(corr[j]);
        if (closed && j - i <= maxGap)
          for (let k = i; k < j; k++) corr[k] = cand[k];
        i = j;
      }
      w.corr = corr;
    }
  }

  /**
   * Tunnelled roadways side by side (the parkway's carriageways and the lanes beside them under one street) share one
   * slab: every member's slab top is the highest of the members' at that spot, so the street on top is one plane.
   */
  private unifySlabs(): void {
    const tun = this.ways.filter((w) => w.slab && w.st.includes(ST_TUNNEL));
    const near = new Map<number, Projection>();
    for (let pass = 0; pass < 2; pass++)
      for (const w of tun) {
        for (let i = 0; i < w.al.n; i++) {
          if (w.st[i] !== ST_TUNNEL) continue;
          this.nearLines(
            w.al.x[i],
            w.al.z[i],
            TRENCH_REACH,
            near,
            (q) => q === w || !q.slab,
          );
          for (const [qi, p] of near) {
            const q = this.ways[qi];
            const k = Math.min(q.al.n - 1, p.f < 0.5 ? p.i : p.i + 1);
            if (q.st[k] !== ST_TUNNEL) continue;
            if (
              Math.abs(w.al.tx[i] * q.al.tx[k] + w.al.tz[i] * q.al.tz[k]) < 0.85
            )
              continue;
            w.slab![i] = Math.max(w.slab![i], q.slab![k]);
          }
        }
      }
  }

  /**
   * Survey plazas: the streets end on the rim (their ends inside are cut back to a sample past it, a street wholly
   * inside is left out), the junctions inside are the plaza's. The roads in the trench below stay: the stage, every way with a tunnel stretch
   * and the ways joining one (the lanes into the bores).
   */
  private trimToPlazas(): void {
    if (!this.plazas.length) return;
    const trench = this.trench;
    for (const w of this.ways)
      if (w.stage || w.st.includes(ST_TUNNEL)) trench.add(w);
    for (const w of this.ways)
      if (!trench.has(w) && [...trench].some((q) => this.sharesNode(w, q)))
        trench.add(w);
    const inside = (pl: Plaza, x: number, z: number) =>
      x >= pl.minX &&
      x <= pl.maxX &&
      z >= pl.minZ &&
      z <= pl.maxZ &&
      inPolygon(pl.area, x, z);
    for (const pl of this.plazas) {
      for (const w of this.ways) {
        if (w.internal || trench.has(w)) continue;
        const { n, x, z, s } = w.al;
        const L = w.al.length;
        const inAt = (i: number) => inside(pl, x[i], z[i]);
        if (!inAt(0) && !inAt(n - 1)) continue;
        w.plazaCut ??= [w.cut0, w.cut1];
        if (inAt(0) && inAt(n - 1)) {
          w.cut0 = L;
          w.cut1 = 0;
          continue;
        }
        let i = inAt(0) ? 0 : n - 1;
        const step = inAt(0) ? 1 : -1;
        while (inAt(i)) i += step;
        // (the street runs a sample onto the plaza: no strip of land between its end and an edge it meets aslant)
        i -= step;
        const cut = step > 0 ? s[i] : L - s[i];
        if (step > 0) w.cut0 = Math.max(w.cut0, cut);
        else w.cut1 = Math.max(w.cut1, cut);
        // its pavement's height across the rim
        for (const t of [-w.sec.paveR, 0, w.sec.paveL]) {
          const lw = worldT(w, i, 0, t);
          pl.rim.push({
            x: x[i] + w.al.tz[i] * lw,
            z: z[i] - w.al.tx[i] * lw,
            y: this.surfaceAt(w, i, 0, t),
          });
        }
      }
      for (const j of this.junctions)
        if (
          inside(pl, (j.minX + j.maxX) / 2, (j.minZ + j.maxZ) / 2) &&
          !j.arms.some((a) => trench.has(a.way))
        )
          j.plaza = true;
      // the roof slab of a bore under the plaza carries the plaza at its surveyed level (v1 plazas.ts: the slab top
      // follows the street on top), down to its own clearance line - not the land's line from portal to portal
      const level = pl.level;
      if (!level) continue;
      let lowered = false;
      for (const w of this.ways) {
        if (!w.slab) continue;
        for (let i = 0; i < w.al.n; i++) {
          if (w.st[i] !== ST_TUNNEL || !inside(pl, w.al.x[i], w.al.z[i]))
            continue;
          const floor = Math.max(
            this.surfaceAt(w, i, 0, -w.sec.paveR),
            this.surfaceAt(w, i, 0, 0),
            this.surfaceAt(w, i, 0, w.sec.paveL),
          );
          const y = Math.max(
            floor + w.tpl.clearance + 0.4 + SLAB,
            level(w.al.x[i], w.al.z[i]),
          );
          if (y < w.slab[i]) {
            w.slab[i] = y;
            lowered = true;
          }
        }
      }
      // (bores side by side keep one roof)
      if (lowered) this.unifySlabs();
    }
  }

  /**
   * Per sample of a corridor member: the stage station to follow (its own where coupled, the nearest coupled one
   * across gaps) and the distance to the coupled stretch (0 inside).
   */
  private corridorStations(w: Way): { st: Float64Array; dist: Float64Array } {
    const n = w.al.n;
    const corr = w.corr!;
    const st = new Float64Array(corr);
    const dist = new Float64Array(n).fill(Infinity);
    let last = NaN;
    let lastS = -Infinity;
    for (let i = 0; i < n; i++)
      if (!Number.isNaN(corr[i])) {
        last = corr[i];
        lastS = w.al.s[i];
        dist[i] = 0;
      } else {
        st[i] = last;
        dist[i] = w.al.s[i] - lastS;
      }
    last = NaN;
    lastS = Infinity;
    for (let i = n - 1; i >= 0; i--)
      if (!Number.isNaN(corr[i])) {
        last = corr[i];
        lastS = w.al.s[i];
      } else if (lastS - w.al.s[i] < dist[i]) {
        st[i] = last;
        dist[i] = lastS - w.al.s[i];
      }
    return { st, dist };
  }

  /**
   * Blend a corridor member's profile `ys` to the stage road's `stageY` at its stations, eased out beyond the coupled
   * stretch over at least CORRIDOR_EASE m (longer where the two profiles stand further apart there).
   */
  private coupleTo(w: Way, ys: Float64Array, stageY: Float64Array): void {
    const stage = this.stage;
    const { st, dist } = this.corridorStations(w);
    const n = w.al.n;
    let ease = CORRIDOR_EASE;
    for (let i = 0; i < n; i++) {
      if (dist[i] !== 0 || Number.isNaN(st[i])) continue;
      const edge =
        (i > 0 && dist[i - 1] !== 0) || (i < n - 1 && dist[i + 1] !== 0);
      if (!edge) continue;
      const step = Math.abs(valueAt(stage.al, stageY, st[i]) - ys[i]);
      ease = Math.max(ease, step / (w.tpl.maxGrade * 0.3));
    }
    for (let i = 0; i < n; i++) {
      if (Number.isNaN(st[i])) continue;
      const k = 1 - smoothstep(0, ease, dist[i]);
      if (k > 0) ys[i] += (valueAt(stage.al, stageY, st[i]) - ys[i]) * k;
    }
  }

  /**
   * The final profile of the stage road's other carriageway is the stage road's at the same station (its dips under
   * streets, its decks); its own crossings and junction ends are kept.
   */
  private coupleCorridor(): void {
    for (const w of this.ways) {
      if (!w.corr) continue;
      const n = w.al.n;
      this.coupleTo(w, w.y, this.stage.y);
      // its own crossings keep their clearance (a ramp over the carriageway where it leaves the stage road's level)
      for (const d of this.debug.dips)
        if (d.w === w) shape(w.al, w.y, d.s, d.y, d.flat, d.g, d.mode);
      // its junction ends keep their heights (the ways meeting there were solved to them): eased back over the
      // length the grade allows
      const L = w.al.length;
      for (const [e, i] of [
        [0, 0],
        [1, n - 1],
      ] as const) {
        const node = this.nodes.get(w.nodes[e]);
        if (!node || node.kind === 'end' || (e ? w.merge1 : w.merge0)) continue;
        const d = node.h - w.y[i];
        if (Math.abs(d) < 0.02) continue;
        const reach = Math.min(
          L,
          Math.max(20, Math.abs(d) / (w.tpl.maxGrade * 0.6)),
        );
        for (let j = 0; j < n; j++) {
          const from = e === 0 ? w.al.s[j] : L - w.al.s[j];
          if (from < reach) w.y[j] += d * (1 - smoothstep(0, reach, from));
        }
      }
      // (the ease from its own profile onto the stage road's stays within its grade, CORRIDOR_GRADE times over)
      pinnedGrade(
        w.y,
        w.al.s,
        w.tpl.maxGrade * CORRIDOR_GRADE,
        !!this.nodes.get(w.nodes[0]) &&
          this.nodes.get(w.nodes[0])!.kind !== 'end',
        !!this.nodes.get(w.nodes[1]) &&
          this.nodes.get(w.nodes[1])!.kind !== 'end',
      );
    }
  }

  private structuresFromTags(
    data: {
      tagSets: TagSet[];
      stage: {
        spans: { kind: string; from: number; to: number }[];
        length: number;
      };
    },
    structures: Map<string, { from: number; to: number; kind: string }[]>,
    _def: NetworkDef,
    road: Road,
  ): void {
    const scale = road.runoutFrom / Math.max(1, data.stage.length);
    for (const sp of data.stage.spans) {
      const from = sp.from * scale;
      const to = sp.to * scale;
      if (sp.kind === 'bridge') this.markRange(this.stage, from, to, ST_DECK);
      else if (to - from >= TUNNEL_MIN)
        this.markRange(this.stage, from, to, ST_TUNNEL);
      // a short underpass (a street bridge over the stage road): layer -1 there, the crossing makes the street a deck
      else this.stageUnder.push([from - 4, to + 4]);
    }
    for (const w of this.ways) {
      if (w.stage) continue;
      const e = (w as Way & { edge?: EdgeData }).edge!;
      const vs = this.vertexS(w);
      const nseg = vs.length - 1;
      e.tags.forEach(([seg, ti], k) => {
        const end = k + 1 < e.tags.length ? e.tags[k + 1][0] : nseg;
        const t = data.tagSets[ti];
        if (t?.bridge) this.markRange(w, vs[seg], vs[end], ST_DECK);
        // a tunnel long enough to carry the street grid on a slab (a short underpass is a road under a deck)
        else if (t?.tunnel && vs[end] - vs[seg] >= 30)
          this.markRange(w, vs[seg], vs[end], ST_TUNNEL);
      });
      for (const o of structures.get(w.id) ?? [])
        this.markRange(
          w,
          o.from,
          o.to,
          o.kind === 'bridge'
            ? ST_DECK
            : o.kind === 'tunnel'
              ? ST_TUNNEL
              : ST_GROUND,
        );
    }
  }

  /** Layer of a way at arc length s: decks +1, tunnels / OSM layer < 0 -1. */
  private layerAt(w: Way, s: number): number {
    const i = Math.min(
      w.al.n - 1,
      Math.round(s / (w.al.length / (w.al.n - 1) || 1)),
    );
    if (w.st[i] === ST_DECK) return 1;
    if (w.st[i] === ST_TUNNEL) return -1;
    if (w.stage)
      return this.stageUnder.some(([a, b]) => s >= a && s <= b) ? -1 : 0;
    const e = (w as Way & { edge?: EdgeData }).edge;
    if (!e) return 0;
    const vs = this.vertexS(w);
    let seg = 0;
    while (seg + 1 < vs.length - 1 && vs[seg + 1] < s) seg++;
    let ti = e.tags[0]?.[1] ?? 0;
    for (const [sg, t] of e.tags) if (sg <= seg) ti = t;
    const t = this.tagSets[ti];
    if (t?.tunnel) return -1;
    if (t?.layer) return t.layer;
    // the other carriageway of the stage road goes over / under what the stage road does there
    const st = w.corr?.[i];
    if (st !== undefined && !Number.isNaN(st))
      return this.layerAt(this.stage, st);
    return 0;
  }
  private tagSets: TagSet[] = [];
  private stageSpans: [number, number, number][] = [];
  private deckDefs: NonNullable<NetworkDef['decks']> = [];
  /** Stage stations [from, to] of the one-off decks whose median is decked too (`NetworkDef.decks` `median`). */
  readonly medianDecks: [number, number][] = [];

  /** Stage station s lies on a deck whose median (to the other carriageway's deck) is decked too. */
  medianDeckAt(s: number): boolean {
    return this.medianDecks.some(([a, b]) => s >= a && s <= b);
  }
  /** The one-off decks per way [way, from, to, entry] (`NetworkDef.decks`): their parapet / piers. */
  private ownDecks: [
    Way,
    number,
    number,
    NonNullable<NetworkDef['decks']>[number],
  ][] = [];

  /** The `NetworkDef.decks` entry whose deck holds m `s` of way `w` (undefined: a fitted deck). */
  ownDeckAt(
    w: Way,
    s: number,
  ): NonNullable<NetworkDef['decks']>[number] | undefined {
    return this.ownDecks.find(
      ([o, a, b]) => o === w && s >= a - 1 && s <= b + 1,
    )?.[3];
  }

  /**
   * [from, to] along `upper` that the lower way's band (section + wall line + the coping behind it) covers within the
   * upper way's band (section + parapet), near the crossing at sU / sL: a skewed road beneath reaches far past the
   * crossing point at the upper road's edges.
   */
  private skewFootprint(
    upper: Way,
    lower: Way,
    sU: number,
    sL: number,
  ): [number, number] {
    const lowHalf =
      Math.max(lower.sec.footL, lower.sec.footR) +
      lower.tpl.daylight.wallOffset +
      FOOTPRINT_BACK;
    const upHalf = Math.max(upper.sec.footL, upper.sec.footR) + 0.6;
    let a = sU;
    let b = sU;
    const near = new Map<number, Projection>();
    const { n, s, x, z, tx, tz } = lower.al;
    for (let i = 0; i < n; i++) {
      if (Math.abs(s[i] - sL) > 90) continue;
      for (const t of [-lowHalf, 0, lowHalf]) {
        this.nearLines(
          x[i] + tz[i] * t,
          z[i] - tx[i] * t,
          upHalf,
          near,
          (q) => q !== upper,
        );
        const p = near.get(upper.index);
        if (!p || Math.abs(p.s - sU) > 90) continue;
        a = Math.min(a, p.s);
        b = Math.max(b, p.s);
      }
    }
    return [a, b];
  }

  /** OSM layer of a way at arc length s from its tags alone (stage spans, bridge / tunnel / layer), before structures. */
  private tagLayer(w: Way, s: number): number {
    if (w.stage) {
      for (const [a, b, l] of this.stageSpans) if (s >= a && s <= b) return l;
      return 0;
    }
    const e = (w as Way & { edge?: EdgeData }).edge;
    if (!e) return 0;
    const vs = this.vertexS(w);
    let seg = 0;
    while (seg + 1 < vs.length - 1 && vs[seg + 1] < s) seg++;
    let ti = e.tags[0]?.[1] ?? 0;
    for (const [sg, t] of e.tags) if (sg <= seg) ti = t;
    const t = this.tagSets[ti];
    if (t?.bridge) return t.layer && t.layer > 0 ? t.layer : 1;
    if (t?.tunnel) return -1;
    return t?.layer ?? 0;
  }
  /** Stage road stretches under a short OSM underpass (no tunnel). */
  private stageUnder: [number, number][] = [];
  /** Stage road OSM bridge spans (m along, the road's scale), known before the layout passes. */
  private stageBridges: [number, number][] = [];

  private findCrossings(): void {
    const ways = this.ways;
    const seen = new Set<string>();
    const share = (a: Way, b: Way) =>
      a.nodes.some((n) => n >= 0 && b.nodes.includes(n));
    const segHit = (
      ax: number,
      az: number,
      bx: number,
      bz: number,
      cx: number,
      cz: number,
      dx: number,
      dz: number,
    ): [number, number] | undefined => {
      const ex = bx - ax;
      const ez = bz - az;
      const fx = dx - cx;
      const fz = dz - cz;
      const det = ex * fz - ez * fx;
      if (Math.abs(det) < 1e-9) return undefined;
      const t = ((cx - ax) * fz - (cz - az) * fx) / det;
      const u = ((cx - ax) * ez - (cz - az) * ex) / det;
      if (t < 0 || t > 1 || u < 0 || u > 1) return undefined;
      return [t, u];
    };
    for (const w of ways) {
      if (w.internal) continue;
      const { x, z, n } = w.al;
      for (let i = 0; i + 1 < n; i++) {
        const keys = this.lines.at(
          (x[i] + x[i + 1]) / 2,
          (z[i] + z[i + 1]) / 2,
        );
        for (const key of keys) {
          const q = ways[Math.floor(key / 65536)];
          if (q.index <= w.index || q.internal) continue;
          const k = key % 65536;
          const hit = segHit(
            x[i],
            z[i],
            x[i + 1],
            z[i + 1],
            q.al.x[k],
            q.al.z[k],
            q.al.x[k + 1],
            q.al.z[k + 1],
          );
          if (!hit) continue;
          const sW = w.al.s[i] + (w.al.s[i + 1] - w.al.s[i]) * hit[0];
          const sQ = q.al.s[k] + (q.al.s[k + 1] - q.al.s[k]) * hit[1];
          // at a shared node (an at-grade junction) or at a merge onto the stage road
          if (share(w, q)) {
            const nearEnd =
              Math.min(sW, w.al.length - sW) < 25 ||
              Math.min(sQ, q.al.length - sQ) < 25;
            if (nearEnd) continue;
          }
          // along a merge (the ramp tapers in over its host)
          const R = MERGE_TAPER + 10;
          if (q.into[0] === w && sQ < R) continue;
          if (q.into[1] === w && q.al.length - sQ < R) continue;
          if (w.into[0] === q && sW < R) continue;
          if (w.into[1] === q && w.al.length - sW < R) continue;
          const key2 = `${w.index}:${q.index}:${Math.round(sW / 10)}`;
          if (seen.has(key2)) continue;
          seen.add(key2);
          const lw = this.layerAt(w, sW);
          const lq = this.layerAt(q, sQ);
          if (lw === lq) continue; // at grade (missing node / tags): both stay on the ground
          const [upper, sU, lower, sL] =
            lw > lq ? [w, sW, q, sQ] : [q, sQ, w, sW];
          const ti = Math.round(sU / (upper.al.length / (upper.al.n - 1) || 1));
          const li = Math.round(sL / (lower.al.length / (lower.al.n - 1) || 1));
          const sin = Math.abs(
            upper.al.tx[Math.min(ti, upper.al.n - 1)] *
              lower.al.tz[Math.min(li, lower.al.n - 1)] -
              upper.al.tz[Math.min(ti, upper.al.n - 1)] *
                lower.al.tx[Math.min(li, lower.al.n - 1)],
          );
          const overSlab = lower.st[Math.min(li, lower.al.n - 1)] === ST_TUNNEL;
          const c: Crossing = {
            upper,
            lower,
            sU,
            sL,
            sin: Math.max(0.25, sin),
            x: x[i] + (x[i + 1] - x[i]) * hit[0],
            z: z[i] + (z[i + 1] - z[i]) * hit[0],
            overSlab,
          };
          this.crossings.push(c);
          if (!overSlab) {
            // deck over the lower way's whole section + walls + abutment seats
            const half =
              (Math.max(lower.sec.footL, lower.sec.footR) +
                lower.tpl.daylight.wallOffset +
                2.5) /
                c.sin +
              1;
            // (a one-off structure from the map data: at least its own length, and over the whole skewed footprint)
            const id = lower.id.split('.')[0];
            const own = this.deckDefs.find((d) => d.under.includes(id));
            if (own) {
              const [a, b] = this.skewFootprint(upper, lower, sU, sL);
              const from = Math.min(sU - own.length / 2, a - DECK_SEAT);
              const to = Math.max(sU + own.length / 2, b + DECK_SEAT);
              this.markRange(upper, from, to, ST_DECK);
              if (own.median && upper.stage) this.medianDecks.push([from, to]);
              this.ownDecks.push([upper, from, to, own]);
            } else
              this.markRange(
                upper,
                sU - Math.min(half, 70),
                sU + Math.min(half, 70),
                ST_DECK,
              );
          }
        }
      }
    }
  }

  /**
   * Two decks of one way separated by a short stretch of ground are one span (a street over both carriageways of the
   * parkway: the median between them is bridged, not filled).
   */
  private joinDecks(): void {
    const gap = Math.round(DECK_JOIN / STEP);
    for (const w of this.ways) {
      const runs = runsOf(w.st, ST_DECK);
      for (let k = 0; k + 1 < runs.length; k++) {
        const [, a] = runs[k];
        const [b] = runs[k + 1];
        if (b - a - 1 > gap) continue;
        for (let i = a + 1; i < b; i++)
          if (w.st[i] === ST_GROUND) w.st[i] = ST_DECK;
      }
    }
  }

  /**
   * A way ending on top of / against another one it does not share a node with (a street running into the side of the
   * sunken parkway, a lane end over a tunnel): over a tunnel it is a crossing on the slab; anywhere else its end is cut
   * back to clear the other way's section and wall.
   */
  private nearCrossings(): void {
    const near = new Map<number, Projection>();
    for (const w of this.ways) {
      if (w.stage || w.internal) continue;
      const half = Math.max(w.sec.paveL, w.sec.paveR);
      for (const atEnd of [false, true]) {
        const node = this.nodes.get(w.nodes[atEnd ? 1 : 0]);
        const L = w.al.length;
        let cutTo = 0;
        for (let k = 0; k < w.al.n; k++) {
          const i = atEnd ? w.al.n - 1 - k : k;
          const d = atEnd ? L - w.al.s[i] : w.al.s[i];
          if (d > 30) break;
          this.nearLines(
            w.al.x[i],
            w.al.z[i],
            half + 14,
            near,
            (q) => q === w || q.internal,
          );
          for (const [qi, p] of near) {
            const q = this.ways[qi];
            if (
              node &&
              (q.nodes.includes(node.id) || (q.stage && node.stage >= 0))
            )
              continue;
            if (this.sharesNode(w, q)) continue;
            const kq = Math.min(q.al.n - 1, p.f < 0.5 ? p.i : p.i + 1);
            if (
              Math.abs(w.al.tx[i] * q.al.tx[kq] + w.al.tz[i] * q.al.tz[kq]) >
              0.8
            )
              continue;
            const foot = p.t >= 0 ? q.sec.footL : q.sec.footR;
            if (Math.abs(p.t) > foot + half) continue;
            if (q.st[kq] === ST_TUNNEL) {
              if (
                !this.crossings.some(
                  (c) =>
                    c.upper === w &&
                    c.lower === q &&
                    Math.abs(c.sU - w.al.s[i]) < 20,
                )
              )
                this.crossings.push({
                  upper: w,
                  lower: q,
                  sU: w.al.s[i],
                  sL: p.s,
                  sin: 1,
                  x: w.al.x[i],
                  z: w.al.z[i],
                  overSlab: true,
                });
              continue;
            }
            if (q.st[kq] === ST_DECK || w.st[i] === ST_DECK) continue;
            // clear of the other way's section + its wall room
            cutTo = Math.max(cutTo, d + 1);
          }
        }
        if (cutTo > 0 && (!node || node.kind === 'end')) {
          const c = Math.min(cutTo + q0WallRoom, L * 0.45);
          if (atEnd) w.cut1 = Math.max(w.cut1, c);
          else w.cut0 = Math.max(w.cut0, c);
        }
      }
    }
  }

  /** The two ways share a node. */
  private sharesNode(a: Way, b: Way): boolean {
    return a.nodes.some((n) => n >= 0 && b.nodes.includes(n));
  }

  // --- vertical design ----------------------------------------------------------------------------------------------

  /** Points of every tunnel (OSM tunnel streets, the stage road's long underpasses): the survey holds off them. */
  private tunnelPts: number[] = [];
  /** Per tunnel point: a bore at least TUNNEL_MIN long (not an OSM `tunnel` stub under an overpass). */
  private tunnelLong: boolean[] = [];
  private tunnelGrid = new Grid<number>(TUNNEL_HOLD);

  private holdTunnels(data: NetworkData, road: Road): void {
    const add = (x: number, z: number, long = true) => {
      const k = this.tunnelPts.length / 2;
      this.tunnelPts.push(x, z);
      this.tunnelLong.push(long);
      this.tunnelGrid.add(
        k,
        x - TUNNEL_HOLD,
        z - TUNNEL_HOLD,
        x + TUNNEL_HOLD,
        z + TUNNEL_HOLD,
      );
    };
    for (const e of data.edges)
      if (e.tags.some(([, ti]) => data.tagSets[ti]?.tunnel)) {
        let len = 0;
        for (let i = 2; i < e.pts.length; i += 2)
          len += Math.hypot(
            e.pts[i] - e.pts[i - 2],
            e.pts[i + 1] - e.pts[i - 1],
          );
        for (let i = 0; i < e.pts.length; i += 2)
          add(e.pts[i], e.pts[i + 1], len >= TUNNEL_MIN);
      }
    const scale = road.runoutFrom / Math.max(1, data.stage.length);
    const al = this.stage.al;
    for (const sp of data.stage.spans)
      if (sp.kind !== 'bridge' && (sp.to - sp.from) * scale >= TUNNEL_MIN)
        for (let i = 0; i < al.n; i++)
          if (al.s[i] >= sp.from * scale && al.s[i] <= sp.to * scale)
            add(al.x[i], al.z[i]);
  }

  /**
   * The stage's samples within TUNNEL_HOLD m along of its own tunnel stretches (the bores are sized by the section);
   * none when its widths apply in the bores too (`stage.boreWidths`).
   */
  private stageTunnelHeld(data: NetworkData, road: Road): Uint8Array {
    const { n, s } = this.stage.al;
    const scale = road.runoutFrom / Math.max(1, data.stage.length);
    const held = new Uint8Array(n);
    if (data.stage.boreWidths) return held;
    for (const sp of data.stage.spans)
      if (sp.kind !== 'bridge' && (sp.to - sp.from) * scale >= TUNNEL_MIN)
        for (let i = 0; i < n; i++)
          if (
            s[i] >= sp.from * scale - TUNNEL_HOLD &&
            s[i] <= sp.to * scale + TUNNEL_HOLD
          )
            held[i] = 1;
    return held;
  }

  /** Distance along the stage (m) from each sample to the nearest held one (both ways; Infinity = none). */
  private heldDistance(held: Uint8Array): Float64Array {
    const { n, s } = this.stage.al;
    const d = new Float64Array(n).fill(Infinity);
    for (let i = 0; i < n; i++)
      d[i] = held[i] ? 0 : i > 0 ? d[i - 1] + (s[i] - s[i - 1]) : Infinity;
    for (let i = n - 2; i >= 0; i--)
      d[i] = Math.min(d[i], d[i + 1] + (s[i + 1] - s[i]));
    return d;
  }

  /** Parkway mainlines at their surveyed width per station (`widthK`: eased back to the template into a junction). */
  private mainlineScale(): void {
    for (const w of this.ways) {
      if (w.stage || !w.widths) continue;
      const { n, s } = w.al;
      const k = new Float64Array(n);
      let narrowed = false;
      for (let i = 0; i < n; i++) {
        k[i] = widthK(w, s[i]);
        if (k[i] < 0.999) narrowed = true;
      }
      if (narrowed) w.k = k;
    }
  }

  /**
   * The stage pavement at its surveyed width per station (`stage.widths`, network_survey.py): scale k = width / the
   * template's pavement (WIDTH_MIN_K..1, never wider than the template), 1 within TUNNEL_HOLD m along of the stage's own
   * tunnel stretches (the Queens Blvd tunnel keeps its section), easing back over WIDTH_EASE m.
   */
  private stageScale(data: NetworkData, road: Road): void {
    const ws = data.stage.widths;
    if (!ws?.length) return;
    const w = this.stage;
    const { n, s } = w.al;
    const scale = road.runoutFrom / Math.max(1, data.stage.length);
    const tpl = w.sec.paveL + w.sec.paveR;
    const widthAt = (m: number): number =>
      surveyK(w, m) * (w.sec.paveL + w.sec.paveR);
    const held = this.stageTunnelHeld(data, road);
    // held too: where another way's pavement runs alongside the stage's template edge (a merging ramp, a gore, the
    // other carriageway in contact): the shared edge stays put, no strip of land opens between them (a mainline with
    // surveyed widths kept its gap at the stage's surveyed width, `separate`: not held for it)
    const near = new Map<number, Projection>();
    const { x, z, tx, tz } = w.al;
    for (let i = 0; i < n && w.sec; i++) {
      if (held[i]) continue;
      for (const side of [1, -1]) {
        const t =
          side * ((side > 0 ? w.sec.paveL : w.sec.paveR) + WIDTH_CONTACT);
        const px = x[i] + tz[i] * t;
        const pz = z[i] - tx[i] * t;
        this.nearLines(px, pz, 30, near, (q) => q.stage || !!q.widths);
        for (const [qi, p] of near) {
          const q = this.ways[qi];
          if (!q.sec) continue;
          const j = Math.min(q.al.n - 1, p.f < 0.5 ? p.i : p.i + 1);
          if (Math.abs(q.al.tx[j] * tx[i] + q.al.tz[j] * tz[i]) < 0.85)
            continue;
          // (a street over or under it - a bridge over the stage, the boulevard over its tunnel - is no neighbour)
          if (this.tagLayer(q, p.s) !== this.tagLayer(w, s[i])) continue;
          // (a city street alongside is no part of the parkway: the kerbs leave a strip for the barrier between)
          if (!/^(motorway|trunk)(_link)?$/.test(q.kind)) continue;
          if (p.t <= q.sec.paveL && p.t >= -q.sec.paveR) held[i] = 1;
        }
      }
    }
    const d = this.heldDistance(held);
    this.debug.widthHeld = d;
    const k = new Float64Array(n);
    let narrowed = false;
    for (let i = 0; i < n; i++) {
      const raw = Math.min(
        1,
        Math.max(WIDTH_MIN_K, widthAt(s[i] / scale) / tpl),
      );
      k[i] = 1 + (raw - 1) * smoothstep(0, WIDTH_EASE, d[i]);
      if (k[i] < 0.999) narrowed = true;
    }
    if (!narrowed) return;
    w.k = k;
    // the stage Road (timing, autopilot, the off-stage line) narrows with it
    for (const p of road.samples) {
      const i = sampleAt(w.al, p.dist);
      const ds = w.al.s[i + 1] - w.al.s[i] || 1;
      p.halfWidth *= scaleAt(
        w,
        i,
        Math.min(1, Math.max(0, (p.dist - w.al.s[i]) / ds)),
      );
    }
  }

  /** The stage station of way `w` at sample i (the stage itself, or an opposite carriageway's `corr`); NaN = none. */
  private stationOf(w: Way, i: number): number {
    if (w.stage) return w.al.s[i];
    return w.corr ? w.corr[i] : NaN;
  }

  /**
   * Wall survey gate for the parkway's carriageways: undefined = not covered (the daylight rule decides), true = a
   * surveyed wall runs alongside on that side here, false = covered and none (no wall: a bank).
   */
  surveyedWall(w: Way, i: number, side: 0 | 1): boolean | undefined {
    const sv = this.surveyWalls;
    if (!sv) return undefined;
    const st = this.stationOf(w, i);
    if (Number.isNaN(st) || st > sv.until) return undefined;
    const { x, z, tx, tz } = w.al;
    const sg = side === 0 ? 1 : -1;
    for (const k of sv.grid.at(x[i], z[i])) {
      const [x0, z0, x1, z1] = sv.segs.slice(k * 4, k * 4 + 4);
      const ex = x1 - x0;
      const ez = z1 - z0;
      const l = Math.hypot(ex, ez) || 1;
      if (Math.abs((ex * tx[i] + ez * tz[i]) / l) < WALL_SURVEY_SKEW) continue;
      // the sample's projection onto the segment (+ WALL_SURVEY_ALONG beyond its ends)
      const f = ((x[i] - x0) * ex + (z[i] - z0) * ez) / (l * l);
      if (f * l < -WALL_SURVEY_ALONG || f * l > l + WALL_SURVEY_ALONG) continue;
      const fc = Math.min(1, Math.max(0, f));
      const px = x0 + ex * fc - x[i];
      const pz = z0 + ez * fc - z[i];
      const lat = px * tz[i] - pz * tx[i];
      if (lat * sg > 0 && Math.hypot(px, pz) <= WALL_SURVEY_REACH) return true;
    }
    return false;
  }

  /**
   * The parkway's verges (`wallOut`): where the surveyed wall line (`survey.walls`) runs further out than the template's
   * wall, the wall stands on that line and the strip between lies at the road's level - only on the ground, not near
   * a crossing (the decks are laid out on the template's wall) and only where no other road crosses the strip.
   */
  private surveyVerges(): void {
    const sv = this.surveyWalls;
    if (!sv) return;
    const near = new Map<number, Projection>();
    for (const w of this.ways) {
      if (!(w.stage || w.corr)) continue;
      const { n, x, z, tx, tz, s } = w.al;
      const out: [Float32Array, Float32Array] = [
        new Float32Array(n),
        new Float32Array(n),
      ];
      let any = false;
      const crossed = new Uint8Array(n);
      for (const c of this.crossings) {
        if (c.lower !== w && c.upper !== w) continue;
        const sC = c.lower === w ? c.sL : c.sU;
        const o = c.lower === w ? c.upper : c.lower;
        const half = (Math.max(o.sec.footL, o.sec.footR) + 4) / c.sin;
        for (let i = 0; i < n; i++)
          if (Math.abs(s[i] - sC) < half) crossed[i] = 1;
      }
      for (const side of [0, 1] as const) {
        const sg = side === 0 ? 1 : -1;
        const foot = side === 0 ? w.sec.footL : w.sec.footR;
        const raw = new Float64Array(n);
        const on = new Uint8Array(n);
        for (let i = 0; i < n; i++) {
          if (w.st[i] !== ST_GROUND || crossed[i]) continue;
          const st = this.stationOf(w, i);
          if (Number.isNaN(st) || st > sv.until) continue;
          const lat = this.surveyWallLat(w, i, side);
          if (lat === undefined) continue;
          const base = Math.abs(
            worldT(w, i, 0, sg * (foot + w.tpl.daylight.wallOffset)),
          );
          const v = lat - base;
          if (v < WALL_VERGE_MIN || v > WALL_VERGE_MAX) continue;
          // (the strip free of other roads)
          let free = true;
          for (let d = 0.5; d < v && free; d += 1.5) {
            const t = sg * (base + d);
            const px = x[i] + tz[i] * t;
            const pz = z[i] - tx[i] * t;
            for (const [qi, p] of this.nearLines(
              px,
              pz,
              20,
              near,
              (q) => q === w || q.internal,
            )) {
              const q = this.ways[qi];
              if (
                Math.abs(p.t) <=
                (p.t >= 0 ? q.sec.footL : q.sec.footR) + 0.5
              ) {
                free = false;
                break;
              }
            }
          }
          if (!free) continue;
          raw[i] = v;
          on[i] = 1;
        }
        smooth1d(raw, Math.max(1, WALL_VERGE_SMOOTH / STEP));
        for (let i = 0; i < n; i++)
          if (on[i] && raw[i] >= WALL_VERGE_MIN / 2) {
            out[side][i] = raw[i];
            any = true;
          }
      }
      if (any) w.wallOut = out;
    }
  }

  /** The nearest surveyed wall line on that side of way `w` at sample i: its distance from the line (m), if any. */
  private surveyWallLat(
    w: Way,
    i: number,
    side: 0 | 1,
    along = 0,
  ): number | undefined {
    const sv = this.surveyWalls;
    if (!sv) return undefined;
    const { x, z, tx, tz } = w.al;
    const sg = side === 0 ? 1 : -1;
    let best: number | undefined;
    for (const k of sv.grid.at(x[i], z[i])) {
      const [x0, z0, x1, z1] = sv.segs.slice(k * 4, k * 4 + 4);
      const ex = x1 - x0;
      const ez = z1 - z0;
      const l = Math.hypot(ex, ez) || 1;
      if (Math.abs((ex * tx[i] + ez * tz[i]) / l) < WALL_SURVEY_SKEW) continue;
      const f = ((x[i] - x0) * ex + (z[i] - z0) * ez) / (l * l);
      if (f * l < -along || f * l > l + along) continue;
      const fc = Math.min(1, Math.max(0, f));
      const px = x0 + ex * fc - x[i];
      const pz = z0 + ez * fc - z[i];
      const lat = (px * tz[i] - pz * tx[i]) * sg;
      if (lat <= 0 || Math.hypot(px, pz) > WALL_SURVEY_REACH) continue;
      if (best === undefined || lat < best) best = lat;
    }
    return best;
  }

  /** The retaining wall look of way `w` at sample i (map `wallStyles` by stage station over the template's daylight). */
  wallStyle(
    w: Way,
    i: number,
  ): { wall: 'stone' | 'concrete'; fence: 'railing' | 'chainlink' | 'none' } {
    let st = this.stationOf(w, i);
    let dl = w.tpl.daylight;
    if (Number.isNaN(st)) {
      // (beside the stage road in its cut: the stage's own wall, `SIDE_REACH`)
      st = this.sideStation(w, i);
      if (!Number.isNaN(st)) dl = this.ways[0].tpl.daylight;
    }
    const out = { wall: dl.wall, fence: dl.fence };
    if (Number.isNaN(st)) return out;
    for (const r of this.wallStyles)
      if (st >= r.from && st <= r.to) {
        if (r.wall) out.wall = r.wall;
        if (r.fence) out.fence = r.fence;
      }
    return out;
  }

  /** The stage station beside sample i of a way running along the stage road in its cut (SIDE_REACH), else NaN. */
  private sideStation(w: Way, i: number): number {
    const stage = this.ways[0];
    if (!stage?.stage || w.st[i] !== ST_GROUND) return NaN;
    const pr = this.nearLines(
      w.al.x[i],
      w.al.z[i],
      SIDE_REACH,
      this.paveNear,
      (q) => !q.stage,
    ).get(stage.index);
    if (!pr || stage.st[pr.i] !== ST_GROUND) return NaN;
    const along =
      w.al.tx[i] * stage.al.tx[pr.i] + w.al.tz[i] * stage.al.tz[pr.i];
    if (Math.abs(along) < 0.9) return NaN;
    const dy =
      this.surfaceAt(w, i, 0, 0) - this.surfaceAt(stage, pr.i, pr.f, 0);
    return Math.abs(dy) <= SIDE_LEVEL ? pr.s : NaN;
  }

  /** The map's deck look of way `w` (`NetworkDef.deckStyles` by OSM way id), undefined = the template's. */
  deckFacing(w: Way): 'steel' | undefined {
    const osm = w.id.split('.')[0];
    return this.deckStyles.find((d) => d.way === osm)?.facing;
  }

  /** The map's pavement of way `w` at sample i (`NetworkDef.pavement` by stage station), undefined = the template's. */
  pavementAt(w: Way, i: number): 'concrete' | undefined {
    if (!this.pavement.length) return undefined;
    let st = this.stationOf(w, i);
    // a highway ramp: the station of the stage road nearest to it (the interchange is paved alike)
    if (Number.isNaN(st) && w.tpl.pave === 'asphalt_hw') {
      this.nearLines(
        w.al.x[i],
        w.al.z[i],
        PAVEMENT_REACH,
        this.paveNear,
        (q) => !q.stage,
      );
      st = this.paveNear.get(0)?.s ?? NaN;
    }
    if (Number.isNaN(st)) return undefined;
    for (const r of this.pavement)
      if (st >= r.from && st <= r.to) return r.surface;
    return undefined;
  }

  /** The map's own record of the tunnel bore `w` runs in at sample i (`NetworkDef.tunnels` by its nearest stage station). */
  tunnelAt(
    w: Way,
    i: number,
  ): NonNullable<NetworkDef['tunnels']>[number] | undefined {
    if (!this.tunnelDefs.length) return undefined;
    let st = this.stationOf(w, i);
    if (Number.isNaN(st)) {
      this.nearLines(
        w.al.x[i],
        w.al.z[i],
        TUNNEL_REACH,
        this.paveNear,
        (q) => !q.stage,
      );
      st = this.paveNear.get(0)?.s ?? NaN;
    }
    if (Number.isNaN(st)) return undefined;
    return this.tunnelDefs.find((r) => st >= r.from && st <= r.to);
  }

  /** The ceiling girder depth of bore `w` at sample i (its tunnel's record, else TUNNEL_GIRDER_DEFAULT), m. */
  girderAt(w: Way, i: number): number {
    return this.tunnelAt(w, i)?.girder ?? TUNNEL_GIRDER_DEFAULT;
  }

  /** The cut wall height limit of way `w` at sample i (map `wallStyles` maxHeight), Infinity where none. */
  wallMax(w: Way, i: number): number {
    const st = this.stationOf(w, i);
    let out = Infinity;
    if (Number.isNaN(st)) return out;
    for (const r of this.wallStyles)
      if (r.maxHeight && st >= r.from && st <= r.to)
        out = Math.min(out, r.maxHeight);
    return out;
  }

  /** A chain-link fence stands on the median barrier of way `w` at sample i (map `medianFences`, by stage station). */
  medianFenceAt(w: Way, i: number): boolean {
    const st = this.stationOf(w, i);
    return this.medianFences.some((r) => st >= r.from && st <= r.to);
  }

  /** The outer barrier of way `w` at sample i where the map's `wallStyles` set one for that stage station. */
  outerBarrier(
    w: Way,
    i: number,
  ): 'jersey' | 'guard_rail' | 'none' | undefined {
    const st = this.stationOf(w, i);
    if (Number.isNaN(st)) return undefined;
    let out: 'jersey' | 'guard_rail' | 'none' | undefined;
    for (const r of this.wallStyles)
      if (r.barrier && st >= r.from && st <= r.to) out = r.barrier;
    return out;
  }

  /** (x, z) lies within TUNNEL_ROOF m of a tunnel's line: on its roof (`shortOnly`: of an OSM stub's, not a bore's). */
  private overTunnel(x: number, z: number, shortOnly = false): boolean {
    const t = this.tunnelPts;
    for (const k of this.tunnelGrid.at(x, z))
      if (
        !(shortOnly && this.tunnelLong[k]) &&
        Math.hypot(t[k * 2] - x, t[k * 2 + 1] - z) < TUNNEL_ROOF
      )
        return true;
    return false;
  }

  /** Way `w`'s deck edges left / right of its line from the map's `deckStyles` (OSM way id), undefined = its section's. */
  deckEdges(w: Way): [number, number] | undefined {
    const osm = w.id.split('.')[0];
    return this.deckStyles.find((d) => d.way === osm)?.edges;
  }

  /** Way `w`'s deck abutments when the map's `deckStyles` names them (OSM way id), undefined = by the deck's face. */
  deckAbutment(w: Way): 'stone' | 'concrete' | undefined {
    const osm = w.id.split('.')[0];
    return this.deckStyles.find((d) => d.way === osm)?.abutment;
  }

  /** The look of way `w`'s own deck at sample i (map `wallStyles` deck by stage station), the template's elsewhere. */
  deckStyle(w: Way, i: number): 'stone' | 'concrete' {
    const st = this.stationOf(w, i);
    let out = w.tpl.deck;
    if (Number.isNaN(st)) return out;
    for (const r of this.wallStyles)
      if (r.deck && st >= r.from && st <= r.to) out = r.deck;
    return out;
  }

  /** Any of the flat [x, z, ...] points within WIDTH_HOLD m of a bore (not an OSM `tunnel` stub under an overpass). */
  private nearTunnel(pts: ArrayLike<number>): boolean {
    const t = this.tunnelPts;
    for (let i = 0; i < pts.length; i += 2)
      for (const k of this.tunnelGrid.at(pts[i], pts[i + 1]))
        if (
          this.tunnelLong[k] &&
          Math.hypot(t[k * 2] - pts[i], t[k * 2 + 1] - pts[i + 1]) < WIDTH_HOLD
        )
          return true;
    return false;
  }

  /**
   * The surveyed spot heights on a way's pavement replace the DEM's land in its raw profile (the design fit follows them):
   * the median of the spots within the pavement and SPOT_ALONG m of each sample, those within SPOT_TRUST m of the land
   * (none over a tunnel and over the land: those lie on its roof).
   */
  private surveyHeights(
    w: Way,
    raw: Float64Array,
    valid: boolean[],
    deck?: boolean[],
    got?: Float64Array,
  ): void {
    if (!this.spots && !this.deckSpots) return;
    const { n, x, z, tx, tz } = w.al;
    const halfL = w.sec.paveL;
    const halfR = w.sec.paveR;
    // (only a way's own bore - its tunnel stretch and TUNNEL_ROOF m along past its portals - drops the spots over a
    // bore's line: a street over the bore, or the same road out in the open beside it, takes them, they are its
    // paving; an OSM tunnel stub under an overpass is left to the crossing rules for every way)
    const bored = new Array<boolean>(n).fill(false);
    for (const [i0, i1] of runsOf(w.st, ST_TUNNEL))
      for (let i = 0; i < n; i++)
        if (
          w.al.s[i] >= w.al.s[i0] - TUNNEL_ROOF &&
          w.al.s[i] <= w.al.s[Math.min(n - 1, i1)] + TUNNEL_ROOF
        )
          bored[i] = true;
    for (let i = 0; i < n; i++) {
      const onDeck = !valid[i] && !!deck?.[i];
      if (!valid[i] && !onDeck) continue;
      // (the pavement on the land takes the ground's spots, a deck its top's)
      const spots = onDeck ? this.deckSpots : this.spots;
      if (!spots) continue;
      const ys: number[] = [];
      for (const k of spots.grid.at(x[i], z[i])) {
        const dx = spots.pts[k * 3] - x[i];
        const dz = spots.pts[k * 3 + 2] - z[i];
        const along = dx * tx[i] + dz * tz[i];
        const lat = dx * tz[i] - dz * tx[i];
        if (Math.abs(along) > SPOT_ALONG) continue;
        if (lat > halfL * scaleAt(w, i) || -lat > halfR * scaleAt(w, i))
          continue;
        const y = spots.pts[k * 3 + 1];
        // (a deck's top stands at or over the land around it - its fill under the deck is the approaches' level - by
        // any height; the ground's spots near the land)
        if (
          onDeck && w.st[i] === ST_DECK
            ? y < raw[i] - SPOT_TRUST
            : Math.abs(y - raw[i]) > SPOT_TRUST
        )
          continue;
        // (a spot over a tunnel, above the land, lies on its roof: not this road's height)
        if (
          y > raw[i] + SPOT_ROOF &&
          this.overTunnel(spots.pts[k * 3], spots.pts[k * 3 + 2], !bored[i])
        )
          continue;
        ys.push(y);
      }
      if (ys.length) {
        // the median: a lidar spot on a street or a wall top beside the pavement's edge is one of many, not a step
        ys.sort((a, b) => a - b);
        const m = ys.length >> 1;
        raw[i] = ys.length % 2 ? ys[m] : (ys[m - 1] + ys[m]) / 2;
        if (onDeck) valid[i] = true;
        if (got) got[i] = raw[i];
        this.debug.surveyed++;
      }
    }
  }

  /**
   * A bore under a survey plaza dips so its roof slab fits under the plaza: the floor at most the plaza's surveyed
   * level (`Plaza.level`) - (clearance + roof), as v1's survey heights have it. Only the spots of the plaza top count
   * (the open cut's floor spots lie metres below them).
   */
  private plazaDips(base: Float64Array[], dips: Dip[]): void {
    const spots = this.spots;
    if (!spots) return;
    for (const pl of this.plazas) {
      // its top: every spot inside but the ones on the open cut of the roads below (the stage, the bores' lanes and
      // the roads joining them, off their tunnel stretches): those lie metres lower, on the cut's floor
      const deep = this.ways.filter((w) => w.stage || w.st.includes(ST_TUNNEL));
      const below = new Set(deep);
      for (const w of this.ways)
        if (deep.some((q) => this.sharesNode(w, q))) below.add(w);
      const near = new Map<number, Projection>();
      // (a spot belongs to the road it lies nearest to: a street spot beside a ramp in the cut is the street's)
      const inCut = (x: number, z: number, y: number) => {
        let best: [Way, Projection] | undefined;
        for (const [qi, p] of this.nearLines(x, z, 15, near)) {
          const q = this.ways[qi];
          if (Math.abs(p.t) > (p.t >= 0 ? q.sec.footL : q.sec.footR) + 1)
            continue;
          if (!best || Math.abs(p.t) < Math.abs(best[1].t))
            best = [q, { ...p }];
        }
        if (!best || !below.has(best[0])) return false;
        const [q, p] = best;
        const k = Math.min(q.al.n - 1, p.f < 0.5 ? p.i : p.i + 1);
        // (over a bore: its roof only above the land, as `surveyHeights` tells them apart)
        return q.st[k] !== ST_TUNNEL || y <= this.natural(x, z) + SPOT_ROOF;
      };
      // (and the spots just outside its rim: the streets running onto it, where its edge meets them)
      const nearRim = (x: number, z: number) => {
        const a = pl.area;
        for (let e = 0; e < a.length; e += 2) {
          const f = (e + 2) % a.length;
          const ex = a[f] - a[e];
          const ez = a[f + 1] - a[e + 1];
          const u = Math.max(
            0,
            Math.min(
              1,
              ((x - a[e]) * ex + (z - a[e + 1]) * ez) /
                (ex * ex + ez * ez || 1),
            ),
          );
          if (Math.hypot(a[e] + ex * u - x, a[e + 1] + ez * u - z) < PLAZA_RIM)
            return true;
        }
        return false;
      };
      const on: [number, number, number][] = [];
      for (let k = 0; k < spots.pts.length; k += 3) {
        const x = spots.pts[k];
        const z = spots.pts[k + 2];
        if (
          x < pl.minX - PLAZA_RIM ||
          x > pl.maxX + PLAZA_RIM ||
          z < pl.minZ - PLAZA_RIM ||
          z > pl.maxZ + PLAZA_RIM
        )
          continue;
        if (!inPolygon(pl.area, x, z) && !nearRim(x, z)) continue;
        if (inCut(x, z, spots.pts[k + 1])) continue;
        on.push([x, z, spots.pts[k + 1]]);
      }
      if (!on.length) continue;
      pl.spots = on;
      const level = (pl.level = (x: number, z: number) => {
        let a = 0;
        let ws = 0;
        for (const [px, pz, py] of on) {
          const wt = 1 / Math.max(1, (px - x) ** 2 + (pz - z) ** 2);
          a += py * wt;
          ws += wt;
        }
        return a / ws;
      });
      // the streets ending on its rim meet the paving at its surveyed level (v1: the plaza field is the survey, the
      // streets run onto it), not the land's line (`trimToPlazas` cuts them there; the same roads stay in the trench)
      for (const w of this.ways) {
        if (w.internal || below.has(w)) continue;
        const { n, x, z } = w.al;
        // (every place it crosses the rim: the last sample outside)
        for (let i = 0; i + 1 < n; i++) {
          const a = inPolygon(pl.area, x[i], z[i]);
          if (a === inPolygon(pl.area, x[i + 1], z[i + 1])) continue;
          const k = a ? i + 1 : i;
          const d: Dip = {
            w,
            s: w.al.s[k],
            y: level(x[k], z[k]),
            flat: 0,
            g: Math.min(0.06, w.tpl.maxGrade),
            mode: 'force',
          };
          shape(w.al, base[w.index], d.s, d.y, d.flat, d.g, d.mode);
          dips.push(d);
        }
      }
      for (const w of this.ways) {
        if (!w.st.includes(ST_TUNNEL)) continue;
        for (const [i0, i1] of runsOf(w.st, ST_TUNNEL)) {
          let y = Infinity;
          for (let i = i0; i <= i1; i++)
            if (inPolygon(pl.area, w.al.x[i], w.al.z[i]))
              y = Math.min(
                y,
                level(w.al.x[i], w.al.z[i]) - w.tpl.clearance - 0.4 - SLAB,
              );
          if (y === Infinity) continue;
          const d: Dip = {
            w,
            s: (w.al.s[i0] + w.al.s[i1]) / 2,
            y,
            flat: (w.al.s[i1] - w.al.s[i0]) / 2,
            g: w.stage ? w.tpl.maxGrade * 0.8 : Math.min(0.06, w.tpl.maxGrade),
            mode: 'down',
          };
          shape(w.al, base[w.index], d.s, d.y, d.flat, d.g, d.mode);
          dips.push(d);
          // its roof on the dipped floor, and under the plaza at the plaza's level (`trimToPlazas` does the same on
          // the final profile): the streets fitted onto it next meet the paving, not the land's line
          this.tunnelSlab(w, base[w.index]);
          const slab = w.slab!;
          for (let i = i0; i <= i1; i++)
            if (inPolygon(pl.area, w.al.x[i], w.al.z[i]))
              slab[i] = Math.max(
                base[w.index][i] + w.tpl.clearance + 0.4 + SLAB,
                Math.min(slab[i], level(w.al.x[i], w.al.z[i])),
              );
        }
      }
    }
  }

  /**
   * A bore under the stage road: its roof never stands above the stage where the stage crosses it (the land's line from
   * portal to portal can lie higher; a roof above the road is a block beside the lanes). Down to its own clearance line.
   */
  private stageRoof(
    w: Way,
    b: Float64Array,
    yOf: (u: Way) => Float64Array,
  ): void {
    let cap = Infinity;
    for (const c of this.crossings)
      if (c.lower === w && c.overSlab && c.upper.stage)
        cap = Math.min(cap, valueAt(c.upper.al, yOf(c.upper), c.sU));
    if (cap === Infinity) return;
    const slab = w.slab!;
    for (let i = 0; i < w.al.n; i++)
      if (w.st[i] === ST_TUNNEL)
        slab[i] = Math.min(
          slab[i],
          Math.max(cap, b[i] + w.tpl.clearance + 0.4 + SLAB),
        );
  }

  /** A tunnel's roof slab over floor profile `b`: the street level at the portals' rims, never below the roof. */
  private tunnelSlab(w: Way, b: Float64Array): void {
    w.slab = new Float64Array(w.al.n);
    for (const [i0, i1] of runsOf(w.st, ST_TUNNEL)) {
      const rim = (i: number) => {
        const k = Math.min(w.al.n - 1, Math.max(0, i));
        // (a portal under a survey plaza: its rim is the plaza's paving at its surveyed level)
        for (const pl of this.plazas)
          if (pl.level && inPolygon(pl.area, w.al.x[k], w.al.z[k]))
            return pl.level(w.al.x[k], w.al.z[k]);
        const off = Math.max(w.sec.footL, w.sec.footR) + 8;
        let best = -Infinity;
        for (const sg of [1, -1]) {
          const px = w.al.x[k] + w.al.tz[k] * off * sg;
          const pz = w.al.z[k] - w.al.tx[k] * off * sg;
          best = Math.max(best, this.natural(px, pz));
        }
        return best;
      };
      const r0 = rim(i0 - 4);
      const r1 = rim(i1 + 4);
      for (let i = i0; i <= i1; i++) {
        const f = (i - i0) / Math.max(1, i1 - i0);
        const roof = b[i] + w.tpl.clearance + 0.4 + SLAB;
        w.slab[i] = Math.max(roof, r0 + (r1 - r0) * f);
      }
    }
  }

  private profiles(pins: Map<number, number>): void {
    const base: Float64Array[] = [];
    // (each way's surveyed heights - lidar spots on its pavement or its deck's top - by sample, NaN where none)
    const seen: Float64Array[] = [];
    for (const w of this.ways) {
      const { n, x, z } = w.al;
      const raw = new Float64Array(n);
      const valid: boolean[] = [];
      for (let i = 0; i < n; i++) {
        raw[i] = this.natural(x[i], z[i]);
        // (the land over a bore - the street on its roof - is not its floor either: the floor joins the open ends)
        valid.push(w.st[i] !== ST_DECK && w.st[i] !== ST_TUNNEL);
      }
      // the land under the lower way's footprint at a crossing is not this way's ground either (the bare-earth DEM
      // has no bridges: an upper way sagged into the cut it spans)
      for (const c of this.crossings) {
        if (c.upper !== w) continue;
        const half =
          (Math.max(c.lower.sec.footL, c.lower.sec.footR) + 3) / c.sin;
        for (let i = 0; i < n; i++)
          if (Math.abs(w.al.s[i] - c.sU) < half) valid[i] = false;
      }
      // (a way's own decks: their lidar top, `network_survey.py` lidar deck spots, is the deck's height)
      const deck = valid.map((v, i) => !v && w.st[i] !== ST_TUNNEL);
      const got = new Float64Array(n).fill(NaN);
      this.surveyHeights(w, raw, valid, deck, got);
      seen.push(got);
      surveyGaps(w.al.s, raw, valid, got);
      fillInvalid(raw, valid);
      if (w.stage) this.debug.raw = raw.slice();
      // the designed profile: tangents + vertical curves fitted to the land within the class's tolerance
      const tol = w.tpl.tolerance ?? profileTol(w.tpl.rank);
      const design = (r: Float64Array, s: Float64Array) => {
        smooth1d(r, Math.max(1, 12 / STEP));
        return designProfile(
          r,
          s,
          tol,
          w.tpl.maxGrade,
          w.tpl.smoothing,
          w.tpl.smoothing / 6,
        );
      };
      // the stage road on its surveyed ground (lidar spot heights the whole way): the fitted tangents and vertical
      // curves hang below a crest and stand over a sag the survey has (Woodhaven Blvd deck: 0.8 m); the residual to the
      // survey, smoothed over RESIDUAL_WINDOW m, is added back
      const fit = (r: Float64Array, s: Float64Array) => {
        const src = r.slice();
        const out = design(r, s);
        if (!w.stage) return out;
        const d = new Float64Array(out.length);
        for (let k = 0; k < 2; k++) {
          for (let i = 0; i < d.length; i++) d[i] = src[i] - out[i];
          smooth1d(d, Math.max(1, RESIDUAL_WINDOW / STEP));
          for (let i = 0; i < d.length; i++) out[i] += d[i];
        }
        return gradeCap(out, s, w.tpl.maxGrade);
      };
      // the stage's run-out is a piece of its own from the route's end on: the fit is global (its PVIs follow the
      // ends), so the route before it - the Queens Blvd tunnel - keeps the profile it was designed with
      const m = w.stage ? this.runoutFrom : n;
      if (m < n - 1) {
        const main = fit(raw.slice(0, m + 1), w.al.s.slice(0, m + 1));
        const tail = fit(raw.slice(m), w.al.s.slice(m));
        const out = new Float64Array(n);
        out.set(main);
        // (the tail starts at the main piece's end height and eases into its own fit over RUNOUT_EASE m)
        const d0 = main[m] - tail[0];
        for (let k = 1; k < tail.length; k++)
          out[m + k] =
            tail[k] +
            d0 * (1 - smoothstep(0, RUNOUT_EASE, w.al.s[m + k] - w.al.s[m]));
        base.push(out);
      } else base.push(fit(raw, w.al.s));
    }
    // the stage road's other carriageway: the stage road's land profile at the same station
    for (const w of this.ways)
      if (w.corr) this.coupleTo(w, base[w.index], base[0]);
    // Tunnel slabs: the street level at the portals' rims, never below the roof.
    for (const w of this.ways)
      if (w.st.includes(ST_TUNNEL)) this.tunnelSlab(w, base[w.index]);
    // (where the survey measured the upper way's deck top, the structure stands as built: its own clearance over the
    // lower way's profile, never less than SURVEYED_CLEARANCE_MIN under the deck)
    const need = (c: Crossing) => {
      const t = c.lower.tpl.clearance + DECK_DEPTH + 0.2;
      const yu = nearestOf(c.upper.al, seen[c.upper.index], c.sU);
      if (
        !Number.isFinite(yu) ||
        c.upper.st[sampleAt(c.upper.al, c.sU)] !== ST_DECK
      )
        return t;
      const yl = valueAt(c.lower.al, base[c.lower.index], c.sL);
      return Math.min(
        t,
        Math.max(yu - yl - SURVEYED_SLACK, SURVEYED_CLEARANCE_MIN + DECK_DEPTH),
      );
    };
    // How far a way can rise / drop at `s` with its (pinned) ends held: the grade cone from each junction end.
    const reach = (w: Way, s: number) => {
      const g = w.tpl.maxGrade * 0.85;
      const n0 = this.nodes.get(w.nodes[0]);
      const n1 = this.nodes.get(w.nodes[1]);
      let r = Infinity;
      if (n0 && n0.kind !== 'end') r = Math.min(r, s * g);
      if (n1 && n1.kind !== 'end') r = Math.min(r, (w.al.length - s) * g);
      return r;
    };
    // Clearances at crossings on the land profiles: the upper way rises as far as its ends allow, the lower one dips
    // for the rest (the stage road too - it is never lifted for a street).
    const dips: Dip[] = [];
    // (bores dipped under the stage road: their roof slab is set again on the final profile)
    const stageSlabs = new Set<Way>();
    this.debug.base = base;
    this.debug.dips = dips;
    this.plazaDips(base, dips);
    // the stage road is never lifted for a street: a bore under it dips until its roof carries the stage, before any
    // other road is fitted onto that roof
    for (const c of this.crossings) {
      if (!c.overSlab || !c.upper.stage) continue;
      const U = c.upper;
      const L = c.lower;
      const d: Dip = {
        w: L,
        s: c.sL,
        y: valueAt(U.al, base[U.index], c.sU) - (L.tpl.clearance + 0.4 + SLAB),
        flat: (Math.max(U.sec.footL, U.sec.footR) + 4) / c.sin,
        g: Math.min(0.06, L.tpl.maxGrade),
        mode: 'down',
      };
      shape(L.al, base[L.index], d.s, d.y, d.flat, d.g, d.mode);
      this.tunnelSlab(L, base[L.index]);
      this.stageRoof(L, base[L.index], (U2) => base[U2.index]);
      dips.push(d);
      stageSlabs.add(L);
    }
    for (let pass = 0; pass < 2; pass++)
      for (const c of this.crossings) {
        const U = c.upper;
        const L = c.lower;
        const bu = base[U.index];
        const bl = base[L.index];
        const yu = valueAt(U.al, bu, c.sU);
        const yl = valueAt(L.al, bl, c.sL);
        if (c.overSlab && U.stage) continue;
        if (c.overSlab) {
          const slab = valueAt(L.al, L.slab!, c.sL);
          const flat = (Math.max(L.sec.footL, L.sec.footR) + 4) / c.sin;
          const d: Dip = {
            w: U,
            s: c.sU,
            y: slab,
            flat,
            g: U.tpl.maxGrade * 0.8,
            mode: 'force',
          };
          shape(U.al, bu, d.s, d.y, d.flat, d.g, d.mode);
          if (pass === 1) dips.push(d);
          continue;
        }
        const deficit = need(c) - (yu - yl);
        if (deficit <= 0) continue;
        const flatL = (Math.max(U.sec.footL, U.sec.footR) + 2) / c.sin;
        const flatU = (Math.max(L.sec.footL, L.sec.footR) + 3) / c.sin;
        let up = 0;
        if (!U.stage && (L.stage || L.tpl.rank > U.tpl.rank))
          up = Math.min(deficit, Math.max(0, reach(U, c.sU)));
        const down = deficit - up;
        if (up > 0) {
          const d: Dip = {
            w: U,
            s: c.sU,
            y: yu + up,
            flat: flatU,
            g: Math.min(0.06, U.tpl.maxGrade),
            mode: 'up',
          };
          shape(U.al, bu, d.s, d.y, d.flat, d.g, d.mode);
          dips.push(d);
        }
        if (down > 0) {
          const d: Dip = {
            w: L,
            s: c.sL,
            y: yl - down,
            flat: flatL,
            g: L.stage ? 0.035 : Math.min(0.06, L.tpl.maxGrade),
            mode: 'down',
          };
          shape(L.al, bl, d.s, d.y, d.flat, d.g, d.mode);
          dips.push(d);
        }
      }
    // The stage road's dips get vertical curves (smoothed, then held at the required depth again).
    // (only around them: the rest of the stage keeps its fit to the survey)
    {
      const b = base[0];
      const al = this.stage.al;
      const near = new Float64Array(al.n);
      for (const d of dips)
        if (d.w.stage)
          for (let i = 0; i < al.n; i++) {
            const e = Math.abs(al.s[i] - d.s) - d.flat;
            near[i] = Math.max(
              near[i],
              1 - smoothstep(DIP_CURVE_REACH * 0.5, DIP_CURVE_REACH, e),
            );
          }
      const eased = (r: number) => {
        const sm = b.slice();
        smooth1d(sm, r / STEP);
        for (let i = 0; i < al.n; i++) b[i] += (sm[i] - b[i]) * near[i];
        for (const d of dips)
          if (d.w.stage) shape(d.w.al, b, d.s, d.y, d.flat, d.g, d.mode);
      };
      eased(40);
      eased(16);
    }
    // Node heights, final profiles; crossings re-checked on the final profiles push the junction heights (a street
    // dipping under a deck takes the junction beside it down with it), a few rounds.
    const floor = new Map<number, number>();
    const ceil = new Map<number, number>();
    for (let round = 0; round < 6; round++) {
      this.nodeHeights(base, pins, floor, ceil);
      for (const w of this.ways) this.finalProfile(w, base[w.index]);
      for (const d of dips)
        if (!d.w.stage) shape(d.w.al, d.w.y, d.s, d.y, d.flat, d.g, d.mode);
      let moved = false;
      const limit = (
        w: Way,
        s: number,
        target: number,
        kind: 'floor' | 'ceil',
        g = w.tpl.maxGrade * 0.85,
        flat = 0,
      ) => {
        const ends: [number, number][] = [
          [w.nodes[0], Math.max(0, s - flat)],
          [w.nodes[1], Math.max(0, w.al.length - s - flat)],
        ];
        for (const [nid, dist] of ends) {
          const node = this.nodes.get(nid);
          if (
            !node ||
            node.kind === 'end' ||
            node.kind === 'stage' ||
            pins.has(nid)
          )
            continue;
          if (kind === 'ceil') {
            const v = target + g * dist;
            if (v < (ceil.get(nid) ?? Infinity) - 0.05) {
              ceil.set(nid, v);
              moved = true;
            }
          } else {
            const v = target - g * dist;
            if (v > (floor.get(nid) ?? -Infinity) + 0.05) {
              floor.set(nid, v);
              moved = true;
            }
          }
        }
      };
      // a street's dip ramp holds its junction ends too (the ramp is steeper than the land: a node left above it
      // would meet the dipped arm metres lower than the others)
      for (const d of dips)
        if (!d.w.stage && d.mode !== 'force')
          limit(
            d.w,
            d.s,
            d.y,
            d.mode === 'down' ? 'ceil' : 'floor',
            d.g,
            d.flat,
          );
      for (const c of this.crossings) {
        const U = c.upper;
        const L = c.lower;
        const yu = valueAt(U.al, U.y, c.sU);
        const yl = valueAt(L.al, L.y, c.sL);
        if (c.overSlab && U.stage) {
          // (the bore's roof under the stage road's final profile)
          const y = yu - (L.tpl.clearance + 0.4 + SLAB);
          if (yl > y + 0.05) {
            dips.push({
              w: L,
              s: c.sL,
              y,
              flat: (Math.max(U.sec.footL, U.sec.footR) + 4) / c.sin,
              g: Math.min(0.06, L.tpl.maxGrade),
              mode: 'down',
            });
            limit(L, c.sL, y, 'ceil');
            moved = true;
          }
          continue;
        }
        if (c.overSlab) {
          const slab = valueAt(L.al, L.slab!, c.sL);
          if (Math.abs(yu - slab) > 0.3) {
            limit(U, c.sU, slab, 'floor');
            limit(U, c.sU, slab, 'ceil');
          }
          continue;
        }
        if (yu - yl >= need(c) - 0.05) continue;
        const deficit = need(c) - (yu - yl);
        if (!L.stage) {
          // the lower way dips deeper (its land profile was set before the junctions moved the upper one) and its
          // junctions follow; the upper way's junctions are kept from pulling it down
          const flat = (Math.max(U.sec.footL, U.sec.footR) + 2) / c.sin;
          dips.push({
            w: L,
            s: c.sL,
            y: yl - deficit,
            flat,
            g: Math.min(0.06, L.tpl.maxGrade),
            mode: 'down',
          });
          limit(L, c.sL, yl - deficit, 'ceil');
          if (!U.stage) limit(U, c.sU, yu, 'floor');
          moved = true;
        } else limit(U, c.sU, yl + need(c), 'floor');
      }
      if (!moved) break;
    }
    for (const w of stageSlabs) {
      this.tunnelSlab(w, w.y);
      this.stageRoof(w, w.y, (U2) => U2.y);
    }
  }

  /** Junction / joint heights: the dominant arms' land height there, kept within the crossing limits and pins. */
  private nodeHeights(
    base: Float64Array[],
    pins: Map<number, number>,
    floor: Map<number, number>,
    ceil: Map<number, number>,
  ): void {
    const stage = this.stage;
    // (nodes on the stage road's profile: the stage's own and its other carriageway's)
    const onStage = new Set<NetNode>();
    for (const node of this.nodes.values()) {
      if (!node.ends.length) continue;
      if (pins.has(node.id)) {
        node.h = pins.get(node.id)!;
        continue;
      }
      if (node.kind === 'stage') {
        node.h = valueAt(stage.al, base[0], node.stage);
        continue;
      }
      if (this.stageRunOn.has(node.id)) {
        node.h = valueAt(stage.al, base[0], stage.al.length);
        continue;
      }
      let rank = -1;
      for (const e of node.ends) rank = Math.max(rank, e.way.tpl.rank);
      let sum = 0;
      let cnt = 0;
      let corrSt = NaN;
      for (const e of node.ends) {
        if (e.way.tpl.rank !== rank) continue;
        const b = base[e.way.index];
        sum += e.atEnd ? b[b.length - 1] : b[0];
        cnt++;
        // (the station of its end sample, or of one just before it: the end itself can fall past the corridor's line)
        const corr = e.way.corr;
        if (corr)
          for (let k = 0; k < CORR_END_LOOK && Number.isNaN(corrSt); k++) {
            const c = corr[e.atEnd ? b.length - 1 - k : k];
            if (c !== undefined && !Number.isNaN(c)) corrSt = c;
          }
      }
      node.h = cnt ? sum / cnt : 0;
      // a node of the stage road's other carriageway sits on the stage road's profile at that station
      if (!Number.isNaN(corrSt)) {
        node.h = valueAt(stage.al, base[0], corrSt);
        onStage.add(node);
      }
      const f = floor.get(node.id);
      const c = ceil.get(node.id);
      if (f !== undefined) node.h = Math.max(node.h, f);
      if (c !== undefined) node.h = Math.min(node.h, c);
    }
    // Neighbouring nodes on a short edge: never steeper between them than the way allows (two junctions 6 m apart got
    // their heights from different arms and stood a metre apart).
    const held = (n: NetNode) =>
      n.kind === 'stage' ||
      onStage.has(n) ||
      pins.has(n.id) ||
      floor.has(n.id) ||
      ceil.has(n.id);
    for (let pass = 0; pass < 6; pass++)
      for (const w of this.ways) {
        if (w.stage) continue;
        const a = this.nodes.get(w.nodes[0]);
        const b = this.nodes.get(w.nodes[1]);
        if (!a || !b || a === b || a.kind === 'end' || b.kind === 'end')
          continue;
        const lim =
          w.tpl.maxGrade *
          0.8 *
          Math.max(1, w.al.length - (w.cut0 + w.cut1) * 0.5);
        const d = b.h - a.h;
        if (Math.abs(d) <= lim) continue;
        const fix = (Math.abs(d) - lim) * Math.sign(d);
        const aFixed = held(a);
        const bFixed = held(b);
        if (aFixed && !bFixed) b.h -= fix;
        else if (bFixed && !aFixed) a.h += fix;
        else if (!aFixed) {
          a.h += fix / 2;
          b.h -= fix / 2;
        }
      }
  }

  /** A way's height line: its land profile eased to its end nodes' heights, grade-limited with the ends held. */
  private finalProfile(w: Way, b: Float64Array): void {
    if (w.stage) {
      w.y.set(b);
      return;
    }
    const n0 = this.nodes.get(w.nodes[0]);
    const n1 = this.nodes.get(w.nodes[1]);
    const L = w.al.length;
    const d0 = n0 && n0.kind !== 'end' ? n0.h - b[0] : 0;
    const d1 = n1 && n1.kind !== 'end' ? n1.h - b[b.length - 1] : 0;
    const g = w.tpl.maxGrade * 0.6;
    const e0 = Math.min(L, Math.max(20, Math.abs(d0) / g));
    const e1 = Math.min(L, Math.max(20, Math.abs(d1) / g));
    for (let i = 0; i < w.al.n; i++) {
      const s = w.al.s[i];
      const w0 = 1 - smoothstep(0, e0, s);
      const w1 = smoothstep(L - e1, L, s);
      const sum = w0 + w1;
      const k = sum > 1 ? 1 / sum : 1;
      w.y[i] = b[i] + (d0 * w0 + d1 * w1) * k;
    }
    pinnedGrade(
      w.y,
      w.al.s,
      w.tpl.maxGrade * 1.05,
      !!n0 && n0.kind !== 'end',
      !!n1 && n1.kind !== 'end',
    );
  }

  private crossSlopes(): void {
    for (const w of this.ways) {
      const { n, k, s } = w.al;
      const L = w.al.length;
      const a = w.a;
      const c = w.c;
      const flatNear = (sv: number) => {
        // flat into junctions / joints: crossfall fades out over the last 18 m before the junction polygon
        const n0 = this.nodes.get(w.nodes[0]);
        const n1 = this.nodes.get(w.nodes[1]);
        let f = 1;
        if (n0 && (n0.kind === 'junction' || n0.kind === 'joint'))
          f = Math.min(f, smoothstep(w.cut0, w.cut0 + 18, sv));
        if (n1 && (n1.kind === 'junction' || n1.kind === 'joint'))
          f = Math.min(f, smoothstep(w.cut1, w.cut1 + 18, L - sv));
        return f;
      };
      if (!w.sec.oneway) {
        for (let i = 0; i < n; i++) c[i] = 0.02 * flatNear(s[i]);
        continue;
      }
      const bank = w.tpl.bank;
      for (let i = 0; i < n; i++) {
        let v = 0.015;
        if (bank > 0) {
          const e = Math.min(bank, Math.abs(k[i]) * 3.5);
          if (k[i] > 0) v = e > 0.015 ? -e : 0.015 - e * 2;
          else v = Math.max(0.015, e);
        }
        a[i] = v;
      }
      smooth1d(a, Math.max(1, 30 / STEP));
      for (let i = 0; i < n; i++) a[i] *= flatNear(s[i]);
    }
  }

  // --- walls ------------------------------------------------------------------------------------------------------------

  /** Section surface height of way `w` at sample i (+ fraction f) and lateral t (+ left), clamped to the section. */
  surfaceAt(w: Way, i: number, f: number, t: number): number {
    const y = w.y[i] + (w.y[i + 1 < w.al.n ? i + 1 : i] - w.y[i]) * f;
    const a = w.a[i] + (w.a[i + 1 < w.al.n ? i + 1 : i] - w.a[i]) * f;
    const c = w.c[i] + (w.c[i + 1 < w.al.n ? i + 1 : i] - w.c[i]) * f;
    const sec = w.sec;
    const left = t >= 0;
    const pave = left ? sec.paveL : sec.paveR;
    const u = Math.abs(t);
    // cross slope and crown over WORLD metres (a narrowed stage pavement keeps its slopes)
    const kk = w.k ? scaleAt(w, i, f) : 1;
    const pav = (uu: number) => y + (a * (left ? uu : -uu) - c * uu) * kk;
    if (u <= pave) return pav(u);
    const base = pav(pave);
    let acc = pave;
    let h = base;
    for (const e of left ? sec.left : sec.right) {
      const into = Math.min(e.w, u - acc);
      h = base + e.rise + (e.kind === 'sidewalk' ? 0.015 * into : 0);
      if (u <= acc + e.w) return h;
      acc += e.w;
    }
    return h;
  }

  private wallsOf(
    w: Way,
    surfaceAt: (
      x: number,
      z: number,
      self: Way,
      ref: number,
    ) => number | undefined,
    onRoad: (x: number, z: number, y: number, self: Way) => Way | undefined,
    land: (x: number, z: number, self: Way) => number,
  ): void {
    if (w.internal) return;
    const dl = w.tpl.daylight;
    const { n, x, z, tx, tz, s } = w.al;
    const L = w.al.length;
    for (const side of [0, 1] as const) {
      const sg = side === 0 ? 1 : -1;
      const foot = side === 0 ? w.sec.footL : w.sec.footR;
      const type = w.wall[side];
      const top = w.wallTop[side];
      const banned = new Uint8Array(n);
      // samples where the survey has no wall but the cut is too tall for a bank (SURVEY_GAP)
      const gap = new Uint8Array(n);
      // under another way's deck: the underpass wall, up to the deck's soffit over its line (v1 portals.ts
      // `laneWalls`: the abutment faces run along the road beneath, the deck rests on them; never through a skewed
      // deck) - only where this side's wall line runs under the deck: at a skew the deck covers the two sides at
      // different stations, the open stretch of each keeps its own wall
      const underDeck = new Uint8Array(n);
      const soffit = new Float64Array(n).fill(Infinity);
      const near = new Map<number, Projection>();
      // (a deck over the next way of the same road - the carriageway split at a joint node under the deck - covers this
      // way's end too: the crossing names only the way it was found on)
      const joined = (q: Way) =>
        q.nodes.some(
          (id) =>
            id >= 0 &&
            w.nodes.includes(id) &&
            this.nodes.get(id)?.kind === 'joint',
        );
      for (const c of this.crossings) {
        if (c.overSlab || (c.lower !== w && !joined(c.lower))) continue;
        const up = c.upper;
        const half =
          (Math.max(up.sec.footL, up.sec.footR) + 1) / Math.max(c.sin, 0.2);
        for (let i = 0; i < n; i++) {
          if (
            c.lower === w
              ? Math.abs(s[i] - c.sL) >= half
              : Math.hypot(x[i] - c.x, z[i] - c.z) >= half
          )
            continue;
          const lw = worldT(w, i, 0, (foot + wallOff(w, i, side)) * sg);
          const p = this.nearLines(
            x[i] + tz[i] * lw,
            z[i] - tx[i] * lw,
            Math.max(up.sec.footL, up.sec.footR) + 4,
            near,
            (q) => q !== up,
          ).get(up.index);
          if (!p) continue;
          const upFoot = p.t >= 0 ? up.sec.footL : up.sec.footR;
          if (Math.abs(p.t) <= upFoot + 1) underDeck[i] = 1;
        }
      }
      // the soffit over each wall point under a deck: the lowest deck over it, whichever way carries it; a deck running
      // alongside over it (a viaduct, on piers) takes the wall away
      for (let i = 0; i < n; i++) {
        if (!underDeck[i]) continue;
        const lw = worldT(w, i, 0, (foot + wallOff(w, i, side)) * sg);
        const px = x[i] + tz[i] * lw;
        const pz = z[i] - tx[i] * lw;
        for (const [qi, p] of this.nearLines(
          px,
          pz,
          30,
          near,
          (q) => q === w,
        )) {
          const q = this.ways[qi];
          const k = Math.min(q.al.n - 1, p.f < 0.5 ? p.i : p.i + 1);
          const qFoot = p.t >= 0 ? q.sec.footL : q.sec.footR;
          if (q.st[k] !== ST_DECK || Math.abs(p.t) > qFoot + 1) continue;
          const h =
            this.surfaceAt(
              q,
              p.i,
              p.f,
              Math.sign(p.t) * Math.min(Math.abs(p.t), qFoot),
            ) - DECK_DEPTH;
          if (h < this.surfaceAt(w, i, 0, 0)) continue;
          const sin = Math.abs(tx[i] * q.al.tz[k] - tz[i] * q.al.tx[k]);
          // (near the deck's end it rests on this wall, however it curves in over the line - a street deck turning
          // along the rim at its abutment, not a viaduct)
          let a = k;
          let b = k;
          while (a > 0 && q.st[a - 1] === ST_DECK) a--;
          while (b < q.al.n - 1 && q.st[b + 1] === ST_DECK) b++;
          const atEnd =
            Math.min(q.al.s[k] - q.al.s[a], q.al.s[b] - q.al.s[k]) <
            DECK_END_REST;
          soffit[i] =
            sin < UNDERPASS_SIN && !atEnd ? -Infinity : Math.min(soffit[i], h);
          if (soffit[i] === -Infinity) break;
        }
      }
      // the land behind the wall is another road (a street at the rim of the cut): the wall carries its edge, no parapet
      const carried = w.wallCarried[side];
      carried.fill(0);
      // (at a joint the same road runs on in the next way: its wall runs on to the node, no gap between the two)
      const joint0 = this.nodes.get(w.nodes[0])?.kind === 'joint' && !w.merge0;
      const joint1 = this.nodes.get(w.nodes[1])?.kind === 'joint' && !w.merge1;
      for (let i = 0; i < n; i++) {
        type[i] = WALL_NONE;
        if (w.st[i] === ST_DECK) continue;
        if (
          (!joint0 && s[i] < w.cut0 + 1) ||
          (!joint1 && s[i] > L - w.cut1 - 1)
        )
          continue;
        if ((w.merge0 && s[i] < 40) || (w.merge1 && L - s[i] < 40)) continue;
        const E = this.surfaceAt(w, i, 0, sg * foot);
        // a wall never stands on or beside another road at its level (a carriageway alongside, a ramp, a street
        // running into the side of it): they are one platform - except in a tunnel, where a lane runs in its own
        // bore: the lower-ranked roadway builds a lane wall towards the higher one (the two carriageways of the
        // stage road share a barrier, not a wall)
        let other: Way | undefined;
        for (const p of PLATFORM_PROBES) {
          const l = foot + wallOff(w, i, side) + p;
          const lw = worldT(w, i, 0, l * sg);
          other = onRoad(x[i] + tz[i] * lw, z[i] - tx[i] * lw, E, w);
          if (other) break;
        }
        if (w.st[i] === ST_TUNNEL) {
          if (other) {
            const laneWall =
              other.tpl.rank > w.tpl.rank &&
              !(w.corr && other.stage) &&
              !(w.stage && other.corr);
            if (!laneWall) {
              banned[i] = 1;
              continue;
            }
            w.wallLane[side][i] = 1;
          }
          type[i] = WALL_CUT;
          top[i] = w.slab![i];
          continue;
        }
        if (
          !other &&
          Number.isFinite(soffit[i]) &&
          soffit[i] > E + UNDERPASS_MIN
        ) {
          type[i] = WALL_CUT;
          top[i] = soffit[i];
          // (the deck's edge rests on it: no fence or parapet on top)
          carried[i] = 1;
          continue;
        }
        if (other && !underDeck[i] && this.unrelated(w, other, i))
          this.divides.push([w, side, i, other]);
        if (other || underDeck[i]) {
          banned[i] = 1;
          continue;
        }
        // (the land probes every other sample: the odd ones follow their neighbours below)
        if (i % 2 === 1 && i < n - 1) continue;
        let hi = -Infinity;
        let lo = Infinity;
        // (the wall's height: the land right behind it - land rising further back is a bank above the coping)
        let nearTop = -Infinity;
        for (const p of PROBES) {
          const l = foot + wallOff(w, i, side) + p;
          const lw = worldT(w, i, 0, l * sg);
          const px = x[i] + tz[i] * lw;
          const pz = z[i] - tx[i] * lw;
          const other = surfaceAt(px, pz, w, E);
          // the land as the other roads shape it (a street's embankment beside a sunken lane is a cut to hold)
          const h = other ?? land(px, pz, w);
          hi = Math.max(hi, h);
          lo = Math.min(lo, h);
          if (p <= NEAR_PROBE) nearTop = Math.max(nearTop, h);
          if (other !== undefined) {
            if (p === PROBES[0]) carried[i] = 1;
            break;
          }
        }
        const cut = hi - E;
        const fill = E - lo;
        if (this.surveyedWall(w, i, side) === false) {
          if (cut <= 2 * dl.maxCut) continue;
          gap[i] = 1;
        }
        if (cut > (carried[i] ? ROAD_STEP : dl.maxCut)) {
          type[i] = WALL_CUT;
          top[i] = Number.isFinite(nearTop) ? nearTop : hi;
        } else if (fill > dl.maxFill) {
          type[i] = WALL_FILL;
          top[i] = E + 1.0;
        }
      }
      // (survey gaps: kept only where short, between two walls - a joint end counts as the next way's wall)
      for (let i = 1; i < n - 1; i += 2)
        if (gap[i - 1] && gap[i + 1]) gap[i] = 1;
      for (const [a, b] of runsOf(gap, 1)) {
        // (the odd samples are not decided yet: the next even one beyond the gap)
        const wallAt = (k: number, dir: number, joint: boolean) => {
          if (k >= 0 && k < n && type[k] === WALL_NONE && !gap[k]) k += dir;
          return k < 0 || k >= n ? joint : type[k] === WALL_CUT && !gap[k];
        };
        const keep =
          s[b] - s[a] < SURVEY_GAP &&
          wallAt(a - 1, -1, joint0) &&
          wallAt(b + 1, 1, joint1);
        if (!keep) for (let i = a; i <= b; i++) type[i] = WALL_NONE;
      }
      for (let i = 1; i < n - 1; i += 2) {
        if (type[i - 1] === type[i + 1]) {
          type[i] = type[i - 1];
          top[i] = (top[i - 1] + top[i + 1]) / 2;
        }
        if (carried[i - 1] && carried[i + 1]) carried[i] = 1;
        if (w.wallLane[side][i - 1] || w.wallLane[side][i + 1])
          w.wallLane[side][i] = 1;
      }
      cleanRuns(type, 6, 4);
      for (let i = 0; i < n; i++) if (banned[i]) type[i] = WALL_NONE;
      cleanRuns(type, 0, 4);
      for (let i = 0; i < n; i++) if (banned[i]) type[i] = WALL_NONE;
      // a fill wall ending a few metres short of a deck on this side runs on to the deck's end: the parapet and the
      // wall are one face, never two with a grass slope between them
      // (never over a road passing beneath: the deck's span, however short OSM tags it)
      const join = Math.round(WALL_DECK_JOIN / STEP);
      const overLower = new Uint8Array(n);
      for (const c of this.crossings) {
        if (c.upper !== w || c.overSlab) continue;
        const half =
          (Math.max(c.lower.sec.footL, c.lower.sec.footR) + 3) /
          Math.max(c.sin, 0.2);
        for (let i = 0; i < n; i++)
          if (Math.abs(s[i] - c.sU) < half) overLower[i] = 1;
      }
      for (const [i0, i1] of runsOf(type, WALL_FILL))
        for (const dir of [-1, 1]) {
          let k = dir < 0 ? i0 - 1 : i1 + 1;
          let steps = 0;
          while (
            k > 0 &&
            k < n - 1 &&
            steps <= join &&
            type[k] === WALL_NONE &&
            !banned[k] &&
            !overLower[k] &&
            w.st[k] !== ST_DECK
          ) {
            k += dir;
            steps++;
          }
          if (steps === 0 || steps > join || w.st[k] !== ST_DECK) continue;
          for (let j = dir < 0 ? i0 - 1 : i1 + 1; j !== k; j += dir)
            type[j] = WALL_FILL;
        }
      // wall tops: smoothed along the run
      const tmp = new Float64Array(top);
      for (const [i0, i1] of [
        ...runsOf(type, WALL_CUT),
        ...runsOf(type, WALL_FILL),
      ]) {
        for (let i = i0; i <= i1; i++) {
          let acc = 0;
          let cnt = 0;
          for (let k = Math.max(i0, i - 3); k <= Math.min(i1, i + 3); k++) {
            if (Number.isFinite(tmp[k]) && tmp[k] !== 0) {
              acc += tmp[k];
              cnt++;
            }
          }
          if (cnt) top[i] = acc / cnt;
          const E = this.surfaceAt(w, i, 0, sg * foot);
          // a cut wall stands a parapet above the land it holds (it hides the land's edge from the road below)
          if (w.st[i] === ST_TUNNEL && w.slab) top[i] = w.slab[i];
          else if (type[i] === WALL_CUT) {
            top[i] = Math.max(
              top[i] + (carried[i] ? -0.15 : WALL_PARAPET),
              E + 0.6,
            );
            // a lower wall where the map says so (the land above it is a bank, field.ts)
            if (!carried[i]) top[i] = Math.min(top[i], E + this.wallMax(w, i));
          } else top[i] = E + 1.0;
        }
      }
      // a cut wall ending on open land steps down to its least height towards that end (a wing, not a box standing
      // proud of the land beside its end); not where it runs on into a tunnel, a fill wall or the way's own end
      for (const [i0, i1] of runsOf(type, WALL_CUT)) {
        const open = (k: number) =>
          k > 0 &&
          k < n - 1 &&
          type[k] === WALL_NONE &&
          w.st[k] !== ST_TUNNEL &&
          // (the way's own end: no wall stands there by rule, the run is not open)
          s[k] > w.cut0 + 1.5 &&
          s[k] < L - w.cut1 - 1.5;
        const end0 = open(i0 - 1);
        const end1 = open(i1 + 1);
        if (!end0 && !end1) continue;
        for (let i = i0; i <= i1; i++) {
          if (w.st[i] === ST_TUNNEL || carried[i]) continue;
          const along = Math.min(
            end0 ? s[i] - s[i0] : Infinity,
            end1 ? s[i1] - s[i] : Infinity,
          );
          const E = this.surfaceAt(w, i, 0, sg * foot);
          top[i] = Math.min(top[i], E + 0.6 + along * WALL_END_SLOPE);
        }
      }
      // (an underpass wall meets the soffit: none of the smoothing / parapet / end steps above apply to it)
      for (let i = 0; i < n; i++)
        if (
          type[i] === WALL_CUT &&
          w.st[i] !== ST_TUNNEL &&
          Number.isFinite(soffit[i])
        )
          top[i] = soffit[i];
      // beside the abutment the wall steps down from the soffit along the road as a wing (drive videos: the wing's top
      // slopes away from the deck), never a block standing up on the wall at the deck's edge
      const isSeat = (k: number) =>
        type[k] === WALL_CUT &&
        w.st[k] !== ST_TUNNEL &&
        Number.isFinite(soffit[k]);
      for (let i = 0; i < n; i++) {
        if (!isSeat(i)) continue;
        for (const dir of [-1, 1]) {
          if (isSeat(i + dir)) continue;
          for (
            let k = i + dir;
            k >= 0 && k < n && type[k] === WALL_CUT && w.st[k] !== ST_TUNNEL;
            k += dir
          ) {
            const h = top[i] - Math.abs(s[k] - s[i]) * WALL_END_SLOPE;
            if (h <= top[k]) break;
            top[k] = h;
          }
        }
      }
      // no cut wall rises over a road above its line (a street's embankment edge, the end of a deck's fill): its top
      // stays under that road's pavement, or under its soffit on a deck, and carries no fence
      const boreKept = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        if (type[i] !== WALL_CUT || w.st[i] === ST_TUNNEL) continue;
        const lw = worldT(w, i, 0, (foot + wallOff(w, i, side)) * sg);
        const E = this.surfaceAt(w, i, 0, sg * foot);
        for (const [qi, p] of this.nearLines(
          x[i] + tz[i] * lw,
          z[i] - tx[i] * lw,
          30,
          near,
          (q) => q === w || q.internal,
        )) {
          const q = this.ways[qi];
          const qFoot = p.t >= 0 ? q.sec.footL : q.sec.footR;
          if (Math.abs(p.t) > qFoot + 1) continue;
          // (a point past that road's end - its projection clamped to the end - is not behind the face: a ramp ending
          // short of the wall, 7 445-7 455 left)
          if (p.d > Math.abs(p.t) + PAST_END) continue;
          const h = this.surfaceAt(
            q,
            p.i,
            p.f,
            Math.sign(p.t) * Math.min(Math.abs(p.t), qFoot),
          );
          if (h < E + ROAD_STEP) {
            // (a road at its level or below right behind the face: the land there is that road, no cut to hold -
            // except the bore this street leads into: a street's portal cut keeps its walls beside its own tunnel)
            const kq = Math.min(q.al.n - 1, p.f < 0.5 ? p.i : p.i + 1);
            // (beyond that road's end - the same road running on from a joint - it is not behind the face)
            if (
              Math.abs(p.t) <= qFoot + WALL_ROAD_BACK &&
              p.d <= qFoot + WALL_ROAD_BACK &&
              h < top[i]
            ) {
              if (q.st[kq] === ST_TUNNEL && this.sharesNode(w, q))
                boreKept[i] = 1;
              else type[i] = WALL_NONE;
            }
            continue;
          }
          // (a road above its line: one at least ROAD_STEP over its pavement, a step wall's upper road too)
          // (a fence on top would reach that road: none)
          if (h < top[i] + WALL_FENCE_CLEAR) carried[i] = 1;
          if (Math.abs(p.t) > qFoot + WALL_ROAD_BACK) continue;
          const k = Math.min(q.al.n - 1, p.f < 0.5 ? p.i : p.i + 1);
          const cap =
            q.st[k] === ST_DECK ? h - DECK_DEPTH : h - WALL_UNDER_ROAD;
          if (cap >= top[i]) continue;
          top[i] = cap;
          // (it carries that road's edge: no fence on top)
          carried[i] = 1;
        }
      }
      for (const [i0, i1] of runsOf(boreKept, 1))
        this.portalRuns.push([w, side, i0, i1]);
    }
  }
}

/**
 * Grade limit that keeps both end heights: every sample stays inside the cone the ends allow at `grade` (where the ends
 * are too far apart for it, a straight line), then a light smoothing keeps the corners round.
 */
function pinnedGrade(
  y: Float64Array,
  s: Float64Array,
  grade: number,
  pin0: boolean,
  pin1: boolean,
): void {
  const n = y.length;
  if (n < 3) return;
  const L = s[n - 1];
  const y0 = y[0];
  const y1 = y[n - 1];
  if (pin0 && pin1 && Math.abs(y1 - y0) > grade * L) {
    for (let i = 0; i < n; i++) y[i] = y0 + ((y1 - y0) * s[i]) / L;
    return;
  }
  for (let i = 0; i < n; i++) {
    let hi = Infinity;
    let lo = -Infinity;
    if (pin0) {
      hi = Math.min(hi, y0 + grade * s[i]);
      lo = Math.max(lo, y0 - grade * s[i]);
    }
    if (pin1) {
      hi = Math.min(hi, y1 + grade * (L - s[i]));
      lo = Math.max(lo, y1 - grade * (L - s[i]));
    }
    y[i] = Math.min(hi, Math.max(lo, y[i]));
  }
  // local grade (the ends stay: the cone keeps them reachable)
  const step = s[1] - s[0] || 1;
  const keep0 = y[0];
  const keep1 = y[n - 1];
  limitGrade(y, step, grade);
  if (pin0) y[0] = keep0;
  if (pin1) y[n - 1] = keep1;
  const tmp = Float64Array.from(y);
  smooth1d(tmp, Math.max(1, 8 / step));
  for (let i = 1; i < n - 1; i++) {
    const f = Math.min(1, Math.min(pin0 ? s[i] : 99, pin1 ? L - s[i] : 99) / 6);
    y[i] = y[i] + (tmp[i] - y[i]) * f;
  }
}

/** Linear fill of invalid samples between valid neighbours (median of 3 at each side). */
function fillInvalid(a: Float64Array, valid: boolean[]): void {
  const n = a.length;
  if (!valid.some((v) => v)) return;
  let i = 0;
  while (i < n) {
    if (valid[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && !valid[j]) j++;
    const left = i > 0 ? a[i - 1] : j < n ? a[j] : 0;
    const right = j < n ? a[j] : left;
    for (let k = i; k < j; k++) {
      const f = (k - i + 1) / (j - i + 1);
      a[k] = left + (right - left) * f;
    }
    i = j;
  }
}

/** Runs [i0, i1] of samples with value v. */
export function runsOf(a: ArrayLike<number>, v: number): [number, number][] {
  const out: [number, number][] = [];
  let i0 = -1;
  for (let i = 0; i <= a.length; i++) {
    const on = i < a.length && a[i] === v;
    if (on && i0 < 0) i0 = i;
    if (!on && i0 >= 0) {
      out.push([i0, i - 1]);
      i0 = -1;
    }
  }
  return out;
}

/** Close gaps of up to `gap` samples inside runs of the same value, then drop runs shorter than `min` samples. */
function cleanRuns(a: Uint8Array, gap: number, min: number): void {
  for (const v of [WALL_CUT, WALL_FILL]) {
    const runs = runsOf(a, v);
    for (let k = 0; k + 1 < runs.length; k++) {
      const g0 = runs[k][1] + 1;
      const g1 = runs[k + 1][0] - 1;
      if (g1 - g0 + 1 <= gap) for (let i = g0; i <= g1; i++) a[i] = v;
    }
  }
  for (const v of [WALL_CUT, WALL_FILL])
    for (const [i0, i1] of runsOf(a, v))
      if (i1 - i0 + 1 < min) for (let i = i0; i <= i1; i++) a[i] = WALL_NONE;
}

/**
 * Pull a profile towards `target` around `s0`: flat over +-flat, then a ramp at `grade` back to the profile.
 * 'down' = never above the ramp (a dip), 'up' = never below (a hump), 'force' = clamped to the ramp both ways.
 */
function shape(
  al: Alignment,
  ys: Float64Array,
  s0: number,
  target: number,
  flat: number,
  grade: number,
  mode: 'down' | 'up' | 'force',
): void {
  for (let i = 0; i < al.n; i++) {
    const d = Math.max(0, Math.abs(al.s[i] - s0) - flat);
    const ramp = d * grade;
    if (mode === 'down') ys[i] = Math.min(ys[i], target + ramp);
    else if (mode === 'up') ys[i] = Math.max(ys[i], target - ramp);
    else ys[i] = Math.min(Math.max(ys[i], target - ramp), target + ramp);
  }
}

/** Lateral distance where a fill wall's bed starts: the pavement edge, or the back of its kerb. */
export function fillBedFrom(w: Way, left: boolean): number {
  const els = left ? w.sec.left : w.sec.right;
  return (
    (left ? w.sec.paveL : w.sec.paveR) +
    (els[0]?.kind === 'kerb' ? els[0].w : 0)
  );
}
