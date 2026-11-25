import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  type Material,
  Mesh,
  MeshStandardMaterial,
  ShapeUtils,
  Vector2,
} from 'three';
import { plainDepthMaterial } from '../../engine/materials';
import type { DryZone } from '../../engine/world-shading';
import { getTexture, type TextureId } from '../../engine/textures';
import { hash3, hashString } from '../../../../shared/rng';
import {
  bridgeMaterials,
  Builder,
  Plates,
  railing,
  type RGB,
  type Row,
} from '../bridge-mesh';
import {
  guardRailMaterial,
  RAIL,
  RAIL_POST,
  RAIL_STEEL,
} from '../barrier-mesh';
import { chainLinkMaterial } from '../cut-wall-mesh';
import {
  clearancePlateTexture,
  feetInches,
  namePlateTexture,
} from '../../engine/structure-textures';
import { SKIRT_DEPTH, SKIRT_W } from '../road-slab';
import type { World } from '../world';
import {
  inPolygon,
  pointAt,
  polygonDistance,
  type Projection,
  sampleAt,
} from './alignment';
import { type NetField, SLAB_REACH } from './field';
import {
  DECK_DEPTH,
  goreAt,
  type Junction,
  type Network,
  type Plaza,
  runsOf,
  scaleAt,
  ST_DECK,
  ST_TUNNEL,
  WALL_CUT,
  WALL_FILL,
  type Way,
  worldT,
} from './network';
import type { NetPark } from './types';

/**
 * Meshes of the v2 road network: every way's section swept along its reference line (pavement, kerbs, sidewalks - with
 * a body: the edges drop as faces, so no terrain shows between road and ground), junction paving and sidewalk corners,
 * paint (lines, dashes, crosswalks, stop bars), retaining walls, decks (slab, fascia, parapets, abutments, piers), the
 * tunnel (roof, headwalls, lamps) and the barriers. Merged per 256 m tile and material.
 */

const TILE = 256;
const TEX = 8;
const SIDEWALK_TEX = 3;
const PAINT_LIFT = 0.012;
/** A merging way is stitched to its host's pavement edge over this length before its merge node (m). */
const MERGE_STITCH = 160;
/** A merging way's pavement reaches this far under its host's edge (m), so the join shows no seam. */
const MERGE_UNDERLAP = 0.3;
/** A merging way's lines stop this close to its host's pavement (m): the host's broken edge line is the lane line. */
const MERGE_LINE_GAP = 1;
/**
 * A cut wall's coping reaches this far back over the land it holds: past the drawn terrain's low band behind the face
 * (field.ts WALL_CELL) by more than a 1 m cell's diagonal, so no mesh triangle dips into that band beyond it (stairs).
 */
const WALL_BACK = 3.1;
/** A tunnel lane wall's thickness (m). */
const LANE_WALL_W = 0.25;
/** A tunnel's slab top is drawn this far under the street surfaces on it. */
const SLAB_UNDER = 0.06;
/** ... and this far under a plaza's paving (a few cm would fight it in depth from afar: white flecks in the asphalt). */
const SLAB_UNDER_PLAZA = 0.3;
/** Concrete barrier profile: the drive videos' tall (42 in) safety-shape barrier, ~1.07 m. */
export const JERSEY_H = 1.07;
const JERSEY: [number, number][] = [
  [-0.3, 0],
  [-0.2, 0.08],
  [-0.1, 0.33],
  [-0.075, JERSEY_H],
  [0.075, JERSEY_H],
  [0.1, 0.33],
  [0.2, 0.08],
  [0.3, 0],
];
/** Precast barrier sections (m, the videos' joints every 3-4 m), the joint gap and the tone spread between sections. */
const JERSEY_SEG = 3.66;
const JERSEY_GAP = 0.025;
const JERSEY_TONE = 0.07;
/**
 * Precast barrier colours (drive videos, owner): most runs new, clean white-grey; some older, weathered tan / yellowish
 * with grime at the foot. Old and new are replaced in stretches: JERSEY_RUN sections share one age, JERSEY_OLD of the
 * stretches are old (seeded, `hash3` + JERSEY_SEED); the grime darkens the profile below JERSEY_GRIME_Y m.
 */
const JERSEY_NEW: RGB = [0.93, 0.93, 0.91];
const JERSEY_AGED: RGB = [0.84, 0.67, 0.42];
const JERSEY_RUN = 5;
const JERSEY_OLD = 0.4;
const JERSEY_SEED = 7121;
const JERSEY_GRIME_Y = 0.34;
const JERSEY_GRIME: [aged: number, fresh: number] = [0.66, 0.86];
/** The barriers' bounce light in shade (emissive share of their texture, `jerseyMaterial`). */
const JERSEY_BOUNCE = 0.2;

/** The colour of a precast barrier section (`JERSEY_NEW` / `JERSEY_AGED`) by its way, side and section index. */
function jerseyColor(w: Way, side: number, seg: number, y: number): RGB {
  const key = hashString(w.id) ^ (side * 0x9e37);
  const run = Math.floor(seg / JERSEY_RUN);
  const aged = hash3(run, side, key, JERSEY_SEED) / 0xffffffff < JERSEY_OLD;
  const base = aged ? JERSEY_AGED : JERSEY_NEW;
  const tone =
    (1 +
      JERSEY_TONE *
        (hash3(seg, side, key, JERSEY_SEED + 1) / 0xffffffff - 0.5)) *
    (y < JERSEY_GRIME_Y ? JERSEY_GRIME[aged ? 0 : 1] : 1);
  return [base[0] * tone, base[1] * tone, base[2] * tone];
}
/** Length of the turned-down end of a free Jersey run (m). */
export const JERSEY_END = 4;
/** Barrier centre beyond the pavement edge (m). */
export const BARRIER_OFF = 0.45;
export const PARAPET_H = 1.0;
/** Deck parapet: inner face / outer face (= fascia) beyond the section's outer edge (m). */
export const PARAPET_IN = 0.12;
export const PARAPET_OUT = 0.52;
/** A deck edge under a Jersey barrier (`wallStyles` barrier 'jersey'): the edge beam's height over the deck (m). */
const DECK_EDGE_H = 0.2;
/** A fill wall's thickness: the deck parapet's (a parapet on the ground). */
const FILL_W = PARAPET_OUT - PARAPET_IN;
const SOFFIT: RGB = [0.45, 0.44, 0.42];
/** Tunnel ceiling girders: spacing (m), depth under the soffit (m), dark painted steel. */
const GIRDER_EVERY = 2.6;
const GIRDER: RGB = [0.2, 0.19, 0.18];
/** A tunnel's steel columns: light grey paint, this far in from the bore's wall line (m). */
const COLUMN: RGB = [0.5, 0.51, 0.5];
/** The hall's outer barrier (`hallColumns`): low wall height (m) and the column spacing along it (m). */
const HALL_WALL_H = 1.1;
const HALL_COLUMN_EVERY = 3 * GIRDER_EVERY;
/**
 * A steel deck (`deckStyles` 'steel'): the fascia girders' dull grey-green paint (drive video 3:34-3:36, Myrtle Ave),
 * the slab's underside above its girders (m under the deck top) and the girder spacing across the deck (m).
 */
const STEEL_PAINT: RGB = [0.15, 0.21, 0.2];
const STEEL_SLAB = 0.45;
const STEEL_GIRDER_GAP = 2.2;
/** Top of a tunnel slab (weathered concrete paving). */
const SLAB_TOP: RGB = [0.62, 0.61, 0.59];
const CONC: RGB = [0.8, 0.78, 0.75];
const STONE: RGB = [0.95, 0.92, 0.86];

class Acc {
  pos: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  /** Vertices lit as facing straight up (a plaza's paving: its centimetre steps under the streets stay unlit). */
  up: number[] = [];
  v(x: number, y: number, z: number, u: number, w: number, c = 1): number {
    this.pos.push(x, y, z);
    this.uv.push(u, w);
    this.col.push(c, c, c);
    return this.pos.length / 3 - 1;
  }
  /** Quad from two consecutive rows: a, b on row 0, c, d on row 1 (a-c and b-d along). */
  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, c, d, a, d, b);
  }
  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }
  build(mat: Material): Mesh | undefined {
    if (!this.idx.length) return undefined;
    const g = new BufferGeometry();
    g.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(this.pos), 3),
    );
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    const nor = g.getAttribute('normal');
    for (const i of this.up) nor.setXYZ(i, 0, 1, 0);
    g.computeBoundingSphere();
    const m = new Mesh(g, mat);
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    return m;
  }
}

type MatId =
  | 'asphalt'
  | 'highway'
  | 'stage'
  | 'concrete_pave'
  | 'junction'
  | 'sidewalk'
  | 'island'
  | 'kerb'
  | 'paint';

let mats: Record<MatId, MeshStandardMaterial> | undefined;
function materials(): Record<MatId, MeshStandardMaterial> {
  if (mats) return mats;
  const road = (tex: TextureId, layer: number, bumpScale = 1.1) => {
    const m = new MeshStandardMaterial({
      map: getTexture(tex),
      bumpMap: getTexture(tex),
      bumpScale,
      roughness: 0.86,
      metalness: 0,
      vertexColors: true,
      polygonOffset: true,
      polygonOffsetFactor: -layer,
      polygonOffsetUnits: -layer * 2,
    });
    m.defines = { RALLY_GROUND: 1 };
    return m;
  };
  mats = {
    asphalt: road('asphalt_street', 2),
    // the v2 parkway's own calm tile (v1 keeps asphalt_highway); cement concrete where the map says (`pavement`)
    highway: road('asphalt_parkway', 2),
    stage: road('asphalt_parkway', 3),
    concrete_pave: road('concrete_highway', 3, 0.6),
    junction: road('asphalt_street', 1),
    sidewalk: road('sidewalk', 1),
    // a plaza island's top: over the paving and the roads running under it, so its depth bias beats theirs (from afar
    // the asphalt's own bias would pull it through the island's top)
    island: road('sidewalk', 4),
    kerb: new MeshStandardMaterial({
      map: getTexture('bridge_concrete'),
      vertexColors: true,
      roughness: 0.9,
      metalness: 0,
    }),
    // the worn paint tile of v1 / Vodno (world/road-markings.ts): blended, so a line stays soft from afar
    paint: new MeshStandardMaterial({
      map: getTexture('road_paint'),
      vertexColors: true,
      transparent: true,
      alphaTest: 0.02,
      depthWrite: false,
      roughness: 0.8,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -8,
    }),
  };
  mats.sidewalk.color.setRGB(0.92, 0.91, 0.88);
  mats.island.color.copy(mats.sidewalk.color);
  return mats;
}

class Tiles {
  private map = new Map<string, Acc>();
  at(mat: MatId, x: number, z: number): Acc {
    const k = `${mat}:${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
    let a = this.map.get(k);
    if (!a) this.map.set(k, (a = new Acc()));
    return a;
  }
  build(group: Group): void {
    const m = materials();
    for (const [k, acc] of this.map) {
      const mesh = acc.build(m[k.slice(0, k.indexOf(':')) as MatId]);
      if (mesh) group.add(mesh);
    }
  }
}

/**
 * The v2 structures' stone and concrete: the bridge materials (same maps, same programs) with more sky light, so a
 * wall or barrier on the shade side reads as pale weathered concrete / tan-grey ashlar (the drive videos), not dark
 * slate. The sunny side hardly changes (the sun dominates it). The stone is a little greyer than the bridges' sandstone.
 */
let structMats:
  { stone: MeshStandardMaterial; concrete: MeshStandardMaterial } | undefined;
function structureMaterials() {
  if (structMats) return structMats;
  const b = bridgeMaterials();
  const stone = b.stone.clone();
  stone.color.setRGB(0.8, 0.78, 0.75);
  stone.envMapIntensity = SHADE_SKY;
  const concrete = b.concrete.clone();
  concrete.color.setScalar(0.6);
  concrete.envMapIntensity = SHADE_SKY;
  return (structMats = { stone, concrete });
}
/** Every Jersey (median, wall foot, ramp): v1's precast barrier material (barrier-mesh.ts), one look. */
let jerseyMat: MeshStandardMaterial | undefined;
function jerseyMaterial(): MeshStandardMaterial {
  // (a little of its own colour as light: the bounce off the cut walls and the road that keeps a barrier in shade a
  // light grey in the drive videos, not the sky's dark blue)
  const map = getTexture('barrier_jersey');
  return (jerseyMat ??= new MeshStandardMaterial({
    map,
    vertexColors: true,
    roughness: 0.93,
    metalness: 0,
    envMapIntensity: SHADE_SKY,
    emissive: 0xd8d2c4,
    emissiveMap: map,
    emissiveIntensity: JERSEY_BOUNCE,
  }));
}
/** The guard rails' galvanised steel (Vodno's W-beam, barrier-mesh.ts). */
let railMat: MeshStandardMaterial | undefined;
/** A steel deck's painted girders (`deckStyles` 'steel'): dull paint, vertex colour (not the railings' bare metal). */
let paintMat: MeshStandardMaterial | undefined;
function paintedSteel(): MeshStandardMaterial {
  return (paintMat ??= new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.78,
    metalness: 0.1,
    side: DoubleSide,
    envMapIntensity: SHADE_SKY,
  }));
}
/** Sky (environment) light on the v2 structures relative to other materials. */
const SHADE_SKY = 3.2;

/** Structure builders per tile (stone, concrete, metal, lamps). */
class Parts {
  private map = new Map<
    string,
    {
      stone: Builder;
      conc: Builder;
      jersey: Builder;
      metal: Builder;
      rail: Builder;
      paint: Builder;
      light: Builder;
      fence: Builder;
    }
  >();
  /** Name / clearance plates on portal headwalls (one mesh per texture). */
  readonly plates = new Plates();
  at(x: number, z: number) {
    const k = `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
    let p = this.map.get(k);
    if (!p)
      this.map.set(
        k,
        (p = {
          stone: new Builder(2),
          conc: new Builder(4),
          jersey: new Builder(4),
          metal: new Builder(4),
          rail: new Builder(8),
          paint: new Builder(4),
          light: new Builder(4),
          fence: new Builder(FENCE_TS),
        }),
      );
    return p;
  }
  build(group: Group): void {
    const m = { ...bridgeMaterials(), ...structureMaterials() };
    const glow = new MeshStandardMaterial({
      vertexColors: true,
      emissive: 0xfff2d0,
      emissiveIntensity: 1.6,
      roughness: 0.6,
    });
    for (const p of this.map.values()) {
      if (!p.stone.empty()) group.add(p.stone.build(m.stone));
      if (!p.conc.empty()) group.add(p.conc.build(m.concrete));
      if (!p.jersey.empty()) group.add(p.jersey.build(jerseyMaterial()));
      if (!p.metal.empty()) group.add(p.metal.build(m.metal));
      if (!p.rail.empty())
        group.add(p.rail.build((railMat ??= guardRailMaterial())));
      if (!p.paint.empty()) group.add(p.paint.build(paintedSteel()));
      if (!p.light.empty()) group.add(p.light.build(glow));
      if (!p.fence.empty()) {
        const f = p.fence.build(chainLinkMaterial());
        f.castShadow = false;
        group.add(f);
      }
    }
    this.plates.flush(group);
  }
}

interface Frame {
  x: number;
  z: number;
  tx: number;
  tz: number;
  i: number;
  f: number;
  s: number;
  /** The way (its section laterals map to the world through `worldT`: a narrowed stage pavement). */
  w: Way;
}

function frameAt(w: Way, s: number): Frame {
  const fr = pointAt(w.al, s, { x: 0, z: 0, tx: 0, tz: 0 });
  const i = sampleAt(w.al, s);
  const ds = w.al.s[i + 1] - w.al.s[i] || 1;
  const f = Math.min(1, Math.max(0, (s - w.al.s[i]) / ds));
  return { ...fr, i, f, s, w };
}

/** Arc lengths of the rows of a way between s0 and s1: the ends exact, every sample between. */
function rowsBetween(w: Way, s0: number, s1: number): number[] {
  const out = [s0];
  for (let i = 0; i < w.al.n; i++) {
    const s = w.al.s[i];
    if (s > s0 + 0.3 && s < s1 - 0.3) out.push(s);
  }
  out.push(s1);
  return out;
}

const lat = (fr: Frame, t0: number): [number, number] => {
  const t = fr.w.k ? worldT(fr.w, fr.i, fr.f, t0) : t0;
  return [fr.x + fr.tz * t, fr.z - fr.tx * t];
};

/**
 * World shift of a side's section elements at frame fr (0 unless the pavement is narrowed: its edge and everything
 * beyond move in by pave * (1 - k)): one-sided strips sweep rows moved by it (`rowOf`).
 */
function sideShift(fr: Frame, side: 0 | 1): number {
  const w = fr.w;
  if (!w.k) return 0;
  const pave = side === 0 ? w.sec.paveL : w.sec.paveR;
  return (side === 0 ? -1 : 1) * pave * (1 - scaleAt(w, fr.i, fr.f));
}

/** A sweep row at frame fr, height y, moved `shift` m sideways (`sideShift`), half width hw. */
function rowOf(fr: Frame, y: number, shift = 0, hw = 0): Row {
  return {
    x: fr.x + fr.tz * shift,
    z: fr.z - fr.tx * shift,
    y,
    tx: fr.tx,
    tz: fr.tz,
    d: fr.s,
    hw,
  };
}

