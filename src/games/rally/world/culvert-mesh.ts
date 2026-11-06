import {
  BoxGeometry,
  type BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  type MeshStandardMaterial,
  Path,
  RingGeometry,
  Shape,
} from 'three';
import { smoothstep } from '../../../shared/noise';
import { merge, paint, planarUV, shade } from '../engine/geo';
import { addWorldUniforms } from '../engine/world-shading';
import { bridgeMaterials } from './bridge-mesh';
import {
  culvertFloor,
  culvertProfile,
  FOOTING,
  WALL_T,
  WING_FLARE,
  type CulvertEnd,
  type CulvertSite,
} from './culverts';
import { farShadowCaster } from './far-shadow';
import type { World } from './world';

/**
 * Draws the culverts (world/culverts.ts): at each end a cast-concrete headwall with the pipe standing out of it, a
 * coping, two wing walls splaying out along the gully and an apron slab between them. Built per end in a local frame (x = across, y = up from the invert, z = out from the face), baked to
 * world space, one merged mesh in the bridges' concrete.
 */

/** Concrete texture repeat (m): the bridges' cast-concrete scan. */
const CONC_TS = 4;
/** Pipe wall thickness (m) and how far the pipe stands out of the headwall. */
const PIPE_WALL = 0.08;
const PIPE_OUT = 0.25;
const WING_T = 0.22;
const WALL = '#bdb5a6';
const APRON = '#968f82';
const PIPE = '#b3ab9b';

const conc = (g: BufferGeometry, color: string): BufferGeometry =>
  planarUV(paint(g, color), 1 / CONC_TS);

/**
 * Concrete on flat faces: each face takes the texture on the plane it faces most (tops and the apron flat, a splayed
 * wing along its own run), so none is smeared the way one vertical projection smears them. Needs flat face normals.
 */
const concFaces = (geo: BufferGeometry, color: string): BufferGeometry => {
  const g = paint(geo, color);
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const uv = g.getAttribute('uv');
  const s = 1 / CONC_TS;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    const [u, v] =
      ay >= ax && ay >= az
        ? [p.getX(i), p.getZ(i)]
        : ax >= az
          ? [p.getZ(i), p.getY(i)]
          : [p.getX(i), p.getY(i)];
    uv.setXY(i, u * s, v * s);
  }
  uv.needsUpdate = true;
  return g;
};

/** Wet / soiled foot: darker up to ~0.4 m over the invert. */
const soiled = (g: BufferGeometry): BufferGeometry =>
  shade(g, (_x, y) => 0.72 + 0.28 * smoothstep(-0.1, 0.5, y));

/** A box from `z0` to `z1` (local) whose bottom / top and half width follow functions of z. */
function slab(
  z0: number,
  z1: number,
  x: (z: number, side: number) => number,
  bottom: (z: number) => number,
  top: (z: number) => number,
): BufferGeometry {
  const g = new BoxGeometry(1, 1, 1);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i) < 0 ? z0 : z1;
    const side = p.getX(i) < 0 ? -1 : 1;
    p.setXYZ(i, x(z, side), p.getY(i) < 0 ? bottom(z) : top(z), z);
  }
  g.computeVertexNormals();
  return g;
}

