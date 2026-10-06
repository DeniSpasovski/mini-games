import { Vector2 } from 'three';
import { Rng } from '../../../../../shared/rng';
import { SOUTH_BUILDINGS } from './footprints';
import {
  backFenceZ,
  NORTH_FENCE,
  ROAD,
  roadLine,
  SOUTH_FENCE,
  type Corner,
} from './frame';
import {
  BACK,
  BEHIND,
  LOT_X,
  px16,
  quad16,
  sx16,
  WEST,
  px,
  quad,
  ROOFS,
  southEdge,
  type SouthLine,
  sx,
} from './trace';

/**
 * The lots of the start row (site metres, see frame.ts): which building stands in which lot, how
 * its yard is shaped (traced from the satellite image, see trace.ts), the gate through the street
 * fence and which trucks and cars are parked where. Pure layout, no rendering and no DOM:
 * `build/` turns it into geometry, `index.ts` into pads, colliders and the physical kerb.
 *
 * Lot styles and parking rows. Positions are the real ones from the image, and neighbours share
 * one fence (`Yard.fence` is deduplicated).
 */

export type Compass = 'n' | 'e' | 's' | 'w';
export type VehicleKind =
  'trailer' | 'tanker' | 'box' | 'car' | 'hatch' | 'sport' | 'van' | 'bigvan';

/** Parked vehicle: its middle, heading (rotation about y, 0 = facing east) and paint. */
export interface Placement {
  x: number;
  z: number;
  heading: number;
  color: string;
  /** Trucks: the cab's paint. */
  cabColor?: string;
}

interface Row {
  /** Which wall of the building the row is parked at... */
  edge?: Compass;
  /** ...or a free-standing row along this line (site x, z), parked on its right-hand side. */
  line?: [Corner, Corner];
  kind: VehicleKind;
  /** 'dock': backed up to the wall, nose out; 'along': parallel to the wall. */
  layout: 'dock' | 'along';
  /** Metres between the wall and the nearest vehicle end / side. */
  gap?: number;
  /** Share of the slots that are actually taken. */
  fill?: number;
  /** Car rows: share of the taken slots that get a van instead (default 0.2). */
  vans?: number;
  /** Stop after this many vehicles from this row. */
  count?: number;
  /** Park along the inside of the yard's fence on this side instead of along a building wall. */
  fence?: Compass;
  /** Dock rows: nose to the wall instead of tail to it. */
  noseIn?: boolean;
  /** Park this many more, after every row is done, in bays the random fill left empty. */
  extra?: number;
  /** `extra` vehicles take the first empty bays from this end of the row instead of spreading out. */
  extraFrom?: 'start' | 'end';
  /** Leave the first this many bays at the start of the row empty. */
  skip?: number;
}

export type LotStyle =
  | 'showroom'
  | 'service'
  | 'hq'
  | 'depot'
  | 'hall'
  | 'logistics'
  | 'striped'
  | 'sheds'
  | 'office'
  /** North 5: dark cladding under a red portal frame, three glazed sectional doors. */
  | 'framed'
  /** North 6: a two-storey grey office with red trim and a red bay in front of its hall. */
  | 'redTrim'
  /** North 7: a three-storey grey office with a red portal round the entrance, a pale hall behind. */
  | 'redPortal'
  /** North 8: a white-panelled office with a mirrored glass stair tower in the middle. */
  | 'glassTower'
  /** North 9: a dark showroom / office block, its upper floor overhanging the glazed ground floor. */
  | 'darkOffice'
  /** The Mileks building. */
  | 'mileks'
  /** The construction site east of north 1: a gravel lot with a site cabin, an excavator and a pile of sand. */
  | 'site'
  /** The villa at the east end. */
  | 'house'
  /** North 10 as it is: a gabled house with a balcony block, a single-storey wing and a carport (ref-30..36). */
  | 'villa'
  /** A bare foundation slab on a gravel lot. */
  | 'slab'
  /** The car dealer east of south 6: container office, carports, flags, a green roof truss being built. */
  | 'dealer'
  /** The truck yard: a grey hall at the back, a red-roofed shed, trucks and trailers. */
  | 'truckYard'
  /** The old compound behind the field: block walls, a gate under a sign arch, red-roofed hall and shed. */
  | 'compound'
  /** The shed in a weedy yard full of stone statues, a cypress, a billboard in the field. */
  | 'statues'
  /** The wholesale mall: a big two-storey box under a hipped red roof, stair to a raised entrance. */
  | 'mall'
  /** West of north 1: a small car service, a gabled workshop shed and an office on a gravel yard full of cars. */
  | 'carService'
  /** A gravel car park (its plot building is a pair of rubbish containers). */
  | 'carPark'
  /** The red and white lattice mast in its own small fenced lot. */
  | 'mast'
  /** Open gravel where trailers park, with a brick sign booth (no fences). */
  | 'trailerPark'
  /** An electric substation: gantries, transformers, switchgear rows, a small house. */
  | 'substation'
  /** The factory on the corner by the roundabout: a three-storey panel hall, a white block and a wing. */
  | 'factory';

export interface Plot {
  name: string;
  corners: Corner[];
  height: number;
  /** Which side of the street the lot is on: the road runs east, so north is the row's side. */
  side: 'north' | 'south';
  /** x of the middle of the gate in the street-side fence (unused for a lot off the street). */
  gate: number;
  /** Width of the gate (default 9 m). */
  gateWidth?: number;
  walls: string;
  roof: string;
  style?: LotStyle;
  /** Solar panels on the roof. */
  solar?: boolean;
  /** A second, separate building on the lot. */
  annex?: { corners: Corner[]; height: number; walls?: string; roof?: string };
  /** More buildings on the lot (colliders, placeholder hiding; the style dresses them). */
  more?: { corners: Corner[]; height: number }[];
  /** Concrete pavers for the yard instead of worn asphalt. */
  paving?: 'pavers' | 'gravel';
  /** Pad (graded ground) follows the road along these site x instead of the lot's own frontage (a lot behind others). */
  padSpan?: [number, number];
  /** No graded pad: the lot lies on the natural ground (a lot off the street, out in the fields). */
  noPad?: boolean;
  /** No fences at all (no street fence, no lot fence): open ground; neighbours keep their own fences. */
  open?: boolean;
  /** Parts of the yard with another ground (sand, dirt, pavement), drawn over the paving. */
  patches?: {
    polygon: Corner[];
    tint: string;
    material?: 'concrete' | 'pavers';
  }[];
  /**
   * The lot: its frontage on the street fence between two site x, and the rest of its outline from
   * the east end round to the west (the fence stands on every edge but the street one). A lot without
   * `street` lies off the street (behind other lots, reached by a track): `back` is its whole outline,
   * fenced all round, with no gate or drive; give it a `padSpan` or `noPad`.
   */
  yard: { street?: [number, number]; back: Corner[] };
  rows: Row[];
  /** Vehicles parked by hand: a truck's middle, and its heading. */
  fixed?: {
    kind: VehicleKind;
    at: Corner;
    heading: number;
    /** Paint (and a truck's cab paint) instead of a random pick from the palette. */
    color?: string;
    cabColor?: string;
  }[];
  /** A line of red and white barriers across the yard, closing off its back part, with a gap. */
  divider?: { from: Corner; to: Corner; gate: [number, number] };
  maxVehicles?: number;
  maxTrucks?: number;
  maxCars?: number;
}

const seeded = (seed: number) => {
  const rng = new Rng(seed);
  return () => rng.next();
};

// ----- The Mileks lot: the warehouse -----

/** The Mileks building's footprint (NW, NE, SE, SW), traced from the image. */
export const MILEKS_CORNERS: Corner[] = ROOFS.mileks;
export const MILEKS_HEIGHT = 8;

const GATE_WIDTH = 9;

/** The construction site's machinery (site metres): the excavator faces the sand pile. */
export const SITE = (() => {
  const pile = px(905, 188);
  const dig = px(868, 226);
  return {
    pile: { at: pile, radius: 6.5, height: 3.4 },
    excavator: {
      at: dig,
      heading: Math.atan2(pile[0] - dig[0], pile[1] - dig[1]),
    },
  };
})();

/** Vehicle footprints (m) the yards park with. */
export const VEHICLE_SIZE: Record<
  VehicleKind,
  { length: number; width: number }
> = {
  trailer: { length: 17.5, width: 2.6 },
  tanker: { length: 17.5, width: 2.6 },
  box: { length: 9.2, width: 2.6 },
  car: { length: 4.5, width: 1.9 },
  hatch: { length: 3.55, width: 1.68 },
  sport: { length: 4.4, width: 1.78 },
  van: { length: 4.7, width: 2 },
  bigvan: { length: 6.1, width: 2.2 },
};

/** A few common dock rows for a warehouse whose trucks back up to `edges`. */
const docks = (
  kind: VehicleKind,
  edges: Compass[],
  fill = 0.9,
  gap = 1.4,
): Row[] => edges.map((edge) => ({ edge, kind, layout: 'dock', fill, gap }));