export function* netMeshJob(world: World): Generator<void, Group | undefined> {
  const net = world.gen.net;
  const field = world.gen.netField;
  if (!net || !field) return undefined;
  const group = new Group();
  group.name = 'net';
  const tiles = new Tiles();
  const parts = new Parts();
  let n = 0;
  for (const w of net.ways) {
    if (w.internal) continue;
    waySurface(net, field, w, tiles);
    wayPaint(net, field, w, tiles);
    turnArrows(net, field, w, tiles);
    walls(net, field, w, parts);
    hallColumns(net, w, parts);
    decks(net, field, w, parts);
    medianDecks(net, w, parts);
    tunnel(net, field, w, parts);
    barriers(net, field, w, parts);
    if (++n % 20 === 0) yield;
  }
  for (const j of net.junctions) {
    if (j.plaza) continue;
    junctionSurface(field, j, tiles, parts);
    crossings(net, field, j, tiles);
    if (++n % 20 === 0) yield;
  }
  for (const pl of net.plazas) plazaSurface(field, pl, tiles);
  for (const pk of net.parks) parkMesh(field, pk, tiles, parts);
  bikeLanes(net, tiles);
  paintedMedians(net, field, tiles);
  tiles.build(group);
  parts.build(group);
  // each caster's own shadow-pass material (three's shared one switches program by draw order: the double-sided
  // railings' variant first compiled mid-stage, a 0.3-1.8 s stall at ~925 m)
  for (const o of group.children) {
    const m = o as Mesh;
    if (m.isMesh && m.castShadow && !m.customDepthMaterial)
      m.customDepthMaterial = plainDepthMaterial(m.material as Material);
  }
  return group;
}

// --- way sections ----------------------------------------------------------------------------------------------------

function pavedMat(w: Way): MatId {
  if (w.stage) return 'stage';
  return w.tpl.pave === 'asphalt_hw' ? 'highway' : 'asphalt';
}

function waySurface(net: Network, field: NetField, w: Way, tiles: Tiles): void {
  const L = w.al.length;
  const s0 = w.cut0;
  const s1 = L - w.cut1;
  if (s1 - s0 < 0.4) return;
  const ss = rowsBetween(w, s0, s1);
  const sec = w.sec;
  const frames = ss.map((s) => frameAt(w, s));
  const mid = frames[frames.length >> 1];
  if (w.tpl.pave !== 'terrain') {
    // pavement columns (crown at 0, every <= 3.5 m)
    const cols: number[] = [];
    const span = sec.paveL + sec.paveR;
    const nc = Math.max(2, Math.ceil(span / 3.5));
    for (let k = 0; k <= nc; k++) cols.push(-sec.paveR + (span * k) / nc);
    if (!sec.oneway && !cols.some((c) => Math.abs(c) < 0.05)) {
      cols.push(0);
      cols.sort((a, b) => a - b);
    }
    // the pavement of each row: the map's (`pavement`, by stage station) or the template's; a way crossing a change
    // is split into one mesh per material at the row
    const base = pavedMat(w);
    const matOf = (fr: Frame): MatId =>
      base !== 'asphalt' && net.pavementAt(w, fr.i) === 'concrete'
        ? 'concrete_pave'
        : base;
    const acc = tiles.at(base, mid.x, mid.z);
    // a merging way is stitched to its host's pavement edge: its columns inside the host move onto the edge (at the
    // host's surface), so the ramp's own pavement is exactly the part outside the host - no seam, no double edge
    const near = new Map<number, Projection>();
    const hostAt = (fr: Frame) => {
      const host =
        w.merge0 && fr.s < MERGE_STITCH
          ? w.into[0]
          : w.merge1 && L - fr.s < MERGE_STITCH
            ? w.into[1]
            : null;
      if (!host) return undefined;
      net.nearLines(fr.x, fr.z, 30, near, (q) => q !== host);
      const p = near.get(host.index);
      if (!p || p.s < host.cut0 || p.s > host.al.length - host.cut1)
        return undefined;
      const hx =
        host.al.x[p.i] +
        (host.al.x[Math.min(host.al.n - 1, p.i + 1)] - host.al.x[p.i]) * p.f;
      const hz =
        host.al.z[p.i] +
        (host.al.z[Math.min(host.al.n - 1, p.i + 1)] - host.al.z[p.i]) * p.f;
      // the host's centre and its near edge, as laterals in this way's frame
      const tH = (hx - fr.x) * fr.tz - (hz - fr.z) * fr.tx;
      const sg = Math.sign(tH) || 1;
      const pave = p.t >= 0 ? host.sec.paveL : host.sec.paveR;
      const edge = tH - sg * pave;
      const hEdge = net.surfaceAt(host, p.i, p.f, Math.sign(p.t) * pave);
      return { sg, edge, hEdge };
    };
    // row points (x, h, z, u, v per column), then their vertices in each material's mesh (made on first use)
    // (a way with a gore has one more column per side: its pavement edge, or out on its host's edge over the gore
    // wedge - paved, no verge between the two roads)
    const colsX = w.gore ? [-Infinity, ...cols, Infinity] : cols;
    const pts: number[][] = frames.map((fr) => {
      const r: number[] = [];
      const h0 = hostAt(fr);
      for (const tc of colsX) {
        const g = Number.isFinite(tc)
          ? undefined
          : goreAt(w, fr.i, fr.f, tc > 0);
        const t0 = Number.isFinite(tc) ? tc : tc > 0 ? sec.paveL : -sec.paveR;
        let t = t0;
        let h: number;
        if (h0 && h0.sg * (t0 - h0.edge) > 0) {
          // (a little under the host's edge: no hairline between the two meshes; the host draws over it)
          t = h0.edge + h0.sg * MERGE_UNDERLAP;
          h = h0.hEdge - 0.02;
        } else if (g) {
          t = Math.sign(t0) * (g.u + MERGE_UNDERLAP);
          h = g.h - 0.02;
        } else h = net.surfaceAt(w, fr.i, fr.f, t);
        const [x, z] = lat(fr, t);
        r.push(x, h, z, t / TEX, fr.s / TEX);
      }
      return r;
    });
    const rowsIn = new Map<Acc, number[][]>();
    const rowOfIn = (a: Acc, k: number): number[] => {
      let rows = rowsIn.get(a);
      if (!rows) rowsIn.set(a, (rows = []));
      if (!rows[k]) {
        const p = pts[k];
        rows[k] = colsX.map((_, c) =>
          a.v(p[c * 5], p[c * 5 + 1], p[c * 5 + 2], p[c * 5 + 3], p[c * 5 + 4]),
        );
      }
      return rows[k];
    };
    for (let k = 0; k + 1 < frames.length; k++) {
      const m = matOf(frames[k]);
      const a = m === base ? acc : tiles.at(m, mid.x, mid.z);
      const r0 = rowOfIn(a, k);
      const r1 = rowOfIn(a, k + 1);
      for (let c = 0; c + 1 < colsX.length; c++)
        a.quad(r0[c], r0[c + 1], r1[c], r1[c + 1]);
    }
    // the slab's side (road-slab.ts rules): a kerbless pavement edge drops SKIRT_DEPTH, SKIRT_W out, into the verge
    // (NetField.meshSink lowers the drawn verge there); none where its toe lies on another way's pavement
    for (const side of [0, 1] as const) {
      const els = side === 0 ? sec.left : sec.right;
      if (els[0]?.kind === 'kerb') {
        kerbFace(
          net,
          field,
          w,
          frames,
          side === 0,
          els[0].w,
          tiles.at('kerb', mid.x, mid.z),
        );
        continue;
      }
      slabSkirt(
        net,
        field,
        w,
        frames,
        side === 0,
        acc,
        tiles.at('kerb', mid.x, mid.z),
      );
    }
  }
  // kerbs, sidewalks - not where another road's pavement lies (a street's sidewalk never crosses a ramp lane), nor on
  // a plaza's paving (its surveyed islands stand there: a street's sidewalk end would stand loose on the plaza)
  const clear = (k: number, t0: number, t1: number) => {
    const fr = frames[k];
    const [x, z] = lat(fr, (t0 + t1) / 2);
    const h = net.surfaceAt(w, fr.i, fr.f, (t0 + t1) / 2);
    return (
      !field.pavedByOther(x, z, h, w, 0.2, 1.5) &&
      field.plazaDrawn(x, z, 0) === undefined
    );
  };
  for (const side of [0, 1] as const) {
    const sg = side === 0 ? 1 : -1;
    const els = side === 0 ? sec.left : sec.right;
    let u = side === 0 ? sec.paveL : sec.paveR;
    for (const e of els) {
      const t0 = sg * u;
      const t1 = sg * (u + e.w);
      if (e.kind === 'kerb') {
        const acc = tiles.at('kerb', mid.x, mid.z);
        // face (from the pavement edge up) + top
        const face: number[][] = [];
        const top: number[][] = [];
        for (const fr of frames) {
          const [x0, z0] = lat(fr, t0);
          const [x1, z1] = lat(fr, t1);
          const base = net.surfaceAt(w, fr.i, fr.f, sg * (u - 0.001));
          const h = base + e.rise;
          face.push([
            acc.v(x0, base - 0.02, z0, fr.s / 2, 0, 0.9),
            acc.v(x0, h, z0, fr.s / 2, e.rise, 0.95),
          ]);
          top.push([
            acc.v(x0, h, z0, fr.s / 2, 0, 1),
            acc.v(x1, h, z1, fr.s / 2, 0.2, 1),
          ]);
        }
        for (let k = 0; k + 1 < frames.length; k++) {
          if (!clear(k, t0, t1) || !clear(k + 1, t0, t1)) continue;
          const [a, b] = side === 0 ? [0, 1] : [1, 0];
          acc.quad(face[k][a], face[k][b], face[k + 1][a], face[k + 1][b]);
          acc.quad(top[k][a], top[k][b], top[k + 1][a], top[k + 1][b]);
        }
      } else if (e.kind === 'sidewalk') {
        const acc = tiles.at('sidewalk', mid.x, mid.z);
        const rows: number[][] = [];
        for (const fr of frames) {
          const r: number[] = [];
          for (const t of [t0, t1]) {
            const [x, z] = lat(fr, t);
            r.push(
              acc.v(
                x,
                net.surfaceAt(w, fr.i, fr.f, t),
                z,
                t / SIDEWALK_TEX,
                fr.s / SIDEWALK_TEX,
              ),
            );
          }
          rows.push(r);
        }
        for (let k = 0; k + 1 < frames.length; k++) {
          if (!clear(k, t0, t1) || !clear(k + 1, t0, t1)) continue;
          const [a, b] = side === 0 ? [0, 1] : [1, 0];
          acc.quad(rows[k][a], rows[k][b], rows[k + 1][a], rows[k + 1][b]);
        }
        // (its edge drop only where the strip itself is drawn)
        skirt(net, w, frames, t1, 0.3, acc, side === 0, (k) =>
          clear(k, t0, t1),
        );
      }
      u += e.w;
    }
  }
}

/** Shade of the slab's side (dark: the asphalt's cut edge, not lit like the top). */
const SKIRT_SHADE = 0.32;

/**
 * The slab's side at a kerbless pavement edge (main's road slab, world/road-slab.ts): from the edge down SKIRT_DEPTH to a
 * toe SKIRT_W further out, so it leans out (its normal tilts outward, lit like a bevel), darkened. Skipped where the toe
 * lies on another way's pavement (a ramp merging alongside, a street's mouth): the paving carries on there.
 */
/** One row of a slab skirt at arc length s: the pavement edge, the toe (SKIRT_W out, SKIRT_DEPTH down), drawn or not. */
export interface SkirtRow {
  edge: [number, number, number];
  toe: [number, number, number];
  open: boolean;
}

/** The skirt row of way `w`'s kerbless pavement edge on one side at arc length s (pure: the rule tests call it). */
export function skirtRow(
  net: Network,
  field: NetField,
  w: Way,
  s: number,
  left: boolean,
): SkirtRow {
  const fr = frameAt(w, s);
  const sg = left ? 1 : -1;
  const t = left ? w.sec.paveL : -w.sec.paveR;
  const [x, z] = lat(fr, t);
  const [xt, zt] = lat(fr, t + sg * SKIRT_W);
  const h = net.surfaceAt(w, fr.i, fr.f, t);
  return {
    edge: [x, h, z],
    toe: [xt, h - SKIRT_DEPTH, zt],
    // (none over its own gore wedge: paved on to the host's edge)
    open:
      !goreAt(w, fr.i, fr.f, left) &&
      !field.pavedByOther(xt, zt, h, w, 0.05, 0.5),
  };
}

function slabSkirt(
  net: Network,
  field: NetField,
  w: Way,
  frames: Frame[],
  left: boolean,
  acc: Acc,
  faceAcc: Acc,
): void {
  const r: number[][] = [];
  const open: boolean[] = [];
  // below the toe: a concrete face down to the drawn land where it lies lower (a strip beside a road a storey lower,
  // NetField.ground `STEP_SLOPE`), so the step is a clean face, not a terrain slope
  const face: number[][] = [];
  let anyFace = false;
  const side = left ? 0 : 1;
  const foot = left ? w.sec.footL : w.sec.footR;
  for (const fr of frames) {
    const row = skirtRow(net, field, w, fr.s, left);
    // in front of a fill wall / on a deck the pavement runs on, level, to the wall's / parapet's inner face (one line):
    // no edge drop, no slot
    const k = fr.f < 0.5 ? fr.i : Math.min(w.al.n - 1, fr.i + 1);
    const walled = w.wall[side][k] === WALL_FILL || w.st[k] === ST_DECK;
    if (walled) {
      const [xw, zw] = lat(fr, (left ? 1 : -1) * (foot + PARAPET_IN + 0.05));
      row.toe = [xw, row.edge[1], zw];
      row.open = true;
    }
    open.push(row.open);
    const [xt, yt, zt] = row.toe;
    // (on a deck the land below is the road it spans: no face hangs down to it)
    const onDeck =
      w.st[fr.f < 0.5 ? fr.i : Math.min(w.al.n - 1, fr.i + 1)] === ST_DECK;
    const land =
      row.open && !onDeck && !walled
        ? faceLand(field, fr, xt, zt, left ? 1 : -1)
        : yt;
    const bot = Math.max(yt - FACE_MAX, Math.min(yt, land - 0.05));
    if (yt - bot > 0.1) anyFace = true;
    face.push([
      faceAcc.v(xt, yt, zt, fr.s / 4, 0, 0.82),
      faceAcc.v(xt, bot, zt, fr.s / 4, (yt - bot) / 4, 0.82),
    ]);
    r.push([
      acc.v(
        row.edge[0],
        row.edge[1],
        row.edge[2],
        fr.s / TEX,
        0,
        walled ? 1 : SKIRT_SHADE + 0.1,
      ),
      acc.v(
        row.toe[0],
        row.toe[1],
        row.toe[2],
        fr.s / TEX,
        SKIRT_DEPTH / TEX,
        walled ? 1 : SKIRT_SHADE,
      ),
    ]);
  }
  for (let k = 0; k + 1 < frames.length; k++) {
    if (!open[k] || !open[k + 1]) continue;
    const [a, b] = left ? [0, 1] : [1, 0];
    acc.quad(r[k][a], r[k][b], r[k + 1][a], r[k + 1][b]);
    if (anyFace)
      faceAcc.quad(face[k][a], face[k][b], face[k + 1][a], face[k + 1][b]);
  }
}
/**
 * The back of a kerb standing over lower land (a strip beside a road a storey lower, NetField.ground `STEP_SLOPE`): a
 * concrete face from the kerb's top down to the drawn land, where that lies more than 0.1 m lower.
 */
function kerbFace(
  net: Network,
  field: NetField,
  w: Way,
  frames: Frame[],
  left: boolean,
  kerbW: number,
  acc: Acc,
): void {
  const sg = left ? 1 : -1;
  const t = sg * ((left ? w.sec.paveL : w.sec.paveR) + kerbW);
  const rows: number[][] = [];
  const deep: boolean[] = [];
  // (none on a plaza's paving: the plaza meets the street there, as its sidewalk and kerb leave it - waySurface)
  const paved: boolean[] = [];
  for (const fr of frames) {
    const [x, z] = lat(fr, t);
    paved.push(field.plazaDrawn(x, z, 0) !== undefined);
    const top = net.surfaceAt(w, fr.i, fr.f, t);
    // (on a deck the land below is the road it spans: no face hangs down to it)
    const onDeck =
      w.st[fr.f < 0.5 ? fr.i : Math.min(w.al.n - 1, fr.i + 1)] === ST_DECK;
    const land = onDeck ? top : faceLand(field, fr, x, z, sg);
    const bot = Math.max(top - FACE_MAX, Math.min(top, land - 0.05));
    deep.push(top - bot > 0.1);
    rows.push([
      acc.v(x, top, z, fr.s / 4, 0, 0.82),
      acc.v(x, bot, z, fr.s / 4, (top - bot) / 4, 0.82),
    ]);
  }
  for (let k = 0; k + 1 < frames.length; k++) {
    if ((!deep[k] && !deep[k + 1]) || paved[k] || paved[k + 1]) continue;
    const [a, b] = left ? [0, 1] : [1, 0];
    acc.quad(rows[k][a], rows[k][b], rows[k + 1][a], rows[k + 1][b]);
  }
}

