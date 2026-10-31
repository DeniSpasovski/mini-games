import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  ShapeUtils,
  Vector2,
  type Scene,
} from 'three';
import { getTexture } from '../engine/textures';
import { addWorldUniforms } from '../engine/world-shading';
import type { World } from './world';

/**
 * Water in the carved canals / drains / rivers (`paths` with surface `water`): one flat
 * ribbon per channel at its water level (`TerrainGenerator.channelWaterLevel`, level
 * across, falling downstream), a little wider than the water so its edges tuck under the
 * banks - the terrain draws the shoreline. Where a road crosses (bridge / culvert) the
 * road embankment is above the water and hides it. Lakes / ponds / reservoirs are their
 * OSM polygon at the lake's level (`Lakes.levels`). Merged per 256 m tile.
 */
const STEP = 4; // m between rows
const TILE = 256;
/** Ribbon half width relative to the water half width (edges hidden by the banks). */
const OVERLAP = 1.18;
/** Ripple texture size (m) and drift speed (m/s). */
const RIPPLE = 9;
const DRIFT = 0.12;
/** Current (m/s) of the flowing water: the big ripples and the finer ones run at 1 and 0.6 of it. */
const CURRENT = 0.9;
/** Vertices across a channel ribbon (depth samples: clear at the banks, deepest mid-stream). */
const ACROSS = 4;
/** Depth given to lakes (m): their polygons have no inner vertices to sample the bed at. */
const LAKE_DEPTH = 3;

/** Water deeper than this (m) shows its full deep colour; shallower it clears to the bed. */
const CLEAR = 0.9;

const materials = new Map<boolean, MeshStandardMaterial>();
const time = { value: 0 };

/**
 * Shared water material; reflects the sky (scene environment). Per vertex `depth` (m, water level minus the bed) runs
 * it from clear over the shallows (a soft edge where it meets the bank) to a deep green-brown; `flow` = the ripples run
 * along the UV's v (channels, downstream) instead of drifting (lakes).
 */
