import { hash3, Rng } from '../../../shared/rng';
import { TEAM_COUNT } from '../assets/builders/teams';
import {
  ASSET_CATALOG,
  SPECTATOR_SEATED_COUNT,
  SPECTATOR_SEATED_FROM,
} from '../assets/catalog';
import { lotContains, lotWorld } from '../maps/shared/service-lot';
import type { Country, ServiceLot, ServicePark } from '../maps/shared/types';
import { fanVariant } from './fan-variants';
import { newRoadQuery, type Road } from './road';
import type { ScatterInstance } from './scatter';

/** Every asset a service park uses (the streamer's prewarm / view distance). */
export const SERVICE_PARK_ASSETS = [
  'service_truck',
  'service_semi',
  'service_van',
  'car_trailer',
  'pickup',
  'gazebo',
  'gazebo_long',
  'team_car',
  'tyre_stack',
  'tool_chest',
  'table_chairs',
  'generator',
  'feather_flag',
  'ground_sheet',
  'trolley_jack',
  'food_truck',
  'porta_toilet',
  'fuel_trailer',
  'control_board',
  'mechanic',
  'crew',
  'driver',
  'marshal',
  'photographer',
  'visitor',
  'spectator',
  'tape_post',
  'ambulance',
];

/** Variants of a people asset (the people kit owns the count; the catalog states it). */
const variantsOf = (id: string): number =>
  ASSET_CATALOG.find((a) => a.id === id)?.variants ?? 1;

export interface ServiceParkContext {
  /** The stage road (the park's lots sit beside it, the start control on it). */
  road: Road;
  /** Stage distance of the start line (m). */
  start: number;
  height: (x: number, z: number) => number;
  /**
   * True where a piece of radius `r` cannot stand (buildings, water, other roads, ...); `paved` (a lot on a street):
   * the road surface of other roads does not count.
   */
  blocked: (x: number, z: number, r: number, paved?: boolean) => boolean;
  /** Seed when the definition has none (hash of the stage id). */
  seed: number;
  /** The map's country: a share of the crowd waves its hand flag (none without one). */
  country?: Country;
}

export interface ServiceParkLayout {
  instances: ScatterInstance[];
  /** Team bays that fit (each has a team car). */
  bays: number;
  /** Teams' bay centres (world x, z) in the order they were laid out. */
  bayCentres: { x: number; z: number; team: number }[];
}

/** Bay depth (m) from the back edge (trucks) to the front (cars, tents, people); two rows face one aisle. */
const BAY_DEPTH = 11;

type Template = 'works' | 'privateer' | 'small' | 'ferme';
const WIDTH: Record<Template, number> = {
  works: 21,
  privateer: 13.5,
  small: 9.5,
  ferme: 3.6,
};
/** Along-the-lot width of a parc fermé bay: nose-in cars stand close, parallel-parked ones nose to tail (m). */
const fermeWidth = (lot: ServiceLot): number => (lot.parallel ? 5.4 : 3.6);

type Item = ScatterInstance & { must: boolean };

/** One bay under construction: world pieces, dropped as a whole when a vehicle or the car cannot stand. */
interface BayCtx {
  put(
    asset: string,
    variant: number,
    bx: number,
    bz: number,
    /** Local turn about Y (rad): a car's nose direction or a person's facing (0 = front of the bay). */
    turn?: number,
    o?: { must?: boolean; r?: number; sx?: number; sz?: number },
  ): void;
  /** The facing that looks from (bx, bz) towards (tx, tz). */
  face(bx: number, bz: number, tx: number, tz: number): number;
  /** True when nothing but a ground sheet stands within `r` m of (bx, bz). */
  clear(bx: number, bz: number, r: number): boolean;
}

/**
 * Service park beside a stage start (StageDef.servicePark): team bays on level lots (two rows round an aisle, trucks
 * and vans at the back, cars on ground sheets under awnings and tents, tyres, tools, flags, 3-6 people each), tape and
 * a crowd along the public edge, support vehicles in the aisle and - at the start line - the control tent, boards,
 * marshals and a rescue ambulance. Deterministic from the seed; a piece that would stand on a building / water / road is
 * dropped, and a bay whose vehicles or car cannot stand is dropped whole (the generator tries a few layouts and keeps
 * the one with the most bays).
 */