/**
 * The drawn land a step's face at (x, z) reaches down to: the lowest of the land just outside and the cut band inside
 * (`NetField` stepCut), as the 1 m terrain mesh sags between them under the face's foot.
 */
function faceLand(
  field: NetField,
  fr: Frame,
  x: number,
  z: number,
  sg: number,
): number {
  // (over a tunnel bore the land below is the bore's floor under a slab: no face hangs down into it)
  if (field.overBore(x, z)) return Infinity;
  let low = Infinity;
  for (const o of [0.05, -0.5, -1.1]) {
    const px = x + fr.tz * sg * o;
    const pz = z - fr.tx * sg * o;
    low = Math.min(low, field.ground(px, pz) - field.meshSink(px, pz));
  }
  return low;
}

/** Deepest slab-side face down to lower land (m). */
const FACE_MAX = 4;

/** A vertical face hanging `depth` m under the section at lateral t (the body of the road). */
function skirt(
  net: Network,
  w: Way,
  frames: Frame[],
  t: number,
  depth: number,
  acc: Acc,
  left: boolean,
  drawn: (k: number) => boolean = () => true,
): void {
  const r: number[][] = [];
  for (const fr of frames) {
    const [x, z] = lat(fr, t);
    const h = net.surfaceAt(w, fr.i, fr.f, t);
    r.push([
      acc.v(x, h, z, fr.s / TEX, 0, 0.55),
      acc.v(x, h - depth, z, fr.s / TEX, depth / TEX, 0.4),
    ]);
  }
  for (let k = 0; k + 1 < frames.length; k++) {
    if (!drawn(k) || !drawn(k + 1)) continue;
    const [a, b] = left ? [0, 1] : [1, 0];
    acc.quad(r[k][a], r[k][b], r[k + 1][a], r[k + 1][b]);
  }
}

// --- paint ----------------------------------------------------------------------------------------------------------------

const WHITE = 0.92;
/** Faded, dirty parkway yellow (drive videos), times the paint tile. */
const YELLOW: RGB = [0.8, 0.64, 0.3];
/** Paint tile repeat along a line (m; `road_paint`). */
const PAINT_TILE = 4;

function paintStrip(
  net: Network,
  w: Way,
  tiles: Tiles,
  sFrom: number,
  sTo: number,
  t: number,
  width: number,
  yellow: boolean | RGB,
  hidden?: (x: number, z: number, h: number) => boolean,
): void {
  if (sTo - sFrom < 0.3) return;
  const tint = yellow === true ? YELLOW : yellow || undefined;
  const n = Math.max(1, Math.ceil((sTo - sFrom) / 2));
  const fr0 = frameAt(w, sFrom);
  const acc = tiles.at('paint', fr0.x, fr0.z);
  const rows: number[][] = [];
  for (let k = 0; k <= n; k++) {
    const fr = frameAt(w, sFrom + ((sTo - sFrom) * k) / n);
    const r: number[] = [];
    for (const dt of [-width / 2, width / 2]) {
      const [x, z] = lat(fr, t + dt);
      const h = net.surfaceAt(w, fr.i, fr.f, t + dt) + PAINT_LIFT;
      const v = acc.v(x, h, z, dt < 0 ? 0 : 1, fr.s / PAINT_TILE, WHITE);
      if (tint) acc.col.splice(v * 3, 3, ...tint);
      r.push(v);
    }
    rows.push(r);
  }
  for (let k = 0; k < n; k++) {
    if (hidden) {
      const fr = frameAt(w, sFrom + ((sTo - sFrom) * (k + 0.5)) / n);
      const [x, z] = lat(fr, t);
      if (hidden(x, z, net.surfaceAt(w, fr.i, fr.f, t))) continue;
    }
    acc.quad(rows[k][0], rows[k][1], rows[k + 1][0], rows[k + 1][1]);
  }
}

function wayPaint(net: Network, field: NetField, w: Way, tiles: Tiles): void {
  if (w.tpl.pave === 'terrain') return;
  const L = w.al.length;
  const s0 = w.cut0 + (w.cut0 > 0 ? 1.5 : 0);
  const s1 = L - w.cut1 - (w.cut1 > 0 ? 1.5 : 0);
  if (s1 - s0 < 2) return;
  // a merge end's lines stop where it runs under its host (only its outer edge stays, as the taper)
  const hidden =
    w.merge0 || w.merge1
      ? (x: number, z: number, h: number) => {
          const o = field.pavedByOther(x, z, h, w, MERGE_LINE_GAP);
          return !!o && (o.tpl.rank > w.tpl.rank || w.into.includes(o));
        }
      : undefined;
  // a pavement edge line is broken (3 m in 9) where a ramp merges in / splits off alongside
  const rampBeside = (s: number, t: number) => {
    const fr = frameAt(w, s);
    const out = t + Math.sign(t) * 1.2;
    const [x, z] = lat(fr, out);
    const o = field.pavedByOther(
      x,
      z,
      net.surfaceAt(w, fr.i, fr.f, t),
      w,
      0,
      0.6,
    );
    return !!o && (o.into.includes(w) || w.into.includes(o));
  };
  for (const line of w.sec.paint) {
    const ts = line.double ? [line.t - 0.11, line.t + 0.11] : [line.t];
    for (const t of ts) {
      if (
        !line.dash &&
        line.edge &&
        (w.merge0 || w.merge1 || w.tpl.rank >= 6)
      ) {
        let runFrom = s0;
        for (let a = s0; a < s1; a += 3) {
          const b = Math.min(s1, a + 3);
          const beside = rampBeside((a + b) / 2, t);
          if (beside) {
            if (runFrom < a)
              paintStrip(
                net,
                w,
                tiles,
                runFrom,
                a,
                t,
                line.w,
                line.color === 'yellow',
                hidden,
              );
            if (Math.round(a / 3) % 3 === 0)
              paintStrip(
                net,
                w,
                tiles,
                a,
                b,
                t,
                line.w,
                line.color === 'yellow',
                hidden,
              );
            runFrom = b;
          }
        }
        if (runFrom < s1)
          paintStrip(
            net,
            w,
            tiles,
            runFrom,
            s1,
            t,
            line.w,
            line.color === 'yellow',
            hidden,
          );
        continue;
      }
      if (!line.dash) {
        paintStrip(
          net,
          w,
          tiles,
          s0,
          s1,
          t,
          line.w,
          line.color === 'yellow',
          hidden,
        );
        continue;
      }
      // a white lane line in the tight curves of a template with `solidLaneRadius`: double solid there
      const solid =
        line.color === 'white' ? solidLaneRuns(w, s0, s1, net.stage) : [];
      for (const [a, b] of solid)
        for (const d of [-SOLID_GAP / 2, SOLID_GAP / 2])
          paintStrip(net, w, tiles, a, b, t + d, line.w, false, hidden);
      const inSolid = (a: number) => solid.some(([u, v]) => a + 3 > u && a < v);
      for (let a = Math.ceil(s0 / 12) * 12; a < s1; a += 12)
        if (!inSolid(a))
          paintStrip(
            net,
            w,
            tiles,
            a,
            Math.min(s1, a + 3),
            t,
            line.w,
            false,
            hidden,
          );
    }
  }
}

/** A turn arrow's length, its stem's width, the head's length and width (m; NYC street arrows). */
const ARROW_L = 4.2;
const ARROW_STEM = 0.22;
const ARROW_HEAD_L = 1.3;
const ARROW_HEAD_W = 0.95;
/** Turn arrows stand this far before a way's end (the stop line), a second set ARROW_AGAIN further back (m). */
const ARROW_BEFORE = 9;
const ARROW_AGAIN = 30;

/**
 * One arrow glyph as convex pieces in (u along the lane, v to its left), m: a stem and a head per direction of
 * `turn` (an OSM turn:lanes entry, e.g. "through;right"); empty for none.
 */
export function arrowGlyph(turn: string): [number, number][][] {
  const out: [number, number][][] = [];
  const st = ARROW_STEM / 2;
  const head = (u: number, v: number, du: number, dv: number) => {
    // a head at (u, v) pointing along (du, dv)
    const n = Math.hypot(du, dv);
    const ax = du / n;
    const ay = dv / n;
    const bu = u - ax * ARROW_HEAD_L;
    const bv = v - ay * ARROW_HEAD_L;
    out.push([
      [u, v],
      [bu - ay * (ARROW_HEAD_W / 2), bv + ax * (ARROW_HEAD_W / 2)],
      [bu + ay * (ARROW_HEAD_W / 2), bv - ax * (ARROW_HEAD_W / 2)],
    ]);
    return [bu, bv] as const;
  };
  const kinds = turn.split(';').map((k) => k.trim());
  const bend = ARROW_L - ARROW_HEAD_L - 0.9;
  let stem = 0;
  for (const k of kinds) {
    if (k === 'through') {
      head(ARROW_L, 0, 1, 0);
      stem = Math.max(stem, ARROW_L - ARROW_HEAD_L);
    } else if (k === 'left' || k === 'right') {
      const sg = k === 'left' ? 1 : -1;
      const [, bv] = head(bend + st, sg * 1.75, 0, sg);
      out.push([
        [bend - st, 0],
        [bend + st, 0],
        [bend + st, bv],
        [bend - st, bv],
      ]);
      stem = Math.max(stem, bend + st);
    } else if (
      k === 'slight_left' ||
      k === 'slight_right' ||
      k.startsWith('merge_to')
    ) {
      const sg = k === 'slight_left' || k === 'merge_to_left' ? 1 : -1;
      const [bu, bv] = head(ARROW_L - 0.2, sg * 0.9, 1, sg * 0.6);
      out.push([
        [bend - 0.6, -st],
        [bend - 0.6, st],
        [bu, bv + st],
        [bu, bv - st],
      ]);
      stem = Math.max(stem, bend - 0.6);
    }
  }
  if (stem > 0)
    out.push([
      [0, -st],
      [stem, -st],
      [stem, st],
      [0, st],
    ]);
  return out;
}

/**
 * Turn arrows from OSM `turn:lanes` (`TagSet.turnFwd` / `turnBack`) in each lane before a way's ends at a junction:
 * one set ARROW_BEFORE m before the stop line, a second ARROW_AGAIN m further back on a long approach (drive videos,
 * the Kew Gardens streets). Lanes from the way's own lane lines, counted from the centre (one-way: from its left).
 */
function turnArrows(net: Network, field: NetField, w: Way, tiles: Tiles): void {
  const { turnFwd, turnBack } = w.tags;
  if (w.stage || w.tpl.pave === 'terrain' || (!turnFwd && !turnBack)) return;
  const L = w.al.length;
  const s0 = w.cut0;
  const s1 = L - w.cut1;
  const sec = w.sec;
  const centre = sec.oneway
    ? sec.paveL
    : (sec.paint.find((p) => p.color === 'yellow')?.t ?? 0);
  const bounds = [...new Set(sec.paint.map((p) => +p.t.toFixed(2)))];
  const lanesOf = (dir: 1 | -1, n: number): number[] => {
    // the lane line laterals on this direction's side, from its left (the centre) outwards
    const edges = [centre, ...bounds.filter((t) => (t - centre) * dir < -0.3)]
      .concat(dir === 1 ? [-sec.paveR] : [sec.paveL])
      .sort((a, b) => (b - a) * dir);
    const uniq = edges.filter(
      (t, i) => i === 0 || Math.abs(t - edges[i - 1]) > 1.5,
    );
    const out: number[] = [];
    for (let i = 0; i + 1 < uniq.length && out.length < n; i++)
      out.push((uniq[i] + uniq[i + 1]) / 2);
    return out;
  };
  const place = (turns: string, dir: 1 | -1, end: number) => {
    const list = turns.split('|');
    const lanes = lanesOf(dir, list.length);
    if (lanes.length < list.length) return;
    for (const back of [ARROW_BEFORE, ARROW_BEFORE + ARROW_AGAIN]) {
      const sTip = end - dir * back;
      const sTail = sTip - dir * ARROW_L;
      if (sTail < s0 + 2 || sTail > s1 - 2 || sTip < s0 + 2 || sTip > s1 - 2)
        continue;
      for (let i = 0; i < list.length; i++) {
        const glyph = arrowGlyph(list[i]);
        if (!glyph.length) continue;
        const t0 = lanes[i];
        const at = (u: number, v: number) => {
          const fr = frameAt(w, sTail + dir * u);
          const t = t0 + dir * v;
          const [x, z] = lat(fr, t);
          return {
            x,
            z,
            h: net.surfaceAt(w, fr.i, fr.f, t) + PAINT_LIFT * 1.5,
          };
        };
        const mid = at(ARROW_L / 2, 0);
        const o = field.pavedByOther(mid.x, mid.z, mid.h, w, 0.5);
        if (o && o.tpl.rank > w.tpl.rank) continue;
        const acc = tiles.at('paint', mid.x, mid.z);
        for (const poly of glyph) {
          const vs = poly.map(([u, v]) => {
            const p = at(u, v);
            return acc.v(p.x, p.h, p.z, v, u / PAINT_TILE, WHITE);
          });
          // (front faces up: a piece counter-clockwise in (u, v) is so seen from above, either direction - a turn of
          // 180 degrees; a clockwise one is wound the other way)
          let area = 0;
          for (let k = 0; k < poly.length; k++) {
            const [u0, v0] = poly[k];
            const [u1, v1] = poly[(k + 1) % poly.length];
            area += u0 * v1 - u1 * v0;
          }
          for (let k = 1; k + 1 < vs.length; k++)
            if (area > 0) acc.tri(vs[0], vs[k], vs[k + 1]);
            else acc.tri(vs[0], vs[k + 1], vs[k]);
        }
      }
    }
  };
  if (turnFwd && !w.merge1) place(turnFwd, 1, s1);
  if (turnBack && !sec.oneway && !w.merge0) place(turnBack, -1, s0);
}

/** The two lines of a double solid lane line, centre to centre (m). */
const SOLID_GAP = 0.22;
/** A tight curve's double solid line runs on this far past it (m); straights shorter than SOLID_JOIN keep it. */
const SOLID_HOLD = 30;
const SOLID_JOIN = 150;
/** Shortest double solid run (m, holds included): a lone short bend stays dashed. */
const SOLID_MIN = 200;

/**
 * Stretches [s0, s1] of way `w` between from / to where its lane line is double solid (`Template.solidLaneRadius`). The
 * stage road's other carriageway (`corr`) takes the stage road's curves at its station: one corridor, the line in the
 * same bends (drive videos, both directions); its own OSM line wobbles where the ramps join.
 */
export function solidLaneRuns(
  w: Way,
  from: number,
  to: number,
  stage?: Way,
): [number, number][] {
  const R = w.tpl.solidLaneRadius;
  if (!R) return [];
  const { n, s, k } = w.al;
  const corr = stage && stage !== w ? w.corr : undefined;
  const step = stage ? stage.al.length / Math.max(1, stage.al.n - 1) : 1;
  const runs: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    let ki = k[i];
    if (corr) {
      // (off the corridor: no stage curve to follow, dashed)
      if (Number.isNaN(corr[i])) continue;
      ki = stage!.al.k[Math.min(stage!.al.n - 1, Math.round(corr[i] / step))];
    }
    if (Math.abs(ki) * R <= 1) continue;
    const a = Math.max(from, s[i] - SOLID_HOLD);
    const b = Math.min(to, s[i] + SOLID_HOLD);
    if (b <= a) continue;
    const last = runs[runs.length - 1];
    if (last && a - last[1] < SOLID_JOIN) last[1] = Math.max(last[1], b);
    else runs.push([a, b]);
  }
  // a single short bend keeps its dashed line (drive video 0:10-0:16, the start bend); the long winding runs get it
  return runs.filter(([a, b]) => b - a >= SOLID_MIN);
}

/** Crosswalks (NYC ladder) and stop bars on the arms of a junction with sidewalks. */
function crossings(
  net: Network,
  field: NetField,
  j: Junction,
  tiles: Tiles,
): void {
  for (const a of j.arms) {
    const w = a.way;
    if (w.tpl.kerbH <= 0 || w.tpl.sidewalkW <= 0) continue;
    // never painted on a higher-ranked road's pavement (a street whose OSM line bends onto the parkway beside it)
    const hidden = (x: number, z: number, h: number) => {
      const o = field.pavedByOther(x, z, h, w);
      return !!o && o.tpl.rank > w.tpl.rank;
    };
    const L = w.al.length;
    const room = L - w.cut0 - w.cut1;
    if (room < 9) continue;
    const at = (d: number) => (a.atEnd ? L - a.cut - d : a.cut + d);
    const sec = w.sec;
    // ladder bars along the street, 0.6 m wide every 1.2 m across the pavement
    const s0 = Math.min(at(0.6), at(3.6));
    const s1 = Math.max(at(0.6), at(3.6));
    for (let t = -sec.paveR + 0.45; t < sec.paveL - 0.3; t += 1.2)
      paintStrip(net, w, tiles, s0, s1, t + 0.3, 0.6, false, hidden);
    // stop bar across the lanes coming in
    let tIn0: number;
    let tIn1: number;
    if (sec.oneway) {
      if (!a.atEnd) continue;
      tIn0 = -sec.paveR;
      tIn1 = sec.paveL;
    } else if (a.atEnd) {
      tIn0 = -sec.paveR;
      tIn1 = 0;
    } else {
      tIn0 = 0;
      tIn1 = sec.paveL;
    }
    const b0 = Math.min(at(4.3), at(4.75));
    const b1 = Math.max(at(4.3), at(4.75));
    // (in 0.6 m pieces across: each one is tested against the higher road's pavement on its own)
    const lo = Math.min(tIn0, tIn1) + 0.15;
    const hi = Math.max(tIn0, tIn1) - 0.15;
    const pieces = Math.max(1, Math.round((hi - lo) / 0.6));
    for (let k = 0; k < pieces; k++)
      paintStrip(
        net,
        w,
        tiles,
        b0,
        b1,
        lo + ((k + 0.5) * (hi - lo)) / pieces,
        (hi - lo) / pieces,
        false,
        hidden,
      );
  }
}