function end(
  site: CulvertSite,
  e: CulvertEnd,
  ground: (x: number, z: number) => number,
): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  const D = site.diameter;
  const ri = D / 2;
  const ro = ri + PIPE_WALL;
  const top = e.top - e.invert;
  // Headwall with the pipe's hole, face at z = 0, back at -WALL_T.
  const outline = new Shape();
  outline.moveTo(-e.half, -FOOTING);
  outline.lineTo(e.half, -FOOTING);
  outline.lineTo(e.half, top);
  outline.lineTo(-e.half, top);
  outline.closePath();
  const hole = new Path();
  hole.absarc(0, ri, ro - 0.005, 0, Math.PI * 2, true);
  outline.holes.push(hole);
  const wall = new ExtrudeGeometry(outline, {
    depth: WALL_T,
    bevelEnabled: false,
    curveSegments: 20,
  }).translate(0, 0, -WALL_T);
  parts.push(soiled(concFaces(wall, WALL)));
  // Coping: a little proud of the wall all round.
  parts.push(
    concFaces(
      new BoxGeometry(e.half * 2 + 0.08, 0.1, WALL_T + 0.08).translate(
        0,
        top + 0.05,
        -WALL_T / 2,
      ),
      WALL,
    ),
  );
  // The pipe stands a little out of the face; the terrain draws no ground between the wings or inside the wall
  // (terrain-material.ts `setCulvertHoles`), so its inside ends in a dark disc just inside the wall's back.
  const mouth = PIPE_OUT;
  const plug = -WALL_T + 0.03;
  const barrel = (r: number, z0: number) =>
    new CylinderGeometry(r, r, mouth - z0, 24, 2, true)
      .rotateX(Math.PI / 2)
      .translate(0, ri, (mouth + z0) / 2);
  parts.push(conc(barrel(ro, -WALL_T), PIPE));
  parts.push(
    shade(
      conc(barrel(ri, plug), PIPE),
      (_x, _y, z) => 0.25 + 0.75 * smoothstep(plug, mouth, z),
    ),
  );
  parts.push(conc(new RingGeometry(ri, ro, 24).translate(0, ri, mouth), PIPE));
  // The dark inside: black in the middle, the lit barrel's tone at the rim, silt along the bottom.
  parts.push(
    shade(
      paint(new CircleGeometry(ri, 24).translate(0, ri, plug), '#3a3833'),
      (x, y) => {
        const r = Math.hypot(x, y - ri) / ri;
        return 0.08 + 0.55 * r * r + (y < ri * 0.35 ? 0.25 * r : 0);
      },
    ),
  );
  parts.push(
    conc(
      new BoxGeometry(ri * 1.1, 0.03, mouth - plug).translate(
        0,
        0.03,
        (plug + mouth) / 2,
      ),
      '#6f6350',
    ),
  );
  // Wing walls from the wall ends along the gully, their tops falling to the ground.
  const floor = (t: number) => culvertFloor(e, t) - e.invert;
  const tip = e.wing;
  const dx = site.ax * e.side;
  const dz = site.az * e.side;
  for (const side of [-1, 1]) {
    const inner = (z: number) => side * (e.half - 0.15 + z * WING_FLARE);
    // The tip's top just over the bank it retains (the ground beside it), never below the gully floor + a kerb.
    const ox = inner(tip) + side * (WING_T + 0.5);
    const bank =
      ground(
        site.x + dx * (e.u + tip) + dz * ox,
        site.z + dz * (e.u + tip) - dx * ox,
      ) - e.invert;
    const tipTop = Math.min(
      top,
      Math.max(
        floor(tip) + 0.35,
        Math.min(bank, culvertProfile(e, tip) - e.invert + 0.6) + 0.05,
      ),
    );
    parts.push(
      soiled(
        concFaces(
          slab(
            0,
            tip,
            (z, s) => inner(z) + side * (s * side > 0 ? WING_T : 0),
            (z) => floor(z) - FOOTING,
            (z) => top + (tipTop - top) * smoothstep(0, tip, z),
          ),
          WALL,
        ),
      ),
    );
  }
  // Apron slab between the wings.
  parts.push(
    concFaces(
      slab(
        0,
        tip,
        (z, s) => s * (e.half - 0.15 + z * WING_FLARE),
        (z) => floor(z) - 0.15,
        (z) => floor(z) + 0.065,
      ),
      APRON,
    ),
  );
  // Local frame -> world: z along the axis outward, at the face centre on the invert.
  const m = new Matrix4()
    .makeRotationY(Math.atan2(dx, dz))
    .setPosition(site.x + dx * e.u, e.invert, site.z + dz * e.u);
  return parts.map((g) => {
    const t = g.index ? g.toNonIndexed() : g;
    // Height over the invert (`cwH`): the weathering's water line and the moss creeping up from the foot.
    const pos = t.getAttribute('position');
    const h = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) h[i] = pos.getY(i);
    t.setAttribute('cwH', new Float32BufferAttribute(h, 1));
    return t.applyMatrix4(m);
  });
}