/** A lot between two image columns on the north side, its back traced (image points, east end first). */
const northYard = (
  cols: readonly [number, number],
  back: readonly (readonly [number, number])[],
): Plot['yard'] => ({
  street: [sx(cols[0]), sx(cols[1])],
  back: back.map(([x, y]) => px(x, y)),
});

/** A lot off the street, its whole outline traced (image points), kept north of the motorway's back fence line. */
const behindYard = (
  outline: readonly (readonly [number, number])[],
): Plot['yard'] => ({
  back: outline.map(([x, y]) => {
    const [sxv, szv] = px(x, y);
    return [sxv, Math.min(szv, backFenceZ(sxv) - 0.5)] as Corner;
  }),
});

/** The street's heading (0 = east) at site x, from the south fence line. */
const streetHeading = (x: number): number => {
  const fence = lineAt(SOUTH_FENCE - 0.4);
  return Math.atan2(-(fence(x + 10) - fence(x - 10)) / 20, 1);
};

/**
 * The car dealer's yard (ref-39..43): flag poles at the west corner, two carports by the street either side
 * of the container office, the green truss over its slab at the east end by the truck yard. Positions from the image; `along` is the unit vector east along the street.
 */
export const DEALER = (() => {
  const east = streetHeading(sx(1320));
  const along: Corner = [Math.cos(east), -Math.sin(east)];
  return {
    east,
    along,
    carports: [px(1266, 531), px(1333, 541)],
    truss: px(1377, 536),
    flags: [px(1247, 516), px(1253, 517), px(1259, 518)],
  };
})();

/** Cars under the dealer's carports, nose to the street. */
const DEALER_CARS = (() => {
  const { carports, along, east } = DEALER;
  const spots: [number, number][] = [
    [0, -1],
    [0, 0],
    [0, 1],
    [1, -1],
    [1, 1],
  ];
  return spots.map(([c, k]) => ({
    kind: (k === 0 ? 'sport' : 'car') as VehicleKind,
    at: [
      carports[c][0] + along[0] * k * 3,
      carports[c][1] + along[1] * k * 3,
    ] as Corner,
    heading: east + Math.PI / 2,
  }));
})();

/** The villa's house and wing (the wing a few cm inside its own outline so no faces meet the house's). */
const NORTH_10_WING: Corner[] = (() => {
  const c = ROOFS.north10Wing;
  const mx = c.reduce((s, p) => s + p[0], 0) / 4;
  const mz = c.reduce((s, p) => s + p[1], 0) / 4;
  return c.map(([x, z]): Corner => [
    mx + (x - mx) * 0.997,
    mz + (z - mz) * 0.997,
  ]);
})();

/** A lot on the south side between two boundary lines (west, east), ending at the motorway's back fence line. */
const southYard = (west: SouthLine, east: SouthLine): Plot['yard'] => {
  const w = southEdge(west);
  const e = southEdge(east);
  return { street: [w.front[0], e.front[0]], back: [e.back, w.back] };
};

/** North 1's warehouse, 5 m narrower than traced (its east wall pulled west) to widen the lane to the construction site. */
const NORTH_1_CORNERS: Corner[] = (() => {
  const [nw, ne, se, sw] = ROOFS.north1;
  const pull = (a: Corner, b: Corner): Corner => {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [b[0] - ((b[0] - a[0]) * 5) / d, b[1] - ((b[1] - a[1]) * 5) / d];
  };
  return [nw, pull(nw, ne), pull(sw, se), sw];
})();
/**
 * An office block across the whole street front of a north building (corners NW, NE, SE, SW), `depth` m
 * back along its side walls, standing `proud` m out of the front and both sides so its faces don't share
 * planes with the building's. Corners SE, SW, then the two back ones.
 */
const frontBlock = (
  corners: Corner[],
  depth: number,
  proud = 0.4,
): Corner[] => {
  const [, ne, se, sw] = corners.map(([x, z]) => new Vector2(x, z));
  const front = sw.clone().sub(se).normalize(); // east to west along the front
  const east = ne.clone().sub(se).normalize(); // south to north along the east wall
  const out = new Vector2(-east.y, east.x).multiplyScalar(proud); // outwards, east
  const south = new Vector2(front.y, -front.x).multiplyScalar(proud); // outwards, south
  const c0 = se.clone().add(out).add(south);
  const c1 = c0.clone().addScaledVector(front, se.distanceTo(sw) + 2 * proud);
  const c2 = c1.clone().addScaledVector(east, depth);
  const c3 = c0.clone().addScaledVector(east, depth);
  return [c0, c1, c2, c3].map((c): Corner => [c.x, c.y]);
};

/** North 1's four-storey office block across the whole street front of the warehouse. */
const north1Front = (depth: number): Corner[] =>
  frontBlock(NORTH_1_CORNERS, depth);

/** South 2's lower west block takes this share of the street front; the taller block the rest. */
export const HALL_WEST_SHARE = 0.48;

/**
 * A south building that is two blocks side by side, the east one longer towards the street: the whole footprint
 * is the east block's, `setBack` pulls the west block's street wall back by `back` m (NE, SE, SW, NW).
 */
const setBack = ([ne, se, sw, nw]: Corner[], back: number): Corner[] => {
  const along = (a: Corner, b: Corner): Corner => {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [
      a[0] + ((b[0] - a[0]) * back) / d,
      a[1] + ((b[1] - a[1]) * back) / d,
    ];
  };
  return [along(ne, se), se, sw, along(nw, sw)];
};

/**
 * The east block of such a building: the east part of the whole footprint, shrunk 0.3% about its middle so its
 * walls sit a few cm inside the west block's and no faces coincide.
 */
const eastBlock = ([ne, se, sw, nw]: Corner[], westShare: number): Corner[] => {
  const at = (a: Corner, b: Corner): Corner => [
    a[0] + (b[0] - a[0]) * westShare,
    a[1] + (b[1] - a[1]) * westShare,
  ];
  const block = [ne, se, at(se, sw), at(ne, nw)];
  const mx = block.reduce((s, c) => s + c[0], 0) / 4;
  const mz = block.reduce((s, c) => s + c[1], 0) / 4;
  return block.map(([x, z]): Corner => [
    mx + (x - mx) * 0.997,
    mz + (z - mz) * 0.997,
  ]);
};

/** South 2: the lower west block is 2.8 m shorter at the street than the taller east block. */
const HALL_BACK = 2.8;
const hallWest = (): Corner[] => setBack(SOUTH_BUILDINGS['south 2'], HALL_BACK);
const hallTallBlock = (): Corner[] =>
  eastBlock(SOUTH_BUILDINGS['south 2'], HALL_WEST_SHARE);

/** South 3: the red building's east block runs 3.4 m further towards the street than its west block. */
export const STRIPED_WEST_SHARE = 0.53;
const stripedWest = (): Corner[] => setBack(SOUTH_BUILDINGS['south 3'], 3.4);
const stripedEast = (): Corner[] =>
  eastBlock(SOUTH_BUILDINGS['south 3'], STRIPED_WEST_SHARE);

/** South 4's loading canopy: `length` m down its east wall from the front corner, standing `depth` m out. */
const canopy = (length: number, depth: number): Corner[] => {
  const [a, b] = SOUTH_BUILDINGS['south 4']; // NE, SE, SW, NW: the east wall runs NE -> SE
  const along = new Vector2(b[0] - a[0], b[1] - a[1]).normalize();
  const out = new Vector2(along.y, -along.x); // away from the building, east
  const c0 = new Vector2(a[0], a[1]).addScaledVector(out, -0.3);
  const c1 = c0.clone().addScaledVector(along, length);
  const c2 = c1.clone().addScaledVector(out, depth + 0.3);
  const c3 = c0.clone().addScaledVector(out, depth + 0.3);
  return [c0, c1, c2, c3].map((c): Corner => [c.x, c.y]);
};

/** South 6's round glazed front: a half-ellipse `depth` m out from the middle of its street wall. */
export const ROTUNDA_DEPTH = 6;
const rotunda = (depth = ROTUNDA_DEPTH, steps = 10): Corner[] => {
  const [, , nw, ne] = SOUTH_BUILDINGS['south 6']; // SE, SW, NW, NE: the street wall runs NW -> NE
  const a = new Vector2(nw[0], nw[1]);
  const b = new Vector2(ne[0], ne[1]);
  const along = b.clone().sub(a);
  const half = along.length() * 0.47;
  along.normalize();
  const out = new Vector2(along.y, -along.x); // towards the street (north)
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const arc = Array.from({ length: steps + 1 }, (_, k) => {
    const t = (Math.PI * k) / steps;
    return mid
      .clone()
      .addScaledVector(along, -Math.cos(t) * half)
      .addScaledVector(out, Math.sin(t) * depth);
  });
  const back = [half, -half].map((d) =>
    mid.clone().addScaledVector(along, d).addScaledVector(out, -0.3),
  );
  return [...arc, ...back].map((c): Corner => [c.x, c.y]);
};