// --- junctions ---------------------------------------------------------------------------------------------------------

/** Triangulate a flat outline and split the triangles until no edge is longer than `max` m. */
/** A raised plaza island's kerb over the paving (m, v1 plazas.ts `ISLAND_KERB`). */
const PLAZA_KERB = 0.15;
/** A survey plaza under a street end overlapping it: this far below the street's pavement (m). */
const PLAZA_UNDER = 0.03;

/**
 * A survey plaza (`NetworkDef.plazas`): one paved surface over its area on the plaza's height field (none over the open
 * cut below), its islands / sidewalks raised by PLAZA_KERB with a kerb face round them.
 */
/** A raised plaza island narrower than this on average (2 area / perimeter, m) or smaller (m²) is a clip sliver. */
const ISLAND_MIN_W = 1.2;
const ISLAND_MIN_AREA = 10;
/** An island's top keeps to its own level within this (m): no part of it follows the paving down a drop. */
const ISLAND_STEP = 1;
/** An island kerb face's step along its edge (m). */
const KERB_STEP = 0.75;

/**
 * The plaza's raised islands drawn: the planimetric layers overlap (an island and the sidewalk over it, the same
 * polygon twice) and leave clip slivers, so the largest go first, a piece mostly inside one already kept is dropped
 * (two coplanar tops fight) and slivers are dropped.
 */
function raisedIslands(pl: Plaza): Plaza['islands'] {
  const size = (p: number[]) => {
    let a = 0;
    let l = 0;
    for (let k = 0, n = p.length; k < n; k += 2) {
      const q = (k + 2) % n;
      a += p[k] * p[q + 1] - p[q] * p[k + 1];
      l += Math.hypot(p[q] - p[k], p[q + 1] - p[k + 1]);
    }
    return { a: Math.abs(a) / 2, w: l ? Math.abs(a) / l : 0 };
  };
  const all = pl.islands
    .filter((il) => il.kind !== 'painted' && il.pts.length >= 6)
    .map((il) => ({ il, ...size(il.pts) }))
    .filter((c) => c.a >= ISLAND_MIN_AREA && c.w >= ISLAND_MIN_W)
    .sort((a, b) => b.a - a.a);
  const kept: Plaza['islands'] = [];
  for (const { il } of all) {
    const n = il.pts.length / 2;
    const covered = kept.some((o) => {
      let k = 0;
      for (let i = 0; i < il.pts.length; i += 2)
        if (
          inPolygon(o.pts, il.pts[i], il.pts[i + 1]) ||
          polygonDistance(o.pts, il.pts[i], il.pts[i + 1]) < 0.3
        )
          k++;
      return k > n / 2;
    });
    if (!covered) kept.push(il);
  }
  return kept;
}

function plazaSurface(field: NetField, pl: Plaza, tiles: Tiles): void {
  const cx = (pl.minX + pl.maxX) / 2;
  const cz = (pl.minZ + pl.maxZ) / 2;
  // an island also stands where the plaza leaves the land to the roads (a median strip in a verge beside them), on
  // that land, or on a street's pavement where the survey's median divides its roadways (Queens Blvd's raised
  // medians between the main lanes and the service roads) - never on a road down in the trench
  // (on the highest paving under it at the plaza's level - the plaza, a street running onto it, a road through it - so
  // no asphalt stands up through the island's top)
  const islandH = (x: number, z: number) => {
    // (an outline point just past the paved area: the plaza's rim there, not the land beyond - teeth up the bank)
    const base =
      field.plazaDrawn(x, z, 0) ??
      field.streetOnPlaza(x, z) ??
      field.plazaNear(x, z);
    const ref = base ?? field.ground(x, z);
    const road = field.top(x, z, ref + 0.5)?.h;
    let h: number | undefined;
    for (const v of [base, road])
      if (v !== undefined && Math.abs(v - ref) < 1)
        h = Math.max(h ?? -Infinity, v);
    if (h !== undefined) return h;
    return field.onPaving(x, z, 0.3) ? undefined : field.ground(x, z);
  };
  const fill = (
    poly: number[],
    mat: MatId,
    rise: number,
    tex: number,
    height: (x: number, z: number) => number | undefined = (x, z) =>
      field.plazaHeight(x, z),
    holes: number[][] = [],
    up = false,
    under: number[][] = [],
  ) => {
    const acc = tiles.at(mat, cx, cz);
    const { pts, tris } = triangulate(poly, 1.5, holes);
    // (under the end of a street running onto it the plaza stays just below that street's pavement)
    const hs = pts.map(([x, z]) => {
      const h = height(x, z);
      const st = h === undefined ? undefined : field.streetOnPlaza(x, z);
      return st === undefined || h === undefined
        ? h
        : Math.min(h, st - PLAZA_UNDER);
    });
    const ids = pts.map(([x, z], k) =>
      hs[k] === undefined
        ? -1
        : acc.v(x, (hs[k] as number) + rise, z, x / tex, z / tex),
    );
    if (up) for (const i of ids) if (i >= 0) acc.up.push(i);
    for (const [a, b, c] of tris) {
      if (ids[a] < 0 || ids[b] < 0 || ids[c] < 0) continue;
      const [ax, az] = pts[a];
      const [bx, bz] = pts[b];
      const [qx, qz] = pts[c];
      // (only a triangle wholly on the island: one reaching past its outline would leave a gap in the paving)
      const on = (u: number[], x: number, z: number) =>
        inPolygon(u, x, z) || polygonDistance(u, x, z) < 0.05;
      if (under.some((u) => on(u, ax, az) && on(u, bx, bz) && on(u, qx, qz)))
        continue;
      const cross = (bx - ax) * (qz - az) - (bz - az) * (qx - ax);
      if (cross < 0) acc.tri(ids[a], ids[b], ids[c]);
      else acc.tri(ids[a], ids[c], ids[b]);
    }
  };
  // (the raised islands are holes in the paving: nothing lies under their tops to show through at a distance)
  const holes: number[][] = [];
  const inside = (p: number[], q: number[]) => {
    for (let k = 0; k < p.length; k += 2)
      if (inPolygon(q, p[k], p[k + 1])) return true;
    return false;
  };
  const raised = raisedIslands(pl);
  for (const il of raised) {
    let ok = true;
    for (let k = 0; k < il.pts.length && ok; k += 2)
      if (
        !inPolygon(pl.area, il.pts[k], il.pts[k + 1]) ||
        polygonDistance(pl.area, il.pts[k], il.pts[k + 1]) < 0.05
      )
        ok = false;
    if (ok && holes.every((h) => !inside(il.pts, h) && !inside(h, il.pts)))
      holes.push(il.pts);
  }
  fill(
    pl.area,
    'junction',
    0,
    TEX,
    (x, z) => field.plazaDrawn(x, z, PLAZA_UNDER),
    holes,
    true,
    // (and none under an island that could not be a hole - one on the plaza's edge)
    raised.filter((il) => !holes.includes(il.pts)).map((il) => il.pts),
  );
  const kerb = tiles.at('kerb', cx, cz);
  for (const il of raised) {
    // (one level per island: where the paving under it drops away - an island over a tunnel portal, the ramp down in
    // its cut beside the slab - the top ends rather than draping down into the cut)
    const m = il.pts.length / 2;
    const at: number[] = [];
    for (let k = 0; k < m; k++) {
      const h = islandH(il.pts[k * 2], il.pts[k * 2 + 1]);
      if (h !== undefined) at.push(h);
    }
    at.sort((a, b) => a - b);
    const ref = at[at.length >> 1];
    const topH = (x: number, z: number) => {
      const h = islandH(x, z);
      return h === undefined || Math.abs(h - ref) > ISLAND_STEP ? undefined : h;
    };
    fill(il.pts, 'island', PLAZA_KERB + 0.01, SIDEWALK_TEX, topH, [], true);
    // the kerb face: along each edge in short steps on the top's own heights (no teeth where the top's fill bends
    // between the outline's corners), its foot down under the paving beside it
    const foot = (x: number, z: number, h: number) => {
      const p = field.plazaDrawn(x, z, PLAZA_UNDER);
      const st = field.streetOnPlaza(x, z);
      const pave = Math.min(p ?? h, st === undefined ? h : st - PLAZA_UNDER);
      return Math.min(h, pave) - 0.05;
    };
    let area = 0;
    for (let k = 0; k < m; k++) {
      const q = (k + 1) % m;
      area +=
        il.pts[k * 2] * il.pts[q * 2 + 1] - il.pts[q * 2] * il.pts[k * 2 + 1];
    }
    const ccw = area > 0;
    for (let k = 0; k < m; k++) {
      const [ax, az] = [il.pts[k * 2], il.pts[k * 2 + 1]];
      const q = (k + 1) % m;
      const [bx, bz] = [il.pts[q * 2], il.pts[q * 2 + 1]];
      const L = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(L / KERB_STEP));
      // (the face (a, b, up) turns to the edge's left seen from above: outward on a clockwise outline in x, z)
      const out = !ccw;
      let prev: [number, number] | undefined;
      for (let e = 0; e <= n; e++) {
        const x = ax + ((bx - ax) * e) / n;
        const z = az + ((bz - az) * e) / n;
        const h = topH(x, z);
        if (h === undefined) {
          prev = undefined;
          continue;
        }
        const u = e / n;
        const lo = kerb.v(x, foot(x, z, h), z, u, 0, 0.9);
        const hi = kerb.v(x, h + PLAZA_KERB, z, u, 0.15, 0.95);
        if (prev) {
          const [p0, p1] = prev;
          // (one face, turned out of the island: two windings on shared corners would cancel its normals)
          if (out) kerb.idx.push(p0, lo, hi, p0, hi, p1);
          else kerb.idx.push(p0, hi, lo, p0, p1, hi);
        }
        prev = [lo, hi];
      }
    }
  }
  plazaPaint(field, pl, tiles);
}

// --- bike lanes ---------------------------------------------------------------------------------------------------------

/** A protected bike lane: green, this wide, this far in from the kerb, a white line on its traffic side (m). */
const BIKE_GREEN: RGB = [0.3, 0.62, 0.36];
const BIKE_W = 1.8;
const BIKE_IN = 0.3;
const BIKE_LINE = 0.12;
/** Roadways beside a lane's centreline: within this reach (m), parallel to it (|cos|). */
const BIKE_REACH = 28;
const BIKE_COS = 0.92;
/** A roadway this close to the centreline carries the lane at its own kerb on the lane's side (m). */
const BIKE_CENTRED = 4;
/** ... and a service road's median: another roadway within this far past its foot (m). */
const BIKE_MEDIAN = 6;

/**
 * Protected bike lanes (`NetworkDef.bikeLanes`, NYC DOT lines on the street centrelines): on the lane's side of the line,
 * the outermost parallel kerbed roadway carries it - a boulevard's service road along its median edge (the side facing
 * the centreline), a plain street at its kerb on that side. Painted on the drawn stretch of that roadway only.
 */
function bikeLanes(net: Network, tiles: Tiles): void {
  const near = new Map<number, Projection>();
  const other = new Map<number, Projection>();
  // another parallel kerbed roadway just past way w's foot on side sg (+1 left) at sample i
  const beside = (w: Way, i: number, sg: number): boolean => {
    const tx = w.al.tx[i];
    const tz = w.al.tz[i];
    const t = sg * ((sg > 0 ? w.sec.footL : w.sec.footR) + BIKE_MEDIAN);
    net.nearLines(
      w.al.x[i] + tz * t,
      w.al.z[i] - tx * t,
      BIKE_MEDIAN,
      other,
      (q) => q === w || q.stage || !!q.internal || q.tpl.kerbH <= 0,
    );
    for (const [qi, q] of other) {
      const o = net.ways[qi];
      if (Math.abs(o.al.tx[q.i] * tx + o.al.tz[q.i] * tz) >= BIKE_COS)
        return true;
    }
    return false;
  };
  for (const ln of net.bikeLanes) {
    const side = ln[0];
    const n = (ln.length - 1) / 2;
    // runs of [way, its side (+1 left / -1 right), s from, s to]
    const runs: [Way, number, number, number][] = [];
    for (let k = 0; k + 1 < n; k++) {
      const [ax, az, bx, bz] = [
        ln[1 + k * 2],
        ln[2 + k * 2],
        ln[3 + k * 2],
        ln[4 + k * 2],
      ];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.5) continue;
      const ux = (bx - ax) / L;
      const uz = (bz - az) / L;
      // the lane's side of the line (travel along it: right = (-uz, ux), +Z south)
      const rx = -uz * side;
      const rz = ux * side;
      for (let d = 1; d < L; d += 2) {
        const cx = ax + ux * d;
        const cz = az + uz * d;
        net.nearLines(
          cx,
          cz,
          BIKE_REACH,
          near,
          (w) => w.stage || !!w.internal || w.tpl.kerbH <= 0,
        );
        let best: [Way, number, number] | undefined;
        let bestOff = -Infinity;
        for (const [wi, p] of near) {
          const w = net.ways[wi];
          if (p.s < w.cut0 + 1 || p.s > w.al.length - w.cut1 - 1) continue;
          const i = p.i;
          const tx = w.al.tx[i];
          const tz = w.al.tz[i];
          if (Math.abs(tx * ux + tz * uz) < BIKE_COS) continue;
          // the way's centre relative to the line, along the lane's side
          const off = (w.al.x[i] - cx) * rx + (w.al.z[i] - cz) * rz;
          if (off < -BIKE_CENTRED || off <= bestOff) continue;
          // the way's side carrying the lane: facing the line, or the lane's side for a centred street
          const lx = tz;
          const lz = -tx;
          let ws = Math.sign(rx * lx + rz * lz) || 1;
          // a boulevard's service road (another roadway beside it on one side only): its median side
          const l = beside(w, i, 1);
          const r = beside(w, i, -1);
          if (l !== r) ws = l ? 1 : -1;
          bestOff = off;
          best = [w, ws, p.s];
        }
        if (!best) continue;
        const [w, ws, s] = best;
        const r = runs[runs.length - 1];
        if (r && r[0] === w && r[1] === ws && Math.abs(s - r[3]) < 4) {
          r[2] = Math.min(r[2], s);
          r[3] = Math.max(r[3], s);
        } else runs.push([w, ws, s, s]);
      }
    }
    for (const [w, ws, s0, s1] of runs) {
      const pave = ws > 0 ? w.sec.paveL : w.sec.paveR;
      // (room for it and a travel lane: a one-way service road's pavement is both halves)
      if (w.sec.paveL + w.sec.paveR < BIKE_W + BIKE_IN + 3) continue;
      const a = Math.max(w.cut0 + 1, s0 - 1);
      const b = Math.min(w.al.length - w.cut1 - 1, s1 + 1);
      paintStrip(
        net,
        w,
        tiles,
        a,
        b,
        ws * (pave - BIKE_IN - BIKE_W / 2),
        BIKE_W,
        BIKE_GREEN,
      );
      paintStrip(
        net,
        w,
        tiles,
        a,
        b,
        ws * (pave - BIKE_IN - BIKE_W - BIKE_LINE / 2),
        BIKE_LINE,
        false,
      );
    }
  }
}

// --- parks --------------------------------------------------------------------------------------------------------------

/** A park path's lift over the drawn land (m: the 1 m terrain mesh between its vertices stays under it). */
const PATH_LIFT = 0.05;
/** A fountain basin: its rim (wall thickness, height over the land, water this far below the coping, the foundation
 * below the land) and the lobes of its quatrefoil outline (share of the radius) (m). */
const BASIN_WALL = 0.4;
const BASIN_H = 0.55;
const WATER_DOWN = 0.2;
const BASIN_FOOT = 0.3;
const BASIN_LOBE = 0.12;
const FOUNTAIN_STONE: RGB = [0.74, 0.7, 0.62];
const FOUNTAIN_WATER: RGB = [0.16, 0.22, 0.23];
/** The centrepiece: pedestal, bowl and finial (radius, top over the water, m). */
const TIERS: [r: number, top: number][] = [
  [0.7, 1.1],
  [1.8, 1.3],
  [0.3, 2.3],
];

