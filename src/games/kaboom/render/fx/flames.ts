import {
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  ShaderMaterial,
} from 'three';
import { FLAME_S } from '../../sim/rules';
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

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uLife;
  attribute vec4 aCell; // x, z = world position of the tile centre, y = spawn time, w = type
  varying float vRadial;
  varying float vK;

  void main() {
    float age = uTime - aCell.y;
    float k = age / uLife;
    if (age < 0.0 || k > 1.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    float grow = smoothstep(0.0, 0.14, k);
    float shrink = 1.0 - smoothstep(0.6, 1.0, k);
    float s = grow * shrink;
    float type = aCell.w;
    vec3 scale = vec3(0.6, 0.78, 0.6);          // centre
    vec3 shift = vec3(0.0);
    if (type > 0.5 && type < 1.5) scale = vec3(0.62, 0.5, 0.4);     // arm along x
    else if (type > 1.5 && type < 2.5) scale = vec3(0.4, 0.5, 0.62); // arm along z
    else if (type > 2.5) {                                           // tips: shorter, pulled back
      scale = vec3(0.46, 0.44, 0.46);
      if (type < 3.5) shift.x = -0.1;
      else if (type < 4.5) shift.x = 0.1;
      else if (type < 5.5) shift.z = -0.1;
      else shift.z = 0.1;
    }
    vec3 p = position;
    vRadial = length(vec3(p.x * 0.85, p.y * 0.55, p.z * 0.85));
    // licking flicker: the upper half wobbles and stretches
    float up = max(p.y, 0.0);
    p.x += sin(uTime * 17.0 + aCell.x * 2.3 + p.z * 5.0) * 0.07 * up;
    p.z += cos(uTime * 15.0 + aCell.x * 1.7 + p.x * 5.0) * 0.07 * up;
    p.y *= 1.0 + 0.18 * sin(uTime * 23.0 + aCell.x * 3.1 + aCell.z * 2.1);
    vec3 world = vec3(aCell.x, 0.34 * s, aCell.z) + shift * s + p * scale * s;
    vK = k;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(world, 1.0);
  }
`;

const FRAG = /* glsl */ `
  varying float vRadial;
  varying float vK;
  void main() {
    // concentric toon bands, hot in the middle, red at the rim; cooler as the flame ages
    float u = clamp(vRadial + vK * 0.45, 0.0, 0.999);
    float q = floor(u * 4.0);
    vec3 c = q < 1.0 ? vec3(1.0, 0.97, 0.7)
           : q < 2.0 ? vec3(1.0, 0.8, 0.25)
           : q < 3.0 ? vec3(1.0, 0.5, 0.1)
           : vec3(0.85, 0.2, 0.08);
    gl_FragColor = vec4(c, 1.0);
  }
`;

/**
 * Every burning tile of every blast as one instanced mesh of toon-stepped fireballs: centre, arm segments and rounded tips.
 * A tile is a ring-buffer slot written once when the blast goes off; the shader grows, flickers and shrinks it over
 * `FLAME_S` from the shared clock. No per-frame CPU work, one draw call.
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
    const geo = new IcosahedronGeometry(1, 1).toNonIndexed();
    this.cell = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    for (let i = 0; i < capacity; i++) this.cell.setY(i, 1e9);
    geo.setAttribute('aCell', this.cell);
    this.material = new ShaderMaterial({
      uniforms: { uTime: time, uLife: { value: FLAME_S } },
      vertexShader: VERT,
      fragmentShader: FRAG,
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