export function serviceParkInstances(
  def: ServicePark,
  ctx: ServiceParkContext,
): ServiceParkLayout {
  const seed = def.seed ?? ctx.seed;
  let best: ServiceParkLayout | undefined;
  for (let attempt = 0; attempt < 8; attempt++) {
    const layout = layBays(def, ctx, hash3(attempt, 31, 7, seed));
    if (!best || layout.bays > best.bays) best = layout;
    if (best.bays >= def.bays) break;
  }
  const out = best!;
  const rng = new Rng(hash3(5, 11, 3, seed));
  addPublicEdge(out, def, ctx, rng);
  if (def.startControl) addStartControl(out, ctx, rng);
  return out;
}

/** True inside any lot grown by `margin` (scatter exclusion: trees, grass, rocks). */
export function serviceParkOccupies(
  def: ServicePark,
  x: number,
  z: number,
  margin = 0,
): boolean {
  return def.lots.some((l) => lotContains(l, x, z, margin));
}

// --- bays --------------------------------------------------------------------------------------

function layBays(
  def: ServicePark,
  ctx: ServiceParkContext,
  seed: number,
): ServiceParkLayout {
  const rng = new Rng(seed);
  const teams = shuffle([...Array(TEAM_COUNT).keys()], rng);
  const layout: ServiceParkLayout = { instances: [], bays: 0, bayCentres: [] };
  const ferme = !!def.ferme;
  const gap = def.gap ?? (ferme ? 0.6 : 5);
  let next = 0;
  for (const lot of def.lots) {
    const rows = !ferme && !lot.semis && lot.width >= 2 * BAY_DEPTH + 4 ? 2 : 1;
    const firstCentre = layout.bayCentres.length;
    let inLot = 0;
    for (let r = 0; r < rows && layout.bays < def.bays; r++) {
      // Row 0 backs on v = BAY_DEPTH (front at the public edge), row 1 on the far edge of the lot; a parc fermé row
      // fills the lot's whole depth.
      const vBack = ferme ? lot.width : r === 0 ? BAY_DEPTH : lot.width;
      let uEast = lot.length - (ferme ? 1.2 : 1.5);
      let first = !ferme;
      while (layout.bays < def.bays && inLot < (lot.bays ?? Infinity)) {
        // Each row opens with a works team (truck + awning, two cars), the rest is drawn; a parc fermé is cars only.
        const template: Template | undefined = ferme
          ? fermeWidth(lot) <= uEast - 1.2
            ? 'ferme'
            : undefined
          : first
            ? 'works'
            : pickTemplate(rng, uEast - 1.5);
        first = false;
        if (!template) break;
        const w = template === 'ferme' ? fermeWidth(lot) : WIDTH[template];
        const team = teams[next % TEAM_COUNT];
        const bay = buildBay(lot, uEast, vBack, template, team, ctx, rng);
        uEast -= w + gap;
        if (!bay) continue;
        next++;
        inLot++;
        layout.bays++;
        layout.instances.push(...bay.items);
        layout.bayCentres.push({ ...bay.centre, team });
      }
    }
    if (lot.semis)
      addSemis(layout, lot, ctx, layout.bayCentres.slice(firstCentre));
  }
  return layout;
}

/** Length of a team semi (m), the aisle between the bays and the trucks, and the most room one gets along the lot. */
const SEMI_LENGTH = 17.5;
const SEMI_AISLE = 6;
const SEMI_PITCH = 11;

/**
 * The truck park of a lot (`ServiceLot.semis`): tractor-trailer team trucks side by side across the lot behind the
 * bays, noses to the back edge, each in the colours of the team whose bay is nearest. One that cannot stand (buildings,
 * water) is left out.
 */
