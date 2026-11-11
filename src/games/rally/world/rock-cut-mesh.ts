import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { Noise2D, smoothstep } from '../../../shared/noise';
import { imageTexture } from '../engine/image-texture';
import colorUrl from '../engine/props/cut-face.color.webp';
import normalUrl from '../engine/props/cut-face.normal.webp';
import { bridgeMaterials } from './bridge-mesh';
import { newRoadQuery } from './road';
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
/** A retaining wall (`walls`): how far it stands proud of the carve (m), its stone's uv tile (m, the bridge ashlar's), its
 * tone (dark weathered limestone blocks, moss and lichen: the owner's photos) and the green of the moss streaks. */
const WALL_PROUD = 0.1;
const WALL_TILE = 2;
const WALL_STONE = [0.42, 0.42, 0.4];
const WALL_MOSS = [0.36, 0.42, 0.3];

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
): Generator<void, Group | undefined> {
  const rc = world.map.road.rockCuts;
  if (!rc) return undefined;
  const road = world.road;
  const gen = world.gen;
  const def = world.map.road;
  const rq = newRoadQuery();
  const noise = new Noise2D(world.map.seed + 811);
  const group = new Group();
  group.name = 'rock-cuts';

  // The face across the road at `d` on side `s` (+1 left, -1 right): foot and top offsets, or null when there is none.
  const section = (d: number, s: number): Section | null => {
    const p = road.at(d);
    const lat = (l: number) => [p.x + p.tz * l * s, p.z - p.tx * l * s];
    const foot = p.halfWidth + def.shoulder + rc.foot;
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
    const wall = run[0].wall;
    run.forEach((r, i) => {
      // Ends of a run taper into the ground, their tone easing to the ground's rock so the face has no hard edge there.
      const end = Math.min(
        open[0] ? 1 : smoothstep(0, END_TAPER, i),
        open[1] ? 1 : smoothstep(0, END_TAPER, n - 1 - i),
      );
      const ys: number[] = [];
      const ls: number[] = [];
      for (let k = 0; k < ROWS; k++) {
        const l = r.lo + ((r.hi - r.lo) * k) / (ROWS - 1);
        ls.push(l);
        ys.push(gen.height(r.x + r.tz * l, r.z - r.tx * l));
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
        const out = wall
          ? inner
            ? WALL_PROUD * end
            : -0.05
          : inner
            ? (PROUD + LEDGE * strata + 0.12 * rough) * end - 0.05 * (1 - end)
            : -0.08;
        const l = ls[k] + nl * out;
        pos.push(r.x + r.tz * l, y0 + ny * out, r.z - r.tx * l);
        // Tone: a stretch of silver-grey schist, yellow ochre or rust (large noise along the road), warmer towards the
        // weathered top of the face, streaked by smaller noise; a little darker in the ledges' shade.
        if (wall) {
          // Dark blocks, a little lighter or greener from stone to stone (moss on the top courses), no strata.
          const moss = smoothstep(0.2, 0.9, k / (ROWS - 1) + 0.4 * rough);
          const tone = 0.9 + 0.2 * noise.noise2(r.d / 2.5, y0 / 1.2);
          for (let c = 0; c < 3; c++)
            col.push(
              tone * (WALL_STONE[c] + (WALL_MOSS[c] - WALL_STONE[c]) * moss),
            );
          uv.push(r.d / WALL_TILE, y0 / WALL_TILE);
          continue;
        }
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
    const mesh = new Mesh(
      geo,
      wall ? bridgeMaterials().stone : rockCutMaterial(),
    );
    mesh.receiveShadow = true;
    mesh.name = wall ? 'rock-cut-wall' : 'rock-cut';
    group.add(mesh);
  };

  for (const s of [1, -1]) {
    let run: Section[] = [];
    let cont = false;
    const flush = (more = false) => {
      if (run.length >= 3) build(run, s, [cont, more]);
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
