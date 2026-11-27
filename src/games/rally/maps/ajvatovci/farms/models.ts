import type { BuildingDef } from '../../shared/types';
import { VILLAGE_ADDED } from '../village';

/**
 * The look of each building the village corrections add (../village.ts `ADD`), from the aerial photos (roof shape and
 * colour, size, the yard round it); walls, doors and windows as on the farms and houses of the plain round Skopje.
 * - hall: steel-framed farm hall, a block plinth, sheet cladding, a low two-pitch sheet roof, sliding doors.
 * - barn: an older long barn or stable, rendered (or brick) walls, a clay-tile gable roof, wooden doors, small windows.
 * - house: a two-storey village house, rendered, a hip (or low sheet gable) roof, a balcony over the door.
 * - block: a flat-roofed two- / three-storey concrete farm building (offices, stores), rows of windows.
 * - shed: an open-fronted machinery shed on steel posts, block back and end walls, a low two-pitch sheet roof.
 */
export type FarmKind = 'hall' | 'barn' | 'house' | 'block' | 'shed';

export interface FarmModel {
  kind: FarmKind;
  walls: string;
  roof: string;
  /** Brick walls (barns) instead of render. (Clay tiles take `roof` as a tint over their own colour.) */
  brick?: boolean;
  /** Houses: a low two-pitch sheet roof instead of a tiled hip. */
  sheet?: boolean;
  /** Houses: a hip roof of painted steel sheet (`sheet`) or matt dark concrete tiles (`roofing`) instead of clay. */
  painted?: 'sheet' | 'roofing';
  /** Dark window frames and door (a newer house). */
  dark?: boolean;
  /** Houses: length of the hip roof's ridge (m), when longer than a near-square plan gives (steeper hip ends). */
  ridge?: number;
  /** The doors face the yard, away from the road. */
  back?: boolean;
  /** Buildings that touch share one terrace level (their yard; a `street` one's when it has one). */
  yard?: string;
  /** Where the terrace takes its level (default the middle of the building or of its yard): the low front of a hall dug into the slope. */
  levelAt?: [number, number];
  /** Right beside the stage road: its terrace at the road's level. */
  street?: boolean;
  /** A wire-mesh fence round its plot, local x0, x1, z0, z1 (m), with a gate on the side nearest the road. */
  fence?: [number, number, number, number];
}

const WHITE_SHEET = '#efeee9';

export const FARM_MODELS: Record<number, FarmModel> = {
  // ~2 850 m: the concrete farm complex (two flat-roofed blocks and a white hall).
  900001: {
    kind: 'block',
    walls: '#f1e4c9',
    roof: '#8d8c87',
    back: true,
    yard: 'complex',
  },
  900002: {
    kind: 'block',
    walls: '#e9dcc2',
    roof: '#8d8c87',
    yard: 'complex',
  },
  900003: { kind: 'hall', walls: '#f3efe4', roof: WHITE_SHEET },
  // ~3 240 m: the teal-roofed machinery shed.
  900004: { kind: 'shed', walls: '#b8b3a8', roof: '#6f9c97' },
  // ~3 290 m: the green-roofed house and the tiled barns.
  900006: {
    kind: 'house',
    walls: '#efe4cc',
    roof: '#5f8a55',
    painted: 'sheet',
    ridge: 6,
  },
  900011: { kind: 'barn', walls: '#d8cebb', roof: '#cfa898' },
  900013: {
    kind: 'barn',
    walls: '#e6d2c2',
    roof: '#c9a090',
    brick: true,
    yard: 'barns',
  },
  900015: {
    kind: 'barn',
    walls: '#d3c9b5',
    roof: '#d2ac9c',
    back: true,
    street: true,
    yard: 'barns',
  },
  // ~3 400 m: the dark-roofed new house.
  900017: {
    kind: 'house',
    walls: '#f2f0ea',
    roof: '#55575a',
    painted: 'roofing',
    dark: true,
    street: true,
  },
  // ~3 480 m: the farm halls and the white-roofed house.
  900018: {
    kind: 'hall',
    walls: '#f4f0e6',
    roof: WHITE_SHEET,
    yard: 'halls',
    levelAt: [1523.5, -214.5],
  },
  900020: {
    kind: 'hall',
    walls: '#eeeae0',
    roof: WHITE_SHEET,
    street: true,
  },
  900021: {
    kind: 'hall',
    walls: '#f2eee3',
    roof: '#e3e2dc',
    yard: 'halls',
    levelAt: [1523.5, -214.5],
  },
  900023: { kind: 'house', walls: '#ebe6da', roof: WHITE_SHEET, sheet: true },
  // ~3 600 m: the farm building in its fenced yard.
  900025: {
    kind: 'hall',
    walls: '#f5f1e7',
    roof: WHITE_SHEET,
    fence: [-16, 13, -8, 8],
  },
};

/** Roof pitch (rad) and overhang (m) per kind. */
export const ROOF = {
  hall: { pitch: 0.17, over: 0.35 },
  barn: { pitch: 0.42, over: 0.5 },
  house: { pitch: 0.38, over: 0.6 },
  sheetHouse: { pitch: 0.2, over: 0.5 },
  block: { pitch: 0, over: 0 },
  shed: { pitch: 0.2, over: 0.45 },
} as const;

export const roofOf = (m: FarmModel) =>
  m.kind === 'house' && m.sheet ? ROOF.sheetHouse : ROOF[m.kind];

/** Height of the roof's top over the wall top (m). */
export function roofRise(b: BuildingDef, m: FarmModel): number {
  const r = roofOf(m);
  if (m.kind === 'block') return 0.6;
  return (b.d / 2) * Math.tan(r.pitch) + 0.2;
}

/** The footprints the landmark draws, with their models. */
export const FARMS: { b: BuildingDef; m: FarmModel }[] = VILLAGE_ADDED.filter(
  (b) => FARM_MODELS[b.id],
).map((b) => ({ b, m: FARM_MODELS[b.id] }));
