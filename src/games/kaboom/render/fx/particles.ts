import {
  BoxGeometry,
  BufferGeometry,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  ShaderMaterial,
  type IUniform,
} from 'three';

export type ParticleKind = 'fire' | 'dust' | 'splinter' | 'spark';

/** Shared clock for every FX shader: one uniform written once per frame. */
export type TimeUniform = IUniform<number>;

const VERT = /* glsl */ `
  uniform float uTime;
  attribute vec4 aSpawn; // xyz = spawn position, w = spawn time
  attribute vec4 aVel;   // xyz = velocity, w = life (s)
  attribute vec4 aMisc;  // x = size, y = spin (rad/s), z = seed, w = gravity
  varying vec3 vColor;

  vec3 rotateAround(vec3 v, vec3 axis, float a) {
    float c = cos(a);
    float s = sin(a);
    return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
  }

  vec3 ramp(float k, float seed) {
    #if KIND == 0
      // fire: white-hot -> yellow -> orange -> dark red, quantised (toon)
      float q = floor(k * 4.0) / 3.0;
      vec3 a = vec3(1.0, 0.96, 0.62);
      vec3 b = vec3(1.0, 0.72, 0.18);
      vec3 c = vec3(0.98, 0.4, 0.1);
      vec3 d = vec3(0.42, 0.14, 0.09);
      return q < 0.34 ? mix(a, b, q * 3.0) : (q < 0.67 ? mix(b, c, (q - 0.34) * 3.0) : mix(c, d, (q - 0.67) * 3.0));
    #elif KIND == 1
      // dust: warm beige, a touch darker as it ages
      return mix(vec3(0.97, 0.9, 0.76), vec3(0.78, 0.7, 0.6), k) * (0.92 + 0.08 * sin(seed * 31.0));
    #elif KIND == 2
      // splinters: three wood tones
      float t = fract(seed * 3.7);
      return t < 0.34 ? vec3(0.82, 0.56, 0.28) : (t < 0.67 ? vec3(0.62, 0.4, 0.19) : vec3(0.9, 0.7, 0.4));
    #else
      // sparks: bright yellow, then orange
      return mix(vec3(1.0, 0.92, 0.35), vec3(1.0, 0.55, 0.15), k);
    #endif
  }

  float sizeCurve(float k) {
    #if KIND == 0
      return smoothstep(0.0, 0.12, k) * (1.0 - smoothstep(0.55, 1.0, k));
    #elif KIND == 1
      return smoothstep(0.0, 0.25, k) * (1.0 - smoothstep(0.6, 1.0, k)) * 1.0 + 0.05;
    #else
      return 1.0 - smoothstep(0.7, 1.0, k);
    #endif
  }

  void main() {
    float age = uTime - aSpawn.w;
    float life = aVel.w;
    if (age < 0.0 || age > life) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // dead slot: outside clip space
      return;
    }
    float k = age / life;
    #if KIND == 1 || KIND == 0
      // air drag: they slow down quickly
      float drag = 2.5;
      vec3 p = aSpawn.xyz + aVel.xyz * ((1.0 - exp(-drag * age)) / drag);
      p.y -= 0.5 * aMisc.w * age * age;
    #else
      vec3 p = aSpawn.xyz + aVel.xyz * age;
      p.y -= 0.5 * aMisc.w * age * age;
    #endif
    float seed = aMisc.z;
    vec3 axis = normalize(vec3(sin(seed * 12.9), cos(seed * 7.3) + 0.2, sin(seed * 5.1)));
    vec3 local = rotateAround(position * aMisc.x * sizeCurve(k), axis, aMisc.y * age + seed * 6.0);
    // never sink into the floor
    p.y = max(p.y, 0.02 + aMisc.x * 0.3);
    vColor = ramp(k, seed);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p + local, 1.0);
  }
`;

const FRAG = /* glsl */ `
  varying vec3 vColor;
  void main() { gl_FragColor = vec4(vColor, 1.0); }
`;

const KIND_ID: Record<ParticleKind, number> = {
  fire: 0,
  dust: 1,
  splinter: 2,
  spark: 3,
};

function geometryFor(kind: ParticleKind): BufferGeometry {
  if (kind === 'splinter') return new BoxGeometry(1, 0.3, 0.16);
  if (kind === 'spark') return new BoxGeometry(1, 1, 1);
  return new IcosahedronGeometry(1, 0).toNonIndexed();
}

/**
 * One ring buffer of GPU particles of one kind: a single InstancedMesh. Spawning writes one slot of three instanced
 * attributes (position + time, velocity + life, size / spin / seed / gravity); motion, size, colour and death are all
 * computed in the vertex shader from the shared clock, so the CPU does nothing per particle per frame and a blast costs
 * the same however many particles are alive. Dead slots collapse outside clip space. The oldest slot is reused when the
 * buffer is full (graceful under a 60-TNT chain).
 */
export class ParticleSystem {
  readonly mesh: InstancedMesh;
  private readonly spawn: InstancedBufferAttribute;
  private readonly vel: InstancedBufferAttribute;
  private readonly misc: InstancedBufferAttribute;
  private head = 0;
  /** Slots written at least once: only these are drawn (the rest of the pool costs nothing until a chain needs it). */
  private used = 0;
  private dirty = false;
  private readonly material: ShaderMaterial;

  constructor(
    readonly kind: ParticleKind,
    readonly capacity: number,
    time: TimeUniform,
  ) {
    const geo = geometryFor(kind);
    this.spawn = new InstancedBufferAttribute(
      new Float32Array(capacity * 4),
      4,
    );
    this.vel = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.misc = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    // every slot starts dead: spawn time far in the future, life 0
    for (let i = 0; i < capacity; i++) this.spawn.setW(i, 1e9);
    geo.setAttribute('aSpawn', this.spawn);
    geo.setAttribute('aVel', this.vel);
    geo.setAttribute('aMisc', this.misc);
    this.material = new ShaderMaterial({
      uniforms: { uTime: time },
      vertexShader: VERT,
      fragmentShader: FRAG,
      defines: { KIND: KIND_ID[kind] },
    });
    this.mesh = new InstancedMesh(geo, this.material, capacity);
    this.mesh.frustumCulled = false;
    const id = new Matrix4();
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, id);
    this.mesh.renderOrder = 3;
    this.mesh.count = 0;
  }

  /** Spawn one particle at `(x, y, z)` with velocity `(vx, vy, vz)` m/s at clock time `t`. */
  emit(
    t: number,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size: number,
    seed: number,
    spin = 0,
    gravity = 0,
  ): void {
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    if (this.used < this.capacity) this.used = Math.max(this.used, i + 1);
    this.spawn.setXYZW(i, x, y, z, t);
    this.vel.setXYZW(i, vx, vy, vz, life);
    this.misc.setXYZW(i, size, spin, seed, gravity);
    this.dirty = true;
  }

  /** Upload spawns written since the last call (one small buffer upload, only on frames that spawned something). */
  flush(): void {
    this.mesh.count = this.used;
    if (!this.dirty) return;
    this.dirty = false;
    this.spawn.needsUpdate = true;
    this.vel.needsUpdate = true;
    this.misc.needsUpdate = true;
  }

  /** Kill everything (new round). */
  clear(): void {
    for (let i = 0; i < this.capacity; i++) this.spawn.setW(i, 1e9);
    this.spawn.needsUpdate = true;
    this.used = 0;
    this.mesh.count = 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