/** A small park (`NetworkDef.parks`): its footpaths paved on the drawn land, its fountains in stone. */
function parkMesh(
  field: NetField,
  pk: NetPark,
  tiles: Tiles,
  parts: Parts,
): void {
  const land = (x: number, z: number) =>
    field.ground(x, z) - field.meshSink(x, z);
  const hw = pk.pathWidth / 2;
  for (const p of pk.paths) {
    const n = p.length / 2;
    if (n < 2) continue;
    const acc = tiles.at('sidewalk', p[0], p[1]);
    // points every <= 1 m, each with the mean normal of its segments
    const pts: [number, number][] = [];
    for (let k = 0; k + 1 < n; k++) {
      const [ax, az, bx, bz] = [
        p[k * 2],
        p[k * 2 + 1],
        p[k * 2 + 2],
        p[k * 2 + 3],
      ];
      const m = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az)));
      for (let i = 0; i < m; i++)
        pts.push([ax + ((bx - ax) * i) / m, az + ((bz - az) * i) / m]);
    }
    pts.push([p[n * 2 - 2], p[n * 2 - 1]]);
    let d = 0;
    let prev: [number, number] | undefined;
    for (let k = 0; k < pts.length; k++) {
      const [x, z] = pts[k];
      const [px, pz] = pts[Math.max(0, k - 1)];
      const [qx, qz] = pts[Math.min(pts.length - 1, k + 1)];
      const L = Math.hypot(qx - px, qz - pz) || 1;
      const ox = (-(qz - pz) / L) * hw;
      const oz = ((qx - px) / L) * hw;
      if (k) d += Math.hypot(x - pts[k - 1][0], z - pts[k - 1][1]);
      const a = acc.v(
        x - ox,
        land(x - ox, z - oz) + PATH_LIFT,
        z - oz,
        -hw / SIDEWALK_TEX,
        d / SIDEWALK_TEX,
      );
      const b = acc.v(
        x + ox,
        land(x + ox, z + oz) + PATH_LIFT,
        z + oz,
        hw / SIDEWALK_TEX,
        d / SIDEWALK_TEX,
      );
      // (left offset -> right: a then b; these rows face up in this order)
      if (prev) acc.idx.push(prev[0], prev[1], b, prev[0], b, a);
      prev = [a, b];
    }
  }
  for (const f of pk.fountains) fountain(f.x, f.z, f.r, land(f.x, f.z), parts);
}

/** A round stone fountain: a quatrefoil basin of radius r with its water, a tiered centrepiece. */
function fountain(
  cx: number,
  cz: number,
  r: number,
  g: number,
  parts: Parts,
): void {
  const { stone, conc } = parts.at(cx, cz);
  const N = 64;
  const ring = (rad: (a: number) => number, y: number) => {
    const out: [number, number, number][] = [];
    for (let k = 0; k <= N; k++) {
      const a = (k / N) * Math.PI * 2;
      out.push([cx + Math.cos(a) * rad(a), y, cz + Math.sin(a) * rad(a)]);
    }
    return out;
  };
  // (both faces: the builders' meshes are one-sided)
  const sheet = (b: Builder, rows: [number, number, number][][], c: RGB) => {
    b.grid(rows, c);
    b.grid([...rows].reverse(), c);
  };
  const tube = (
    b: Builder,
    rad: (a: number) => number,
    bot: number,
    top: number,
    c: RGB,
  ) => {
    const pts = ring(rad, 0).map(([x, , z]) => ({ x, z, bot, top }));
    b.wall(pts, c);
    b.wall([...pts].reverse(), c);
  };
  const outer = (a: number) =>
    r * (1 - BASIN_LOBE + BASIN_LOBE * Math.abs(Math.cos(2 * a)));
  const inner = (a: number) => outer(a) - BASIN_WALL;
  const top = g + BASIN_H;
  const water = top - WATER_DOWN;
  tube(stone, outer, g - BASIN_FOOT, top, FOUNTAIN_STONE);
  tube(stone, inner, water - 0.05, top, FOUNTAIN_STONE);
  sheet(stone, [ring(inner, top), ring(outer, top)], FOUNTAIN_STONE);
  sheet(conc, [ring(() => 0.01, water), ring(inner, water)], FOUNTAIN_WATER);
  // the centrepiece: pedestal, a shallow bowl with its lip, the finial
  let base = water;
  for (const [tr, tt] of TIERS) {
    const y = water + tt;
    tube(stone, () => tr, base - 0.05, y, FOUNTAIN_STONE);
    sheet(stone, [ring(() => 0.01, y), ring(() => tr, y)], FOUNTAIN_STONE);
    base = y - (tr > 1 ? 0.2 : 0);
  }
}

/** A painted island's hatch: yellow bars at 45 degrees to its longest edge, this far apart and wide (m). */
const HATCH_STEP = 2.4;
const HATCH_W = 0.3;
/** ... inside a yellow outline this wide (m). */
const OUTLINE_W = 0.15;
/** A plaza crosswalk's NYC ladder: bars LADDER_BAR wide every LADDER_STEP along the crossing, LADDER_LEN long (m). */
const LADDER_STEP = 1.2;
const LADDER_BAR = 0.6;
const LADDER_LEN = 3;

/**
 * A survey plaza's markings: each painted island (NYC planimetric median 360010) as a yellow outline + hatch, each OSM
 * zebra crossing as ladder bars; on the paving under them (plaza field or the road through it), inside the area and
 * off the raised islands.
 */
function plazaPaint(field: NetField, pl: Plaza, tiles: Tiles): void {
  const raised = pl.islands.filter(
    (il) => il.kind !== 'painted' && il.pts.length >= 6,
  );
  const surf = (x: number, z: number): number | undefined => {
    if (!inPolygon(pl.area, x, z)) return undefined;
    if (raised.some((il) => inPolygon(il.pts, x, z))) return undefined;
    return field.plazaHeight(x, z) ?? field.top(x, z)?.h;
  };
  markings(
    tiles,
    surf,
    pl.islands.filter((il) => il.kind === 'painted').map((il) => il.pts),
    pl.crosswalks,
  );
}

/**
 * Painted medians outside the survey plazas (`NetworkDef.paintedMedians`): hatched on the highest paving under them (a
 * street on its deck, not the road below).
 */
function paintedMedians(net: Network, field: NetField, tiles: Tiles): void {
  const own = net.paintedMedians.filter((p) => {
    let cx = 0;
    let cz = 0;
    for (let k = 0; k < p.length; k += 2) {
      cx += p[k];
      cz += p[k + 1];
    }
    cx /= p.length / 2;
    cz /= p.length / 2;
    return !net.plazas.some((pl) => inPolygon(pl.area, cx, cz));
  });
  markings(tiles, (x, z) => field.top(x, z)?.h, own, []);
}

/** A marking line's sample step and its shortest piece left after the paving clips it (m). */
const PAINT_STEP = 0.3;
const PAINT_MIN_RUN = 0.5;

/** Yellow-hatched painted islands and NYC ladder crosswalks on the surface `surf` gives (undefined = none there). */
function markings(
  tiles: Tiles,
  surf: (x: number, z: number) => number | undefined,
  painted: number[][],
  crosswalks: number[][],
): void {
  const line = (
    ax: number,
    az: number,
    bx: number,
    bz: number,
    width: number,
    yellow: boolean,
  ) => {
    const L = Math.hypot(bx - ax, bz - az);
    if (L < PAINT_MIN_RUN) return;
    // (sampled finely: a line never spans land or an island between two paved points; the pieces the paving clips
    // it into are kept from PAINT_MIN_RUN long - no loose bits)
    const n = Math.max(1, Math.ceil(L / PAINT_STEP));
    const ox = (-(bz - az) / L) * (width / 2);
    const oz = ((bx - ax) / L) * (width / 2);
    const acc = tiles.at('paint', ax, az);
    const runs: [number, number, number, number][][] = [];
    let run: [number, number, number, number][] | undefined;
    for (let k = 0; k <= n; k++) {
      const x = ax + ((bx - ax) * k) / n;
      const z = az + ((bz - az) * k) / n;
      const h = surf(x, z);
      if (h === undefined) {
        run = undefined;
        continue;
      }
      if (!run) runs.push((run = []));
      run.push([x, z, h, (L * k) / n]);
    }
    for (const r of runs) {
      if (r.length < 2 || r[r.length - 1][3] - r[0][3] < PAINT_MIN_RUN)
        continue;
      let prev: [number, number, number, number] | undefined;
      for (const [x, z, h, s] of r) {
        const d = s / PAINT_TILE;
        const a = acc.v(x - ox, h + PAINT_LIFT, z - oz, 0, d, WHITE);
        const b = acc.v(x + ox, h + PAINT_LIFT, z + oz, 1, d, WHITE);
        if (yellow) {
          acc.col.splice(a * 3, 3, ...YELLOW);
          acc.col.splice(b * 3, 3, ...YELLOW);
        }
        if (prev) {
          // (face up whichever way the line runs)
          const up = (x - prev[2]) * oz - (z - prev[3]) * ox > 0;
          if (up) acc.idx.push(prev[0], prev[1], b, prev[0], b, a);
          else acc.idx.push(prev[0], b, prev[1], prev[0], a, b);
        }
        prev = [a, b, x, z];
      }
    }
  };
  for (const p of painted) {
    if (p.length < 6) continue;
    const m = p.length / 2;
    let best = 0;
    let dir = 0;
    for (let k = 0; k < m; k++) {
      const q = (k + 1) % m;
      const dx = p[q * 2] - p[k * 2];
      const dz = p[q * 2 + 1] - p[k * 2 + 1];
      const l = Math.hypot(dx, dz);
      if (l > best) {
        best = l;
        dir = Math.atan2(dz, dx);
      }
      line(p[k * 2], p[k * 2 + 1], p[q * 2], p[q * 2 + 1], OUTLINE_W, true);
    }
    // hatch lines across the island at 45 degrees: each cut by the outline into its inside runs
    const hx = Math.cos(dir + Math.PI / 4);
    const hz = Math.sin(dir + Math.PI / 4);
    const nx = -hz;
    const nz = hx;
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < m; k++) {
      const o = p[k * 2] * nx + p[k * 2 + 1] * nz;
      lo = Math.min(lo, o);
      hi = Math.max(hi, o);
    }
    for (let o = lo + HATCH_STEP / 2; o < hi; o += HATCH_STEP) {
      const ts: number[] = [];
      for (let k = 0; k < m; k++) {
        const q = (k + 1) % m;
        const oa = p[k * 2] * nx + p[k * 2 + 1] * nz - o;
        const ob = p[q * 2] * nx + p[q * 2 + 1] * nz - o;
        if (oa < 0 === ob < 0) continue;
        const f = oa / (oa - ob);
        const x = p[k * 2] + (p[q * 2] - p[k * 2]) * f;
        const z = p[k * 2 + 1] + (p[q * 2 + 1] - p[k * 2 + 1]) * f;
        ts.push(x * hx + z * hz);
      }
      ts.sort((a, b) => a - b);
      for (let k = 0; k + 1 < ts.length; k += 2) {
        const t0 = ts[k] + OUTLINE_W;
        const t1 = ts[k + 1] - OUTLINE_W;
        if (t1 - t0 < 0.3) continue;
        line(
          nx * o + hx * t0,
          nz * o + hz * t0,
          nx * o + hx * t1,
          nz * o + hz * t1,
          HATCH_W,
          true,
        );
      }
    }
  }
  for (const cw of crosswalks) {
    for (let k = 0; k + 3 < cw.length; k += 2) {
      const [ax, az, bx, bz] = [cw[k], cw[k + 1], cw[k + 2], cw[k + 3]];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.5) continue;
      const ux = (bx - ax) / L;
      const uz = (bz - az) / L;
      for (let d = LADDER_STEP / 2; d < L; d += LADDER_STEP) {
        const x = ax + ux * d;
        const z = az + uz * d;
        const h = LADDER_LEN / 2;
        line(x + uz * h, z - ux * h, x - uz * h, z + ux * h, LADDER_BAR, false);
      }
    }
  }
}

function triangulate(
  poly: number[],
  max: number,
  holes: number[][] = [],
): { pts: [number, number][]; tris: number[][] } {
  const ring = (p: number[]) => {
    const r: Vector2[] = [];
    for (let k = 0; k < p.length; k += 2) r.push(new Vector2(p[k], p[k + 1]));
    return r;
  };
  const contour = ring(poly);
  const hs = holes.map(ring);
  const faces = ShapeUtils.triangulateShape(contour, hs);
  const pts: [number, number][] = [contour, ...hs].flatMap((r) =>
    r.map((v): [number, number] => [v.x, v.y]),
  );
  const key = new Map<string, number>();
  const mid = (a: number, b: number) => {
    const k = a < b ? `${a},${b}` : `${b},${a}`;
    let m = key.get(k);
    if (m === undefined) {
      m = pts.length;
      pts.push([(pts[a][0] + pts[b][0]) / 2, (pts[a][1] + pts[b][1]) / 2]);
      key.set(k, m);
    }
    return m;
  };
  let tris = faces.map((f) => [...f]);
  for (let round = 0; round < 5; round++) {
    let split = false;
    const out: number[][] = [];
    for (const [a, b, c] of tris) {
      const len = (p: number, q: number) =>
        Math.hypot(pts[p][0] - pts[q][0], pts[p][1] - pts[q][1]);
      if (Math.max(len(a, b), len(b, c), len(c, a)) <= max) {
        out.push([a, b, c]);
        continue;
      }
      split = true;
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      out.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
    }
    tris = out;
    if (!split) break;
  }
  return { pts, tris };
}

function junctionSurface(
  field: NetField,
  j: Junction,
  tiles: Tiles,
  parts: Parts,
): void {
  if (j.poly.length < 6) return;
  const cx = (j.minX + j.maxX) / 2;
  const cz = (j.minZ + j.maxZ) / 2;
  let bridged = false;
  const fill = (
    poly: number[],
    mat: MatId,
    rise: number,
    tex: number,
    down = false,
  ) => {
    const acc = tiles.at(mat, cx, cz);
    const { pts, tris } = triangulate(poly, 2.5);
    const ids = pts.map(([x, z]) => {
      const h = field.junctionHeight(j, x, z);
      // a road more than a storey below the junction: this junction spans it (a street grid over a trench) -
      // unless a tunnel slab already carries it
      if (
        !down &&
        rise === 0 &&
        field.top(x, z, h - 3) &&
        field.slabAt(x, z) === undefined
      )
        bridged = true;
      return acc.v(x, h + rise, z, x / tex, z / tex);
    });
    for (const [a, b, c] of tris) {
      // face up (down for a soffit)
      const [ax, az] = pts[a];
      const [bx, bz] = pts[b];
      const [qx, qz] = pts[c];
      // (none on a plaza's paving: the plaza is drawn there, a pad over it fights it from afar)
      if (
        !down &&
        field.plazaDrawn((ax + bx + qx) / 3, (az + bz + qz) / 3, 0) !==
          undefined
      )
        continue;
      const cross = (bx - ax) * (qz - az) - (bz - az) * (qx - ax);
      if (cross < 0 !== down) acc.tri(ids[a], ids[b], ids[c]);
      else acc.tri(ids[a], ids[c], ids[b]);
    }
    return acc;
  };
  fill(j.poly, 'junction', 0, TEX);
  if (bridged) {
    fill(j.poly, 'kerb', -DECK_DEPTH, TEX, true);
    const p = parts.at(cx, cz);
    const pts: { x: number; z: number; bot: number; top: number }[] = [];
    const m = j.poly.length / 2;
    for (let k = 0; k <= m; k++) {
      const x = j.poly[(k % m) * 2];
      const z = j.poly[(k % m) * 2 + 1];
      const h = field.junctionHeight(j, x, z);
      pts.push({ x, z, bot: h - DECK_DEPTH, top: h + 0.02 });
    }
    p.conc.wall(pts, CONC);
  }
  for (const c of j.corners) {
    // (a corner reaching onto a plaza's paving: the plaza's surveyed islands stand there, a corner would overlap
    // them or stand loose on the plaza)
    let onPlaza = false;
    for (let k = 0; k < c.poly.length && !onPlaza; k += 2)
      onPlaza = field.plazaDrawn(c.poly[k], c.poly[k + 1], 0) !== undefined;
    if (onPlaza) continue;
    const acc = fill(c.poly, 'sidewalk', c.rise, SIDEWALK_TEX);
    // kerb face along the junction side
    const kerb = tiles.at('kerb', cx, cz);
    const n = c.kerbN;
    for (let k = 0; k + 1 < n; k++) {
      const [ax, az] = [c.poly[k * 2], c.poly[k * 2 + 1]];
      const [bx, bz] = [c.poly[k * 2 + 2], c.poly[k * 2 + 3]];
      const ha = field.junctionHeight(j, ax, az);
      const hb = field.junctionHeight(j, bx, bz);
      const a0 = kerb.v(ax, ha - 0.02, az, 0, 0, 0.9);
      const a1 = kerb.v(ax, ha + c.rise, az, 0, 0.15, 0.95);
      const b0 = kerb.v(bx, hb - 0.02, bz, 1, 0, 0.9);
      const b1 = kerb.v(bx, hb + c.rise, bz, 1, 0.15, 0.95);
      kerb.idx.push(a0, b0, b1, a0, b1, a1, a0, b1, b0, a0, a1, b1);
    }
    // outer edge drops
    const m = c.poly.length / 2;
    for (let k = n - 1; k < m; k++) {
      const p = k;
      const q = (k + 1) % m;
      if (q === 0) break;
      const [ax, az] = [c.poly[p * 2], c.poly[p * 2 + 1]];
      const [bx, bz] = [c.poly[q * 2], c.poly[q * 2 + 1]];
      const ha = field.junctionHeight(j, ax, az) + c.rise;
      const hb = field.junctionHeight(j, bx, bz) + c.rise;
      const a0 = acc.v(ax, ha, az, 0, 0, 0.7);
      const a1 = acc.v(ax, ha - 0.3, az, 0, 0.1, 0.6);
      const b0 = acc.v(bx, hb, bz, 1, 0, 0.7);
      const b1 = acc.v(bx, hb - 0.3, bz, 1, 0.1, 0.6);
      acc.idx.push(a0, b0, b1, a0, b1, a1, a0, b1, b0, a0, a1, b1);
    }
  }
}