/** Small box trucks parked side by side at the back of south 4's yard, facing the highway. */
const SOUTH_4_BOX_TRUCKS = (() => {
  const [ne, se, sw, nw] = SOUTH_BUILDINGS['south 4'];
  const centre = new Vector2(
    (ne[0] + se[0] + sw[0] + nw[0]) / 4,
    (ne[1] + se[1] + sw[1] + nw[1]) / 4,
  );
  // Straight south, parallel to nothing in particular: the building's own back wall leans out of its lot.
  const across = new Vector2(1, 0);
  const back = new Vector2(0, 1);
  const FENCE_CLEARANCE = 3;
  const noseToTail = VEHICLE_SIZE.box.length / 2;
  return [-10.5, -7, -3.5].map((a) => {
    const at = centre.clone().addScaledVector(across, a);
    // Slide along the lot's back direction until the point just ahead of the nose is on the fence line.
    for (let n = 0; n < 6; n++) {
      const ahead = at
        .clone()
        .addScaledVector(back, noseToTail + FENCE_CLEARANCE);
      at.addScaledVector(back, (backFenceZ(ahead.x) - ahead.y) / back.y);
    }
    return {
      kind: 'box' as const,
      at: [at.x, at.y] as Corner,
      heading: Math.atan2(-back.y, back.x),
    };
  });
})();

/**
 * North 5's forecourt: cars and vans parked in rows parallel to the street fence, either side of the gate - four
 * on the west side facing east (two rows of two), three on the east side facing west (one per row).
 */
const NORTH_5_VEHICLES = (() => {
  const fence = lineAt(NORTH_FENCE + 0.4);
  const gate = sx(1050);
  const slope = (fence(gate + 10) - fence(gate - 10)) / 20;
  const east = Math.atan2(-slope, 1);
  const spot = (
    kind: VehicleKind,
    x: number,
    row: number,
    facing: 'east' | 'west',
  ) => ({
    kind,
    at: [x, fence(x) - 2.6 - row * 3.1] as Corner,
    heading: facing === 'east' ? east : east + Math.PI,
  });
  return [
    spot('car', 39.6, 0, 'east'),
    spot('van', 45.8, 0, 'east'),
    spot('hatch', 39.2, 1, 'east'),
    spot('car', 45.4, 1, 'east'),
    spot('van', 60.4, 0, 'west'),
    spot('car', 60.0, 1, 'west'),
    spot('hatch', 60.6, 2, 'west'),
  ];
})();

/** A north lot west of north 1, from its ref-16 trace. */
const westYard = (lot: {
  street: readonly [number, number];
  back: readonly (readonly [number, number])[];
}): Plot['yard'] => ({
  street: [sx16(lot.street[0]), sx16(lot.street[1])],
  back: lot.back.map(([x, y]) => px16(x, y)),
});