function addSemis(
  layout: ServiceParkLayout,
  lot: ServiceLot,
  ctx: ServiceParkContext,
  centres: ServiceParkLayout['bayCentres'],
): void {
  const count = lot.semis ?? 0;
  const pitch = Math.min(SEMI_PITCH, (lot.length - 4) / count);
  const v = BAY_DEPTH + SEMI_AISLE + SEMI_LENGTH / 2;
  for (let i = 0; i < count; i++) {
    const u = lot.length / 2 + (i - (count - 1) / 2) * pitch;
    const [x, z] = lotWorld(lot, u, v);
    const ends = [-1, 1].map((k) => lotWorld(lot, u, v + k * 7.2));
    if (
      ctx.blocked(x, z, 2.5, lot.paved) ||
      ends.some(([ex, ez]) => ctx.blocked(ex, ez, 1.5, lot.paved))
    )
      continue;
    let team = i % TEAM_COUNT;
    let nearest = Infinity;
    for (const c of centres) {
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < nearest) [nearest, team] = [d, c.team];
    }
    layout.instances.push({
      asset: 'service_semi',
      variant: team,
      x,
      y: ctx.height(x, z),
      z,
      // The model's nose is +x: turned to +v, away from the public edge.
      rotY: -Math.PI / 2 - lot.heading,
      scale: 1,
      tiltX: 0,
      tiltZ: 0,
    });
  }
}

/** A template that still fits in `room` m: seeded, favouring privateers and small teams. */
function pickTemplate(rng: Rng, room: number): Template | undefined {
  const fits = (t: Template) => WIDTH[t] <= room;
  const roll = rng.next();
  const order: Template[] =
    roll < 0.25
      ? ['works', 'privateer', 'small']
      : roll < 0.7
        ? ['privateer', 'small', 'works']
        : ['small', 'privateer', 'works'];
  return order.find(fits);
}

function shuffle<T>(a: T[], rng: Rng): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildBay(
  lot: ServiceLot,
  uEast: number,
  vBack: number,
  template: Template,
  team: number,
  ctx: ServiceParkContext,
  rng: Rng,
): { items: ScatterInstance[]; centre: { x: number; z: number } } | undefined {
  const items: Item[] = [];
  const theta = Math.PI - lot.heading;
  const toWorld = (bx: number, bz: number): [number, number] =>
    lotWorld(lot, uEast - bx, vBack - bz);
  const bay: BayCtx = {
    put(asset, variant, bx, bz, turn = 0, o = {}) {
      const [x, z] = toWorld(bx, bz);
      if (ctx.blocked(x, z, o.r ?? 0.6, lot.paved)) {
        if (o.must) items.push(DROPPED);
        return;
      }
      items.push({
        asset,
        variant,
        x,
        y: ctx.height(x, z),
        z,
        rotY: theta + turn,
        scale: 1,
        tiltX: 0,
        tiltZ: 0,
        sx: o.sx,
        sz: o.sz,
        must: !!o.must,
      });
    },
    face: (bx, bz, tx, tz) => Math.atan2(tx - bx, tz - bz),
    clear(bx, bz, r) {
      const [x, z] = toWorld(bx, bz);
      return !items.some(
        (i) => i.asset !== 'ground_sheet' && Math.hypot(i.x - x, i.z - z) < r,
      );
    },
  };
  const width = template === 'ferme' ? fermeWidth(lot) : WIDTH[template];
  const carIdx = rng.chance(0.4) ? team + TEAM_COUNT : team;
  if (template === 'works') works(bay, width, team, carIdx, rng);
  else if (template === 'privateer') privateer(bay, width, team, carIdx, rng);
  else if (template === 'ferme')
    ferme(bay, width, team, vBack, !!lot.parallel, rng);
  else small(bay, width, team, carIdx, rng);
  if (items.some((i) => i === DROPPED)) return undefined;
  const [cx, cz] = toWorld(
    width / 2,
    template !== 'ferme'
      ? BAY_DEPTH / 2
      : lot.parallel
        ? vBack - STREET_CAR_V
        : vBack / 2,
  );
  return {
    items: items.map(({ must: _must, ...i }) => i),
    centre: { x: cx, z: cz },
  };
}

/** Marker for a vehicle / car that could not stand: the bay is dropped. */
const DROPPED: Item = {
  asset: '__dropped__',
  variant: 0,
  x: 0,
  y: 0,
  z: 0,
  rotY: 0,
  scale: 1,
  tiltX: 0,
  tiltZ: 0,
  must: true,
};

const SHEET = [0, 1, 2, 3];

/**
 * People round a car at (cx, cz) whose nose points along `fwd` (+1 / -1 along the bay): a mechanic crouching at the
 * front wheel, one bent over the nose, one kneeling at the rear wheel (a raised car's changed wheel), a crew member
 * carrying a tyre in.
 */