// --- walls ------------------------------------------------------------------------------------------------------------------

/** Chain-link on a cut wall: height, post spacing (m), mesh texture scale (v1's cut-wall-mesh values). */
const FENCE_H = 2.2;
const FENCE_POST = 3;
const FENCE_TS = 1.6;
const STEEL: RGB = [0.52, 0.54, 0.55];
/** Chain-link on the parapets of a bridge over the parkway (m over the parapet cap). */
const PARAPET_FENCE_H = 1.8;

/** Chain-link mesh on posts along `rows` at lateral `off`, from `base` m over the rows' height, `h` m tall. */
function chainLink(
  p: ReturnType<Parts['at']>,
  rows: Row[],
  off: number,
  base: number,
  h: number,
): void {
  p.fence.strip(rows, [off, base, 0], [off, base + h, 0], [1, 1, 1]);
  p.metal.strip(rows, [off, base + h, 0], [off, base + h + 0.05, 0], STEEL);
  let next = rows[0].d;
  for (const r of rows) {
    if (r.d < next) continue;
    next = r.d + FENCE_POST;
    const [x, z] = [r.x + r.tz * off, r.z - r.tx * off];
    p.metal.box(
      x,
      z,
      r.tx,
      r.tz,
      0.05,
      0.05,
      r.y + base - 0.04,
      r.y + base + h + 0.05,
      STEEL,
    );
  }
}

/** Runs of one wall kind on a side, split where the wall look (`Network.wallStyle`) changes. */
function styledRuns(
  net: Network,
  w: Way,
  side: 0 | 1,
  kind: number,
): [number, number][] {
  const out: [number, number][] = [];
  for (const [i0, i1] of runsOf(w.wall[side], kind)) {
    let a = i0;
    let key = JSON.stringify(net.wallStyle(w, i0));
    for (let i = i0 + 1; i <= i1; i++) {
      const k = JSON.stringify(net.wallStyle(w, i));
      if (k === key) continue;
      out.push([a, i - 1]);
      a = i - 1;
      key = k;
    }
    out.push([a, i1]);
  }
  return out;
}

/**
 * One hall over side-by-side bores (Queens Blvd, drive frames: the carriageways split by a barrier only, each outer lane
 * behind a low wall with a column row on it): along a tunnel lane wall a steel column every HALL_COLUMN_EVERY m from the
 * wall's top up to a long beam under the soffit.
 */
function hallColumns(net: Network, w: Way, parts: Parts): void {
  if (!w.slab) return;
  for (const side of [0, 1] as const) {
    const sg = side === 0 ? 1 : -1;
    const foot = side === 0 ? w.sec.footL : w.sec.footR;
    const lane = new Uint8Array(w.al.n);
    for (let i = 0; i < w.al.n; i++)
      lane[i] =
        w.st[i] === ST_TUNNEL &&
        w.wall[side][i] === WALL_CUT &&
        w.wallLane[side][i]
          ? 1
          : 0;
    for (const [i0, i1] of runsOf(lane, 1)) {
      const s0 = w.al.s[i0];
      const s1 = w.al.s[i1];
      if (s1 - s0 < HALL_COLUMN_EVERY) continue;
      const t = sg * (foot + w.tpl.daylight.wallOffset + LANE_WALL_W / 2);
      const beam: Row[] = [];
      for (const s of rowsBetween(w, s0, s1)) {
        const fr = frameAt(w, s);
        const ceil = net.surfaceAt(w, fr.i, fr.f, 0) + w.tpl.clearance + 0.4;
        beam.push(rowOf(fr, ceil - net.girderAt(w, fr.i), 0));
      }
      const p = parts.at(beam[0].x, beam[0].z);
      // the long beam: a box section along the wall line under the girders
      p.paint.strip(beam, [t - 0.25, 0, 0], [t + 0.25, 0, 0], GIRDER, false);
      for (let s = s0 + HALL_COLUMN_EVERY / 2; s < s1; s += HALL_COLUMN_EVERY) {
        const fr = frameAt(w, s);
        const [px, pz] = lat(fr, t);
        const E = net.surfaceAt(w, fr.i, fr.f, sg * foot);
        const ceil = net.surfaceAt(w, fr.i, fr.f, 0) + w.tpl.clearance + 0.4;
        p.paint.box(
          px,
          pz,
          fr.tx,
          fr.tz,
          0.17,
          0.16,
          E + HALL_WALL_H,
          ceil - net.girderAt(w, fr.i),
          COLUMN,
        );
      }
    }
  }
}

function walls(net: Network, field: NetField, w: Way, parts: Parts): void {
  const dl = w.tpl.daylight;
  for (const side of [0, 1] as const) {
    const sg = side === 0 ? 1 : -1;
    const foot = side === 0 ? w.sec.footL : w.sec.footR;
    const tCut = sg * (foot + dl.wallOffset);
    for (const kind of [WALL_CUT, WALL_FILL]) {
      // (a fill wall is a parapet on the ground: the deck parapet's face line, one coping where the two meet)
      const tWall = kind === WALL_FILL ? sg * (foot + PARAPET_OUT) : tCut;
      for (const [i0, i1] of styledRuns(net, w, side, kind)) {
        if (i1 - i0 < 1) continue;
        const style = net.wallStyle(w, (i0 + i1) >> 1);
        const face: { x: number; z: number; bot: number; top: number }[] = [];
        const inner: { x: number; z: number; bot: number; top: number }[] = [];
        const rear: { x: number; z: number; bot: number; top: number }[] = [];
        const cap: Row[] = [];
        // (a fill wall next to a deck starts where its parapet ends - one coping, no end face between the two)
        const deck0 = kind === WALL_FILL && i0 > 0 && w.st[i0 - 1] === ST_DECK;
        const deck1 =
          kind === WALL_FILL && i1 < w.al.n - 1 && w.st[i1 + 1] === ST_DECK;
        const s0 = deck0 ? w.al.s[i0 - 1] + 1 : Math.max(0, w.al.s[i0] - 1);
        const s1 = deck1
          ? w.al.s[i1 + 1] - 1
          : Math.min(w.al.length, w.al.s[i1] + 1);
        for (const s of rowsBetween(w, s0, s1)) {
          const fr = frameAt(w, s);
          const k = Math.min(
            w.al.n - 1,
            Math.round(s / (w.al.length / (w.al.n - 1))),
          );
          const E = net.surfaceAt(w, fr.i, fr.f, sg * foot);
          const [x, z] = lat(fr, tWall);
          if (kind === WALL_CUT) {
            const kk = Math.min(i1, Math.max(i0, k));
            // (the top between this row's samples, within the run: a stepped-down end reads as a slope, not stairs)
            const ka = Math.min(i1, Math.max(i0, fr.i));
            const kb = Math.min(i1, ka + 1);
            const wt = w.wallTop[side];
            const tf = ka === fr.i && kb === fr.i + 1 ? fr.f : 0;
            // a tunnel wall stops just under the slab (the road on top is drawn over it); elsewhere the coping stands
            // a little above the land it holds
            // (a lane wall in a tunnel is the hall's outer barrier: a low wall under a column row, `hallColumns`)
            const top =
              w.st[kk] === ST_TUNNEL && w.slab
                ? w.wallLane[side][kk]
                  ? E + HALL_WALL_H
                  : w.slab[kk] - 0.03
                : Math.max(wt[ka] + (wt[kb] - wt[ka]) * tf, E + 0.6) + 0.12;
            face.push({ x, z, bot: E - 0.3, top });
            // the back of the coping drops to the land it holds (a lane wall is a thin body in the gap)
            const back = w.wallLane[side][kk] ? LANE_WALL_W : WALL_BACK;
            const [rx, rz] = lat(fr, tWall + sg * back);
            rear.push({
              x: rx,
              z: rz,
              // (a lane wall's back reaches the floor of the bore beside it, which may lie lower: no gap under it)
              bot: w.wallLane[side][kk]
                ? Math.min(
                    E,
                    field.ground(rx + fr.tz * sg * 0.3, rz - fr.tx * sg * 0.3),
                  ) - 0.3
                : // (down to its road: buried where the land behind stands higher, closing the body where it falls -
                  // the end of a run, a lowered wall)
                  Math.min(
                    E,
                    field.ground(rx + fr.tz * sg * 0.8, rz - fr.tx * sg * 0.8),
                  ) - 0.4,
              top,
            });
            cap.push(rowOf(fr, top, sideShift(fr, side)));
          } else {
            const top = E + PARAPET_H;
            const [ox, oz] = lat(fr, tWall + sg * 0.05);
            // (the DRAWN land at its foot, a little out and further down the bank: the face reaches it, no gap)
            let ground = Infinity;
            for (const o of [0.6, 1.5]) {
              const gx = ox + fr.tz * sg * o;
              const gz = oz - fr.tx * sg * o;
              ground = Math.min(
                ground,
                field.ground(gx, gz) - field.meshSink(gx, gz),
              );
            }
            face.push({ x, z, bot: Math.min(ground, E) - 0.4, top });
            const [ix, iz] = lat(fr, tWall - sg * FILL_W);
            inner.push({ x: ix, z: iz, bot: E - 0.1, top });
            cap.push(rowOf(fr, top, sideShift(fr, side)));
          }
        }
        const p = parts.at(face[0].x, face[0].z);
        const b = style.wall === 'stone' ? p.stone : p.conc;
        const color = style.wall === 'stone' ? STONE : CONC;
        // on top of a cut wall holding open land: the railing / chain-link of that stretch (not on a lane wall, a
        // tunnel wall or a wall carrying another road's edge), a little behind the face
        if (kind === WALL_CUT && style.fence !== 'none') {
          let run: Row[] = [];
          const flush = () => {
            if (run.length >= 2) {
              const off = tWall + sg * 0.25;
              if (style.fence === 'railing')
                railing(p.metal, run, off, 0.02, 0);
              else chainLink(p, run, off, 0.14, FENCE_H);
            }
            run = [];
          };
          cap.forEach((r, k) => {
            const kk = Math.min(
              i1,
              Math.max(
                i0,
                i0 + Math.round((k / Math.max(1, cap.length - 1)) * (i1 - i0)),
              ),
            );
            const open =
              !w.wallLane[side][kk] &&
              !w.wallCarried[side][kk] &&
              w.st[kk] !== ST_TUNNEL;
            if (open) run.push(r);
            else flush();
          });
          flush();
        }
        b.wall(face, color);
        if (inner.length) b.wall(inner, color);
        if (rear.length) b.wall(rear, color);
        // coping / cap: a slab on top reaching back over the land behind
        const back =
          kind === WALL_CUT
            ? sg * (w.wallLane[side][i0] ? LANE_WALL_W : WALL_BACK)
            : -sg * FILL_W;
        b.strip(
          cap,
          [kind === WALL_FILL ? tWall : tWall - sg * 0.08, 0, 0],
          [tWall + back, 0, 0],
          color,
          false,
        );
        // end faces close the body (a wall is an object, not a skin)
        const other = kind === WALL_CUT ? rear : inner;
        for (const k of [0, face.length - 1]) {
          if ((k === 0 && deck0) || (k > 0 && deck1)) continue;
          const a = face[k];
          const o = other[k];
          b.wall(
            [
              { x: a.x, z: a.z, bot: Math.min(a.bot, o.bot), top: a.top },
              { x: o.x, z: o.z, bot: Math.min(a.bot, o.bot), top: o.top },
            ],
            color,
          );
        }
      }
    }
  }
}

// --- decks + tunnels ---------------------------------------------------------------------------------------------------------

function decks(net: Network, field: NetField, w: Way, parts: Parts): void {
  const L = w.al.length;
  for (const [i0, i1] of runsOf(w.st, ST_DECK)) {
    const s0 = Math.max(w.cut0, w.al.s[i0] - (i0 > 0 ? 1 : 0));
    const s1 = Math.min(L - w.cut1, w.al.s[i1] + (i1 < w.al.n - 1 ? 1 : 0));
    if (s1 - s0 < 2) continue;
    const ss = rowsBetween(w, s0, s1);
    const mid = frameAt(w, (s0 + s1) / 2);
    const p = parts.at(mid.x, mid.z);
    // a bridge over a road whose own decks are stone (the 1930s parkway) was built with it: stone face, chain-link on
    // the parapets (drive videos: every street arch over the parkway)
    const overStone = net.crossings.some(
      (c) =>
        c.upper === w &&
        !c.overSlab &&
        c.lower.tpl.deck === 'stone' &&
        c.sU >= s0 - 2 &&
        c.sU <= s1 + 2,
    );
    // a one-off structure from the map data (`NetworkDef.decks`): its own parapet type, one span (no piers)
    const own = net.ownDeckAt(w, (s0 + s1) / 2);
    const jersey = own?.parapet === 'jersey';
    const stone = !jersey && (net.deckStyle(w, mid.i) === 'stone' || overStone);
    // a painted plate-girder bridge (map `deckStyles`): steel fascia and girders, the abutments stay masonry (or the
    // map's `abutment`)
    const steel = net.deckFacing(w) === 'steel';
    const face = steel ? p.paint : stone ? p.stone : p.conc;
    const faceCol = steel ? STEEL_PAINT : stone ? STONE : CONC;
    const abutStone =
      (net.deckAbutment(w) ?? (stone || steel ? 'stone' : 'concrete')) ===
      'stone';
    const abut = abutStone ? p.stone : p.conc;
    const abutCol = abutStone ? STONE : CONC;
    const edgeL = w.sec.footL + PARAPET_OUT;
    const edgeR = w.sec.footR + PARAPET_OUT;
    // (one half per side: on a narrowed pavement each side's edge moves in by its own shift; hw = that shift, so the
    // halves meet on the centreline)
    const soffitL: Row[] = [];
    const soffitR: Row[] = [];
    // (steel: the slab's underside higher up, the girders below it reach the same depth - the clearance is unchanged)
    const slabUnder = steel ? STEEL_SLAB : DECK_DEPTH;
    const deckRows: Row[] = [];
    for (const s of ss) {
      const fr = frameAt(w, s);
      const y = net.surfaceAt(w, fr.i, fr.f, 0) - slabUnder;
      const dL = sideShift(fr, 0);
      const dR = sideShift(fr, 1);
      soffitL.push(rowOf(fr, y, dL, -dL));
      soffitR.push(rowOf(fr, y, dR, dR));
      deckRows.push(rowOf(fr, y + slabUnder));
    }
    const under = steel ? p.paint : p.conc;
    const underCol = steel ? GIRDER : SOFFIT;
    under.strip(soffitR, [-edgeR, 0, 0], [0, 0, -1], underCol, false);
    under.strip(soffitL, [0, 0, 1], [edgeL, 0, 0], underCol, false);
    if (steel) {
      // longitudinal girders under the slab (drive video: dark steel stringers across the parkway), web + bottom flange
      const n = Math.max(2, Math.round((edgeL + edgeR) / STEEL_GIRDER_GAP));
      for (let k = 0; k <= n; k++) {
        const t = -edgeR + 0.35 + ((edgeL + edgeR - 0.7) * k) / n;
        p.paint.strip(
          deckRows,
          [t, -STEEL_SLAB, 0],
          [t, -DECK_DEPTH, 0],
          GIRDER,
        );
        p.paint.strip(
          deckRows,
          [t - 0.18, -DECK_DEPTH, 0],
          [t + 0.18, -DECK_DEPTH, 0],
          GIRDER,
          false,
        );
      }
    }
    // fascia + parapet per side, open where another road runs alongside at the deck's level (a ramp merging)
    for (const side of [0, 1] as const) {
      const sg = side === 0 ? 1 : -1;
      const foot = side === 0 ? w.sec.footL : w.sec.footR;
      const edge = side === 0 ? edgeL : edgeR;
      // the map's Jersey barrier for this stretch on the outer side (`wallStyles` barrier): a modern deck edge, the
      // precast barrier standing on the deck (barrierRuns) and a low concrete edge beam behind it
      const jersey =
        side === 1 && net.outerBarrier(w, (i0 + i1) >> 1) === 'jersey';
      const sFace = jersey ? p.conc : face;
      const sCol = jersey ? CONC : faceCol;
      const capH = jersey ? DECK_EDGE_H : PARAPET_H;
      for (const [r0, r1] of parapetRuns(net, field, w, side, i0, i1)) {
        const fa: { x: number; z: number; bot: number; top: number }[] = [];
        const pa: typeof fa = [];
        const cap: Row[] = [];
        if (jersey) {
          jerseyParapet(net, w, p, side, r0, r1);
          continue;
        }
        for (const s of rowsBetween(w, r0, r1)) {
          const fr = frameAt(w, s);
          const y = net.surfaceAt(w, fr.i, fr.f, 0);
          const h = net.surfaceAt(w, fr.i, fr.f, sg * foot);
          const [x, z] = lat(fr, sg * edge);
          const [ix, iz] = lat(fr, sg * (foot + PARAPET_IN));
          fa.push({ x, z, bot: y - DECK_DEPTH, top: h + capH });
          pa.push({ x: ix, z: iz, bot: h - 0.05, top: h + capH });
          cap.push(rowOf(fr, h + capH, sideShift(fr, side)));
        }
        sFace.wall(fa, sCol);
        sFace.wall(pa, sCol);
        // end faces close the parapet body (no look into it past its end, where a fill wall carries on)
        if (fa.length >= 2)
          for (const k of [0, fa.length - 1])
            sFace.wall(
              [
                { x: fa[k].x, z: fa[k].z, bot: pa[k].bot, top: fa[k].top },
                { x: pa[k].x, z: pa[k].z, bot: pa[k].bot, top: pa[k].top },
              ],
              sCol,
            );
        sFace.strip(
          cap,
          [sg * (foot + PARAPET_IN), 0, 0],
          [sg * edge, 0, 0],
          sCol,
          false,
        );
        if (overStone && !jersey && cap.length >= 2)
          chainLink(
            p,
            cap,
            sg * (foot + (PARAPET_IN + edge - foot) / 2),
            0,
            PARAPET_FENCE_H,
          );
      }
    }
    // abutments: the deck ends sit on a wall down to the ground
    for (const [s, atRunEnd] of [
      [s0, i0 > 0],
      [s1, i1 < w.al.n - 1],
    ] as const) {
      if (!atRunEnd) continue;
      const fr = frameAt(w, s);
      const y = net.surfaceAt(w, fr.i, fr.f, 0);
      const pts: { x: number; z: number; bot: number; top: number }[] = [];
      const soffit = y - DECK_DEPTH + 0.02;
      for (
        let t = -edgeR;
        t <= edgeL + 0.01;
        t += Math.max(0.5, (edgeL + edgeR) / 8)
      ) {
        const [x, z] = lat(fr, t);
        // over a road passing under the deck end the abutment stops at the soffit (the span continues)
        const under = field.top(x, z, soffit - 0.5);
        const onRoad = under !== undefined;
        pts.push({
          x,
          z,
          bot: onRoad ? soffit - 0.3 : field.ground(x, z) - 0.5,
          top: soffit,
        });
      }
      abut.wall(pts, abutCol);
    }
    // piers under long decks, clear of the roads beneath
    const len = s1 - s0;
    if (len > 28 && !own) {
      const n = Math.round(len / 24);
      for (let k = 1; k < n; k++) {
        const s = s0 + (len * k) / n;
        const fr = frameAt(w, s);
        const y = net.surfaceAt(w, fr.i, fr.f, 0);
        const g = field.ground(fr.x, fr.z);
        if (y - DECK_DEPTH - g < 1.5) continue;
        const hn = Math.min(2.5, (edgeL + edgeR) * 0.3);
        if (!pierClear(field, w, fr, hn, y - DECK_DEPTH)) continue;
        // (its foot: the lowest drawn land around its footprint, a cell past each corner - on a bank the downhill end
        // would hang over the 1 m terrain cells)
        let foot = g;
        for (const v of [-hn - 1, -hn, 0, hn, hn + 1])
          for (const a of [-1.2, 0, 1.2]) {
            const fx = fr.x + fr.tz * v + fr.tx * a;
            const fz = fr.z - fr.tx * v + fr.tz * a;
            foot = Math.min(
              foot,
              field.ground(fx, fz) - field.meshSink(fx, fz),
            );
          }
        p.conc.box(
          fr.x,
          fr.z,
          fr.tx,
          fr.tz,
          0.7,
          hn,
          foot - 0.3,
          y - DECK_DEPTH,
          CONC,
        );
      }
    }
  }
}

