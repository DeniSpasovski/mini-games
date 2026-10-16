import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Matrix4,
  Quaternion,
  ShapeUtils,
  Vector2,
  Vector3,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Vector4,
  type Camera,
  type WebGLRenderer,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash3 } from '../../../shared/rng';
import { getAssetMeta } from '../assets/catalog';
import { getAsset } from '../assets/library';
import { addWorldUniforms } from '../engine/world-shading';
import type { HorizonDef } from '../maps/shared/types';
import { base64Bytes } from './real-data';
import { RENDER_MARGIN, type World } from './world';

/** Far plane of the backdrop's own projection (m): the baked grids reach ~25 km from the map centre. */
const FAR = 80_000;
/** Inside the streamed area the backdrop is cut away this far short of the terrain view distance (m)... */
const CUT_MARGIN = 60;
/** ...and sunk up to SINK m over the next FADE m, so its coarse surface never pokes above the real terrain's edge. */
const SINK = 12;
const FADE = 700;

/**
 * The land far around a real map - terrain + land cover from `MapDef.horizon` (scripts/realmap/horizon.py), no roads,
 * trees or buildings - as a backdrop beyond the streamed terrain: two coarse grid meshes (100 m to ~8 km, 300 m to
 * ~25 km), vertex-coloured by land cover, lit by the sun, fogged like the rest of the scene.
 *
 * Drawn right after the sky (`renderOrder` -0.5) with its OWN projection (far 80 km; the game camera's far plane is
 * 3 km), then it clears the depth buffer (`onAfterRender`): the scene draws over it wherever it has something, and
 * its own hills still hide each other correctly. Inside the streamed area (map bounds + RENDER_MARGIN) it is cut away
 * within the terrain view distance (`setCutoff`); outside it, it reaches right up to the terrain's edge.
 * Cost: 2 draws, ~100k triangles, no shadows.
 */
export class Horizon {
  readonly group = new Group();
  private material: MeshLambertMaterial;
  private uniforms = {
    uHorizonProj: { value: new Matrix4() },
    /** Streamed area: minX, minZ, maxX, maxZ. */
    uHorizonRect: { value: new Vector4() },
    uHorizonCut: { value: 1e9 },
  };
  private projCam = new PerspectiveCamera(60, 1, 5, FAR);

  constructor(world: World, def: HorizonDef) {
    this.group.name = 'horizon';
    const map = world.map;
    const b = map.bounds;
    const m = RENDER_MARGIN;
    this.uniforms.uHorizonRect.value.set(
      b.minX - m,
      b.minZ - m,
      b.maxX + m,
      b.maxZ + m,
    );
    this.material = this.createMaterial();
    const lift = map.terrain.baseHeight - (map.terrain.heightmap?.offset ?? 0);
    const palette = horizonPalette(map.environment.groundTint);
    const inner = def.grids[0];
    def.grids.forEach((g, k) => {
      // The outer grid skips cells inside the inner one (a band of up to one cell overlaps; pushed back below).
      const hole = k > 0 && inner ? inner : undefined;
      const geo = gridGeometry(g, lift - (k > 0 ? 2 : 0), palette, hole);
      const mesh = new Mesh(geo, k > 0 ? this.outerMaterial() : this.material);
      mesh.name = `horizon ${g.cell} m`;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = -0.5 - k * 0.01; // after the sky (-1); the outer grid before the inner one
      mesh.onBeforeRender = (_r, _s, camera) => this.project(camera);
      // The inner grid is drawn last: it clears the depth, the scene is then drawn as if the backdrop were not there.
      if (k === 0)
        mesh.onAfterRender = (renderer: WebGLRenderer) => renderer.clearDepth();
      this.group.add(mesh);
    });
    // Big landmarks (the cross, the antenna mast) stay on the skyline beyond the streamed scatter: their last LOD is drawn
    // here, with the same cut-away inside the terrain view distance where the real instances take over.
    // The city's tall buildings beyond the baked area (MapDef.skyline): extruded footprints, same pass as the landmarks.
    const skyline = skylineGeometry(world, def);
    if (skyline) {
      const mesh = new Mesh(skyline, this.material);
      mesh.name = 'horizon skyline';
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = -0.505;
      mesh.onBeforeRender = (_r, _s, camera) => this.project(camera);
      this.group.add(mesh);
    }
    const far = farLandmarks(world);
    if (far) {
      const mesh = new Mesh(far, this.material);
      mesh.name = 'horizon landmarks';
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = -0.505; // after the outer grid, before the inner one (which clears the depth)
      mesh.onBeforeRender = (_r, _s, camera) => this.project(camera);
      this.group.add(mesh);
    }
  }