function carCrew(
  bay: BayCtx,
  team: number,
  cx: number,
  cz: number,
  fwd: number,
  raised: boolean,
  rng: Rng,
  count: number,
): void {
  const side = rng.chance(0.5) ? 1 : -1;
  const jit = () => rng.range(-0.2, 0.2);
  const list: (() => void)[] = [
    () => {
      const x = cx + fwd * 1.4;
      const z = cz + side * 1.45;
      bay.put(
        'mechanic',
        team,
        x,
        z,
        bay.face(x, z, cx + fwd * 1.4, cz) + jit(),
        { r: 0.4 },
      );
    },
    () => {
      const x = cx + fwd * 3.0;
      bay.put(
        'mechanic',
        team + TEAM_COUNT,
        x,
        cz + jit(),
        bay.face(x, cz, cx, cz) + jit(),
        { r: 0.4 },
      );
    },
    () => {
      const x = cx - fwd * 1.4;
      const z = cz - side * 1.45;
      bay.put(
        'mechanic',
        team + 2 * TEAM_COUNT,
        x,
        z,
        bay.face(x, z, x, cz) + jit(),
        { r: 0.4 },
      );
    },
    () => {
      const x = cx - fwd * 0.6;
      const z = cz + side * 2.6;
      bay.put(
        'crew',
        team,
        x,
        z,
        bay.face(x, z, cx - fwd * 1.4, cz + side * 1.4),
        { r: 0.4 },
      );
    },
  ];
  list.push(
    // The strategist with a laptop on the far side, and a crew member watching from behind the car.
    () => {
      const x = cx + fwd * 0.6;
      const z = cz - side * 3.0;
      bay.put('crew', team + TEAM_COUNT, x, z, bay.face(x, z, cx, cz) + jit(), {
        r: 0.4,
      });
    },
    () => {
      const x = cx - fwd * 3.3;
      const z = cz + side * 0.9;
      bay.put(
        'crew',
        team + 2 * TEAM_COUNT,
        x,
        z,
        bay.face(x, z, cx, cz) + jit(),
        { r: 0.4 },
      );
    },
  );
  if (raised) list.unshift(...list.splice(2, 1));
  for (const f of list.slice(0, count)) f();
  // The raised car's rear wheels (the model has them off) lie in a stack beside the mechanic changing them.
  if (raised)
    bay.put('tyre_stack', 0, cx - fwd * 1.5, cz - side * 2.25, 0, { r: 0.4 });
}

/** A team car on its ground sheet with its crew (the car faces along +bx or -bx). */
function carSpot(
  bay: BayCtx,
  team: number,
  carVariant: number,
  cx: number,
  cz: number,
  rng: Rng,
  people: number,
): void {
  const fwd = rng.chance(0.5) ? 1 : -1;
  bay.put('ground_sheet', rng.pick(SHEET), cx, cz, 0, {
    sx: 7.2,
    sz: 4.4,
    r: 0.2,
  });
  bay.put('team_car', carVariant, cx, cz, fwd > 0 ? 0 : Math.PI, {
    must: true,
    r: 2.4,
  });
  carCrew(bay, team, cx, cz, fwd, carVariant >= TEAM_COUNT, rng, people);
}

/** A visitor variant: any persona (ages, sizes, clothes), a pose from `firstPose` (0 = walking) to standing. */
const visitorLook = (rng: Rng, firstPose = 0): number =>
  rng.int(0, variantsOf('visitor') / 4 - 1) * 4 + rng.int(firstPose, 3);

/**
 * Guests at the front of a bay (journalists, friends, local fans): singles and chatting pairs on free ground between
 * the cars and the walkway.
 */
function guests(bay: BayCtx, w: number, rng: Rng, count: number): void {
  for (let i = 0; i < count; i++) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const bx = rng.range(2.2, w - 2.2);
      const bz = rng.range(8.6, 10.6);
      const pair = rng.chance(0.55);
      const bx2 = bx + (rng.chance(0.5) ? 0.9 : -0.9);
      const bz2 = bz + rng.range(-0.25, 0.25);
      if (!bay.clear(bx, bz, 0.9) || (pair && !bay.clear(bx2, bz2, 0.9)))
        continue;
      // Drink, phone, hands in pockets (visitor variants are 4 * persona + pose, pose 0 = walking).
      const v = () => visitorLook(rng, 1);
      if (pair) {
        bay.put('visitor', v(), bx, bz, bay.face(bx, bz, bx2, bz2), { r: 0.4 });
        bay.put('visitor', v(), bx2, bz2, bay.face(bx2, bz2, bx, bz), {
          r: 0.4,
        });
        i++;
      } else {
        bay.put('visitor', v(), bx, bz, rng.range(-1.2, 1.2), { r: 0.4 });
      }
      break;
    }
  }
}

