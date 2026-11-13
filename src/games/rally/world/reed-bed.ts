import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  Vector3,
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
 * Reed beds of the field ditches (`terrain.ditches.reedBed`) drawn as one volume: a dark core from bank to bank along
 * the ditch, its top `height` m above the bank line, and a wall of reed cards (the season's reed sheet) round its sides
 * for the silhouette. Seen from a bridge it closes up like the real bed (crossed cards alone never did: from above
 * their thin stems vanish and the water and ground show through); the scattered reed cards (`ditchTop` rules) stand on
 * it for the plumes. Merged per 256 m tile, built once per world.
 */
const TILE = 256;
/** Along-ditch step (m): one reed cell of the wall per step (the sheet's cells are 1.2 m wide). */
const STEP = 1.2;
/** The core reaches this share of the ditch's half top width (the reeds fill it to just inside the lips). */
const SPAN = 0.9;
/** The wall of cards stands this far outside the core, and its plumes this far above the core's top (m). */
const WALL_OUT = 0.22;
const WALL_RISE = 0.6;
/** Card wall layers: inset (m) from the outer one (two rows of stems close the silhouette). */
const WALL_LAYERS = [0, 0.45];
/** Height of a reed cell of the sheet (m): the wall shows its top part at true size. */
const CELL_H = 2.4;
/** Points across the core's top (inner) besides its two shoulders. */
const TOP_ACROSS = [-0.62, -0.2, 0.2, 0.62];
/** Keep this far from a road / track crossing the ditch (m, beyond its half width). */
const CROSSING = 2;

interface Look {
  /** Wall sheet; the core's two colours (sRGB) mottled over its top, and its root (dark inside). */
  sheet: PlantSheet;
  top: [string, string];
  root: string;
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
    top: ['#33401c', '#45522a'],
    root: '#121609',
    height: 1,
    cover: 1,
  },
  autumn: {
    sheet: 'reeds-autumn',
    top: ['#3f4224', '#64593a'],
    root: '#15170d',
    height: 1,
    cover: 1,
  },
  spring: {
    sheet: 'reeds-winter',
    top: ['#57503c', '#46432f'],
    root: '#1a1810',
    height: 0.75,
    cover: 0.8,
  },
};

const coreMats = new Map<Season, MeshStandardMaterial>();
const wallMats = new Map<Season, MeshStandardMaterial>();

/**
 * The core: vertex colour = light (dark roots to a lit top), the hue mottled between the season's two top colours by
 * noise in world space, fine stem streaks on the sides and leaf mottle on the top. Lit like the ground (no specular).
 */