  /** Cut the backdrop away inside the streamed area within this distance of the camera (the terrain view distance). */
  setCutoff(viewDistance: number): void {
    this.uniforms.uHorizonCut.value = Math.max(0, viewDistance - CUT_MARGIN);
  }

  private project(camera: Camera): void {
    const c = this.projCam;
    const src = camera as PerspectiveCamera;
    if (!src.isPerspectiveCamera) return;
    c.fov = src.fov;
    c.aspect = src.aspect;
    c.zoom = src.zoom;
    c.view = src.view;
    c.updateProjectionMatrix();
    this.uniforms.uHorizonProj.value.copy(c.projectionMatrix);
  }

  private createMaterial(): MeshLambertMaterial {
    const mat = new MeshLambertMaterial({ vertexColors: true });
    const u = this.uniforms;
    mat.onBeforeCompile = (shader) => {
      addWorldUniforms(shader);
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform mat4 uHorizonProj;
          uniform vec4 uHorizonRect;
          uniform float uHorizonCut;
          varying vec3 vHorizonWorld;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          // Sink the coarse surface where it meets the streamed terrain (inside the streamed area only).
          bool hzIn = all( greaterThan( transformed.xz, uHorizonRect.xy ) ) && all( lessThan( transformed.xz, uHorizonRect.zw ) );
          float hzD = distance( transformed.xz, cameraPosition.xz );
          if ( hzIn ) transformed.y -= ${SINK.toFixed(1)} * ( 1.0 - smoothstep( uHorizonCut, uHorizonCut + ${FADE.toFixed(1)}, hzD ) );
          vHorizonWorld = transformed;`,
        )
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          gl_Position = uHorizonProj * mvPosition;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform vec4 uHorizonRect;
          uniform float uHorizonCut;
          varying vec3 vHorizonWorld;`,
        )
        .replace(
          'void main() {',
          `void main() {
          if ( all( greaterThan( vHorizonWorld.xz, uHorizonRect.xy ) ) && all( lessThan( vHorizonWorld.xz, uHorizonRect.zw ) )
            && distance( vHorizonWorld.xz, cameraPosition.xz ) < uHorizonCut ) discard;`,
        );
    };
    mat.customProgramCacheKey = () => 'rally-horizon-v1';
    return mat;
  }

  /** The outer grid: same shader, depth pushed back so the inner grid wins where they overlap. */
  private outerMaterial(): MeshLambertMaterial {
    const m = this.createMaterial();
    m.polygonOffset = true;
    m.polygonOffsetFactor = 2;
    m.polygonOffsetUnits = 8;
    return m;
  }

  dispose(): void {
    for (const c of this.group.children) {
      const mesh = c as Mesh;
      mesh.geometry.dispose();
      (mesh.material as MeshLambertMaterial).dispose();
    }
  }
}

interface Palette {
  grass: Color;
  tree: Color;
  crop: Color;
  built: Color;
  water: Color;
}

/** Land cover colours (linear), the grass following the map's `groundTint` like the terrain shader. */
function horizonPalette(
  tint: { grass: string; amount?: number; crop?: string } | undefined,
): Palette {
  const grass = new Color('#6e7440');
  if (tint) grass.lerp(new Color(tint.grass), (tint.amount ?? 0.85) * 0.8);
  return {
    grass,
    tree: new Color('#2f4626'),
    crop: grass.clone().lerp(new Color(tint?.crop ?? '#b9a25a'), 0.55),
    built: new Color('#8a857c'),
    water: new Color('#4b6273'),
  };
}

type GridDef = HorizonDef['grids'][number];