const PLOT_LAYOUT: Plot[] = [
  {
    // The factory on the corner by the roundabout (user's Street View screenshots, 2026-10-04): a three-storey
    // grey panel hall with two rows of windows, a roof cyclone and a chimney, a white block and a long wing behind
    // it, trailers on the gravel by the road. Sign plain.
    name: 'west 3',
    corners: quad16(...WEST.factory.hall),
    height: 12,
    side: 'north',
    gate: sx16(662),
    gateWidth: 7,
    walls: '#c9cdd0',
    roof: '#b9bcbc',
    style: 'factory',
    annex: {
      corners: quad16(...WEST.factory.north),
      height: 10,
      walls: '#e2e4e5',
      roof: '#e8e9e8',
    },
    more: [{ corners: quad16(...WEST.factory.wing), height: 8 }],
    yard: westYard(WEST.factory),
    rows: [
      { fence: 'n', kind: 'car', layout: 'dock', fill: 0.6, gap: 1, count: 6 },
    ],
    maxTrucks: 4,
  },
  {
    // The red and white lattice mast in its own fenced triangle at the car park's south-west corner, by the street
    // and the start line, outside the factory's south-east corner (user, 2026-10-04).
    name: 'mast',
    corners: quad16(...WEST.mast.base),
    height: 2,
    side: 'north',
    gate: sx16(744),
    gateWidth: 1.2,
    walls: '#c8322b',
    roof: '#c8322b',
    style: 'mast',
    paving: 'gravel',
    yard: westYard(WEST.mast),
    rows: [],
    maxVehicles: 0,
  },
  {
    // The open gravel in front of the factory's south-west fence, by the junction: a few box trucks parked nose to
    // the fence (too shallow for semi-trailers since the fence moved), the brick sign booth of the economic zone
    // (plain sign board). No fences.
    name: 'trailer park',
    corners: quad16(...WEST.trailers.booth),
    height: 2.8,
    side: 'north',
    gate: sx16(593),
    gateWidth: 23,
    walls: '#a85a44',
    roof: '#8c4636',
    style: 'trailerPark',
    paving: 'gravel',
    // Dusty dirt and gravel right down to the roads (user, 2026-10-04).
    patches: [
      {
        polygon: quad16(
          [546, 925],
          [645, 935],
          [615, 887],
          [440, 715],
          [438, 828],
          [462, 864],
          [510, 893],
        ),
        tint: '#b8a888',
      },
    ],
    open: true,
    yard: westYard(WEST.trailers),
    rows: [
      {
        line: [px16(452, 731), px16(604, 881)],
        kind: 'box',
        layout: 'dock',
        noseIn: true,
        fill: 1,
        count: 3,
        gap: 0.8,
      },
    ],
    maxTrucks: 3,
  },
  {
    // The electric substation west of the corner road (user, 2026-10-04): portal gantries on concrete poles,
    // transformers, two long rows of switchgear cabinets, a small white house by the road, lamp posts. Off the street.
    name: 'substation',
    corners: quad16(...WEST.substation.house),
    height: 3,
    side: 'north',
    gate: sx16(380),
    walls: '#efeeea',
    roof: '#8a7a6a',
    style: 'substation',
    paving: 'gravel',
    noPad: true,
    more: WEST.substation.gear.map((g, i) => ({
      corners: quad16(...g),
      height: i < 2 ? 2.6 : 3.2,
    })),
    patches: [
      {
        polygon: quad16(...WEST.substation.back),
        tint: '#6f8448',
      },
    ],
    yard: { back: quad16(...WEST.substation.back) },
    rows: [],
    maxVehicles: 0,
  },
  {
    // A gravel car park between the factory's diagonal fence and the car service, open to the street.
    name: 'west 2',
    // Its "building" is the pair of rubbish containers at the back.
    corners: quad16([820, 736], [832, 736], [832, 742], [820, 742]),
    height: 1.4,
    side: 'north',
    gate: sx16(761),
    gateWidth: 14,
    walls: '#c9c6bf',
    roof: '#c9c6bf',
    style: 'carPark',
    paving: 'gravel',
    yard: westYard(WEST.parking),
    // At most 20 cars (user, 2026-10-04).
    maxVehicles: 20,
    rows: [
      {
        fence: 'n',
        kind: 'car',
        layout: 'dock',
        fill: 0.85,
        gap: 3.5,
        vans: 0.25,
      },
      {
        fence: 'w',
        kind: 'car',
        layout: 'dock',
        fill: 0.9,
        gap: 0.8,
        vans: 0.15,
      },
      {
        fence: 'e',
        kind: 'car',
        layout: 'dock',
        fill: 0.9,
        gap: 0.8,
        vans: 0.15,
      },
    ],
  },
  {
    // The small car service next to north 1: a gabled workshop shed with a lean-to canopy, open at the front with
    // cars inside, a small office with a green roof, a gravel yard packed with older saloons, vans and a box
    // truck, open to the street; the old houses and trees behind are its back yard.
    name: 'west 1',
    corners: quad16(...WEST.service.shed),
    height: 4.4,
    side: 'north',
    gate: sx16(935),
    gateWidth: 16,
    walls: '#c4c8ca',
    roof: '#a9adae',
    style: 'carService',
    paving: 'gravel',
    annex: {
      corners: quad16(...WEST.service.office),
      height: 3.2,
      walls: '#d8d2c2',
      roof: '#3e7a4a',
    },
    patches: [
      {
        polygon: quad16([880, 524], [1110, 524], [1110, 610], [890, 610]),
        tint: '#6f8448',
      },
    ],
    yard: westYard(WEST.service),
    // The cars are in the front half (the back yard is empty): a row along the street facing the shed, one in
    // front of the shed, one along the fence to north 1.
    rows: [
      {
        line: [px16(1012, 834), px16(858, 842)],
        kind: 'car',
        layout: 'dock',
        fill: 0.85,
        gap: 0.5,
        vans: 0.3,
      },
      {
        edge: 's',
        kind: 'car',
        layout: 'dock',
        fill: 0.9,
        gap: 2.5,
        vans: 0.2,
      },
      {
        fence: 'e',
        kind: 'car',
        layout: 'dock',
        fill: 0.85,
        gap: 0.8,
        vans: 0.2,
      },
    ],
    fixed: [{ kind: 'box', at: px16(960, 735), heading: 1.3 }],
  },
  {
    // North 1: the big grey warehouse with the red trim (the freight forwarder's) with its solar
    // roof, set back from the street behind its car parks, in one big asphalt yard that wraps round
    // behind the next three lots. Its office tower stands on the street front.
    name: 'north 1',
    corners: NORTH_1_CORNERS,
    height: 11,
    side: 'north',
    gate: sx(400),
    walls: '#b3b7ba',
    roof: '#eceeee',
    style: 'hq',
    annex: { corners: north1Front(13), height: 17 },
    yard: northYard(LOT_X.north1, BACK.north1),
    rows: [
      // The striped car park in the south-west corner, in two rows.
      {
        line: [px(440, 570), px(150, 578)],
        kind: 'car',
        layout: 'dock',
        fill: 0.4,
        gap: 1.2,
        vans: 0,
      },
      {
        line: [px(440, 570), px(150, 578)],
        kind: 'car',
        layout: 'dock',
        fill: 0.15,
        gap: 12,
        vans: 0,
      },
      ...docks('box', ['n'], 0.35),
      // Trailers along the diagonal west fence (only behind the striped barrier, which meets the fence at about
      // image (212, 445): the car park in front is for cars), the canal fence and the neighbours' back fences.
      {
        line: [px(226, 426), px(408, 112)],
        kind: 'trailer',
        layout: 'dock',
        fill: 0.25,
        gap: 1.2,
        extra: 3,
        extraFrom: 'end',
      },
      {
        line: [px(420, 104), px(700, 126)],
        kind: 'trailer',
        layout: 'dock',
        fill: 0.12,
        gap: 1.2,
        skip: 4,
        extra: 3,
      },
    ],
    // Fences off the truck yard behind the warehouse, in line with its front face and out to the
    // west fence (the only way round the building), with a gate in the middle.
    divider: {
      from: NORTH_1_CORNERS[3],
      to: [
        2 * NORTH_1_CORNERS[3][0] - NORTH_1_CORNERS[2][0],
        2 * NORTH_1_CORNERS[3][1] - NORTH_1_CORNERS[2][1],
      ],
      gate: [0, 9.5],
    },
    maxTrucks: 14,
    maxCars: 12,
  },
  {
    // The car service: a single-storey workshop with two open bays under a blue canopy, and its
    // office block behind.
    name: 'north 2',
    corners: ROOFS.north2,
    height: 5.5,
    side: 'north',
    gate: sx(770),
    gateWidth: 6,
    walls: '#f1f2f0',
    roof: '#c9ccce',
    style: 'service',
    annex: { corners: ROOFS.north2Annex, height: 6.5 },
    yard: northYard(LOT_X.north2, BACK.north2),
    rows: [
      { edge: 's', kind: 'sport', layout: 'dock', fill: 1, gap: 1.2, count: 1 },
      {
        edge: 's',
        kind: 'car',
        layout: 'dock',
        fill: 0.6,
        gap: 1.2,
        vans: 0.4,
      },
      { edge: 'w', kind: 'car', layout: 'along', fill: 0.5, gap: 0.6 },
    ],
    maxVehicles: 6,
  },
  {
    // A lot under construction east of north 1, reached by the lane between north 1 and north 2: all
    // gravel, a site cabin by the fence, an excavator and a pile of sand at the back.
    name: 'construction site',
    corners: ROOFS.siteCabin,
    height: 2.7,
    side: 'north',
    gate: sx(725),
    gateWidth: 4.5,
    walls: '#c9ccce',
    roof: '#9aa0a4',
    style: 'site',
    paving: 'gravel',
    padSpan: [sx(716), sx(984)],
    yard: northYard(LOT_X.site, BACK.site),
    rows: [],
    maxVehicles: 0,
  },
  {
    // The Mileks building (Mileks-AS warehouse), in the lot of the former truck repair shop.
    name: 'Mileks-AS',
    corners: MILEKS_CORNERS,
    height: MILEKS_HEIGHT,
    side: 'north',
    gate: sx(871),
    gateWidth: 4.5,
    walls: '#f7f7f4',
    roof: '#cfcfca',
    style: 'mileks',
    yard: northYard(LOT_X.mileks, BACK.mileks),
    rows: [],
    maxVehicles: 0,
  },
  {
    // The glass-fronted showroom: an open paved forecourt, a drive down the west side to its two
    // roller doors.
    name: 'north 4',
    corners: ROOFS.north4,
    height: 10,
    side: 'north',
    gate: sx(891),
    gateWidth: 4.5,
    walls: '#e6e8e7',
    roof: '#b9bdbf',
    style: 'showroom',
    paving: 'pavers',
    yard: northYard(LOT_X.north4, BACK.north4),
    rows: [
      { edge: 's', kind: 'sport', layout: 'dock', fill: 1, count: 1 },
      { edge: 's', kind: 'car', layout: 'dock', fill: 0.8 },
    ],
  },
  {
    // The dark-clad hall with the red portal frame (ref-17..19): three glazed sectional doors under a
    // projecting red band, the entrance and a balcony at the east end, an asphalt forecourt with
    // three shrubs, sand behind. Its gate is in the middle of the frontage.
    name: 'north 5',
    corners: ROOFS.north5,
    height: 9,
    side: 'north',
    gate: sx(1050),
    gateWidth: 7,
    walls: '#3a3e42',
    roof: '#a9aba8',
    style: 'framed',
    yard: northYard(LOT_X.north5, BACK.north5),
    patches: [
      {
        polygon: quad([985, 152], [1095, 160], [1095, 335], [985, 335]),
        tint: '#d4c49c',
      },
    ],
    // Seven cars and vans on the forecourt, four west of the gate facing east, three east of it facing west.
    rows: [],
    fixed: NORTH_5_VEHICLES,
  },
  {
    // A long grey hall behind a two-storey office (ref-20..22): grey render, a red parapet band, red
    // corner pilasters and floor band, a red bay over the entrance, a generic red sign on the parapet.
    // Pavers in front, the sliding gate at the west end.
    name: 'north 6',
    corners: ROOFS.north6,
    height: 7.4,
    side: 'north',
    gate: sx(1112),
    gateWidth: 7,
    walls: '#b9bdbf',
    roof: '#a6a8a6',
    style: 'redTrim',
    paving: 'pavers',
    annex: { corners: frontBlock(ROOFS.north6, 11, 0.3), height: 7.8 },
    yard: northYard(LOT_X.north6, BACK.north6),
    // A van, a car and a small van nose-in on the east part of the forecourt (ref-21), the gate side clear.
    rows: [],
    fixed: [
      { kind: 'van', at: [80.2, -11.9], heading: Math.PI / 2 },
      { kind: 'car', at: [83.6, -11.9], heading: Math.PI / 2 },
      { kind: 'hatch', at: [87.2, -11.4], heading: Math.PI / 2 },
    ],
  },
  {
    // A three-storey grey office with a red portal round the entrance in front of a pale three-storey
    // hall (user photos, 2026-10-04). Pavers; the open drive runs down the east side.
    name: 'north 7',
    corners: ROOFS.north7,
    height: 10.4,
    side: 'north',
    gate: sx(1290),
    gateWidth: 6,
    walls: '#d8dbda',
    roof: '#b4b6b4',
    style: 'redPortal',
    paving: 'pavers',
    annex: { corners: frontBlock(ROOFS.north7, 9, 0.3), height: 10.8 },
    yard: northYard(LOT_X.north7, BACK.north7),
    // Two vans down the drive along the east wall (it leans like the wall), facing the street.
    rows: [],
    fixed: [
      { kind: 'van', at: px(1289, 368), heading: -1.41 },
      { kind: 'bigvan', at: px(1291, 400), heading: -1.41 },
    ],
  },
  {
    // A white-panelled two-storey office with a mirrored glass stair tower in the middle and balconies
    // either side (ref-24..27); a hall with a lean-to canopy behind. An empty paved yard.
    name: 'north 8',
    corners: ROOFS.north8,
    height: 6.8,
    side: 'north',
    gate: sx(1384),
    gateWidth: 5,
    walls: '#c9cdcd',
    roof: '#b0b2b0',
    style: 'glassTower',
    paving: 'pavers',
    annex: { corners: frontBlock(ROOFS.north8, 9, 0.3), height: 7.4 },
    yard: northYard(LOT_X.north8, BACK.north8),
    rows: [],
    maxVehicles: 0,
  },
  {
    // A dark anthracite showroom / office: the upper floor overhangs a glazed ground floor, a terrace
    // with a perforated screen at the west end, a canopy over roller doors on the east (ref-28..29).
    // Solar panels on the hall behind; an empty paved yard with two raised beds.
    name: 'north 9',
    corners: ROOFS.north9,
    height: 7.6,
    side: 'north',
    gate: sx(1416),
    gateWidth: 6,
    walls: '#aeb2b4',
    roof: '#aaa79f',
    style: 'darkOffice',
    solar: true,
    paving: 'pavers',
    annex: { corners: frontBlock(ROOFS.north9, 10, 0.3), height: 8.4 },
    yard: northYard(LOT_X.north9, BACK.north9),
    rows: [],
    maxVehicles: 0,
  },
  {
    // The lot west of the villa: bare ground with a weedy front, a gravel track along the villa's fence to a
    // foundation slab at the back (ref-35, ref-36).
    name: 'slab lot',
    corners: ROOFS.slab,
    height: 0.35,
    side: 'north',
    gate: sx(1574),
    gateWidth: 4,
    walls: '#c9c6bf',
    roof: '#c9c6bf',
    style: 'slab',
    paving: 'gravel',
    patches: [
      {
        polygon: quad([1502, 262], [1568, 262], [1568, 420], [1502, 420]),
        tint: '#7f7a52',
      },
    ],
    yard: northYard(LOT_X.slab, BACK.slab),
    rows: [],
    maxVehicles: 0,
  },
  {
    // The house on the corner with the east road (ref-30..36): two storeys and an attic under a gabled metal
    // roof, a balcony block on the street front by the east corner, a single-storey wing behind with a carport
    // at its east end, the yard round the east gable.
    name: 'north 10',
    corners: ROOFS.north10House,
    height: 6.2,
    side: 'north',
    gate: sx(1626),
    gateWidth: 5,
    walls: '#cfd1cf',
    roof: '#b7bbbd',
    style: 'villa',
    paving: 'pavers',
    annex: { corners: NORTH_10_WING, height: 3.8 },
    yard: northYard(LOT_X.north10, BACK.north10),
    rows: [],
    fixed: [
      { kind: 'van', at: px(1672, 266), heading: Math.PI / 2 },
      { kind: 'car', at: px(1675, 300), heading: -Math.PI / 2 },
      { kind: 'hatch', at: px(1673, 345), heading: Math.PI / 2 },
    ],
  },
  // ----- South side: behind the wire fence, backs to the motorway -----
  {
    // A grey rendered two-storey hall with a stepped parapet, high ribbon windows and a blue
    // canopy over the side door; a low lean-to at the west end, a glazed blue office at the
    // east end, and a sign pylon by the street fence.
    name: 'south 1',
    corners: SOUTH_BUILDINGS['south 1'],
    height: 9.5,
    side: 'south',
    gate: sx(305),
    walls: '#a9adb0',
    roof: '#7f8488',
    style: 'depot',
    paving: 'pavers',
    yard: southYard('west1', 'b12'),
    rows: [
      ...docks('trailer', ['s'], 0.4),
      { edge: 'n', kind: 'car', layout: 'along', fill: 0.8 },
      { edge: 'w', kind: 'car', layout: 'along', fill: 0.8 },
    ],
    maxTrucks: 3,
  },
  {
    // A white panel-clad hall in two stepped blocks: a taller east block with a big roller
    // door, a lower west block with an open door, both behind a slatted screen fence.
    name: 'south 2',
    corners: hallWest(),
    height: 7.8,
    side: 'south',
    gate: sx(378),
    walls: '#dfe1df',
    roof: '#9ba1a6',
    style: 'hall',
    annex: { corners: hallTallBlock(), height: 9.6 },
    yard: southYard('b12', 'b23'),
    rows: [
      ...docks('box', ['s'], 0.5),
      { edge: 'n', kind: 'car', layout: 'along', fill: 0.9, gap: 4 },
    ],
    maxTrucks: 3,
  },
  {
    // The red-roofed one.
    name: 'south 3',
    corners: stripedWest(),
    height: 13.2,
    side: 'south',
    gate: sx(470),
    gateWidth: 6,
    walls: '#a5aaad',
    roof: '#a83a32',
    style: 'striped',
    annex: { corners: stripedEast(), height: 13.2 },
    yard: southYard('b23', 'b34'),
    rows: [
      ...docks('trailer', ['s'], 0.4),
      { edge: 'n', kind: 'car', layout: 'along', fill: 0.9 },
    ],
    maxTrucks: 2,
  },
  {
    // The logistics centre: a long two-storey grey block, its street end a dark ground floor
    // under a red band with a glazed upper floor, ribbon windows down the sides, and a big
    // loading canopy over the yard on the east flank. The trailer park is behind it.
    name: 'south 4',
    corners: SOUTH_BUILDINGS['south 4'],
    height: 9.6,
    side: 'south',
    gate: sx(690),
    walls: '#b3b5b6',
    roof: '#9a9ea1',
    style: 'logistics',
    annex: { corners: canopy(22, 7), height: 6 },
    paving: 'pavers',
    fixed: SOUTH_4_BOX_TRUCKS,
    yard: southYard('b34', 'b45'),
    rows: [
      ...docks('trailer', ['s'], 0.5),
      { edge: 'n', kind: 'car', layout: 'along', fill: 0.9 },
      {
        fence: 'e',
        kind: 'car',
        layout: 'dock',
        noseIn: true,
        fill: 0.85,
        gap: 1.5,
        count: 5,
      },
    ],
    maxTrucks: 9,
  },
  {
    // A truck-service yard: two dark blue sheds, the bigger one with a yellow roof by the
    // street and the smaller one behind it with a red roof.
    name: 'south 5',
    corners: ROOFS.south5Back,
    height: 8,
    side: 'south',
    gate: sx(790),
    walls: '#3d485a',
    roof: '#b3503f',
    style: 'sheds',
    annex: {
      corners: ROOFS.south5Front,
      height: 6.5,
      walls: '#3d485a',
      roof: '#d8c449',
    },
    yard: southYard('b45', 'east5'),
    rows: [
      ...docks('trailer', ['s'], 0.4),
      {
        edge: 'w',
        kind: 'trailer',
        layout: 'along',
        fill: 0.6,
        gap: 0.6,
        count: 2,
      },
      {
        edge: 'e',
        kind: 'trailer',
        layout: 'along',
        fill: 0.6,
        gap: 0.6,
        count: 2,
      },
    ],
    maxTrucks: 4,
  },
  {
    // The two-storey grey office block: a round glazed front with the entrance, a hipped roof
    // with grey cladding at the eaves, a cypress hedge round the fence and a wide forecourt.
    name: 'south 6',
    corners: SOUTH_BUILDINGS['south 6'],
    height: 8.2,
    side: 'south',
    gate: sx(950),
    walls: '#b7b6b3',
    roof: '#6f757a',
    style: 'office',
    annex: { corners: rotunda(), height: 8.8 },
    yard: southYard('west6', 'east6'),
    rows: [
      { edge: 'n', kind: 'car', layout: 'dock', fill: 0.5, gap: 14, count: 3 },
      { edge: 'w', kind: 'car', layout: 'along', fill: 0.5, gap: 1.5 },
    ],
    maxCars: 4,
  },
  {
    // The car dealer (ref-39..43, being built): a white container office, two dark carports by the street,
    // flags at the east corner, a green steel roof truss going up over a new slab. Pavers.
    name: 'south 7',
    corners: ROOFS.dealerOffice,
    height: 2.8,
    side: 'south',
    gate: sx(1351),
    gateWidth: 5,
    walls: '#e8eae9',
    roof: '#d4d7d8',
    style: 'dealer',
    paving: 'pavers',
    yard: {
      street: [sx(LOT_X.dealer[0]), sx(LOT_X.dealer[1])],
      back: BACK.dealer.map(([x, y]) => px(x, y)),
    },
    // Cars for sale in rows along the back fence and a row facing it behind the carports, stopping short of
    // the truss slab at the east end; a row along the west fence.
    rows: [
      {
        line: [px(1350, 590), px(1243, 590)],
        kind: 'car',
        layout: 'dock',
        fill: 0.95,
        gap: 0.6,
        vans: 0.1,
      },
      {
        line: [px(1350, 590), px(1243, 590)],
        kind: 'car',
        layout: 'dock',
        fill: 0.9,
        gap: 7.2,
        vans: 0.1,
        noseIn: true,
      },
      { fence: 'w', kind: 'car', layout: 'dock', fill: 0.9, gap: 0.8, vans: 0 },
    ],
    fixed: DEALER_CARS,
  },
  {
    // The truck yard (ref-43..45): trailers along the east fence, trucks at the grey hall, cars by the gate.
    name: 'south 8',
    corners: ROOFS.truckHall,
    height: 6.5,
    side: 'south',
    gate: sx(1598),
    gateWidth: 12,
    walls: '#c3c6c8',
    roof: '#b9bcbd',
    style: 'truckYard',
    paving: 'pavers',
    annex: { corners: ROOFS.truckShed, height: 5, roof: '#a8473a' },
    // The white tank semi-trailer behind a red tractor unit in the middle of the yard, facing west (ref-45).
    fixed: [
      {
        kind: 'tanker',
        at: px(1545, 602),
        heading: streetHeading(sx(1545)) + Math.PI,
        cabColor: '#b8282b',
      },
    ],
    yard: {
      street: [sx(LOT_X.truckYard[0]), sx(LOT_X.truckYard[1])],
      back: BACK.truckYard.map(([x, y]) => px(x, y)),
    },
    rows: [
      { fence: 'e', kind: 'trailer', layout: 'dock', fill: 0.85, gap: 1.2 },
      {
        fence: 's',
        kind: 'trailer',
        layout: 'dock',
        fill: 0.5,
        gap: 1.2,
        skip: 4,
      },
      { edge: 'e', kind: 'box', layout: 'dock', fill: 0.7, gap: 1.4 },
      {
        fence: 'n',
        kind: 'car',
        layout: 'dock',
        noseIn: true,
        fill: 1,
        gap: 1,
        count: 3,
      },
    ],
    maxTrucks: 12,
  },
  {
    // The old compound behind the field (ref-46): a red-roofed hall and a white shed, block walls and a plank
    // gate under a sign arch. Off the street.
    name: 'south 9',
    corners: ROOFS.compoundHall,
    height: 5.5,
    side: 'south',
    gate: sx(1350),
    walls: '#d6d1c5',
    roof: '#9c4b3b',
    style: 'compound',
    paving: 'gravel',
    annex: {
      corners: ROOFS.compoundShed,
      height: 4.2,
      walls: '#e6e4de',
      roof: '#8a4a3a',
    },
    noPad: true,
    yard: behindYard(BEHIND.compound),
    rows: [],
    maxVehicles: 0,
  },
  {
    // A grey shed in a weedy yard of stone statues and broken sculpture, a cypress, rusty arches (ref-49).
    name: 'south 10',
    corners: ROOFS.statueShed,
    height: 4.6,
    side: 'south',
    gate: sx(1600),
    walls: '#bcc1c4',
    roof: '#b1b6b9',
    style: 'statues',
    paving: 'gravel',
    patches: [
      {
        polygon: quad([1548, 866], [1660, 866], [1660, 1000], [1548, 1000]),
        tint: '#87865a',
      },
    ],
    noPad: true,
    yard: behindYard(BEHIND.statues),
    rows: [],
    maxVehicles: 0,
  },
  {
    // The wholesale mall south-east of the street's end (ref-47, ref-48): a big two-storey box under a hipped
    // red roof with a deep fascia, an upper band of glazing behind a rail, a stair up to the raised entrance at
    // the north-west corner. Reached by the dirt track; a lawn along the north side.
    name: 'south 11',
    corners: ROOFS.mall,
    height: 11,
    side: 'south',
    gate: sx(1700),
    walls: '#b8b2a5',
    roof: '#a54a38',
    style: 'mall',
    noPad: true,
    patches: [
      {
        polygon: quad([1730, 703], [1940, 760], [1934, 778], [1724, 720]),
        tint: '#6f8a45',
      },
    ],
    yard: behindYard(BEHIND.mall),
    rows: [],
    maxVehicles: 0,
  },
];