function coreMaterial(season: Season): MeshStandardMaterial {
  let m = coreMats.get(season);
  if (m) return m;
  const look = LOOKS[season];
  const a = new Color(look.top[0]);
  const b = new Color(look.top[1]);
  m = new MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  m.defines = { RALLY_GROUND: 1, RALLY_FOLIAGE: 0.15 };
  m.onBeforeCompile = (shader) => {
    addWorldUniforms(shader);
    shader.uniforms.uRbA = { value: a };
    shader.uniforms.uRbB = { value: b };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vRbW;\nvarying float vRbUp;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n\tvRbW = ( modelMatrix * vec4( position, 1.0 ) ).xyz;\n\tvRbUp = normal.y;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
uniform vec3 uRbA;
uniform vec3 uRbB;
varying vec3 vRbW;
varying float vRbUp;
float rbHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float rbNoise( vec2 p ) {
	vec2 i = floor( p );
	vec2 f = fract( p );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( rbHash( i ), rbHash( i + vec2( 1.0, 0.0 ) ), f.x ),
		mix( rbHash( i + vec2( 0.0, 1.0 ) ), rbHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
	{
		// Hue: patches of the two top colours (0.8 m), lighter up top. Detail: stems on the sides (thin vertical
		// streaks), leaves and plumes on the top (fine mottle), dark gaps between them.
		float up = clamp( vRbUp, 0.0, 1.0 );
		float hue = rbNoise( vRbW.xz * 1.3 ) * 0.7 + rbNoise( vRbW.xz * 4.1 ) * 0.3;
		vec3 tint = mix( uRbA, uRbB, smoothstep( 0.3, 0.75, hue ) * ( 0.4 + 0.6 * up ) );
		float stems = rbNoise( vec2( ( vRbW.x + vRbW.z ) * 22.0, vRbW.y * 2.2 ) );
		float leaves = rbNoise( vRbW.xz * 11.0 + vRbW.y * 3.0 ) * 0.6 + rbNoise( vRbW.xz * 29.0 ) * 0.4;
		float d = mix( stems, leaves, up );
		diffuseColor.rgb *= tint * ( 0.3 + 1.0 * smoothstep( 0.2, 0.9, d ) );
	}`,
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
  m.customProgramCacheKey = () => 'reed-bed-core';
  m.name = `reed_bed_core_${season}`;
  coreMats.set(season, m);
  return m;
}

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
    shader.fragmentShader = shader.fragmentShader
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

/** Height share of row `k` of a run of `n`: the bed slopes down to the ground over its last few metres. */
function taper(k: number, n: number): number {
  const e = Math.min(k, n - 1 - k);
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

function nearRoad(
  cells: Map<string, number[]>,
  x: number,
  z: number,
  reach: number,
): boolean {
  const r = Math.ceil(reach / 100);
  const cx = Math.floor(x / 100);
  const cz = Math.floor(z / 100);
  const r2 = reach * reach;
  for (let i = -r; i <= r; i++)
    for (let j = -r; j <= r; j++) {
      const list = cells.get(`${cx + i},${cz + j}`);
      if (!list) continue;
      for (let k = 0; k < list.length; k += 2) {
        const dx = list[k] - x;
        const dz = list[k + 1] - z;
        if (dx * dx + dz * dz < r2) return true;
      }
    }
  return false;
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
  const rq = newRoadQuery();
  const pq = newPathQuery();
  const ground = world.heightfield;
  const reedCells = [0, 1, 2, 3, 4, 5];
  const rootC = new Color(look.root);
  const tiles = new Map<string, { core: Acc; wall: Acc }>();
  const tileAt = (x: number, z: number) => {
    const key = `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
    let t = tiles.get(key);
    if (!t) tiles.set(key, (t = { core: acc(), wall: acc() }));
    return t;
  };
  const pt = { x: 0, z: 0 };
  const pA = { x: 0, z: 0 };
  const pB = { x: 0, z: 0 };
  const up = new Vector3();

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
    }[] = [];
    for (let i = 0; i <= n; i++) {
      const a = i * STEP;
      net.pointAt(ci, a, pt);
      net.pointAt(ci, a - 1, pA);
      net.pointAt(ci, a + 1, pB);
      const tl = Math.hypot(pB.x - pA.x, pB.z - pA.z) || 1;
      const tx = (pB.x - pA.x) / tl;
      const tz = (pB.z - pA.z) / tl;
      const bank = gen.channelBankHeight(ci, a);
      const h =
        def.height[0] +
        (def.height[1] - def.height[0]) *
          (0.5 + 0.5 * noise.fbm(pt.x / 9, pt.z / 9, 2));
      // Grown over where the long noise is above the cover threshold, near the stage road, off every crossing.
      const grow =
        0.5 + 0.5 * noise.fbm(pt.x / 40 + 31, pt.z / 40 - 17, 2) <
        def.cover * look.cover;
      let on = grow && nearRoad(cells, pt.x, pt.z, def.reach);
      if (on) {
        const q = world.road.query(pt.x, pt.z, rq);
        if (q.found && q.distance < q.halfWidth + outer + CROSSING) on = false;
      }
      if (on && gen.paths) {
        const p = gen.paths.query(pt.x, pt.z, pq);
        if (p.found && p.distance < p.halfWidth + outer + CROSSING) on = false;
      }
      if (on && gen.nearCulvert(pt.x, pt.z, outer + CROSSING)) on = false;
      rows.push({
        x: pt.x,
        z: pt.z,
        rx: -tz,
        rz: tx,
        bank,
        top: bank + h * look.height,
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
      if (j - i >= 2) addRun(rows.slice(i, j + 1));
      i = j + 1;
    }
    yield;

    function addRun(run: typeof rows): void {
      const mid = run[run.length >> 1];
      const t = tileAt(mid.x, mid.z);
      const core = t.core;
      const wall = t.wall;
      // Core cross-section: foot, shoulder, top points, shoulder, foot (left to right).
      const across: [number, number][] = [
        [-half, -1],
        [-half * 0.96, -0.5],
        ...TOP_ACROSS.map((s): [number, number] => [s * half, 0]),
        [half * 0.96, -0.5],
        [half, -1],
      ];
      const R = across.length;
      const c0 = core.pos.length / 3;
      run.forEach((r, k) => {
        for (const [off, kind] of across) {
          const x = r.x + r.rx * off;
          const z = r.z + r.rz * off;
          const g = ground.height(x, z);
          const endK = taper(k, run.length);
          const topY = g + Math.max(0.15, (r.top - g) * endK);
          const dome =
            kind === 0
              ? 0.06 * (1 - Math.abs(off / half)) +
                0.12 * noise.noise2(x * 0.9, z * 0.9)
              : 0;
          let y: number;
          let light: number;
          if (kind === -1) {
            y = g - 0.05;
            light = 0;
          } else if (kind === -0.5) {
            y = topY - 0.3;
            light = 0.75;
          } else {
            y = topY + dome;
            light = 1;
          }
          core.pos.push(x, y, z);
          const side = Math.sign(off) * (kind === 0 ? 0.15 : 0.55);
          up.set(r.rx * side, 1, r.rz * side).normalize();
          core.nor.push(up.x, up.y, up.z);
          const l = 0.35 + 0.65 * light;
          core.col.push(
            rootC.r + (l - rootC.r) * light,
            rootC.g + (l - rootC.g) * light,
            rootC.b + (l - rootC.b) * light,
          );
        }
      });
      for (let k = 0; k < run.length - 1; k++)
        for (let s = 0; s < R - 1; s++) {
          const a = c0 + k * R + s;
          core.idx.push(a, a + 1, a + R, a + 1, a + R + 1, a + R);
        }
      // End caps: a fan from the ditch's bed under the middle of the first / last cross-section (closes the V too).
      for (const [k, flip] of [
        [0, true],
        [run.length - 1, false],
      ] as const) {
        const r = run[k];
        const base = c0 + k * R;
        const centre = core.pos.length / 3;
        core.pos.push(r.x, r.bank - dd!.depth - 0.05, r.z);
        core.nor.push(0, 1, 0);
        core.col.push(rootC.r, rootC.g, rootC.b);
        for (let s = 0; s < R - 1; s++)
          if (flip) core.idx.push(centre, base + s + 1, base + s);
          else core.idx.push(centre, base + s, base + s + 1);
      }
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
            const e0 = taper(k, run.length);
            const e1 = taper(k + 1, run.length);
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
              g0 + (r0.top - g0 + WALL_RISE * (1 + layer * 0.3)) * e0,
              g1 + (r1.top - g1 + WALL_RISE * (1 + layer * 0.3)) * e1,
              Math.floor(r0.x * 7 + r0.z * 13) + (sgn > 0 ? 5 : 0) + layer * 3,
            );
          }
    }
  }
  const group = new Group();
  group.name = 'reed-beds';
  const coreMat = coreMaterial(season);
  const wallMat = wallMaterial(season);
  for (const t of tiles.values()) {
    if (t.core.idx.length) group.add(toMesh(t.core, coreMat, true));
    if (t.wall.idx.length) group.add(toMesh(t.wall, wallMat, false));
    yield;
  }
  return group;
}