function works(
  bay: BayCtx,
  w: number,
  team: number,
  carVariant: number,
  rng: Rng,
): void {
  const tx = 6.4;
  bay.put('service_truck', team, tx, 2.0, 0, { must: true, r: 4.6 });
  carSpot(bay, team, carVariant, tx, 5.1, rng, 6);
  // Second car, a tent and the work table behind it.
  const cx = w - 5.8;
  const second = rng.chance(0.5) ? team + TEAM_COUNT : team;
  carSpot(bay, team, second, cx, 6.6, rng, 5);
  bay.put('gazebo_long', team, cx, 2.7, 0, { r: 1.6 });
  bay.put('table_chairs', 0, cx + 0.5, 1.9, 0, { r: 1 });
  bay.put('crew', team + TEAM_COUNT, cx - 1.4, 3.4, 0.4, { r: 0.4 });
  bay.put('crew', team + 2 * TEAM_COUNT, cx + 2.2, 4.1, -0.5, { r: 0.4 });
  bay.put('tool_chest', team % 4, 12.3, 4.4, 0, { r: 0.7 });
  bay.put('generator', 0, 12.4, 1.5, 0, { r: 0.7 });
  bay.put('tyre_stack', 0, 2.6, 8.0, 0, { r: 0.4 });
  bay.put('tyre_stack', 1, 3.5, 8.4, 0, { r: 0.4 });
  bay.put('tyre_stack', 2, 12.6, 9.0, 0, { r: 0.4 });
  bay.put('trolley_jack', 0, tx + 2.9, 6.9, rng.range(-0.4, 0.4), { r: 0.4 });
  bay.put('feather_flag', team, 0.8, 9.7, 0, { r: 0.3 });
  bay.put('feather_flag', team, w - 0.8, 9.7, 0, { r: 0.3 });
  bay.put(
    'driver',
    team + TEAM_COUNT * (rng.chance(0.5) ? 1 : 0),
    15.5,
    9.4,
    rng.range(-0.8, 0.8),
    { r: 0.4 },
  );
  bay.put('crew', team, 11.2, 7.4, rng.range(-0.8, 0.8), { r: 0.4 });
  // The co-driver beside the driver, one more at the truck, guests out front.
  bay.put('driver', team + TEAM_COUNT, 16.6, 9.0, rng.range(-0.8, 0.8), {
    r: 0.4,
  });
  bay.put('crew', team, 1.4, 4.2, 1.2, { r: 0.4 });
  guests(bay, w, rng, 4);
}

function privateer(
  bay: BayCtx,
  w: number,
  team: number,
  carVariant: number,
  rng: Rng,
): void {
  bay.put('service_van', team, 3.5, 1.7, 0, { must: true, r: 2.8 });
  bay.put('car_trailer', rng.int(0, 1), 9.6, 1.7, Math.PI, { r: 2.6 });
  carSpot(bay, team, carVariant, 7.2, 6.6, rng, 5);
  bay.put('gazebo', team, 2.3, 6.9, 0, { r: 1.6 });
  bay.put('table_chairs', 0, 2.3, 6.2, 0, { r: 1 });
  bay.put('crew', team + TEAM_COUNT, 2.9, 8.3, -0.4, { r: 0.4 });
  bay.put('tyre_stack', 1, w - 1.8, 5.2, 0, { r: 0.4 });
  bay.put('tyre_stack', 2, w - 1.0, 5.8, 0, { r: 0.4 });
  bay.put('tool_chest', (team + 1) % 4, w - 1.2, 8.1, 0, { r: 0.7 });
  bay.put('feather_flag', team, w - 0.6, 10.2, 0, { r: 0.3 });
  bay.put('driver', team, 5.2, 9.6, rng.range(-0.6, 0.6), { r: 0.4 });
  bay.put('crew', team, w - 3.4, 3.2, -1.3, { r: 0.4 });
  bay.put('crew', team + 2 * TEAM_COUNT, 3.6, 4.6, 0.9, { r: 0.4 });
  guests(bay, w, rng, 3);
}