export const PLOTS: Plot[] = PLOT_LAYOUT;

// ----- Geometry -----

const v = (c: Corner) => new Vector2(c[0], c[1]);

const centroid = (points: Vector2[]) =>
  points
    .reduce((sum, p) => sum.add(p), new Vector2())
    .divideScalar(points.length);

/** Compass direction an outward normal points to. */
const compass = (n: Vector2): Compass =>
  Math.abs(n.y) > Math.abs(n.x) ? (n.y < 0 ? 'n' : 's') : n.x > 0 ? 'e' : 'w';

export interface Edge {
  a: Vector2;
  b: Vector2;
  length: number;
  dir: Vector2;
  /** Unit normal pointing out of the building. */
  normal: Vector2;
  side: Compass;
}

export const edgesOf = (corners: Corner[]): Edge[] => {
  const points = corners.map(v);
  const middle = centroid(points);
  return points.map((a, i) => {
    const b = points[(i + 1) % points.length];
    const d = b.clone().sub(a);
    const length = d.length();
    const dir = d.clone().divideScalar(length);
    const normal = new Vector2(-dir.y, dir.x);
    if (normal.dot(a.clone().add(b).multiplyScalar(0.5).sub(middle)) < 0)
      normal.negate();
    return { a, b, length, dir, normal, side: compass(normal) };
  });
};