function gridGeometry(
  g: GridDef,
  lift: number,
  pal: Palette,
  hole?: GridDef,
): BufferGeometry {
  const { cols, rows, cell } = g;
  const hb = base64Bytes(g.heights);
  const heights = new Int16Array(hb.buffer, hb.byteOffset, cols * rows);
  const cb = base64Bytes(g.cover);
  const cover = new Uint16Array(cb.buffer, cb.byteOffset, cols * rows);
  const n = cols * rows;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const c = new Color();
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      const x = g.originX + i * cell;
      const z = g.originZ + j * cell;
      pos[k * 3] = x;
      pos[k * 3 + 1] = g.base + heights[k] * g.step + lift;
      pos[k * 3 + 2] = z;
      const v = cover[k];
      const tree = (v & 15) / 15;
      const crop = ((v >> 4) & 15) / 15;
      const built = ((v >> 8) & 15) / 15;
      const water = ((v >> 12) & 15) / 15;
      const grass = Math.max(0, 1 - tree - crop - built - water);
      c.setRGB(0, 0, 0);
      for (const [p, w] of [
        [pal.grass, grass],
        [pal.tree, tree],
        [pal.crop, crop],
        [pal.built, built],
        [pal.water, water],
      ] as const)
        c.setRGB(c.r + p.r * w, c.g + p.g * w, c.b + p.b * w);
      // A little per-cell variation so wide fields / forests are not one flat colour.
      c.multiplyScalar(0.92 + ((hash3(i, j, 7) >>> 0) % 1000) / 6250);
      col[k * 3] = c.r;
      col[k * 3 + 1] = c.g;
      col[k * 3 + 2] = c.b;
    }
  const inHole = (x0: number, z0: number): boolean =>
    !!hole &&
    x0 >= hole.originX &&
    z0 >= hole.originZ &&
    x0 + cell <= hole.originX + (hole.cols - 1) * hole.cell &&
    z0 + cell <= hole.originZ + (hole.rows - 1) * hole.cell;
  const idx: number[] = [];
  for (let j = 0; j < rows - 1; j++)
    for (let i = 0; i < cols - 1; i++) {
      if (inHole(g.originX + i * cell, g.originZ + j * cell)) continue;
      const a = j * cols + i;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      // Face up (+Y): rows run +Z, columns +X.
      idx.push(a, d, e, a, e, b);
    }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('color', new BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** Catalog assets of `MapDef.props` that are also drawn on the backdrop (last LOD) so they read from far away. */
const FAR_LANDMARKS = new Set(['millennium_cross', 'antenna_mast']);

/** The far landmarks of a map merged into one vertex-coloured geometry in world space, or undefined. */
function farLandmarks(world: World): BufferGeometry | undefined {
  const parts: BufferGeometry[] = [];
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  for (const p of world.map.props) {
    if (!FAR_LANDMARKS.has(p.asset) || p.x === undefined || p.z === undefined)
      continue;
    const lod = getAssetMeta(p.asset).lods.length - 1;
    const m = new Matrix4().compose(
      new Vector3(p.x, world.analytic.height(p.x, p.z), p.z),
      q.setFromAxisAngle(up, ((p.rotY ?? 0) * Math.PI) / 180),
      new Vector3(1, 1, 1).multiplyScalar(p.scale ?? 1),
    );
    for (const part of getAsset(p.asset, p.variant ?? 0, lod).parts) {
      const g = new BufferGeometry();
      for (const name of ['position', 'normal', 'color'])
        g.setAttribute(name, part.geometry.getAttribute(name).clone());
      g.applyMatrix4(m);
      parts.push(g);
    }
  }
  if (!parts.length) return undefined;
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/** Ground height of the backdrop's finest grid at (x, z) (bilinear), in the same frame as its mesh. */
function gridHeight(g: GridDef, heights: Int16Array, lift: number) {
  return (x: number, z: number): number => {
    const fx = Math.min(g.cols - 1.001, Math.max(0, (x - g.originX) / g.cell));
    const fz = Math.min(g.rows - 1.001, Math.max(0, (z - g.originZ) / g.cell));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const h = (a: number, b: number): number => heights[b * g.cols + a];
    const v =
      h(i, j) * (1 - tx) * (1 - tz) +
      h(i + 1, j) * tx * (1 - tz) +
      h(i, j + 1) * (1 - tx) * tz +
      h(i + 1, j + 1) * tx * tz;
    return g.base + v * g.step + lift;
  };
}

/**
 * The skyline buildings (MapDef.skyline) as one vertex-coloured geometry: each footprint extruded from just under its
 * lowest ground to its height, the facade in a wall band and a glass band per floor, a flat roof.
 */
function skylineGeometry(
  world: World,
  def: HorizonDef,
): BufferGeometry | undefined {
  const list = world.map.skyline;
  const g = def.grids[0];
  if (!list?.length || !g) return undefined;
  const hb = base64Bytes(g.heights);
  const heights = new Int16Array(hb.buffer, hb.byteOffset, g.cols * g.rows);
  const lift =
    world.map.terrain.baseHeight - (world.map.terrain.heightmap?.offset ?? 0);
  const ground = gridHeight(g, heights, lift);
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const tri = (
    a: number[],
    b: number[],
    c: number[],
    n: number[],
    color: Color,
  ): void => {
    // Wound so the face looks along +n (counter-clockwise seen from outside).
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const dot =
      (uy * vz - uz * vy) * n[0] +
      (uz * vx - ux * vz) * n[1] +
      (ux * vy - uy * vx) * n[2];
    const pts = dot >= 0 ? [a, b, c] : [a, c, b];
    for (const p of pts) {
      pos.push(p[0], p[1], p[2]);
      nor.push(n[0], n[1], n[2]);
      col.push(color.r, color.g, color.b);
    }
  };
  for (const b of list) {
    const n = b.footprint.length / 2;
    const P: [number, number][] = [];
    for (let i = 0; i < n; i++)
      P.push([b.footprint[i * 2], b.footprint[i * 2 + 1]]);
    // (a closed outline repeats its first point)
    if (n > 3 && P[0][0] === P[n - 1][0] && P[0][1] === P[n - 1][1]) P.pop();
    const m = P.length;
    let low = Infinity;
    for (const [x, z] of P) low = Math.min(low, ground(x, z));
    const y0 = low - 4;
    const top = low + b.height;
    let area = 0;
    for (let i = 0; i < m; i++) {
      const [x0, z0] = P[i];
      const [x1, z1] = P[(i + 1) % m];
      area += x0 * z1 - x1 * z0;
    }
    const s = area >= 0 ? 1 : -1;
    const wall = new Color(b.wall ?? '#c9c6bd');
    const glass = new Color(b.glass ?? '#4a5d72');
    const roof = new Color(b.roof ?? '#8d8a84');
    const floors = Math.max(1, b.floors ?? Math.round(b.height / 3.2));
    const floorH = b.height / floors;
    for (let i = 0; i < m; i++) {
      const [x0, z0] = P[i];
      const [x1, z1] = P[(i + 1) % m];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 0.05) continue;
      const nrm = [((z1 - z0) / len) * s, 0, (-(x1 - x0) / len) * s];
      const quad = (ya: number, yb: number, color: Color): void => {
        const a = [x0, ya, z0];
        const bb = [x1, ya, z1];
        const c = [x1, yb, z1];
        const d = [x0, yb, z0];
        tri(a, bb, c, nrm, color);
        tri(a, c, d, nrm, color);
      };
      // Below the lowest ground: plain wall; then a wall band and a glass band per floor.
      quad(y0, low, wall);
      for (let f = 0; f < floors; f++) {
        const ya = low + f * floorH;
        quad(ya, ya + floorH * 0.32, wall);
        quad(ya + floorH * 0.32, ya + floorH, glass);
      }
    }
    // The roof, triangulated (a footprint need not be convex).
    const contour = P.map(([x, z]) => new Vector2(x, z));
    for (const [i, j, k] of ShapeUtils.triangulateShape(contour, [])) {
      tri(
        [P[i][0], top, P[i][1]],
        [P[j][0], top, P[j][1]],
        [P[k][0], top, P[k][1]],
        [0, 1, 0],
        roof,
      );
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  geo.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  geo.computeBoundingSphere();
  return geo;
}