export function getWaterMaterial(flow = false): MeshStandardMaterial {
  let material = materials.get(flow);
  if (!material) {
    const normalMap = getTexture('water_normal').clone();
    normalMap.needsUpdate = true;
    material = new MeshStandardMaterial({
      color: new Color(0x26382c),
      roughness: 0.14,
      metalness: 0,
      normalMap,
      envMapIntensity: flow ? 0.2 : 0.4,
      transparent: true,
    });
    material.normalScale.set(0.18, 0.18);
    material.name = flow ? 'water_flow' : 'water';
    if (flow) material.defines = { WATER_FLOW: 1 };
    material.onBeforeCompile = (sh) => {
      addWorldUniforms(sh);
      sh.uniforms.uWaterTime = time;
      sh.vertexShader = sh.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float waterDepth;\nvarying float vDepth;\nvarying vec3 vWp;',
        )
        .replace(
          '#include <uv_vertex>',
          '#include <uv_vertex>\nvDepth = waterDepth;\nvWp = ( modelMatrix * vec4( position, 1.0 ) ).xyz;',
        );
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying float vDepth;
          varying vec3 vWp;
          uniform float uWaterTime;`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          // Shallow: the wet gravel bed shows through, a bright line of foam at the bank; deep: dark green, opaque.
          float dk = smoothstep( 0.0, ${CLEAR.toFixed(2)}, vDepth );
          vec3 wsBed = vec3( 0.30, 0.29, 0.23 );
          diffuseColor.rgb = mix( wsBed, diffuseColor.rgb * 0.8, dk );
          diffuseColor.a = smoothstep( 0.0, 0.12, vDepth ) * mix( 0.35, 1.0, dk );
          #ifdef WATER_FLOW
            // Foam: along the banks and in streaks where the stream runs shallow, stretched with the current.
            vec2 wsFq = vec2( vNormalMapUv.x * ${RIPPLE.toFixed(1)} * 2.2, vNormalMapUv.y * ${RIPPLE.toFixed(1)} * 0.35 + uWaterTime * ${(CURRENT * 0.35).toFixed(3)} );
            float wsFn = wsVNoise( wsFq ) * 0.6 + wsVNoise( wsFq * 2.3 + 9.1 ) * 0.4;
            float wsFoam = ( 1.0 - smoothstep( 0.03, 0.3, vDepth ) ) * smoothstep( 0.35, 0.7, wsFn ) + ( 1.0 - smoothstep( 0.2, 0.9, vDepth ) ) * smoothstep( 0.78, 0.9, wsFn ) * 0.5;
            diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.78, 0.8, 0.78 ), wsFoam * 0.85 );
            diffuseColor.a = max( diffuseColor.a, wsFoam * 0.9 );
          #endif`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#ifdef WATER_FLOW
            // Two layers of ripples running downstream, stretched along the current, at different speeds, so the
            // surface neither looks like a conveyor nor like a stamped texture.
            vec3 n1 = texture2D( normalMap, vNormalMapUv * vec2( 1.5, 0.55 ) + vec2( 0.0, -uWaterTime * ${(CURRENT / RIPPLE).toFixed(4)} * 0.55 ) ).xyz * 2.0 - 1.0;
            vec3 n2 = texture2D( normalMap, vNormalMapUv * vec2( 0.9, 0.35 ) + vec2( 0.31, -uWaterTime * ${(CURRENT / RIPPLE).toFixed(4)} * 0.33 ) ).xyz * 2.0 - 1.0;
            vec3 mapN = normalize( vec3( ( n1.xy * 0.8 + n2.xy ) * normalScale, 1.0 ) );
            normal = normalize( tbn * mapN );
          #else
            #include <normal_fragment_maps>
            // Wind on a lake: a long, slow swell over the small ripples (a big pattern the texture's 9 m never repeats).
            vec3 wsSw = texture2D( normalMap, vWp.xz / 53.0 + vec2( uWaterTime * 0.004, 0.0 ) ).xyz * 2.0 - 1.0;
            normal = normalize( normal + tbn * vec3( wsSw.xy * 0.07, 0.0 ) );
          #endif
          // Rain on the water: rings from random points that grow and fade (the puddles' ones).
          float wsRate = clamp( wsWet.y / 8.0, 0.0, 1.0 );
          if ( wsRate > 0.0 ) {
            float wsNear = 1.0 - smoothstep( 10.0, 40.0, length( vViewPosition ) );
            vec2 wsRip = wsRipples( vWp.xz, wsTime, wsRate * 0.9 ) * ( 0.2 * wsNear );
            normal = normalize( normal + ( viewMatrix * vec4( wsRip.x, 0.0, wsRip.y, 0.0 ) ).xyz );
          }`,
        );
    };
    material.customProgramCacheKey = () => (flow ? 'water-flow-2' : 'water-2');
    materials.set(flow, material);
  }
  return material;
}

/** Ripples drift (lakes) or run (channels) and the sky is reflected: run before each water mesh draw. */
function animate(scene: Scene, mat: MeshStandardMaterial): void {
  if (scene.environment && mat.envMap !== scene.environment) {
    // Own env map so envMapIntensity is not the (low) scene environment intensity.
    mat.envMap = scene.environment;
    mat.needsUpdate = true;
  }
  const t = performance.now() / 1000;
  time.value = t;
  if (mat.name === 'water')
    mat.normalMap!.offset.set((t * DRIFT) / RIPPLE, (t * DRIFT * 0.6) / RIPPLE);
}

export function* waterMeshJob(
  world: World,
): Generator<void, Group | undefined> {
  const gen = world.gen;
  const net = gen.channels;
  const lakes = gen.lakes;
  if (!net && !lakes) return undefined;
  type Tile = { pos: number[]; uv: number[]; depth: number[]; idx: number[] };
  // Channels (flowing) and lakes (still) per tile.
  const tiles = new Map<string, Tile>();
  const tileAt = (x: number, z: number, flow: boolean): Tile => {
    const key = `${Math.floor(x / TILE)},${Math.floor(z / TILE)},${flow ? 1 : 0}`;
    let tile = tiles.get(key);
    if (!tile) tiles.set(key, (tile = { pos: [], uv: [], depth: [], idx: [] }));
    return tile;
  };
  const pt = { x: 0, z: 0 };
  const pt2 = { x: 0, z: 0 };
  net?.paths.forEach((_, ci) => {
    const L = net.lengths[ci];
    const n = Math.max(2, Math.ceil(L / STEP) + 1);
    const step = L / (n - 1);
    const hw = gen.channelWaterHalfWidth(ci) * OVERLAP;
    // Ripples run downstream: v grows the way the water level falls.
    const down =
      gen.channelWaterLevel(ci, L) <= gen.channelWaterLevel(ci, 0) ? 1 : -1;
    net.pointAt(ci, L / 2, pt);
    const tile = tileAt(pt.x, pt.z, true);
    const v0 = tile.pos.length / 3;
    for (let i = 0; i < n; i++) {
      const a = i * step;
      net.pointAt(ci, Math.max(0, a - 2), pt);
      net.pointAt(ci, Math.min(L, a + 2), pt2);
      const tl = Math.hypot(pt2.x - pt.x, pt2.z - pt.z) || 1;
      const tx = (pt2.x - pt.x) / tl;
      const tz = (pt2.z - pt.z) / tl;
      net.pointAt(ci, a, pt);
      const y = gen.channelWaterLevel(ci, a);
      for (let j = 0; j <= ACROSS; j++) {
        const side = (j / ACROSS) * 2 - 1;
        const x = pt.x + tz * hw * side;
        const z = pt.z - tx * hw * side;
        tile.pos.push(x, y, z);
        tile.uv.push((side * hw) / RIPPLE, (a * down) / RIPPLE);
        // The carved bed sits just under the ribbon, so the depth is a cross profile: 0 where the water meets the bank
        // (1 / OVERLAP of the ribbon), deepest mid-stream (wider channels deeper).
        const e = Math.abs(side) * OVERLAP;
        tile.depth.push(Math.min(2, hw * 0.4) * (1 - e * e));
      }
    }
    const R = ACROSS + 1;
    for (let i = 0; i < n - 1; i++)
      for (let j = 0; j < ACROSS; j++) {
        const a = v0 + i * R + j;
        tile.idx.push(a, a + R, a + 1, a + 1, a + R, a + R + 1);
      }
  });
  // Lakes: the polygon, flat at the water level (its rim strip lies under the shore); deep all over (no bed samples).
  lakes?.polys.forEach((p, li) => {
    const contour: Vector2[] = [];
    let cx = 0;
    let cz = 0;
    for (let k = 0; k < p.length; k += 2) {
      contour.push(new Vector2(p[k], p[k + 1]));
      cx += p[k];
      cz += p[k + 1];
    }
    const n = contour.length;
    const tile = tileAt(cx / n, cz / n, false);
    const v0 = tile.pos.length / 3;
    const y = lakes.levels[li];
    for (const c of contour) {
      tile.pos.push(c.x, y, c.y);
      tile.uv.push(c.x / RIPPLE, c.y / RIPPLE);
      tile.depth.push(LAKE_DEPTH);
    }
    for (const [a, b, c] of ShapeUtils.triangulateShape(contour, [])) {
      // Face up (+Y): (b - a) x (c - a) must have a positive y.
      const A = contour[a];
      const B = contour[b];
      const C = contour[c];
      const up = (C.x - A.x) * (B.y - A.y) - (B.x - A.x) * (C.y - A.y);
      if (up >= 0) tile.idx.push(v0 + a, v0 + b, v0 + c);
      else tile.idx.push(v0 + a, v0 + c, v0 + b);
    }
  });
  yield;
  const group = new Group();
  group.name = 'water';
  for (const [key, t] of tiles) {
    const mat = getWaterMaterial(key.endsWith(',1'));
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(t.pos), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(t.uv), 2));
    g.setAttribute(
      'waterDepth',
      new BufferAttribute(new Float32Array(t.depth), 1),
    );
    const nor = new Float32Array(t.pos.length);
    for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
    g.setAttribute('normal', new BufferAttribute(nor, 3));
    g.setIndex(t.idx);
    g.computeBoundingSphere();
    const mesh = new Mesh(g, mat);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.onBeforeRender = (_r, scene) => animate(scene, mat);
    group.add(mesh);
    yield;
  }
  return group;
}
