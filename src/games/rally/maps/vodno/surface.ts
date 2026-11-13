import type { RoadDef, RoadMarking } from '../shared/types';
import { WIDE_FROM, WIDE_TO } from './crossroad';

/**
 * The road's surfaces (as on the real road): old tarmac from the start to the lay-by before the big hairpin -
 * cracked, patched, its edge lines worn - then the re-laid road in dark asphalt with crisp lines (a paler lay above the
 * joint past the hairpin), then the old tarmac again from the joint before the finish junction, unlined and broken up. Visual only: the grip
 * is the same (`surface` stays tarmac).
 */
export const NEW_FROM = 1890;
/** The joint between the two newer lays, on the straight past the big hairpin. */
export const NEW_JOINT = 2136;
export const NEW_TO = 4276;

export const SURFACE_SECTIONS: NonNullable<RoadDef['sections']> = [
  // (the first crossroad: every line is paint, `MARKINGS`)
  { from: WIDE_FROM, surface: 'tarmac', texture: 'road_tarmac_plain' },
  { from: WIDE_TO, surface: 'tarmac', texture: 'road_tarmac_lines' },
  { from: NEW_FROM, surface: 'tarmac', texture: 'road_tarmac_new' },
  // (above the joint past the big hairpin the newer lay is a paler grey)
  {
    from: NEW_JOINT,
    surface: 'tarmac',
    texture: 'road_tarmac_new',
    tone: 1.22,
  },
  // (past the joint before the finish junction: the old road again, broken up, no lines)
  { from: NEW_TO, surface: 'tarmac', texture: 'road_tarmac_plain' },
];

/** Half the road's width on the hill (m): the centre line is this far in from either edge. */
const HALF = 2.9;
const pale = (
  from: number,
  to: number,
  edge: 'left' | 'right',
  offset: number,
  width: number,
  dim = false,
): RoadMarking => ({ kind: 'patch', from, to, edge, offset, width, dim });
/** A filled pothole: a small dark patch. */
const fill = (
  at: number,
  edge: 'left' | 'right',
  offset: number,
  size: number,
): RoadMarking => ({
  kind: 'patch',
  from: at,
  to: at + size * 1.3,
  edge,
  offset,
  width: size,
  dark: true,
});

/** A field of alligator cracks (the old road's broken lanes). */
const cracks = (
  from: number,
  to: number,
  edge: 'left' | 'right',
  offset: number,
  width: number,
): RoadMarking => ({
  kind: 'patch',
  from,
  to,
  edge,
  offset,
  width,
  cracks: true,
});

/**
 * The repairs the references show on the old road (m along; the shader adds the small pale patches between them,
 * engine/road-surface.ts): lane-wide re-laid blocks, a re-laid left lane above the 1.35 km hairpin, pale strips at the
 * centre line, dark pothole fills and crack fields on the broken lanes.
 */