/**
 * A deck's Jersey parapet (`NetworkDef.decks` `parapet: 'jersey'`): the roadside barrier carried over the deck, cast on
 * its edge - the Jersey face towards the road from the parapet's inner face, a flat top out to the fascia line, the
 * fascia (concrete, down to the soffit) below the outer face. Profile: section m beyond the foot, height over the deck.
 */
const JERSEY_PARAPET: [number, number][] = [
  [PARAPET_IN, -0.05],
  [PARAPET_IN, 0],
  [PARAPET_IN + 0.1, 0.08],
  [PARAPET_IN + 0.2, 0.33],
  [PARAPET_IN + 0.225, JERSEY_H],
  [PARAPET_OUT, JERSEY_H],
];

function jerseyParapet(
  net: Network,
  w: Way,
  p: ReturnType<Parts['at']>,
  side: 0 | 1,
  r0: number,
  r1: number,
): void {
  const sg = side === 0 ? 1 : -1;
  const foot = side === 0 ? w.sec.footL : w.sec.footR;
  const edge = foot + PARAPET_OUT;
  const rows: Row[] = [];
  const fa: { x: number; z: number; bot: number; top: number }[] = [];
  for (const s of rowsBetween(w, r0, r1)) {
    const fr = frameAt(w, s);
    const y = net.surfaceAt(w, fr.i, fr.f, 0);
    const h = net.surfaceAt(w, fr.i, fr.f, sg * foot);
    rows.push(rowOf(fr, h, sideShift(fr, side)));
    const [x, z] = lat(fr, sg * edge);
    fa.push({ x, z, bot: y - DECK_DEPTH, top: h + JERSEY_H });
  }
  if (rows.length < 2) return;
  p.conc.wall(fa, CONC);
  // (one-sided material: the profile runs towards + lateral, as the barriers' JERSEY does)
  const prof = JERSEY_PARAPET.map(([o, y]) => [sg * (foot + o), y] as const);
  if (sg < 0) prof.reverse();
  // (one parapet run: one age, by its start)
  const n = Math.round(r0 / JERSEY_SEG);
  for (let k = 0; k + 1 < prof.length; k++)
    p.jersey.strip(
      rows,
      [prof[k][0], prof[k][1], 0],
      [prof[k + 1][0], prof[k + 1][1], 0],
      jerseyColor(w, side, n, Math.min(prof[k][1], prof[k + 1][1])),
    );
  // end faces close the parapet body, seen from either side
  for (const r of [rows[0], rows[rows.length - 1]]) {
    const pts = JERSEY_PARAPET.slice(1).map(([o, y]) => {
      const l = sg * (foot + o);
      return {
        x: r.x + r.tz * l,
        z: r.z - r.tx * l,
        bot: r.y - 0.05,
        top: r.y + y,
      };
    });
    const col = jerseyColor(w, side, n, 1);
    p.jersey.wall(pts, col);
    p.jersey.wall([...pts].reverse(), col);
  }
}

/** A decked median is at most this wide between the two carriageways' parapets (m). */
const MEDIAN_DECK_MAX = 12;

/**
 * One structure under both carriageways (`NetworkDef.decks` `median`): the slab between the stage road's deck and the
 * other carriageway's, from parapet to parapet (top, soffit, faces at its ends), over the road beneath.
 */
function medianDecks(net: Network, w: Way, parts: Parts): void {
  const stage = net.stage;
  if (!w.corr || !net.medianDecks.length) return;
  const step = stage.al.length / Math.max(1, stage.al.n - 1);
  type Edge = { x: number; z: number; y: number };
  let run: [Edge, Edge][] = [];
  const flush = () => {
    if (run.length >= 2) {
      const p = parts.at(run[0][0].x, run[0][0].z);
      // (top and soffit, each wound both ways: the run's direction along the corridor decides which one faces out)
      for (const dy of [0, -DECK_DEPTH]) {
        const rows = run.map(([a, b]) => [
          [a.x, a.y + dy, a.z],
          [b.x, b.y + dy, b.z],
        ]) as [number, number, number][][];
        p.conc.grid(rows, CONC);
        p.conc.grid(
          rows.map((r) => [r[1], r[0]]),
          CONC,
        );
      }
      for (const [a, b] of [run[0], run[run.length - 1]])
        p.conc.wall(
          [
            { x: a.x, z: a.z, bot: a.y - DECK_DEPTH, top: a.y },
            { x: b.x, z: b.z, bot: b.y - DECK_DEPTH, top: b.y },
          ],
          CONC,
        );
    }
    run = [];
  };
  for (let i = 0; i < w.al.n; i++) {
    const st = w.corr[i];
    const j = Math.round(st / step);
    if (
      w.st[i] !== ST_DECK ||
      Number.isNaN(st) ||
      !net.medianDeckAt(st) ||
      stage.st[Math.min(stage.al.n - 1, j)] !== ST_DECK
    ) {
      flush();
      continue;
    }
    // each deck's edge (its parapet's outer face) on the side facing the other
    const fw = frameAt(w, w.al.s[i]);
    const fs = frameAt(stage, st);
    const facing = (fr: Frame, ox: number, oz: number) =>
      (ox - fr.x) * fr.tz - (oz - fr.z) * fr.tx >= 0 ? 1 : -1;
    const sgW = facing(fw, fs.x, fs.z);
    const sgS = facing(fs, fw.x, fw.z);
    const edge = (fr: Frame, sg: number): Edge => {
      const foot = sg > 0 ? fr.w.sec.footL : fr.w.sec.footR;
      const [x, z] = lat(fr, sg * (foot + PARAPET_OUT));
      return { x, z, y: net.surfaceAt(fr.w, fr.i, fr.f, sg * foot) };
    };
    const a = edge(fs, sgS);
    const b = edge(fw, sgW);
    if (Math.hypot(a.x - b.x, a.z - b.z) > MEDIAN_DECK_MAX) {
      flush();
      continue;
    }
    run.push([a, b]);
  }
  flush();
}

/** Share of the sky light under a tunnel roof (dark inside, the lamps and the portals' daylight only: drive videos). */
export const TUNNEL_SHADE = 0.8;
/** Length of one roof zone along a bore (m). */
const ROOF_STEP = 12;

/**
 * Every bore's roof as zones for the world shading (`setDryZones`: dry in the rain, dark under the slab): capsules
 * ROOF_STEP m long over the bore's width, below its soffit, the first and last marked as portals.
 */
export function tunnelRoofs(net: Network): DryZone[] {
  const out: DryZone[] = [];
  for (const w of net.ways) {
    if (!w.slab) continue;
    const off = w.tpl.daylight.wallOffset;
    const edgeL = w.sec.footL + off;
    const edgeR = w.sec.footR + off;
    const midT = (edgeL - edgeR) / 2;
    for (const [i0, i1] of runsOf(w.st, ST_TUNNEL)) {
      const s0 = w.al.s[i0];
      const s1 = w.al.s[i1];
      const n = Math.max(1, Math.round((s1 - s0) / ROOF_STEP));
      for (let k = 0; k < n; k++) {
        const fa = frameAt(w, s0 + ((s1 - s0) * k) / n);
        const fb = frameAt(w, s0 + ((s1 - s0) * (k + 1)) / n);
        const [ax, az] = lat(fa, midT);
        const [bx, bz] = lat(fb, midT);
        const top = Math.max(
          net.surfaceAt(w, fa.i, fa.f, 0),
          net.surfaceAt(w, fb.i, fb.f, 0),
        );
        out.push({
          ax,
          az,
          bx,
          bz,
          radius: (edgeL + edgeR) / 2 + 0.6,
          top: top + w.tpl.clearance + 0.45,
          shade: TUNNEL_SHADE,
          ends: (k === 0 ? 1 : 0) + (k === n - 1 ? 2 : 0),
        });
      }
    }
  }
  return mergeHalls(out);
}

/**
 * Bores side by side under one roof (the Queens Blvd hall: both carriageways and the service lanes) become one row of
 * zones over the hall's whole width: the shading takes only the nearest DRY_ZONES, and four bores' worth would leave
 * lit blocks inside. A zone takes in its neighbour from another bore when they run parallel (|cos| > HALL_COS), their
 * middles lie within ROOF_STEP m along and their edges within HALL_GAP m across.
 */
const HALL_COS = 0.9;
const HALL_GAP = 3;
function mergeHalls(zones: DryZone[]): DryZone[] {
  const out = zones.slice();
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < out.length && !merged; i++)
      for (let j = i + 1; j < out.length && !merged; j++) {
        const a = out[i];
        const b = out[j];
        const ux = a.bx - a.ax;
        const uz = a.bz - a.az;
        const la = Math.hypot(ux, uz) || 1;
        const tx = ux / la;
        const tz = uz / la;
        const vx = b.bx - b.ax;
        const vz = b.bz - b.az;
        const lb = Math.hypot(vx, vz) || 1;
        const cos = (tx * vx + tz * vz) / lb;
        if (Math.abs(cos) < HALL_COS) continue;
        const dx = (b.ax + b.bx) / 2 - (a.ax + a.bx) / 2;
        const dz = (b.az + b.bz) / 2 - (a.az + a.bz) / 2;
        const along = dx * tx + dz * tz;
        const across = dx * tz - dz * tx;
        if (Math.abs(along) > ROOF_STEP * 0.75) continue;
        if (Math.abs(across) > a.radius + b.radius + HALL_GAP) continue;
        // the union across (a's frame: + = a's left), centred, over a's length
        const lo = Math.min(-a.radius, across - b.radius);
        const hi = Math.max(a.radius, across + b.radius);
        const mid = (lo + hi) / 2;
        const ox = tz * mid;
        const oz = -tx * mid;
        out[i] = {
          ax: a.ax + ox,
          az: a.az + oz,
          bx: a.bx + ox,
          bz: a.bz + oz,
          radius: (hi - lo) / 2,
          top: Math.max(a.top, b.top),
          shade: Math.max(a.shade ?? 0, b.shade ?? 0),
          // (b's ends in a's direction)
          ends:
            (a.ends ?? 0) |
            (cos >= 0
              ? (b.ends ?? 0)
              : (((b.ends ?? 0) & 1) << 1) | (((b.ends ?? 0) & 2) >> 1)),
        };
        out.splice(j, 1);
        merged = true;
      }
  }
  return out;
}