/** Distance from `p` to the segment a-b. */
const pointToSegment = (p: Vector2, a: Vector2, b: Vector2) => {
  const ab = b.clone().sub(a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq()));
  return p.distanceTo(a.clone().addScaledVector(ab, t));
};

/** The line a row is parked along: its building wall, or its own free-standing line. */
const rowLine = (r: Row, edges: Edge[]): Edge | undefined => {
  if (!r.line) return edges.find((e) => e.side === r.edge);
  const [a, b] = r.line.map(v);
  const d = b.clone().sub(a);
  const length = d.length();
  const dir = d.divideScalar(length);
  const normal = new Vector2(-dir.y, dir.x);
  return { a, b, length, dir, normal, side: compass(normal) };
};

/** The inside of a yard's fence on one side, as a wall to park along (its normal points into the yard). */
const insideFence = (yard: Yard, side: Compass): Edge | undefined => {
  const e = edgesOf(yard.polygon.map((p): Corner => [p.x, p.y])).find(
    (edge) => edge.side === side,
  );
  if (!e) return undefined;
  // Numbered from its north end, so a row with a `count` fills the part by the road first.
  const north = e.a.y < e.b.y;
  return {
    a: north ? e.a : e.b,
    b: north ? e.b : e.a,
    length: e.length,
    dir: north ? e.dir.clone() : e.dir.clone().negate(),
    normal: e.normal.clone().negate(),
    side,
  };
};

export const inside = (point: Vector2, polygon: Vector2[]) => {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      result = !result;
  }
  return result;
};

/** Separating-axis test for convex polygons; `pad` metres of clearance count as touching. */
const overlaps = (a: Vector2[], b: Vector2[], pad = 0) => {
  for (const polygon of [a, b]) {
    for (let i = 0; i < polygon.length; i++) {
      const edge = polygon[(i + 1) % polygon.length].clone().sub(polygon[i]);
      const axis = new Vector2(-edge.y, edge.x).normalize();
      const range = (points: Vector2[]) => {
        const d = points.map((p) => p.dot(axis));
        return [Math.min(...d), Math.max(...d)];
      };
      const [a0, a1] = range(a);
      const [b0, b1] = range(b);
      if (a1 + pad <= b0 || b1 + pad <= a0) return false;
    }
  }
  return true;
};

/** z of the line `offset` metres north of the street's centre, at x (extended past the ends). */
function lineAt(offset: number) {
  const line = roadLine(offset);
  return (x: number) => {
    let i = line.findIndex((p) => p.x >= x);
    if (i === -1) i = line.length - 1;
    if (i === 0) i = 1;
    const a = line[i - 1];
    const b = line[i];
    return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
  };
}

// ----- Layout -----

export interface Yard {
  plot: Plot;
  /** The paved lot around the building. */
  polygon: Vector2[];
  /** The strip from the street's edge to the lot, through the gate. */
  drive: Vector2[];
  /**
   * The yard's perimeter fence: every edge but the street one, as runs of points. Where a neighbour's
   * fence already stands on the boundary (lots that touch) the stretch is left out here, so a
   * boundary has one fence, not two.
   */
  fence: Vector2[][];
  /** The yard's dividing barriers (see `Plot.divider`): the two runs either side of the gap. */
  barriers: [Vector2, Vector2][];
  /** The dividing barriers' whole line, gap included, and the gap's two ends (nearer the building first). */
  divider?: { line: [Vector2, Vector2]; gap: [Vector2, Vector2] };
}

export interface Layout {
  yards: Yard[];
  vehicles: Record<VehicleKind, Placement[]>;
  /** Short divider strokes painted between adjacent parking spaces. */
  parkingLines: [Vector2, Vector2][];
  /** x ranges where the north sidewalk / south fence are open for a gate. */
  northGates: [number, number][];
  southGates: [number, number][];
}

const gateWidthOf = (plot: Plot) => plot.gateWidth ?? GATE_WIDTH;
const gateStart = (plot: Plot) => plot.gate - gateWidthOf(plot) / 2;

/** Gate ranges (site x) of the lots on one side of the street. */
const gatesOf = (side: Plot['side']): [number, number][] =>
  PLOTS.filter((p) => p.side === side && p.yard.street).map((p) => [
    gateStart(p),
    gateStart(p) + gateWidthOf(p),
  ]);

