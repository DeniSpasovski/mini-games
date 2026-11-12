import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  type Material,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { Noise2D, smoothstep } from '../../../shared/noise';
import { imageTexture } from '../engine/image-texture';
import colorUrl from '../engine/props/cut-face.color.webp';
import normalUrl from '../engine/props/cut-face.normal.webp';
import { bridgeMaterials } from './bridge-mesh';
import { newRoadQuery } from './road';
import { getTerrainMaterial } from './terrain-material';
import { WALL_FACE, WALL_SKIN, WALL_THICK } from './terrain-gen';
import type { World } from './world';

/**
 * Rock faces of the stage road's natural cuts (RoadDef.rockCuts): wherever the terrain carve made a steep face beside the
 * road (terrain-gen `rockCutWeightAt`), a continuous ribbon of layered rock is laid on it, from the scree at its foot to
 * the land on top - one ribbon per run of face along the road, never a row of boxes. The ribbon follows the carved
 * ground (sampled across the face) a little proud of it, with ledges along the strata; its first and last rows tuck into
 * the ground. On a `walls` stretch the face is a low retaining wall instead: the same ribbon, flat, in dark coursed stone.
 * The terrain under it is the collider.
 */

/** Road samples (m). */
const STEP = 2;
/** Rows across the face. */
const ROWS = 7;
/** Lowest face that gets a ribbon (m). */
const MIN_FACE = 1.4;
/** Longest piece of one mesh (m of road): culled in pieces. */
const PIECE = 120;
/** How far the ribbon stands proud of the ground (m) and the depth of the strata ledges. */
const PROUD = 0.22;
const LEDGE = 0.28;
/** Texture tile (m): the baked scan is 1.83 m; shown at twice its size the layers are 5-20 cm thick like the Vodno shale. */
const TILE = 3.6;
/** Tones of the light baked stone (linear multipliers): silver-grey schist, yellow ochre and rust weathering (owner's photos). */
const SCHIST = [1.12, 1.0, 0.82];
const OCHRE = [1.4, 0.98, 0.48];
const RUST = [1.22, 0.8, 0.56];
/** Tone the face fades to where it sinks into the ground at a run's end: the terrain's cool grey rock / scree beside it. */
const GROUND_ROCK = [0.92, 0.97, 1.06];
/** Road samples over which a run's end sinks into the ground and takes the ground's tone. */
const END_TAPER = 5;
/** Length of a stretch of one tone along the road (m). */
const ZONE = 70;
/** A retaining wall (`walls`, its face `WALL_GAP` in front of the carve's foot): its stone's uv tile (m, the bridge
 * ashlar's), its tone (dark weathered limestone blocks, moss and lichen: the owner's photos) and the green of the moss. */
const WALL_TILE = 0.9;
const WALL_STONE = [0.25, 0.25, 0.25];
const WALL_MOSS = [0.22, 0.3, 0.15];
/** Splat of the ground right on top of the wall: grass with gravel [grass, dirt, rock, gravel]. */
const WALL_TOP_SPLAT = [0.55, 0.1, 0, 0.35];