function small(
  bay: BayCtx,
  w: number,
  team: number,
  carVariant: number,
  rng: Rng,
): void {
  bay.put('pickup', team, w - 3.2, 1.7, 0, { must: true, r: 2.7 });
  carSpot(bay, team, carVariant, 4.4, 6.4, rng, 4);
  bay.put('tyre_stack', 0, 1.0, 3.2, 0, { r: 0.4 });
  bay.put('tyre_stack', 1, 1.0, 4.0, 0, { r: 0.4 });
  bay.put('tool_chest', (team + 2) % 4, w - 1.1, 7.0, 0, { r: 0.7 });
  bay.put('feather_flag', team, 0.7, 10.3, 0, { r: 0.3 });
  bay.put('driver', team + TEAM_COUNT, w - 2.8, 9.4, rng.range(-0.6, 0.6), {
    r: 0.4,
  });
  bay.put('crew', team, w - 2.2, 4.4, -1.6, { r: 0.4 });
  guests(bay, w, rng, 2);
}

/** Parallel-parked car: its centre line this far in from the kerb on the public edge (m). */
const STREET_CAR_V = 1.5;

/**
 * Parc fermé bay: one team car on its ground sheet, nose towards the public edge, the next car close beside it; now and
 * then a crew member or the driver stands in front of it. On a street (`parallel`) the cars stand nose to tail along
 * the kerb, no sheets, and the person on the pavement beside the car.
 */
function ferme(
  bay: BayCtx,
  w: number,
  team: number,
  depth: number,
  parallel: boolean,
  rng: Rng,
): void {
  if (parallel) {
    const cz = depth - STREET_CAR_V;
    bay.put('team_car', team, w / 2, cz, Math.PI, { must: true, r: 2.2 });
    if (rng.chance(0.5)) {
      const x = w / 2 + rng.range(-1, 1);
      const z = depth + 0.5;
      const who = rng.chance(0.5) ? 'driver' : 'crew';
      bay.put(
        who,
        team + TEAM_COUNT * rng.int(0, 1),
        x,
        z,
        bay.face(x, z, w / 2, cz) + rng.range(-0.4, 0.4),
        { r: 0.4 },
      );
    }
    return;
  }
  const cx = w / 2;
  const cz = 2.9;
  bay.put('ground_sheet', rng.pick(SHEET), cx, cz, 0, {
    sx: w - 0.2,
    sz: 5.6,
    r: 0.2,
  });
  bay.put('team_car', team, cx, cz, -Math.PI / 2, { must: true, r: 2.2 });
  if (rng.chance(0.55)) {
    const x = cx + rng.range(-0.5, 0.5);
    const z = Math.min(depth - 1.2, cz + 4.2);
    const who = rng.chance(0.5) ? 'driver' : 'crew';
    bay.put(
      who,
      team + TEAM_COUNT * rng.int(0, 1),
      x,
      z,
      bay.face(x, z, cx, cz) + rng.range(-0.5, 0.5),
      { r: 0.4 },
    );
  }
}

// --- public edge, support, start control ---------------------------------------------------------------

const PEOPLE = new Set([
  'spectator',
  'mechanic',
  'crew',
  'driver',
  'marshal',
  'photographer',
  'visitor',
]);
/** Clear radius (m) round the centre of the pieces a walking person must keep out of (people: 0.6). */
const KEEP_OUT: Record<string, number> = {
  team_car: 2.7,
  service_truck: 4.9,
  service_semi: 8.8,
  service_van: 3,
  car_trailer: 3.6,
  pickup: 3,
  gazebo: 2,
  gazebo_long: 3.4,
  food_truck: 3.2,
  fuel_trailer: 2.2,
  porta_toilet: 1,
  table_chairs: 1.4,
  generator: 0.9,
  tool_chest: 0.8,
  tyre_stack: 0.6,
  ambulance: 3.2,
};
const occupied = (list: ScatterInstance[], x: number, z: number): boolean =>
  list.some((o) => {
    const r = PEOPLE.has(o.asset) ? 0.6 : (KEEP_OUT[o.asset] ?? 0);
    return r > 0 && Math.hypot(o.x - x, o.z - z) < r;
  });

