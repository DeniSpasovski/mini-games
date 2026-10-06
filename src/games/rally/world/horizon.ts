import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Vector4,
  type Camera,
  type WebGLRenderer,
} from 'three';
import { hash3 } from '../../../shared/rng';
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