function tunnel(net: Network, field: NetField, w: Way, parts: Parts): void {
  if (!w.slab) return;
  const off = w.tpl.daylight.wallOffset;
  const edgeL = w.sec.footL + off;
  const edgeR = w.sec.footR + off;
  for (const [i0, i1] of runsOf(w.st, ST_TUNNEL)) {
    const ss = rowsBetween(w, w.al.s[i0], w.al.s[i1]);
    const roof: Row[] = [];
    const mid = frameAt(w, (w.al.s[i0] + w.al.s[i1]) / 2);
    const p = parts.at(mid.x, mid.z);
    for (const s of ss) {
      const fr = frameAt(w, s);
      const y = net.surfaceAt(w, fr.i, fr.f, 0);
      roof.push({
        x: fr.x,
        z: fr.z,
        y: y + w.tpl.clearance + 0.4,
        tx: fr.tx,
        tz: fr.tz,
        d: s,
        hw: 0,
      });
    }
    // the soffit is a steel girder ceiling (drive videos, Queens Blvd: transverse beams every GIRDER_EVERY m, dark
    // steel) with a lamp row along each side hung from the girders
    const span = edgeL + edgeR + 1.2;
    const midT = (edgeL - edgeR) / 2;
    for (
      let s = w.al.s[i0] + GIRDER_EVERY / 2;
      s < w.al.s[i1];
      s += GIRDER_EVERY
    ) {
      const fr = frameAt(w, s);
      const ceil = net.surfaceAt(w, fr.i, fr.f, 0) + w.tpl.clearance + 0.4;
      const girder = net.girderAt(w, fr.i);
      const [cx, cz] = lat(fr, midT);
      p.paint.box(
        cx,
        cz,
        fr.tx,
        fr.tz,
        0.12,
        span / 2,
        ceil - girder,
        ceil,
        GIRDER,
      );
      const n = Math.round((s - w.al.s[i0]) / GIRDER_EVERY);
      if (n % 3 === 0)
        for (const t of [edgeL - 1.1, -(edgeR - 1.1)]) {
          const [lx, lz] = lat(fr, t);
          p.light.lamp(lx, lz, ceil - girder);
        }
    }
    p.conc.strip(
      roof,
      [-edgeR - 0.6, 0, 0],
      [edgeL + 0.6, 0, 0],
      SOFFIT,
      false,
    );
    // the slab's top (the street level over the trench) and its long edges down to the roof
    // (under a street running over it lower than the slab's level - streets dropping across the bores - the slab top
    // and its edges come down to that street: never a slab face or top standing in its lanes)
    const under = (x: number, z: number, y: number) => {
      const h = field.streetBelow(x, z, w, y + SLAB_UNDER);
      const pl = field.plazaDrawn(x, z, PLAZA_UNDER);
      return Math.min(
        y,
        h === undefined ? y : h - SLAB_UNDER,
        pl === undefined ? y : pl - SLAB_UNDER_PLAZA,
      );
    };
    const top: [number, number, number][][] = [];
    const sideL: { x: number; z: number; bot: number; top: number }[] = [];
    const sideR: typeof sideL = [];
    const reachL = edgeL + SLAB_REACH;
    const reachR = edgeR + SLAB_REACH;
    const nCol = Math.max(2, Math.ceil((reachL + reachR) / 1.5));
    for (const s of ss) {
      const fr = frameAt(w, s);
      const k = Math.min(
        w.al.n - 1,
        Math.round(s / (w.al.length / (w.al.n - 1))),
      );
      const y = net.surfaceAt(w, fr.i, fr.f, 0);
      const bot = y + w.tpl.clearance + 0.3;
      // (the street surfaces on top are drawn over the slab: its top sits just under them)
      const row: [number, number, number][] = [];
      for (let c = 0; c <= nCol; c++) {
        const [x, z] = lat(fr, -reachR + ((reachL + reachR) * c) / nCol);
        row.push([x, Math.max(bot, under(x, z, w.slab[k] - SLAB_UNDER)), z]);
      }
      top.push(row);
      const [lx, lz] = lat(fr, reachL);
      const [rx, rz] = lat(fr, -reachR);
      sideL.push({ x: lx, z: lz, bot, top: row[nCol][1] });
      sideR.push({ x: rx, z: rz, bot, top: row[0][1] });
    }
    p.conc.grid(top, SLAB_TOP);
    p.conc.wall(sideL, CONC);
    p.conc.wall(sideR, CONC);
    // headwalls: from the roof up to the slab top, across the cut; a parapet on top only where no road runs over
    // the portal's end (a headwall never cuts into the street above)
    for (const i of [i0, i1]) {
      const fr = frameAt(w, w.al.s[i]);
      const y = net.surfaceAt(w, fr.i, fr.f, 0);
      const pts: { x: number; z: number; bot: number; top: number }[] = [];
      const para: typeof pts = [];
      for (let t = -edgeR - 0.6; t <= edgeL + 0.61; t += 1) {
        const [x, z] = lat(fr, t);
        pts.push({
          x,
          z,
          bot: y + w.tpl.clearance + 0.4 - net.girderAt(w, i),
          top: under(x, z, w.slab[i]),
        });
        const over = field.top(x, z);
        const open = !over || Math.abs(over.h - w.slab[i]) > 0.6;
        if (open)
          para.push({
            x,
            z,
            bot: w.slab[i] - 0.02,
            top: w.slab[i] + PARAPET_H,
          });
        else if (para.length > 1) {
          (w.tpl.deck === 'stone' ? p.stone : p.conc).wall(
            para,
            w.tpl.deck === 'stone' ? STONE : CONC,
          );
          para.length = 0;
        } else para.length = 0;
      }
      if (para.length > 1)
        (w.tpl.deck === 'stone' ? p.stone : p.conc).wall(
          para,
          w.tpl.deck === 'stone' ? STONE : CONC,
        );
      (w.tpl.deck === 'stone' ? p.stone : p.conc).wall(
        pts,
        w.tpl.deck === 'stone' ? STONE : CONC,
      );
      portalPlates(net, w, i, i0, i1, fr, y, midT, parts);
    }
  }
}

/**
 * What the plates on bore `w`'s headwall at sample i (i0 or i1 of its run) say, undefined where it has none (a one-way
 * bore's exit end, a headwall too low): the street the structure carries - the widest named one over the bore (Queens
 * Blvd, not a side street at a portal) - and the clearance under the girders (feet-inches).
 */
export function portalPlateText(
  net: Network,
  w: Way,
  i: number,
  i0: number,
  i1: number,
): { name?: string; clearance: string } | undefined {
  if (i !== i0 && (w.oneway || w.stage)) return undefined;
  const y = net.surfaceAt(w, i, 0, 0);
  const girder = net.girderAt(w, i);
  const bot = y + w.tpl.clearance + 0.4 - girder;
  if ((w.slab?.[i] ?? bot) - bot < 0.75) return undefined;
  let name: string | undefined;
  let best = 0;
  for (const c of net.crossings) {
    if (c.lower !== w || !c.upper.name) continue;
    if (c.sL < w.al.s[i0] - 10 || c.sL > w.al.s[i1] + 10) continue;
    const wide = c.upper.sec.footL + c.upper.sec.footR;
    if (wide > best) {
      best = wide;
      name = c.upper.name;
    }
  }
  return { name, clearance: feetInches(w.tpl.clearance - girder + 0.4) };
}

/**
 * The plates on a portal headwall, facing the drivers who enter the bore there (v1 `portals.ts` / bridge-mesh: drive
 * video, Queens Blvd 5:26-5:27): the green name plate of the street over the portal over the left lane, the white
 * clearance plate (to the girders) over the right one. A one-way bore has them at its entry end only.
 */
function portalPlates(
  net: Network,
  w: Way,
  i: number,
  i0: number,
  i1: number,
  fr: Frame,
  y: number,
  midT: number,
  parts: Parts,
): void {
  const entry = i === i0;
  const text = portalPlateText(net, w, i, i0, i1);
  if (!text) return;
  const { name, clearance } = text;
  const bot = y + w.tpl.clearance + 0.4 - net.girderAt(w, i);
  const head = (w.slab?.[i] ?? bot) - bot;
  // facing out of the bore, towards the drivers approaching this end
  const out = entry ? -1 : 1;
  const nx = fr.tx * out;
  const nz = fr.tz * out;
  const py = bot + Math.min(0.55, head / 2);
  // the drivers' left / right: lateral +t is left of the way's direction (entry); the exit end is seen the other way
  const side = (t: number) => {
    const [x, z] = lat(fr, midT + t * -out);
    return [x + nx * 0.09, z + nz * 0.09] as const;
  };
  const [cx, cz] = side(-1.7);
  parts.plates.add(
    clearancePlateTexture(clearance),
    cx,
    py,
    cz,
    nx,
    nz,
    0.96,
    0.6,
  );
  if (name) {
    const [ax, az] = side(1.9);
    parts.plates.add(namePlateTexture(name), ax, py, az, nx, nz, 2.2, 0.55);
  }
}

// --- barriers --------------------------------------------------------------------------------------------------------------

/** Where a deck's parapet stands on one side: the deck's samples, not where another road runs alongside at its level. */
export function parapetRuns(
  net: Network,
  field: NetField,
  w: Way,
  side: 0 | 1,
  i0: number,
  i1: number,
): [number, number][] {
  const sg = side === 0 ? 1 : -1;
  const foot = side === 0 ? w.sec.footL : w.sec.footR;
  const t = sg * (foot + 0.3);
  const L = w.al.length;
  const out: [number, number][] = [];
  let a = -1;
  for (let i = i0; i <= i1 + 1; i++) {
    let ok = i <= i1;
    if (ok) {
      const x = w.al.x[i] + w.al.tz[i] * worldT(w, i, 0, t);
      const z = w.al.z[i] - w.al.tx[i] * worldT(w, i, 0, t);
      const h = net.surfaceAt(w, i, 0, sg * foot);
      if (field.pavedByOther(x, z, h, w, 0.8, 3)) ok = false;
    }
    if (ok && a < 0) a = i;
    if (!ok && a >= 0) {
      const s0 = Math.max(w.cut0, w.al.s[a] - (a === i0 && a > 0 ? 1 : 0));
      const s1 = Math.min(
        L - w.cut1,
        w.al.s[i - 1] + (i - 1 === i1 && i1 < w.al.n - 1 ? 1 : 0),
      );
      if (s1 - s0 >= 2) out.push([s0, s1]);
      a = -1;
    }
  }
  return out;
}

/** Where a way's barrier stands on one side: [from, to] arc lengths (no deck, no wall, no road alongside, no junction). */
/**
 * A pier across the deck at `fr` (half length `hn`, soffit `top`) stands clear of every road beneath, along its whole
 * length: no pavement anywhere between the land and the soffit.
 */
export function pierClear(
  field: NetField,
  w: Way,
  fr: { x: number; z: number; tx: number; tz: number },
  hn: number,
  top: number,
): boolean {
  for (const v of [-hn, -hn / 2, 0, hn / 2, hn]) {
    const x = fr.x + fr.tz * v;
    const z = fr.z - fr.tx * v;
    const g = field.ground(x, z);
    if (field.pavedByOther(x, z, (g + top) / 2, w, 1.5, (top - g) / 2 + 1.2))
      return false;
  }
  return true;
}

export function barrierRuns(
  net: Network,
  field: NetField,
  w: Way,
  side: 0 | 1,
  atCutWall = false,
): [number, number][] {
  const kind = atCutWall ? w.tpl.cutBarrier : w.sec.barrier[side];
  if (!kind || w.internal) return [];
  const sg = side === 0 ? 1 : -1;
  const t = sg * ((side === 0 ? w.sec.paveL : w.sec.paveR) + BARRIER_OFF);
  const L = w.al.length;
  const ok: boolean[] = [];
  const foot = side === 0 ? w.sec.footL : w.sec.footR;
  for (let i = 0; i < w.al.n; i++) {
    const s = w.al.s[i];
    // on a deck the parapet is the barrier - except where another road runs alongside (the parapet opens there: two
    // carriageway decks side by side keep their median barrier)
    let deckOk =
      w.st[i] !== ST_DECK ||
      (side === 1 && !atCutWall && net.outerBarrier(w, i) === 'jersey');
    if (!deckOk) {
      const tp = sg * (foot + 0.3);
      const px = w.al.x[i] + w.al.tz[i] * worldT(w, i, 0, tp);
      const pz = w.al.z[i] - w.al.tx[i] * worldT(w, i, 0, tp);
      deckOk = !!field.pavedByOther(
        px,
        pz,
        net.surfaceAt(w, i, 0, sg * foot),
        w,
        0.8,
        3,
      );
    }
    let good =
      deckOk &&
      (atCutWall ? w.wall[side][i] === WALL_CUT : w.wall[side][i] === 0) &&
      s > w.cut0 + 1 &&
      s < L - w.cut1 - 1 &&
      !(w.merge0 && s < 80) &&
      !(w.merge1 && L - s < 80);
    if (good) {
      const x = w.al.x[i] + w.al.tz[i] * worldT(w, i, 0, t);
      const z = w.al.z[i] - w.al.tx[i] * worldT(w, i, 0, t);
      const h = net.surfaceAt(w, i, 0, t);
      // open where a ramp merges in / out, or where the roadway alongside outranks this one (its barrier stands in
      // the gap), or where that roadway's lane wall does; a painted gore alongside keeps the barrier up to its nose
      const o = field.pavedByOther(x, z, h, w, 1.2, 3, false);
      // never across another road's pavement (a street crossing it at grade, a ramp's end under it): it would block
      // the lanes
      if (field.pavedByOther(x, z, h, w, 0, 3, false)) good = false;
      else if (o) {
        const merging = o.into.includes(w) || w.into.includes(o);
        const outranked = o.tpl.rank > w.tpl.rank;
        const laneWall =
          w.st[i] === ST_TUNNEL &&
          (o.wallLane[0].includes(1) || o.wallLane[1].includes(1));
        if (merging || outranked || laneWall) good = false;
      }
    }
    ok.push(good);
  }
  const out: [number, number][] = [];
  let a = -1;
  for (let i = 0; i <= ok.length; i++) {
    if (i < ok.length && ok[i]) {
      if (a < 0) a = i;
    } else if (a >= 0) {
      const s0 = w.al.s[a];
      const s1 = w.al.s[i - 1];
      if (s1 - s0 >= 6) out.push([s0, s1]);
      a = -1;
    }
  }
  return out;
}

/**
 * The barrier runs of a way's side and their kind: the section's barrier where no wall stands, and the template's
 * `cutBarrier` along its cut walls (the drive videos: a concrete barrier at the foot of the parkway's stone walls).
 */
export function barrierPlan(
  net: Network,
  field: NetField,
  w: Way,
  side: 0 | 1,
): { kind: string; runs: [number, number][] }[] {
  const out: { kind: string; runs: [number, number][] }[] = [];
  const kind = w.sec.barrier[side];
  if (kind) {
    // the outer side: the map's barrier for that stretch (`wallStyles` barrier), split where it changes
    const byKind = new Map<string, [number, number][]>();
    const add = (k: string, a: number, b: number) => {
      if (b - a < 2) return;
      if (!byKind.has(k)) byKind.set(k, []);
      byKind.get(k)!.push([a, b]);
    };
    for (const [s0, s1] of barrierRuns(net, field, w, side)) {
      const kindAt = (s: number) =>
        (side === 1 ? net.outerBarrier(w, sampleAt(w.al, s)) : undefined) ??
        kind;
      let a = s0;
      let k = kindAt(s0);
      for (const s of rowsBetween(w, s0, s1)) {
        const kk = kindAt(s);
        if (kk === k) continue;
        add(k, a, s);
        a = s;
        k = kk;
      }
      add(k, a, s1);
    }
    for (const [k, runs] of byKind)
      if (k !== 'none') out.push({ kind: k, runs });
  }
  if (w.tpl.cutBarrier)
    out.push({
      kind: w.tpl.cutBarrier,
      runs: barrierRuns(net, field, w, side, true),
    });
  return out;
}

function barriers(net: Network, field: NetField, w: Way, parts: Parts): void {
  for (const side of [0, 1] as const) {
    const sg = side === 0 ? 1 : -1;
    const t = sg * ((side === 0 ? w.sec.paveL : w.sec.paveR) + BARRIER_OFF);
    for (const { kind, runs } of barrierPlan(net, field, w, side))
      for (const [s0, s1] of runs) {
        const rows: Row[] = [];
        for (const s of rowsBetween(w, s0, s1)) {
          const fr = frameAt(w, s);
          rows.push(
            rowOf(fr, net.surfaceAt(w, fr.i, fr.f, t), sideShift(fr, side)),
          );
        }
        if (rows.length < 2) continue;
        const p = parts.at(rows[0].x, rows[0].z);
        if (kind === 'jersey') {
          // one strip per precast section: a dark joint between them, each a little lighter / darker (weathering)
          const row = (d: number) => {
            const fr = frameAt(w, d);
            return rowOf(
              fr,
              net.surfaceAt(w, fr.i, fr.f, t),
              sideShift(fr, side),
            );
          };
          let j = 0;
          for (
            let a = Math.ceil(s0 / JERSEY_SEG) * JERSEY_SEG - JERSEY_SEG;
            a < s1;
            a += JERSEY_SEG
          ) {
            const lo = Math.max(s0, a);
            const hi = Math.min(s1, a + JERSEY_SEG - JERSEY_GAP);
            if (hi - lo < 0.3) continue;
            const seg: Row[] = [row(lo)];
            while (j < rows.length && rows[j].d <= lo + 0.3) j++;
            for (let k = j; k < rows.length && rows[k].d < hi - 0.3; k++)
              seg.push(rows[k]);
            seg.push(row(hi));
            // a free run end (not where the run carries on into the next way piece) turns down into the ground over
            // JERSEY_END m: the sloped end of a precast run (drive videos 5:45-5:49 at the ramp merges)
            for (const r of seg) {
              const fromA = s0 > w.cut0 + 1 ? r.d - s0 : Infinity;
              const toB = s1 < w.al.length - w.cut1 - 1 ? s1 - r.d : Infinity;
              const k = Math.min(fromA, toB) / JERSEY_END;
              if (k < 1) r.y -= JERSEY_H * (1 - Math.max(0, k)) * 1.05;
            }
            const n = Math.round(a / JERSEY_SEG);
            for (let k = 0; k + 1 < JERSEY.length; k++) {
              const [pa, ya] = JERSEY[k];
              const [pb, yb] = JERSEY[k + 1];
              p.jersey.strip(
                seg,
                [t + pa, ya, 0],
                [t + pb, yb, 0],
                jerseyColor(w, side, n, Math.min(ya, yb)),
              );
            }
          }
        } else {
          // the galvanised W-beam on posts every 2 m of the hand-placed rails (barrier-mesh.ts `RAIL`, its grime map:
          // u = along / 8, v = height), the ribs facing the road
          const beamT = t - sg * 0.12;
          for (let k = 0; k + 1 < RAIL.length; k++) {
            const v0 = p.rail.pos.length / 3;
            const [oa, ya] = RAIL[k];
            const [ob, yb] = RAIL[k + 1];
            p.rail.strip(
              rows,
              [beamT + sg * oa, ya, 0],
              [beamT + sg * ob, yb, 0],
              RAIL_STEEL,
            );
            for (let v = v0, j = 0; v < p.rail.pos.length / 3; v++, j++) {
              p.rail.uv[v * 2] = rows[j >> 1].d / 8;
              p.rail.uv[v * 2 + 1] = j & 1 ? yb : ya;
            }
          }
          const postT = beamT + sg * 0.14;
          for (const r of rows)
            if (Math.round(r.d) % 2 === 0) {
              const x = r.x + r.tz * postT;
              const z = r.z - r.tx * postT;
              p.rail.box(
                x,
                z,
                r.tx,
                r.tz,
                0.045,
                0.04,
                r.y - 0.2,
                r.y + 0.78,
                RAIL_POST,
              );
            }
        }
      }
  }
}