/** Cab paint for the parked trucks: mostly the usual white and greys, a few coloured. */
export const CAB_PALETTE = [
  '#f1f1ee',
  '#f1f1ee',
  '#dfe3e6',
  '#7b8288',
  '#2f5d8a',
  '#a8322c',
  '#3b7a57',
  '#e0a020',
  '#1f2226',
  '#c96f1d',
];
export const PALETTE: Record<VehicleKind, string[]> = {
  /** The tank semi-trailer: white (no livery). */
  tanker: ['#eef0f0'],
  trailer: [
    '#f1f1ee',
    '#2f5d8a',
    '#a8322c',
    '#3b7a57',
    '#e0a020',
    '#7b8288',
    '#dfe3e6',
    '#1f4e79',
    '#c96f1d',
    '#e8e6dc',
  ],
  box: ['#f4f4f2', '#d9dde0', '#2f5d8a', '#c0392b', '#3b7a57', '#e6b422'],
  car: [
    '#c8ccd0',
    '#1f2226',
    '#a83232',
    '#2f5d8a',
    '#e6e6e6',
    '#6b7178',
    '#e2c34a',
    '#3e7a4b',
    '#8b5a2b',
    '#dcdad2',
  ],
  // Small Yugo-style hatches: period beige, white, red, blue, green.
  hatch: [
    '#d9c9a0',
    '#d9c9a0',
    '#e8e6e0',
    '#a83232',
    '#3b6ea5',
    '#4f7a4a',
    '#e2c34a',
    '#8b7a5a',
  ],
  sport: ['#c3c8cc', '#c3c8cc', '#1f2226', '#a83232'],
  van: ['#f4f4f2', '#f4f4f2', '#eceae4', '#c8ccd0', '#1f2226', '#2f5d8a'],
  bigvan: ['#f4f4f2', '#f4f4f2', '#1c1d20', '#dfe3e6', '#1f4e79'],
};

let yardsCache: Yard[] | undefined;
/** Every lot's yard, drive, perimeter fence and dividers (cheap; vehicles come with `getLayout`). */
export const getYards = (): Yard[] => (yardsCache ??= layoutYards());

let layoutCache: Layout | undefined;
/** The full layout, worked out once. Read-only: callers must not change it. */
export const getLayout = (): Layout => (layoutCache ??= layoutPlots());

/** Distance from `p` to a polyline. */
const distanceToLine = (p: Vector2, line: Vector2[]): number => {
  let best = Infinity;
  for (let i = 1; i < line.length; i++)
    best = Math.min(best, pointToSegment(p, line[i - 1], line[i]));
  return best;
};

/** Ramer-Douglas-Peucker: the run with every point that lies within `tolerance` of its neighbours' chord dropped. */
const simplify = (run: Vector2[], tolerance = 0.06): Vector2[] => {
  if (run.length < 3) return run;
  const a = run[0];
  const b = run[run.length - 1];
  let worst = -1;
  let at = 0;
  for (let i = 1; i < run.length - 1; i++) {
    const d = pointToSegment(run[i], a, b);
    if (d > worst) {
      worst = d;
      at = i;
    }
  }
  if (worst <= tolerance) return [a, b];
  return [
    ...simplify(run.slice(0, at + 1), tolerance),
    ...simplify(run.slice(at), tolerance).slice(1),
  ];
};

/** How close two lots' fences must be to count as one shared fence (m). */
const SHARED = 1.6;

/**
 * Each yard's fence outline with the stretches a neighbour's fence already covers cut out: lots that
 * touch share their boundary fence (the first lot of the pair builds it); a boundary to an empty lot keeps
 * its own. Returns, per outline, the remaining runs.
 */
const sharedFences = (outlines: Vector2[][]): Vector2[][][] =>
  outlines.map((outline, j) => {
    // Sample the outline every 0.5 m.
    const samples: { p: Vector2; shared: boolean }[] = [];
    for (let i = 1; i < outline.length; i++) {
      const a = outline[i - 1];
      const b = outline[i];
      const n = Math.max(1, Math.ceil(a.distanceTo(b) / 0.5));
      for (let k = i === 1 ? 0 : 1; k <= n; k++) {
        const p = a.clone().lerp(b, k / n);
        samples.push({
          p,
          shared: outlines
            .slice(0, j)
            .some((o) => distanceToLine(p, o) < SHARED),
        });
      }
    }
    const runs: Vector2[][] = [];
    let run: Vector2[] = [];
    for (const s of samples) {
      if (s.shared) {
        if (run.length > 1) runs.push(run);
        run = [];
      } else run.push(s.p);
    }
    if (run.length > 1) runs.push(run);
    // Keep runs longer than 1 m (by length: a lot fenced all round is one closed run whose ends meet).
    const length = (r: Vector2[]) =>
      r.reduce((sum, p, i) => (i ? sum + p.distanceTo(r[i - 1]) : 0), 0);
    // A closed run (first point = last) has no chord to simplify against: simplify its two halves.
    const tidy = (r: Vector2[]) => {
      if (r.length < 4 || r[0].distanceTo(r[r.length - 1]) > 0.01)
        return simplify(r);
      const mid = Math.floor(r.length / 2);
      return [
        ...simplify(r.slice(0, mid + 1)),
        ...simplify(r.slice(mid)).slice(1),
      ];
    };
    return runs.map(tidy).filter((r) => length(r) > 1);
  });

const layoutYards = (): Yard[] => {
  const northFence = lineAt(NORTH_FENCE + 0.4);
  const southFence = lineAt(SOUTH_FENCE - 0.4);
  const northEdge = lineAt(ROAD.half);
  const southEdge = lineAt(-ROAD.half);

  const raw = PLOTS.map((plot) => {
    if (!plot.yard.street) {
      // Off the street: the traced outline is the whole lot, fenced all round (open lots: no fence).
      const polygon = plot.yard.back.map(v);
      return {
        plot,
        polygon,
        drive: [] as Vector2[],
        outline: [...polygon, polygon[0]],
        barriers: [] as Yard['barriers'],
        divider: undefined,
      };
    }
    const north = plot.side === 'north';
    const streetFence = north ? northFence : southFence;
    // Along the (curving) street fence every 5 m, then round the traced back.
    const [x0, x1] = plot.yard.street;
    const front: Vector2[] = [];
    for (let x = x0; x < x1; x += 5) front.push(new Vector2(x, streetFence(x)));
    front.push(new Vector2(x1, streetFence(x1)));
    const back = plot.yard.back.map(v);
    const polygon = [...front, ...back];
    // The fence: everything but the street edge, from the east end of the frontage round to the west end.
    const outline = [front[front.length - 1], ...back, front[0]];
    // Straight across the sidewalk and verge, then on until it meets the lot.
    const edge = north ? northEdge : southEdge;
    const step = north ? -0.5 : 0.5;
    const ends = [gateStart(plot), gateStart(plot) + gateWidthOf(plot)].map(
      (x) => {
        let z = edge(x);
        for (let n = 0; n < 400 && !inside(new Vector2(x, z), polygon); n++)
          z += step;
        return new Vector2(x, z + step * 4);
      },
    );
    const [a, b] = ends;
    const drive = [
      new Vector2(a.x, edge(a.x)),
      new Vector2(b.x, edge(b.x)),
      b,
      a,
    ];
    // The dividing fence, out to wherever it meets the perimeter (nearest hit, as a ray).
    const barriers: Yard['barriers'] = [];
    let divider: Yard['divider'];
    if (plot.divider) {
      const from = v(plot.divider.from);
      const dir = v(plot.divider.to).sub(from).normalize();
      let reach = Infinity;
      for (let k = 1; k < outline.length; k++) {
        const fa = outline[k - 1];
        const e = outline[k].clone().sub(fa);
        const denom = dir.cross(e);
        if (Math.abs(denom) < 1e-9) continue;
        const w = fa.clone().sub(from);
        const t = w.cross(e) / denom;
        const u = w.cross(dir) / denom;
        if (t > 0 && u >= 0 && u <= 1) reach = Math.min(reach, t);
      }
      const at = (t: number) => from.clone().addScaledVector(dir, t);
      const [g0, g1] = plot.divider.gate;
      for (const run of [
        [from, at(g0)],
        [at(g1), at(reach)],
      ] as [Vector2, Vector2][])
        if (run[0].distanceTo(run[1]) > 0.5) barriers.push(run);
      divider = { line: [from, at(reach)], gap: [at(g0), at(g1)] };
    }
    return { plot, polygon, drive, outline, barriers, divider };
  });

  // Open lots have no fence: they drop out before the neighbours' fences are shared out.
  const fences = sharedFences(raw.map((r) => (r.plot.open ? [] : r.outline)));
  return raw.map(({ plot, polygon, drive, barriers, divider }, i) => ({
    plot,
    polygon,
    drive,
    fence: fences[i],
    barriers,
    divider,
  }));
};