const yawAlong = (dx: number, dz: number): number => -Math.atan2(dz, dx);
const yawToward = (dx: number, dz: number): number => Math.atan2(dx, dz);

function addPublicEdge(
  out: ServiceParkLayout,
  def: ServicePark,
  ctx: ServiceParkContext,
  rng: Rng,
): void {
  const rq = newRoadQuery();
  const onRoad = (x: number, z: number, margin: number): boolean => {
    ctx.road.query(x, z, rq);
    return rq.found && rq.distance < rq.halfWidth + margin;
  };
  let paved = false;
  const place = (
    asset: string,
    variant: number,
    x: number,
    z: number,
    rotY: number,
    r: number,
    margin = 2.5,
  ): boolean => {
    if (ctx.blocked(x, z, r, paved) || onRoad(x, z, margin)) return false;
    // A person keeps off vehicles, tents and other people.
    if (PEOPLE.has(asset) && occupied(out.instances, x, z)) return false;
    out.instances.push({
      asset,
      variant,
      x,
      y: ctx.height(x, z),
      z,
      rotY,
      scale: 1,
      tiltX: 0,
      tiltZ: 0,
    });
    return true;
  };
  for (const lot of def.lots) {
    paved = !!lot.paved;
    const c = Math.cos(lot.heading);
    const s = Math.sin(lot.heading);
    // Tape along the public edge; the lot's own outer lines are open.
    const posts = Math.max(2, Math.round(lot.length / 5) + 1);
    for (let i = 0; i < posts; i++) {
      const [x, z] = lotWorld(lot, (i / (posts - 1)) * lot.length, -0.4);
      place('tape_post', 0, x, z, yawAlong(c, s), 0.2, 1.5);
    }
    // Crowd behind the tape (road side), watching the bays or the road; knots, not a line.
    const crowd = Math.round(((def.crowd ?? 30) * lot.length) / 84);
    const knots = Array.from(
      { length: 5 },
      () => rng.range(0.05, 0.95) * lot.length,
    );
    for (let i = 0; i < crowd; i++) {
      const knot = knots[rng.int(0, knots.length - 1)];
      const u = Math.min(lot.length, Math.max(0, knot + rng.gauss() * 7));
      const v = -rng.range(1.3, 4.3);
      const [x, z] = lotWorld(lot, u, v);
      const towardLot = rng.chance(0.6);
      const look = towardLot ? 1 : -1;
      const [vx, vz] = [-s, c];
      const yaw = yawToward(vx * look, vz * look) + rng.range(-0.6, 0.6);
      // Some sit or squat at the tape, the rest stand (some wave the map's flag).
      const variant = rng.chance(0.2)
        ? SPECTATOR_SEATED_FROM + rng.int(0, SPECTATOR_SEATED_COUNT - 1)
        : fanVariant(rng.next(), ctx.country, true);
      place('spectator', variant, x, z, yaw, 0.3);
    }
    // Press photographers just behind the tape, aiming at the bays (they follow the car when it passes).
    const shooters = Math.max(def.ferme ? 1 : 2, Math.round(lot.length / 30));
    for (let i = 0; i < shooters; i++) {
      const [x, z] = lotWorld(
        lot,
        rng.range(0.1, 0.9) * lot.length,
        -rng.range(0.9, 2.6),
      );
      place(
        'photographer',
        rng.int(0, variantsOf('photographer') - 1),
        x,
        z,
        yawToward(-s, c) + rng.range(-0.4, 0.4),
        0.4,
      );
    }
    // Visitors walking the aisle between the rows (a lot with one row: the walkway in front of the cars).
    const twoRows = !lot.semis && lot.width >= 2 * BAY_DEPTH + 4;
    const aisleV = lot.width / 2;
    const visitors = Math.round(lot.length * (def.ferme ? 0.1 : 0.32));
    for (let i = 0; i < visitors; i++) {
      const u = rng.range(2, lot.length - 2);
      const v = lot.parallel
        ? -rng.range(0.8, 2.2)
        : twoRows
          ? aisleV + rng.range(-1.6, 1.6)
          : rng.range(0.6, 3.4);
      const [x, z] = lotWorld(lot, u, v);
      // Walking, drinking, on the phone, standing: pairs turn to each other.
      const variant = visitorLook(rng);
      if (rng.chance(0.4)) {
        const yaw = rng.range(0, Math.PI * 2);
        const [x2, z2] = [x + Math.cos(yaw) * 0.9, z + Math.sin(yaw) * 0.9];
        place('visitor', variant, x, z, yawToward(x2 - x, z2 - z), 0.4, 0);
        place(
          'visitor',
          rng.int(0, variantsOf('visitor') - 1),
          x2,
          z2,
          yawToward(x - x2, z - z2),
          0.4,
          0,
        );
        i++;
      } else {
        place('visitor', variant, x, z, rng.range(0, Math.PI * 2), 0.4, 0);
      }
    }
    // Support in the aisle: catering at the east end, toilets and the fuel trailer at the west end.
    const at = (u: number, v = aisleV): [number, number] => lotWorld(lot, u, v);
    const turn = (a: number): number => -(lot.heading + a);
    if (twoRows) {
      let [x, z] = at(lot.length - 4);
      place('food_truck', rng.int(0, 2), x, z, turn(Math.PI), 2.8, 0);
      for (let i = 0; i < 3; i++) {
        [x, z] = at(3 + i * 1.5, aisleV - 1);
        place('porta_toilet', i, x, z, turn(Math.PI / 2), 0.9, 0);
      }
      [x, z] = at(lot.length - 15);
      place('fuel_trailer', 0, x, z, turn(0), 2, 0);
      [x, z] = at(lot.length - 15, aisleV + 2.2);
      place(
        'marshal',
        rng.int(0, variantsOf('marshal') - 1),
        x,
        z,
        rng.range(0, 6.2),
        0.4,
        0,
      );
    }
  }
}

