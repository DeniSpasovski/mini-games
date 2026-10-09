import {
  AddEquation,
  BufferGeometry,
  CustomBlending,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FLAME_S } from '../../sim/rules';
import { PUFF_GLSL, puffAtlas } from './puff-atlas';
import type { TimeUniform } from './particles';

/** What a flame tile is part of: the blast's heart, the middle of an arm (along x or z) or an arm's rounded tip. */
export const FlameType = {
  Center: 0,
  ArmX: 1,
  ArmZ: 2,
  TipPosX: 3,
  TipNegX: 4,
  TipPosZ: 5,
  TipNegZ: 6,
} as const;

/** Fire puffs per burning tile: they overlap their neighbours, so an arm reads as one roaring jet. */
const LAYERS = 3;

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uLife;
  attribute vec4 aCell; // x, z = world position of the tile centre, y = spawn time, w = type
  attribute float aLayer;
  varying vec2 vUv;
  varying float vK;
  varying float vSeed;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  void main() {
    float age = uTime - aCell.y;
    float k = age / uLife;
    if (age < 0.0 || k > 1.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    float seed = hash(aCell.xz + aLayer * 7.13 + aCell.y);
    float type = aCell.w;
    float l = aLayer - 1.0; // -1, 0, 1
    vec3 c = vec3(aCell.x, 0.0, aCell.z);
    float size = 0.62;
    if (type < 0.5) {
      // the heart: three big puffs in a triangle, billowing up
      float a = aLayer * 2.094 + seed;
      c.xz += vec2(cos(a), sin(a)) * 0.16;
      size = 0.8;
    } else if (type < 2.5) {
      // an arm: puffs spread along it, filling the gap to the next tile
      vec2 axis = type < 1.5 ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      c.xz += axis * l * 0.3 + vec2(axis.y, axis.x) * (seed - 0.5) * 0.14;
    } else {
      // a tip: smaller and pulled back towards the blast
      vec2 back = type < 3.5 ? vec2(-1.0, 0.0) : type < 4.5 ? vec2(1.0, 0.0) : type < 5.5 ? vec2(0.0, -1.0) : vec2(0.0, 1.0);
      c.xz += back * (0.12 + l * 0.12);
      size = 0.5;
    }
    float grow = mix(0.35, 1.0, smoothstep(0.0, 0.16, k));
    float flicker = 1.0 + 0.08 * sin(uTime * 31.0 + seed * 40.0);
    size *= grow * flicker * (0.9 + 0.25 * seed);
    // rises a little as it burns; the top layer rides higher
    c.y = size * 0.55 + 0.08 * (l + 1.0) + k * 0.3;
    vec4 mv = viewMatrix * vec4(c, 1.0);
    float r = seed * 6.2832 + uTime * (seed - 0.5) * 3.0;
    mv.xy += mat2(cos(r), -sin(r), sin(r), cos(r)) * position.xy * size * 2.0;
    vUv = position.xy + 0.5;
    vK = k;
    vSeed = seed;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  varying vec2 vUv;
  varying float vK;
  varying float vSeed;
  ${PUFF_GLSL}

  void main() {
    float k = vK;
    // stays a solid tongue of fire while it can still hurt, breaks up only at the very end
    float d = puffAt(vUv, k * k * 0.7 + vSeed * 0.12).r;
    float heat = clamp(d * (1.0 - k * 0.7), 0.0, 1.0);
    vec3 c = fireRamp(heat) * 0.95;
    float a = d * (1.0 - smoothstep(0.75, 1.0, k));
    gl_FragColor = vec4(c * a, a * 0.8);
  }
`;

function tileGeometry(): BufferGeometry {
  const quads = [];
  for (let i = 0; i < LAYERS; i++) {
    const q = new PlaneGeometry(1, 1);
    q.setAttribute(
      'aLayer',
      new Float32BufferAttribute(
        new Array(q.getAttribute('position').count).fill(i),
        1,
      ),
    );
    quads.push(q);
  }
  const g = mergeGeometries(quads, false);
  if (!g) throw new Error('kabooom: could not merge flame quads');
  for (const q of quads) q.dispose();
  return g;
}

/**
 * Every burning tile of every blast as one instanced mesh: per tile a few soft fire puffs from the shared flipbook
 * (`puff-atlas.ts`) that grow, swirl, rise and cool from white-hot to deep red over `FLAME_S`, blended mostly additive
 * so they glow. A tile is a ring-buffer slot written once when the blast goes off; the shader does the rest from the
 * shared clock. No per-frame CPU work, one draw call.
 */
export class FlameField {
  readonly mesh: InstancedMesh;
  private readonly cell: InstancedBufferAttribute;
  private readonly material: ShaderMaterial;
  private head = 0;
  /** Slots written at least once: only these are drawn. */
  private used = 0;
  private dirty = false;

  constructor(
    readonly capacity: number,
    time: TimeUniform,
  ) {
    const geo = tileGeometry();
    this.cell = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    for (let i = 0; i < capacity; i++) this.cell.setY(i, 1e9);
    geo.setAttribute('aCell', this.cell);
    this.material = new ShaderMaterial({
      uniforms: {
        uTime: time,
        uLife: { value: FLAME_S },
        uPuff: { value: puffAtlas() },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
    });
    this.mesh = new InstancedMesh(geo, this.material, capacity);
    this.mesh.frustumCulled = false;
    const id = new Matrix4();
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, id);
    this.mesh.renderOrder = 4;
    this.mesh.count = 0;
  }

  /** Light one tile at world `(x, z)` at clock time `t`. */
  add(t: number, x: number, z: number, type: number): void {
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    if (this.used < this.capacity) this.used = Math.max(this.used, i + 1);
    this.cell.setXYZW(i, x, t, z, type);
    this.dirty = true;
  }

  flush(): void {
    this.mesh.count = this.used;
    if (!this.dirty) return;
    this.dirty = false;
    this.cell.needsUpdate = true;
  }

  clear(): void {
    for (let i = 0; i < this.capacity; i++) this.cell.setY(i, 1e9);
    this.cell.needsUpdate = true;
    this.used = 0;
    this.mesh.count = 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