let weathered: MeshStandardMaterial | undefined;

/**
 * The bridges' concrete, aged for a culvert: blotchy wear, a soil stain up to the water line, streaks, and moss on the
 * apron, the wall tops and creeping up from the foot (world-space noise; one shared material).
 */
function weatheredConcrete(): MeshStandardMaterial {
  if (weathered) return weathered;
  const m = bridgeMaterials().concrete.clone();
  m.onBeforeCompile = (sh) => {
    addWorldUniforms(sh);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float cwH;
varying float vCwH;
varying vec3 vCwP;
varying vec3 vCwN;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vCwH = cwH;
vCwP = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vCwN = normalize( mat3( modelMatrix ) * objectNormal );`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vCwH;
varying vec3 vCwP;
varying vec3 vCwN;
float cwHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float cwNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( cwHash( i ), cwHash( i + vec2( 1, 0 ) ), f.x ), mix( cwHash( i + vec2( 0, 1 ) ), cwHash( i + vec2( 1, 1 ) ), f.x ), f.y );
}
float cwFbm( vec2 p ) { return 0.55 * cwNoise( p ) + 0.3 * cwNoise( p * 2.3 + 7.1 ) + 0.15 * cwNoise( p * 5.1 + 3.7 ); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  {
    // world-space coordinates that run across walls and floors alike
    vec2 q = vCwP.xz + vec2( vCwP.y * 0.7, -vCwP.y * 0.4 );
    float wear = cwFbm( q * 2.1 );
    float patchy = cwFbm( q * 3.6 + 11.0 );
    float up = smoothstep( 0.55, 0.9, vCwN.y );
    float low = 1.0 - smoothstep( 0.15, 0.7, vCwH + 0.25 * ( cwNoise( q * 1.7 ) - 0.5 ) );
    // blotchy old concrete: darker and lighter patches
    diffuseColor.rgb *= 0.7 + 0.5 * wear;
    // soil and water stain: up to the water line, streaks running down the walls
    float streak = cwNoise( vec2( ( vCwP.x + vCwP.z ) * 3.1, vCwP.y * 0.35 ) );
    float dirt = clamp( 0.75 * low + 0.25 * up * patchy + 0.55 * smoothstep( 0.45, 0.8, streak ) * ( 1.0 - up ) * ( 0.6 + 0.4 * wear ), 0.0, 1.0 );
    diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.62, 0.5, 0.36 ), dirt * 0.8 );
    // moss: patches on the apron and the wall tops, and from the damp foot up
    float moss = smoothstep( 0.6, 0.78, patchy + 0.18 * low + 0.06 * up ) * clamp( 0.7 * up + 0.6 * low, 0.0, 1.0 );
    vec3 mossCol = vec3( 0.075, 0.07, 0.03 ) * ( 0.65 + 0.7 * cwNoise( q * 11.0 ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, mossCol, moss * 0.7 );
  }`,
      );
  };
  m.customProgramCacheKey = () => 'culvert-weathered';
  return (weathered = m);
}

export function* culvertMeshJob(
  world: World,
): Generator<void, Group | undefined> {
  const sites = world.gen.culverts;
  if (!sites.length) return undefined;
  const parts: BufferGeometry[] = [];
  for (const s of sites) {
    for (const e of s.ends)
      parts.push(...end(s, e, (x, z) => world.gen.height(x, z)));
    yield;
  }
  const group = new Group();
  group.name = 'culverts';
  const mesh = new Mesh(merge(parts), weatheredConcrete());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  farShadowCaster(mesh);
  group.add(mesh);
  return group;
}