/** Timekeeper tent, boards, marshals and a rescue ambulance on the right-hand verge at the start line. */
function addStartControl(
  out: ServiceParkLayout,
  ctx: ServiceParkContext,
  rng: Rng,
): void {
  const { road, start } = ctx;
  const rq = newRoadQuery();
  const spot = (
    da: number,
    off: number,
  ): { x: number; z: number; tx: number; tz: number } => {
    const s = road.at(start + da);
    const lat = -(s.halfWidth + off);
    return { x: s.x + s.tz * lat, z: s.z - s.tx * lat, tx: s.tx, tz: s.tz };
  };
  const put = (
    asset: string,
    variant: number,
    da: number,
    off: number,
    rotY: (p: { tx: number; tz: number }) => number,
    r: number,
  ): void => {
    const p = spot(da, off);
    road.query(p.x, p.z, rq);
    if (
      ctx.blocked(p.x, p.z, r) ||
      (rq.found && rq.distance < rq.halfWidth + 1.5)
    )
      return;
    out.instances.push({
      asset,
      variant,
      x: p.x,
      y: ctx.height(p.x, p.z),
      z: p.z,
      rotY: rotY(p),
      scale: 1,
      tiltX: 0,
      tiltZ: 0,
    });
  };
  const alongRoad = (p: { tx: number; tz: number }) => yawAlong(p.tx, p.tz);
  const towardRoad = (p: { tx: number; tz: number }) => yawToward(p.tz, -p.tx);
  const facingBack = (p: { tx: number; tz: number }) => yawToward(-p.tx, -p.tz);
  put('control_board', 0, -26, 2.4, facingBack, 0.2);
  put('control_board', 1, -3, 2.4, facingBack, 0.2);
  // Timekeeper tent with a table, the officials in front of it facing the road.
  put('gazebo', 12, -9, 6.2, alongRoad, 1.8);
  put('table_chairs', 0, -9, 6.4, alongRoad, 1.2);
  put(
    'marshal',
    0,
    -7.2,
    3.5,
    (p) => towardRoad(p) + rng.range(-0.3, 0.3),
    0.4,
  );
  put(
    'marshal',
    5,
    -10.5,
    3.5,
    (p) => towardRoad(p) + rng.range(-0.3, 0.3),
    0.4,
  );
  // One waves the flag at the line, one with a radio further back.
  put('marshal', 12, -1.5, 3.4, (p) => towardRoad(p) - 0.4, 0.4);
  put('marshal', 14, -24.5, 3.2, (p) => towardRoad(p), 0.4);
  // Rescue ambulance on the verge beyond the line, nose forward.
  put('ambulance', 0, 14, 3.4, alongRoad, 3.4);
}
