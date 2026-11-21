import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  LOD,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  type Material,
} from 'three';
import { Noise2D } from '../../../shared/noise';
import {
  cardColor,
  cellRect,
  plantSheet,
  type PlantSheet,
} from '../engine/grass';
import { addWorldUniforms } from '../engine/world-shading';
import { mapSeason } from '../maps/shared/climate';
import type { ReedBedDef } from '../maps/shared/types';
import type { Season } from '../season';
import { newPathQuery } from './real-data';
import { newRoadQuery } from './road';
import type { World } from './world';

/**
 * Reed beds of the field ditches (`terrain.ditches.reedBed`): a dense stand of reed cards (the season's reed sheet)
 * rooted in the ditch's bed and slopes, its top `height` m above the bank line, plus a wall of cards along each side for
 * the silhouette. Stems only, no solid fill: the gaps between them stay open and dark, as in the real bed. The scattered
 * reed cards (`ditchTop` rules) grow among them. Merged per 128 m cell, drawn only near the camera (it fades out by
 * WALL_NEAR, as the scattered cards end). Built once per world.
 */
/** Wall cells (m) and where the wall has faded out (m from the camera; the ditch cards' `DITCH_CARDS`). */
const WALL_CELL = 128;
const WALL_NEAR = 100;
const WALL_FADE = 80;
/** Along-ditch step (m): one reed cell of the wall per step (the sheet's cells are 1.2 m wide). */
const STEP = 1.2;
/** The stand reaches this share of the ditch's half top width (the reeds fill it to just inside the lips). */
const SPAN = 0.9;
/** The wall of cards stands this far outside the stand, and its plumes this far above its top (m). */
const WALL_OUT = 0.22;
const WALL_RISE = 0.6;
/** Card wall layers: inset (m) from the outer one (two rows of stems close the silhouette). */
const WALL_LAYERS = [0, 0.45];
/** Height of a reed cell of the sheet (m): the wall shows its top part at true size. */
const CELL_H = 2.4;
/** Stand card rows across the bed (share of its half width). */
const TOP_ACROSS = [-0.8, -0.48, -0.16, 0.16, 0.48, 0.8];
/**
 * Height bands (m) added to a card's top: each row of the stand has its own long runs of tall plumes and low stems
 * along the ditch (`BAND_LONG` m), broken by clumps (`BAND_CLUMP` m), as the real bed grows in strips.
 */
const BAND_LOW = -1.35;
const BAND_HIGH = 0.45;
const BAND_LONG = 11;
const BAND_CLUMP = 3.5;
/** Open gaps (bank and water show): patches about `GAP_SIZE` m along the ditch, most of them across the whole bed. */
const GAP_SIZE = 7;
const GAP_SHARE = 0.16;
/** Keep this far from a road / track crossing the ditch (m, beyond its half width). */
const CROSSING = 2;
/** The stage road's bridges: the bed grows right up to the deck, this far past the road's edge (its kerb, m). */
const DECK_EDGE = 0.4;

interface Look {
  /** Card sheet. */
  sheet: PlantSheet;
  /** Height and cover multipliers on the def's. */
  height: number;
  cover: number;
}

/**
 * Per season: summer a green bed with brown plumes; autumn (November) olive below, the tops straw and beige; spring
 * last year's straw stand, cut lower and broken up, the new shoots still under it.
 */
const LOOKS: Record<Season, Look> = {
  summer: {
    sheet: 'reeds',
    height: 1,
    cover: 1,
  },
  autumn: {
    sheet: 'reeds-autumn',
    height: 1,
    cover: 1,
  },
  spring: {
    sheet: 'reeds-winter',
    height: 0.75,
    cover: 0.8,
  },
};

const wallMats = new Map<Season, MeshStandardMaterial>();