export const PATCHES: RoadMarking[] = [
  pale(950, 968, 'left', 0.25, HALF - 0.35),
  pale(971, 990, 'right', 0.25, HALF - 0.35),
  pale(1099, 1100.6, 'left', HALF - 0.75, 1.5),
  // (pale repairs beside the centre line before the 1 350 m hairpin: separate blotches, not one slab)
  pale(1214, 1226, 'left', HALF - 1.9, 1.6),
  pale(1262, 1268, 'left', HALF - 1.8, 1.5),
  pale(1293, 1298, 'left', HALF - 1.8, 1.5),
  pale(1305, 1309, 'left', HALF - 1.7, 1.4),
  pale(1314, 1319, 'left', HALF - 1.9, 1.6),
  ...[1214, 1239, 1262, 1291, 1305].map((at, i) =>
    fill(at, 'right', 0.6 + (i % 3) * 0.55, 0.55 + (i % 2) * 0.3),
  ),
  pale(1340, 1346, 'left', HALF - 0.6, 1.2),
  pale(1356, 1361.5, 'left', HALF - 0.6, 1.2),
  // the left lane re-laid lighter in two lengths above the hairpin
  pale(1480, 1560, 'left', 0.15, HALF - 0.25, true),
  pale(1600, 1640, 'left', 0.15, HALF - 0.25, true),
  // ... and the bleached, alligator-cracked full width between the next two bends
  cracks(1690, 1740, 'right', 0.3, 2.5),
  cracks(1692, 1738, 'left', 0.3, 2.4),
  ...[1744, 1757, 1771, 1786, 1799, 1814, 1822].map((at, i) =>
    fill(at, 'right', 0.4 + (i % 4) * 0.5, 0.5 + (i % 3) * 0.25),
  ),
  // crack fields: the bus stop's lane and the junction mouth, the climb past the first lay-by, the 1 350 m hairpin,
  // the broken right lane below the big hairpin
  cracks(648, 702, 'right', 0.3, 2.4),
  cracks(656, 690, 'left', 0.6, 1.9),
  cracks(860, 886, 'right', 0.4, 2.2),
  // (the references: alligator cracking over the full width of the hairpin, dark square repairs in it)
  cracks(1332, 1372, 'right', 0.3, 2.5),
  cracks(1336, 1368, 'left', 0.3, 2.4),
  ...[1338, 1349, 1357, 1366].map((at, i) =>
    fill(
      at,
      i % 2 ? 'left' : 'right',
      0.7 + (i % 3) * 0.5,
      1.1 + (i % 2) * 0.4,
    ),
  ),
  cracks(1738, 1832, 'right', 0.25, 2.5),
  // past the joint before the finish junction: dense alligator cracking over both lanes, square repairs in it
  cracks(NEW_TO + 2, 4474, 'right', 0.2, 2.6),
  cracks(NEW_TO + 4, 4474, 'left', 0.2, 2.6),
  ...[4290, 4312, 4337, 4361, 4395, 4428].map((at, i) =>
    fill(
      at,
      i % 2 ? 'left' : 'right',
      0.5 + (i % 3) * 0.6,
      0.9 + (i % 2) * 0.5,
    ),
  ),
];

const stripe = (
  from: number,
  to: number,
  edge: 'left' | 'right',
  offset: [number, number],
  width = 0.15,
  yellow = false,
): RoadMarking => ({ kind: 'stripe', from, to, edge, offset, width, yellow });

/** A yellow zigzag along an edge (a bus stop): bars `period` m long between `near` and `far` m in from it. */
function zigzag(
  from: number,
  to: number,
  edge: 'left' | 'right',
  near: number,
  far: number,
  period: number,
): RoadMarking[] {
  const out: RoadMarking[] = [];
  for (let a = from, k = 0; a + period <= to + 1e-6; a += period, k++)
    out.push(
      stripe(
        a,
        a + period,
        edge,
        k % 2 ? [far, near] : [near, far],
        0.12,
        true,
      ),
    );
  return out;
}

/** A hatched area against an edge, `depth` m deep: its inner outline and slanted bars every `gap` m. */
function hatch(
  from: number,
  to: number,
  edge: 'left' | 'right',
  depth: number,
  gap: number,
): RoadMarking[] {
  const out: RoadMarking[] = [
    stripe(from, to, edge, [depth, depth]),
    stripe(from - depth, from, edge, [0.15, depth]),
    stripe(to, to + depth, edge, [depth, 0.15]),
  ];
  for (let a = from; a + depth <= to + 1e-6; a += gap)
    out.push(stripe(a, a + depth * 0.9, edge, [0.2, depth - 0.1], 0.3));
  return out;
}

/**
 * The paint at the junctions the references show (m along): the bus stop's yellow zigzag at the crossroad, zebra
 * bars and an ahead arrow at the gate's junction, the hatched area before the side road at the big hairpin.
 */
export const JUNCTION_PAINT: RoadMarking[] = [
  ...zigzag(398, 422, 'left', 0.3, 0.95, 1.5),
  // (a worn zebra crossing over both lanes just before the gate tower, not bars along the edge)
  ...[0.45, 1.45, 2.45, 3.45, 4.45, 5.45].map((o) =>
    stripe(653.5, 656.5, 'right', [o, o], 0.5),
  ),
  { kind: 'arrow', arrow: 'straight', at: 695, edge: 'right', offset: 1.6 },
  ...hatch(1978, 1994, 'left', 2.2, 2),
  { kind: 'arrow', arrow: 'straight', at: 1952, edge: 'right', offset: 1.45 },
];