const layoutPlots = (): Layout => {
  const random = seeded(23);
  const pick = <T>(list: T[], rng = random) =>
    list[Math.floor(rng() * list.length)];
  const yards = getYards();

  const footprints = [
    ...PLOTS.flatMap((p) =>
      [
        p.corners,
        p.annex?.corners ?? [],
        ...(p.more ?? []).map((m) => m.corners),
      ]
        .filter((c) => c.length)
        .map((c) => c.map(v)),
    ),
    MILEKS_CORNERS.map(v),
  ];

  // No vehicle parks on the dividing barriers or in the gap between them.
  const dividers = yards.flatMap(({ divider }) => {
    if (!divider) return [];
    const ends = divider.line;
    const side = new Vector2(-(ends[1].y - ends[0].y), ends[1].x - ends[0].x)
      .normalize()
      .multiplyScalar(0.1);
    return [
      [
        ends[0].clone().add(side),
        ends[1].clone().add(side),
        ends[1].clone().sub(side),
        ends[0].clone().sub(side),
      ],
    ];
  });
  const blockers = [...footprints, ...yards.map((y) => y.drive), ...dividers];
  const placed: {
    yard: Yard;
    polygon: Vector2[];
    kind: VehicleKind;
    p: Placement;
  }[] = [];

  const truck = (k: VehicleKind) =>
    k === 'trailer' || k === 'tanker' || k === 'box';
  const tryPlace = (
    yard: Yard,
    kind: VehicleKind,
    at: Vector2,
    heading: number,
    force = false,
    rng = random,
    ignoreCaps = false,
  ): boolean => {
    const { length, width } = VEHICLE_SIZE[kind];
    const f = new Vector2(Math.cos(heading), -Math.sin(heading));
    const r = new Vector2(-f.y, f.x);
    const corners = [
      [1, 1],
      [1, -1],
      [-1, -1],
      [-1, 1],
    ].map(([i, j]) =>
      at
        .clone()
        .addScaledVector(f, (i * length) / 2)
        .addScaledVector(r, (j * width) / 2),
    );
    if (!force) {
      const here = placed.filter((o) => o.yard === yard);
      const { maxVehicles, maxTrucks, maxCars } = yard.plot;
      const full = (max: number | undefined, count: number) =>
        !ignoreCaps && max !== undefined && count >= max;
      if (full(maxVehicles, here.length)) return false;
      if (
        truck(kind) &&
        full(maxTrucks, here.filter((o) => truck(o.kind)).length)
      )
        return false;
      if (
        !truck(kind) &&
        full(maxCars, here.filter((o) => !truck(o.kind)).length)
      )
        return false;
      if (!corners.every((c) => inside(c, yard.polygon))) return false;
      if (blockers.some((b) => overlaps(corners, b, 0.6))) return false;
      if (placed.some((o) => overlaps(corners, o.polygon, 0.35))) return false;
    }
    placed.push({
      yard,
      polygon: corners,
      kind,
      p: {
        x: at.x,
        z: at.y,
        heading,
        color: pick(PALETTE[kind], rng),
        ...(truck(kind) && { cabColor: pick(CAB_PALETTE, rng) }),
      },
    });
    return true;
  };

  // Hand-parked vehicles first, so the rows work round them.
  for (const yard of yards)
    for (const { kind, at, heading, color, cabColor } of yard.plot.fixed ??
      []) {
      tryPlace(yard, kind, new Vector2(at[0], at[1]), heading, true);
      const p = placed[placed.length - 1].p;
      if (color) p.color = color;
      if (cabColor) p.cabColor = cabColor;
    }
  for (const yard of yards) {
    const edges = edgesOf(yard.plot.corners);
    for (const spec of yard.plot.rows) {
      const wall = spec.fence
        ? insideFence(yard, spec.fence)
        : rowLine(spec, edges);
      if (!wall) continue;
      const { length, width } = VEHICLE_SIZE[spec.kind];
      const dock = spec.layout === 'dock';
      const spacing = dock ? width + 1 : length + 1.2;
      const gap = spec.gap ?? (dock ? 1.4 : 1.5);
      const heading = (dir: Vector2) => Math.atan2(-dir.y, dir.x);
      // A car slot sometimes holds a van (the long ones only fit nose-in) or a small hatch.
      const pickKind = (): VehicleKind => {
        if (spec.kind !== 'car') return spec.kind;
        const r = random();
        const share = spec.vans ?? 0.2;
        if (r >= share) return random() < 0.3 ? 'hatch' : 'car';
        return dock && r < share * 0.4 ? 'bigvan' : 'van';
      };
      let placedHere = 0;
      for (let t = 1; t + spacing / 2 < wall.length; t += spacing) {
        if (placedHere >= (spec.count ?? Infinity) || spec.fill === 0) break;
        if (random() > (spec.fill ?? 0.9)) continue;
        const skipped = (t - 1) / spacing < (spec.skip ?? 0) - 0.5;
        const kind = pickKind();
        const size = VEHICLE_SIZE[kind];
        const out = gap + (dock ? size.length : size.width) / 2;
        const centre = wall.a
          .clone()
          .addScaledVector(wall.dir, t + spacing / 2)
          .addScaledVector(wall.normal, out + (random() - 0.5) * 0.3);
        const facing = dock
          ? spec.noseIn
            ? wall.normal.clone().negate()
            : wall.normal
          : wall.dir;
        const wobble = (random() - 0.5) * 0.06;
        // (The random draws above still happen, so the bays after the skipped ones keep their fill.)
        if (!skipped && tryPlace(yard, kind, centre, heading(facing) + wobble))
          placedHere++;
      }
    }
  }

  // Top up the rows that ask for it, in empty bays only.
  const dressing = seeded(41);
  for (const yard of yards) {
    const edges = edgesOf(yard.plot.corners);
    for (const spec of yard.plot.rows) {
      const wall = spec.extra ? rowLine(spec, edges) : undefined;
      if (!wall || !spec.extra) continue;
      const { length, width } = VEHICLE_SIZE[spec.kind];
      const dock = spec.layout === 'dock';
      const spacing = dock ? width + 1 : length + 1.2;
      const gap = spec.gap ?? (dock ? 1.4 : 1.5);
      const bays: number[] = [];
      for (
        let t = 1 + (spec.skip ?? 0) * spacing;
        t + spacing / 2 < wall.length;
        t += spacing
      )
        bays.push(t);
      if (spec.extraFrom === 'end') bays.reverse();
      const facing = spec.noseIn ? wall.normal.clone().negate() : wall.normal;
      const along = dock ? facing : wall.dir;
      const out = gap + (dock ? length : width) / 2;
      let left = spec.extra;
      // From evenly spaced starting bays, the first empty one at or after each.
      for (let i = 0; i < spec.extra; i++) {
        const from = spec.extraFrom
          ? 0
          : Math.floor(((i + 0.5) * bays.length) / spec.extra);
        for (let k = from; k < bays.length && left > 0; k++) {
          const centre = wall.a
            .clone()
            .addScaledVector(wall.dir, bays[k] + spacing / 2)
            .addScaledVector(wall.normal, out);
          const wobble = (dressing() - 0.5) * 0.06;
          const placedNow = tryPlace(
            yard,
            spec.kind,
            centre,
            Math.atan2(-along.y, along.x) + wobble,
            false,
            dressing,
            true,
          );
          if (placedNow) {
            left--;
            break;
          }
        }
      }
    }
  }

  const vehicles: Layout['vehicles'] = {
    trailer: [],
    tanker: [],
    box: [],
    car: [],
    hatch: [],
    sport: [],
    van: [],
    bigvan: [],
  };
  for (const { kind, p } of placed) vehicles[kind].push(p);

  // Painted dividers at every bay boundary, filled or not: car rows, and the free-standing truck
  // rows along fences. Trucks at a building's docks stand at its doors instead.
  const parkingLines: Layout['parkingLines'] = [];
  for (const yard of yards) {
    const edges = edgesOf(yard.plot.corners);
    for (const spec of yard.plot.rows) {
      if (spec.kind === 'sport' || (spec.kind !== 'car' && !spec.line))
        continue;
      const wall = spec.fence
        ? insideFence(yard, spec.fence)
        : rowLine(spec, edges);
      if (!wall) continue;
      const { length, width } = VEHICLE_SIZE[spec.kind];
      const dock = spec.layout === 'dock';
      const spacing = dock ? width + 1 : length + 1.2;
      const gap = spec.gap ?? (dock ? 1.4 : 1.5);
      const depth = (dock ? length : width) + 0.6;
      for (
        let t = 1 + (spec.skip ?? 0) * spacing;
        t < wall.length;
        t += spacing
      ) {
        const a = wall.a
          .clone()
          .addScaledVector(wall.dir, t)
          .addScaledVector(wall.normal, gap - 0.3);
        const b = a.clone().addScaledVector(wall.normal, depth);
        if (!inside(a, yard.polygon) || !inside(b, yard.polygon)) continue;
        // Not across the dividing barriers.
        const side = new Vector2(-(b.y - a.y), b.x - a.x)
          .normalize()
          .multiplyScalar(0.05);
        const stroke = [
          a.clone().add(side),
          b.clone().add(side),
          b.clone().sub(side),
          a.clone().sub(side),
        ];
        if (dividers.some((d) => overlaps(stroke, d, 0.5))) continue;
        parkingLines.push([a, b]);
      }
    }
  }

  return {
    yards,
    vehicles,
    parkingLines,
    northGates: gatesOf('north'),
    southGates: gatesOf('south'),
  };
};