/** The wall of reed cards: the season's reed sheet, alpha tested, lit like the ground (as the scattered cards). */
function wallMaterial(season: Season): MeshStandardMaterial {
  let m = wallMats.get(season);
  if (m) return m;
  const sheet = LOOKS[season].sheet;
  m = new MeshStandardMaterial({
    vertexColors: true,
    map: plantSheet(sheet),
    color: new Color(...cardColor(sheet)),
    alphaTest: 0.5,
    side: DoubleSide,
    roughness: 1,
  });
  m.defines = { RALLY_GROUND: 1, RALLY_FOLIAGE: 0.25 };
  m.onBeforeCompile = (shader) => {
    addWorldUniforms(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRbW;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n\tvRbW = ( modelMatrix * vec4( position, 1.0 ) ).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRbW;')
      .replace(
        'void main() {',
        /* glsl */ `void main() {
	// Dithered out between WALL_FADE and WALL_NEAR m (before any texture read: the far wall costs no fill).
	float rbFar = smoothstep( ${WALL_FADE.toFixed(1)}, ${WALL_NEAR.toFixed(1)}, distance( vRbW.xz, cameraPosition.xz ) );
	if ( rbFar > 0.0 && fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) ) < rbFar ) discard;`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        '#include <normal_fragment_begin>\n\tnormal = normalize( vNormal );',
      )
      .replace(
        '#include <lights_fragment_end>',
        '#include <lights_fragment_end>\n\treflectedLight.directSpecular = vec3( 0.0 );\n\treflectedLight.indirectSpecular = vec3( 0.0 );',
      );
  };
  m.customProgramCacheKey = () => 'reed-bed-wall';
  m.name = `reed_bed_wall_${season}`;
  wallMats.set(season, m);
  return m;
}

/**
 * Height share of row `k` of a run of `n`: the bed slopes down to the ground over its last few metres, except at an
 * end cut off by the stage road's deck (`cutStart` / `cutEnd`: it stands full height against the bridge).
 */
function taper(k: number, n: number, cutStart = false, cutEnd = false): number {
  const e = Math.min(cutStart ? 3 : k, cutEnd ? 3 : n - 1 - k);
  return e >= 3 ? 1 : [0.15, 0.45, 0.75][e];
}

interface Acc {
  pos: number[];
  nor: number[];
  col: number[];
  uv: number[];
  idx: number[];
}
const acc = (): Acc => ({ pos: [], nor: [], col: [], uv: [], idx: [] });

function toMesh(a: Acc, mat: Material, shadow: boolean): Mesh {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(a.pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(a.nor), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(a.col), 3));
  if (a.uv.length)
    g.setAttribute('uv', new BufferAttribute(new Float32Array(a.uv), 2));
  g.setIndex(a.idx);
  g.computeBoundingSphere();
  const m = new Mesh(g, mat);
  m.castShadow = shadow;
  m.receiveShadow = true;
  m.matrixAutoUpdate = false;
  return m;
}

/** Stage road points every ~15 m in 100 m cells (the bed is drawn only within `reach` of the road). */
function roadCells(world: World): Map<string, number[]> {
  const cells = new Map<string, number[]>();
  const road = world.road;
  for (let a = 0; a <= road.length; a += 15) {
    const p = road.at(a);
    const key = `${Math.floor(p.x / 100)},${Math.floor(p.z / 100)}`;
    let list = cells.get(key);
    if (!list) cells.set(key, (list = []));
    list.push(p.x, p.z);
  }
  return cells;
}

/**
 * Whether (x, z) is within `reach` of the stage road. A 100 m cell wholly inside (or outside) reach of its nearest
 * road point is decided once (`memo`); only cells on the edge test their points.
 */
function nearRoad(
  cells: Map<string, number[]>,
  memo: Map<string, number>,
  x: number,
  z: number,
  reach: number,
): boolean {
  const cx = Math.floor(x / 100);
  const cz = Math.floor(z / 100);
  const key = `${cx},${cz}`;
  let near = memo.get(key);
  if (near === undefined) {
    // From the cell's centre: within reach - 71 m (half its diagonal) = all near, beyond reach + 71 = none.
    const d = closestRoad(
      cells,
      (cx + 0.5) * 100,
      (cz + 0.5) * 100,
      reach + 71,
    );
    near = d < reach - 71 ? 1 : d > reach + 71 ? 0 : 2;
    memo.set(key, near);
  }
  return near === 2 ? closestRoad(cells, x, z, reach) < reach : near === 1;
}

/** Distance to the nearest road sample within `within` m of (x, z) (Infinity: none). */
function closestRoad(
  cells: Map<string, number[]>,
  x: number,
  z: number,
  within: number,
): number {
  const r = Math.ceil(within / 100);
  const cx = Math.floor(x / 100);
  const cz = Math.floor(z / 100);
  let best = within * within;
  let found = false;
  for (let i = -r; i <= r; i++)
    for (let j = -r; j <= r; j++) {
      const list = cells.get(`${cx + i},${cz + j}`);
      if (!list) continue;
      for (let k = 0; k < list.length; k += 2) {
        const dx = list[k] - x;
        const dz = list[k + 1] - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < best) {
          best = d2;
          found = true;
        }
      }
    }
  return found ? Math.sqrt(best) : Infinity;
}