type V3 = [number, number, number];
/** A ribbon of rows across a run (each row the same length) plus loose quads, as one geometry. */
class Strip {
  pos: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  private prev = -1;
  private width = 0;
  row(pts: V3[], cols: number[][], uvs: number[][], s: number): void {
    const b = this.pos.length / 3;
    pts.forEach((v, k) => {
      this.pos.push(...v);
      this.col.push(...cols[k]);
      this.uv.push(...uvs[k]);
    });
    if (this.prev >= 0 && this.width === pts.length) {
      const a = this.prev;
      for (let k = 0; k + 1 < pts.length; k++)
        if (s > 0)
          this.idx.push(a + k, b + k, a + k + 1, b + k, b + k + 1, a + k + 1);
        else
          this.idx.push(a + k, a + k + 1, b + k, b + k, a + k + 1, b + k + 1);
    }
    this.prev = b;
    this.width = pts.length;
  }
  /** Start a new ribbon: the next row is not joined to the last. */
  break(): void {
    this.prev = -1;
  }
  /** `base`: the height the stone courses count from (they run parallel to the road's grade). */
  quad(q: V3[], c: number[], base = 0): void {
    const b = this.pos.length / 3;
    for (const v of q) {
      this.pos.push(...v);
      this.col.push(...c);
      this.uv.push((v[0] + v[2]) / WALL_TILE, (v[1] - base) / WALL_TILE);
    }
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  /** As terrain: `col` holds the splat weights, every triangle faces up (the terrain material is single sided). */
  ground(): BufferGeometry {
    const P = this.pos;
    for (let t = 0; t < this.idx.length; t += 3) {
      const [a, b, c] = [this.idx[t], this.idx[t + 1], this.idx[t + 2]];
      const ux = P[b * 3] - P[a * 3];
      const uz = P[b * 3 + 2] - P[a * 3 + 2];
      const vx = P[c * 3] - P[a * 3];
      const vz = P[c * 3 + 2] - P[a * 3 + 2];
      // (normal y = u.z * v.x - u.x * v.z; a vertical end quad has none and keeps both windings)
      if (uz * vx - ux * vz < -1e-6) {
        this.idx[t + 1] = c;
        this.idx[t + 2] = b;
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(P, 3));
    geo.setAttribute(
      'splat',
      new BufferAttribute(
        Uint8Array.from(this.col, (v) => Math.round(v * 255)),
        4,
        true,
      ),
    );
    geo.setIndex(this.idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }
  geometry(): BufferGeometry {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    geo.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    geo.setIndex(this.idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }
}

let material: MeshStandardMaterial | undefined;
/** The rock face material: the scanned strata (engine/props/cut-face.*.webp, scripts/rocks/bake-cut-face.py), toned by vertex colour. */
export function rockCutMaterial(): MeshStandardMaterial {
  if (material) return material;
  const map = imageTexture(colorUrl, 512, 512, 'cut-face');
  const normalMap = imageTexture(
    normalUrl,
    512,
    512,
    'cut-face:normal',
    '#8080ff',
    false,
  );
  material = new MeshStandardMaterial({
    vertexColors: true,
    map,
    normalMap,
    roughness: 0.92,
  });
  return material;
}

/** One cross-section of a face: the road point it belongs to, the lateral span of the face and its side. */
interface Section {
  d: number;
  x: number;
  z: number;
  tx: number;
  tz: number;
  /** Lateral offsets of the foot and the top of the face (signed: + = left of travel). */
  lo: number;
  hi: number;
  /** A low retaining wall (RoadDef.rockCuts `walls`), not rock. */
  wall: boolean;
}

export function* rockCutMeshJob(
  world: World,
  /** The ground skin on top of a wall: the terrain's material (a plain one where there is no GPU texture, the tests). */
  groundMaterial: () => Material = getTerrainMaterial,
): Generator<void, Group | undefined> {
  const rc = world.map.road.rockCuts;
  if (!rc) return undefined;
  const road = world.road;
  const gen = world.gen;
  const rq = newRoadQuery();
  const noise = new Noise2D(world.map.seed + 811);
  const group = new Group();
  group.name = 'rock-cuts';

  // The face across the road at `d` on side `s` (+1 left, -1 right): foot and top offsets, or null when there is none.
  const section = (d: number, s: number): Section | null => {
    const p = road.at(d);
    const lat = (l: number) => [p.x + p.tz * l * s, p.z - p.tx * l * s];
    const foot = gen.rockCutFoot(p.halfWidth, d, s);
    // Is this stretch a rock cut at all (the carve's own weight, half-way up a typical face)?
    const [mx, mz] = lat(foot + 2);
    if (
      gen.rockCutWeightAt(mx, mz, gen.naturalHeight(mx, mz) - p.y, d, s) < 0.5
    )
      return null;
    const wall = !!gen.rockCutWall(d, s);
    // March up the face to where the carve meets the land again (the natural slope above is not cut).
    const h = (l: number) => {
      const [x, z] = lat(l);
      return gen.height(x, z);
    };
    const below = (l: number) => {
      const [x, z] = lat(l);
      return gen.naturalHeight(x, z) - gen.height(x, z);
    };
    // March up while the ground is steep (a face) and still cut below the land.
    let top = foot;
    for (
      let k = 0;
      k < 40 &&
      below(top) > 0.3 &&
      (top < foot + 1.5 || h(top + 0.5) - h(top) > 0.4);
      k++
    )
      top += 0.5;
    if (h(top) - h(foot) < MIN_FACE) return null;
    // The face must belong to this stretch of road (not to the other leg of a hairpin).
    const [tx, tz] = lat(top);
    road.query(tx, tz, rq);
    if (!rq.found || Math.abs(rq.along - d) > 12) return null;
    return {
      d,
      x: p.x,
      z: p.z,
      tx: p.tx,
      tz: p.tz,
      lo: (foot - 0.3) * s,
      hi: (top + (wall ? 0.15 : 0.4)) * s,
      wall,
    };
  };

  // `open`: the run goes on before its first / after its last section (a piece boundary: no taper there).
  const build = (run: Section[], s: number, open: [boolean, boolean]): void => {
    // Smooth the foot / top lines along the run (1-2-1): no saw-tooth from the 0.5 m march.
    for (let t = 0; t < 3; t++)
      for (const key of ['lo', 'hi'] as const) {
        const v = run.map((r) => r[key]);
        for (let i = 1; i + 1 < run.length; i++)
          run[i][key] = (v[i - 1] + 2 * v[i] + v[i + 1]) / 4;
      }
    const pos: number[] = [];
    const col: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const n = run.length;
    run.forEach((r, i) => {
      // Ends of a run taper into the ground, their tone easing to the ground's rock so the face has no hard edge there.
      const end = Math.min(
        open[0] ? 1 : smoothstep(0, END_TAPER, i),
        open[1] ? 1 : smoothstep(0, END_TAPER, n - 1 - i),
      );
      const ys: number[] = [];
      const ls: number[] = [];
      const at = (l: number) => gen.height(r.x + r.tz * l, r.z - r.tx * l);
      for (let k = 0; k < ROWS; k++) {
        const l = r.lo + ((r.hi - r.lo) * k) / (ROWS - 1);
        ls.push(l);
        ys.push(at(l));
      }
      for (let k = 0; k < ROWS; k++) {
        // Outward normal of the face in the cross-section (towards the road and up).
        const k0 = Math.max(0, k - 1);
        const k1 = Math.min(ROWS - 1, k + 1);
        const dl = (ls[k1] - ls[k0]) * s;
        const dh = ys[k1] - ys[k0];
        const len = Math.hypot(dl, dh) || 1;
        const nl = (-dh / len) * s;
        const ny = dl / len;
        const y0 = ys[k];
        // Strata: ledges along the layers (dipping a little along the road), broken by noise.
        const strata =
          0.5 +
          0.5 *
            Math.sin(
              y0 * 2.4 + r.d * 0.08 + noise.noise2(r.d / 9, y0 / 3) * 2.2,
            );
        const rough = noise.noise2(r.d / 3.5 + 40, y0 / 1.7);
        const inner = k > 0 && k < ROWS - 1;
        const out = inner
          ? (PROUD + LEDGE * strata + 0.12 * rough) * end - 0.05 * (1 - end)
          : -0.08;
        const l = ls[k] + nl * out;
        pos.push(r.x + r.tz * l, y0 + ny * out, r.z - r.tx * l);
        // Tone: a stretch of silver-grey schist, yellow ochre or rust (large noise along the road), warmer towards the
        // weathered top of the face, streaked by smaller noise; a little darker in the ledges' shade.
        const shade = 0.8 + 0.2 * strata;
        const top = k / (ROWS - 1);
        const warm = smoothstep(
          -0.4,
          0.2,
          noise.noise2(r.d / ZONE + 3, 0.5) +
            0.35 * top +
            0.25 * noise.noise2(r.d / 11 + 7, y0 / 4),
        );
        const rust = smoothstep(-0.1, 0.4, noise.noise2(r.d / ZONE + 17, 2.5));
        for (let c = 0; c < 3; c++) {
          const tint = OCHRE[c] + (RUST[c] - OCHRE[c]) * rust;
          const face = shade * (SCHIST[c] + (tint - SCHIST[c]) * warm);
          col.push(GROUND_ROCK[c] + (face - GROUND_ROCK[c]) * end);
        }
        uv.push(r.d / TILE, (y0 + r.d * 0.05) / TILE);
      }
      if (i > 0) {
        const a = (i - 1) * ROWS;
        const b = i * ROWS;
        for (let k = 0; k + 1 < ROWS; k++) {
          // Wound so the face looks towards the road on either side.
          if (s > 0)
            idx.push(a + k, b + k, a + k + 1, b + k, b + k + 1, a + k + 1);
          else idx.push(a + k, a + k + 1, b + k, b + k, a + k + 1, b + k + 1);
        }
      }
    });
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new Float32BufferAttribute(col, 3));
    geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mesh = new Mesh(geo, rockCutMaterial());
    mesh.receiveShadow = true;
    mesh.name = 'rock-cut';
    group.add(mesh);
  };

  /**
   * A low retaining wall (`walls`): a vertical face of dark coursed stone standing in front of the carve's foot (the 1 m
   * terrain grid can't hold a sheer step: its triangles would poke through a face laid on the carve), a thin
   * `WALL_THICK` stone top, then a skin of ground (terrain material: gravel and grass right at the top, the bank's own
   * cover behind) from it back onto the bank, which the terrain grid draws lower. Built in `WALL_PANEL` m panels like the
   * real one: each climbs a little less steeply than the road (courses and top parallel to it), so the top and the
   * courses step up a little at every joint. Both ends are closed.
   */
  const buildWall = (run: Section[], s: number): void => {
    const stone = new Strip();
    const earth = new Strip();
    const sp = [1, 0, 0, 0];
    const n = run.length;
    const wall = gen.rockCutWall(run[0].d, s)!;
    const both = (strip: Strip, q: V3[], c: number[], b = 0) => {
      strip.quad(q, c, b);
      strip.quad([...q].reverse(), c, b);
    };
    // Across the ground on top: from the stone's back over `WALL_SKIN` m into the bank.
    const SKIN = 6;
    let prev: { yt: number; prof: V3[] } | undefined;
    const emit = (r: Section, i: number, k: number) => {
      const hw = road.at(r.d).halfWidth;
      const at = (l: number) => gen.height(r.x + r.tz * l, r.z - r.tx * l);
      const p = (l: number, y: number): V3 => [
        r.x + r.tz * l,
        y,
        r.z - r.tx * l,
      ];
      const face = (hw + wall.offset + WALL_FACE) * s;
      const cope = face + WALL_THICK * s;
      const yb = at(face) - 0.3;
      const { base, top } = gen.wallTop(r.d, s, k)!;
      const yt = Math.max(top, yb + 0.6);
      // Stone: up the face in courses, over the top.
      const rows: V3[] = [];
      for (let j = 0; j <= 3; j++) rows.push(p(face, yb + ((yt - yb) * j) / 3));
      rows.push(p(cope, yt));
      stone.row(
        rows,
        rows.map((v, j) => {
          const t = j / (rows.length - 1);
          const moss = smoothstep(
            -0.1,
            0.6,
            noise.noise2(r.d / 4 + 23, v[1] / 1.5) +
              0.5 * t +
              0.25 * (1 - smoothstep(0, 0.3, t)),
          );
          const tone = 0.85 + 0.3 * noise.noise2(r.d / 2.5, v[1] / 1.2);
          return WALL_STONE.map(
            (c, m) => tone * (c + (WALL_MOSS[m] - c) * moss),
          );
        }),
        rows.map((v) => [r.d / WALL_TILE, (v[1] - base) / WALL_TILE]),
        s,
      );
      // The ground on top (terrain-gen `wallGround`): gravel and grass at the stone, easing into the bank's own cover.
      const prof: V3[] = [];
      const cols: number[][] = [];
      for (let j = 0; j <= SKIN; j++) {
        const l = cope + (WALL_SKIN * j * s) / SKIN;
        const [x, , z] = p(l, 0);
        const y =
          j === 0
            ? yt
            : (gen.wallGround(x, z, r.d, s, Math.abs(l), hw, k) ??
                gen.height(x, z)) + 0.02;
        prof.push(p(l, y));
        world.heightfield.splatAt(x, z, sp);
        const e = smoothstep(0, 1, j / SKIN);
        cols.push(WALL_TOP_SPLAT.map((c, m) => c + (sp[m] - c) * e));
      }
      earth.row(
        prof,
        cols,
        prof.map(() => [0, 0]),
        s,
      );
      // The ends: the wall's square end and the ground's side down to the foot.
      if (i === 0 || i === n - 1) {
        both(
          stone,
          [p(face, yb), p(face, yt), p(cope, yt), p(cope, yb)],
          WALL_STONE,
          base,
        );
        for (let j = 0; j < SKIN; j++)
          both(
            earth,
            [
              [prof[j][0], yb, prof[j][2]],
              prof[j],
              prof[j + 1],
              [prof[j + 1][0], yb, prof[j + 1][2]],
            ],
            WALL_TOP_SPLAT,
          );
      }
      // A joint: the step between the panels, stone and ground.
      if (prev && Math.abs(prev.yt - yt) > 0.01) {
        const [lo, hi] = [Math.min(prev.yt, yt), Math.max(prev.yt, yt)];
        both(
          stone,
          [p(face, lo), p(face, hi), p(cope, hi), p(cope, lo)],
          WALL_STONE,
          base,
        );
        for (let j = 0; j < SKIN; j++)
          both(
            earth,
            [prev.prof[j], prof[j], prof[j + 1], prev.prof[j + 1]],
            WALL_TOP_SPLAT,
          );
      }
      return { yt, prof };
    };
    run.forEach((r, i) => {
      const k = gen.wallPanel(wall, r.d);
      // (a section on a joint ends the panel before it, then starts its own)
      if (i > 0 && gen.wallPanel(wall, r.d - 0.01) !== k) {
        prev = emit(r, i, k - 1);
        stone.break();
        earth.break();
        emit(r, i, k);
        prev = undefined;
      } else emit(r, i, k);
    });
    const mesh = new Mesh(stone.geometry(), bridgeMaterials().stone);
    mesh.receiveShadow = true;
    mesh.name = 'rock-cut-wall';
    group.add(mesh);
    const ground = new Mesh(earth.ground(), groundMaterial());
    ground.receiveShadow = true;
    ground.name = 'rock-cut-wall-top';
    group.add(ground);
  };

  for (const s of [1, -1]) {
    let run: Section[] = [];
    let cont = false;
    const flush = (more = false) => {
      if (run.length >= 3)
        if (run[0].wall) buildWall(run, s);
        else build(run, s, [cont, more]);
      run = [];
      cont = more;
    };
    for (let d = 0; d <= road.length; d += STEP) {
      const sec = section(d, s);
      // (a wall and a rock face are separate runs)
      if (sec && run.length && run[run.length - 1].wall !== sec.wall) flush();
      if (!sec) flush();
      else {
        run.push(sec);
        if (run.length * STEP >= PIECE) {
          const last = run[run.length - 1];
          flush(true);
          run.push({ ...last });
        }
      }
      yield;
    }
    flush();
  }
  return group.children.length ? group : undefined;
}