export function* reedBedMeshJob(
  world: World,
): Generator<void, Group | undefined> {
  const gen = world.gen;
  const net = gen.channels;
  const ditches = world.map.terrain.ditches;
  const def: ReedBedDef | undefined = ditches?.reedBed;
  if (!net || !ditches || !def) return undefined;
  const season = mapSeason(world.map.environment);
  const look = LOOKS[season];
  const noise = new Noise2D(world.map.seed + 811);
  const cells = roadCells(world);
  /** Band height (m) at (x, z) for stand row `row` (rows differ: strips of tall and low reeds side by side). */
  const band = (x: number, z: number, row: number): number => {
    const n =
      0.75 *
        noise.noise2(x / BAND_LONG + row * 3.1, z / BAND_LONG - row * 1.7) +
      0.25 *
        noise.noise2(x / BAND_CLUMP - row * 2.3, z / BAND_CLUMP + row * 4.1);
    const t = Math.min(1, Math.max(0, (n + 0.3) / 0.6));
    return BAND_LOW + (BAND_HIGH - BAND_LOW) * t * t * (3 - 2 * t);
  };
  /** Whether stand row `row` has a gap at (x, z) (rows share most of a gap: it opens across the bed). */
  const gap = (x: number, z: number, row: number): boolean =>
    0.8 * noise.noise2(x / GAP_SIZE + 57, z / GAP_SIZE - 23) +
      0.2 * noise.noise2(x / 2.5 + row * 5.3, z / 2.5 - row * 3.9) <
    -1 + 2 * GAP_SHARE * 0.9;
  const nearMemo = new Map<string, number>();
  const rq = newRoadQuery();
  const pq = newPathQuery();
  const ground = world.heightfield;
  const reedCells = [0, 1, 2, 3, 4, 5];
  const walls = new Map<string, Acc>();
  const wallAt = (x: number, z: number) => {
    const key = `${Math.floor(x / WALL_CELL)},${Math.floor(z / WALL_CELL)}`;
    let t = walls.get(key);
    if (!t) walls.set(key, (t = acc()));
    return t;
  };
  const pt = { x: 0, z: 0 };
  const pA = { x: 0, z: 0 };
  const pB = { x: 0, z: 0 };

  for (let ci = 0; ci < net.paths.length; ci++) {
    const dd = gen.ditchOf(ci);
    if (!dd) continue;
    const L = net.lengths[ci];
    const n = Math.floor(L / STEP);
    const outer = dd.topWidth / 2;
    const half = outer * SPAN;
    const wallHalf = Math.min(outer, half + WALL_OUT);
    // Rows: each sample's centre / frame, its top height, whether the bed grows there.
    const rows: {
      x: number;
      z: number;
      rx: number;
      rz: number;
      bank: number;
      top: number;
      on: boolean;
      /** Off where the stage road crosses (the run beside it ends against the deck). */
      deck?: boolean;
    }[] = [];
    const OFF = { x: 0, z: 0, rx: 0, rz: 0, bank: 0, top: 0, on: false };
    const DECK = { ...OFF, deck: true };
    for (let i = 0; i <= n; i++) {
      const a = i * STEP;
      net.pointAt(ci, a, pt);
      // Grown over where the long noise is above the cover threshold, near the stage road, off every crossing.
      const grow =
        0.5 + 0.5 * noise.fbm(pt.x / 40 + 31, pt.z / 40 - 17, 2) <
        def.cover * look.cover;
      let on = grow && nearRoad(cells, nearMemo, pt.x, pt.z, def.reach);
      if (!on) {
        rows.push(OFF);
        continue;
      }
      net.pointAt(ci, a - 1, pA);
      net.pointAt(ci, a + 1, pB);
      const tl = Math.hypot(pB.x - pA.x, pB.z - pA.z) || 1;
      const tx = (pB.x - pA.x) / tl;
      const tz = (pB.z - pA.z) / tl;
      // The stage road: up to its deck, across the whole bed (both sides too: the road may cross at a slant).
      let deck = false;
      for (const side of [-1, 0, 1]) {
        const q = world.road.query(
          pt.x - tz * half * side,
          pt.z + tx * half * side,
          rq,
        );
        if (q.found && q.distance < q.halfWidth + DECK_EDGE) deck = true;
      }
      if (deck) {
        rows.push(DECK);
        continue;
      }
      if (gen.paths) {
        const p = gen.paths.query(pt.x, pt.z, pq);
        if (p.found && p.distance < p.halfWidth + outer + CROSSING) on = false;
      }
      if (on && gen.nearCulvert(pt.x, pt.z, outer + CROSSING)) on = false;
      if (!on) {
        rows.push(OFF);
        continue;
      }
      const bank = gen.channelBankHeight(ci, a);
      const h =
        def.height[0] +
        (def.height[1] - def.height[0]) *
          (0.5 + 0.5 * noise.fbm(pt.x / 9, pt.z / 9, 2));
      // Never above the ground at its lips: by a road the bank line is smoothed over the embankment's rise, and the
      // bed would stand on the ditch like a plinth.
      const lip = Math.min(
        ground.height(pt.x - tz * outer, pt.z + tx * outer),
        ground.height(pt.x + tz * outer, pt.z - tx * outer),
      );
      rows.push({
        x: pt.x,
        z: pt.z,
        rx: -tz,
        rz: tx,
        bank,
        top: Math.min(bank, lip) + h * look.height,
        on,
      });
    }
    // Runs of grown rows (at least 3 steps), each a closed volume.
    let i = 0;
    while (i < rows.length) {
      if (!rows[i].on) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < rows.length && rows[j + 1].on) j++;
      if (j - i >= 2)
        addRun(rows.slice(i, j + 1), !!rows[i - 1]?.deck, !!rows[j + 1]?.deck);
      i = j + 1;
    }
    yield;

    function addRun(
      run: typeof rows,
      cutStart: boolean,
      cutEnd: boolean,
    ): void {
      // The wall of reed cards: one cell per step along both sides (the stand thins out into the open ends).
      const quad = (
        x0: number,
        z0: number,
        x1: number,
        z1: number,
        bottom0: number,
        bottom1: number,
        top0: number,
        top1: number,
        seed: number,
      ) => {
        const cell = reedCells[Math.abs(seed) % reedCells.length];
        const [u0, v0, u1, v1] = cellRect(look.sheet, cell);
        const flip = (seed >> 3) & 1;
        const wall = wallAt(x0, z0);
        const w0 = wall.pos.length / 3;
        const h0 = top0 - bottom0;
        const h1 = top1 - bottom1;
        // (u across the cell, mirrored on half the cells; v: the top of the cell at the top, true size down)
        const ua = flip ? u1 : u0;
        const ub = flip ? u0 : u1;
        const vTop = v1;
        const vb0 = v1 - ((v1 - v0) * Math.min(CELL_H, h0)) / CELL_H;
        const vb1 = v1 - ((v1 - v0) * Math.min(CELL_H, h1)) / CELL_H;
        wall.pos.push(
          x0,
          bottom0,
          z0,
          x1,
          bottom1,
          z1,
          x1,
          top1,
          z1,
          x0,
          top0,
          z0,
        );
        wall.uv.push(ua, vb0, ub, vb1, ub, vTop, ua, vTop);
        for (let k = 0; k < 4; k++) wall.nor.push(0, 1, 0);
        // Dark at the foot (inside the bed), lit at the plumes.
        wall.col.push(0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 1, 1, 1, 1, 1, 1);
        wall.idx.push(w0, w0 + 1, w0 + 2, w0, w0 + 2, w0 + 3);
      };
      for (const sgn of [-1, 1])
        for (const [layer, inset] of WALL_LAYERS.entries())
          for (let k = 0; k < run.length - 1; k++) {
            const r0 = run[k];
            const r1 = run[k + 1];
            const wh = wallHalf - inset;
            const x0 = r0.x + r0.rx * wh * sgn;
            const z0 = r0.z + r0.rz * wh * sgn;
            const x1 = r1.x + r1.rx * wh * sgn;
            const z1 = r1.z + r1.rz * wh * sgn;
            const e0 = taper(k, run.length, cutStart, cutEnd);
            const e1 = taper(k + 1, run.length, cutStart, cutEnd);
            if (gap(x0, z0, 7 + sgn + layer * 2)) continue;
            const g0 = ground.height(x0, z0);
            const g1 = ground.height(x1, z1);
            const b0 = g0 - 0.05;
            const b1 = g1 - 0.05;
            quad(
              x0,
              z0,
              x1,
              z1,
              b0,
              b1,
              Math.max(
                g0 + 0.3,
                g0 +
                  (r0.top -
                    g0 +
                    WALL_RISE * (1 + layer * 0.3) +
                    band(x0, z0, 7 + sgn + layer * 2)) *
                    e0,
              ),
              Math.max(
                g1 + 0.3,
                g1 +
                  (r1.top -
                    g1 +
                    WALL_RISE * (1 + layer * 0.3) +
                    band(x1, z1, 7 + sgn + layer * 2)) *
                    e1,
              ),
              Math.floor(r0.x * 7 + r0.z * 13) + (sgn > 0 ? 5 : 0) + layer * 3,
            );
          }
      // The stand: crossed reed cards rooted in the ditch's bed and slopes (no solid fill: the gaps between the stems
      // stay open and dark), two staggered rows per step across the bed, their plumes above the bank line.
      for (let k = 0; k < run.length; k++) {
        const r = run[k];
        const e = taper(k, run.length, cutStart, cutEnd);
        for (const along of [0, 0.5])
          for (const [t, sx] of TOP_ACROSS.entries()) {
            const seed =
              Math.floor(r.x * 13 + r.z * 7) + t * 11 + (along ? 29 : 0);
            const j = noise.noise2(r.x * 1.7 + t + along, r.z * 1.7 - t);
            const ang = (seed % 628) / 100;
            const off = (sx + (along ? 0.08 : 0)) * half;
            const shift = (along - 0.25) * STEP + j * 0.35;
            const cx = r.x + r.rx * off + r.rz * shift;
            const cz = r.z + r.rz * off - r.rx * shift;
            const g = ground.height(cx, cz);
            const top = g + (r.top - g) * e;
            const rise = (0.35 + 0.45 * (0.5 + 0.5 * j)) * e;
            if (gap(cx, cz, t)) continue;
            const tall = Math.max(g + 0.3, top + rise + band(cx, cz, t) * e);
            for (const turn of [0, Math.PI / 2]) {
              const dx = Math.cos(ang + turn) * 0.6;
              const dz = Math.sin(ang + turn) * 0.6;
              quad(
                cx - dx,
                cz - dz,
                cx + dx,
                cz + dz,
                g - 0.05,
                g - 0.05,
                tall,
                tall,
                seed + (turn ? 3 : 0),
              );
            }
          }
      }
      // An end against a bridge: a wall of cards across the bed as well (the face seen from the deck), its stems
      // reaching down into the water under the bridge.
      for (const [cut, k, dir] of [
        [cutStart, 0, 1],
        [cutEnd, run.length - 1, -1],
      ] as const) {
        if (!cut) continue;
        const r = run[k];
        const n = run[k + dir];
        const lx = n.x - r.x;
        const lz = n.z - r.z;
        const ll = Math.hypot(lx, lz) || 1;
        const cells = Math.max(2, Math.round((2 * wallHalf) / (STEP * 0.6)));
        for (const [layer, inset] of [...WALL_LAYERS, 0.9].entries()) {
          const ox = r.x + (lx / ll) * inset;
          const oz = r.z + (lz / ll) * inset;
          const top = r.top + WALL_RISE * (1 + layer * 0.3);
          for (let c = 0; c < cells; c++) {
            const s0 = -wallHalf + (2 * wallHalf * c) / cells;
            const s1 = -wallHalf + (2 * wallHalf * (c + 1)) / cells;
            quad(
              ox + r.rx * s0,
              oz + r.rz * s0,
              ox + r.rx * s1,
              oz + r.rz * s1,
              top - CELL_H,
              top - CELL_H,
              top,
              top,
              Math.floor(ox * 11 + oz * 5) + c * 7 + layer * 3,
            );
          }
        }
      }
    }
  }
  const group = new Group();
  group.name = 'reed-beds';
  const wallMat = wallMaterial(season);
  // Each wall cell is a LOD about its centre: drawn while the camera is within WALL_NEAR of some part of it.
  const reach = WALL_NEAR + (WALL_CELL * Math.SQRT2) / 2 + 10;
  for (const [key, w] of walls) {
    if (!w.idx.length) continue;
    const [i, j] = key.split(',').map(Number);
    const cx = (i + 0.5) * WALL_CELL;
    const cz = (j + 0.5) * WALL_CELL;
    let cy = 0;
    for (let k = 1; k < w.pos.length; k += 3) cy += w.pos[k];
    cy /= w.pos.length / 3;
    for (let k = 0; k < w.pos.length; k += 3) {
      w.pos[k] -= cx;
      w.pos[k + 1] -= cy;
      w.pos[k + 2] -= cz;
    }
    const lod = new LOD();
    lod.position.set(cx, cy, cz);
    lod.addLevel(toMesh(w, wallMat, false), 0);
    lod.addLevel(new Object3D(), reach);
    lod.updateMatrix();
    group.add(lod);
    yield;
  }
  return group;
}
