import {
  AddEquation,
  BoxGeometry,
  BufferGeometry,
  CustomBlending,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  ShaderMaterial,
  type IUniform,
} from 'three';
import { PUFF_GLSL, puffAtlas } from './puff-atlas';

/**
 * Particle kinds. Sprites face the camera (fire, dust, smoke, flash), sparks are streaks stretched along their motion,
 * ring / scorch lie flat on the floor, splinters are little lit boards.
 */
export type ParticleKind =
  | 'fire'
  | 'dust'
  | 'splinter'
  | 'spark'
  | 'smoke'
  | 'flash'
  | 'ring'
  | 'scorch';

/** Shared clock for every FX shader: one uniform written once per frame. */
export type TimeUniform = IUniform<number>;

const KIND_ID: Record<ParticleKind, number> = {
  fire: 0,
  dust: 1,
  splinter: 2,
  spark: 3,
  smoke: 4,
  flash: 5,
  ring: 6,
  scorch: 7,
};

/** Draw order among the see-through FX: scorch under everything, then ring, smoke / dust, fire, sparks, flash on top. */
const ORDER: Record<ParticleKind, number> = {
  scorch: 1,
  ring: 2,
  dust: 3,
  smoke: 3,
  splinter: 3,
  fire: 5,
  spark: 6,
  flash: 7,
};

const VERT = /* glsl */ `
  uniform float uTime;
  attribute vec4 aSpawn; // xyz = spawn position, w = spawn time
  attribute vec4 aVel;   // xyz = velocity, w = life (s)
  attribute vec4 aMisc;  // x = size, y = spin (rad/s), z = seed, w = gravity (negative = rises)
  varying vec2 vUv;
  varying float vK;
  varying float vSeed;
  varying vec3 vColor;

  vec3 rotateAround(vec3 v, vec3 axis, float a) {
    float c = cos(a);
    float s = sin(a);
    return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
  }

  float sizeCurve(float k) {
    #if KIND == 0
      return mix(0.45, 1.0, smoothstep(0.0, 0.22, k)) * (1.0 - 0.35 * k);
    #elif KIND == 1
      return 0.55 + 0.75 * smoothstep(0.0, 0.7, k);
    #elif KIND == 4
      return 0.5 + 1.3 * (1.0 - exp(-2.2 * k));
    #elif KIND == 5
      return 0.7 + 0.5 * k;
    #elif KIND == 6
      return (1.0 - exp(-7.0 * k)) / (1.0 - exp(-7.0));
    #elif KIND == 7
      return 1.0;
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
    float seed = aMisc.z;
    vK = k;
    vSeed = seed;
    vColor = vec3(1.0);
    #if KIND == 0 || KIND == 1 || KIND == 4
      // air drag: puffs slow down quickly, then drift (gravity < 0 = buoyant)
      float drag = 2.6;
      vec3 p = aSpawn.xyz + aVel.xyz * ((1.0 - exp(-drag * age)) / drag);
    #else
      vec3 p = aSpawn.xyz + aVel.xyz * age;
    #endif
    p.y -= 0.5 * aMisc.w * age * age;
    float size = aMisc.x * sizeCurve(k);

    #if KIND == 2
      // splinter: a tumbling board, lit by a fixed sun so it reads as 3D
      vec3 axis = normalize(vec3(sin(seed * 12.9), cos(seed * 7.3) + 0.2, sin(seed * 5.1)));
      float a = aMisc.y * age + seed * 6.0;
      vec3 local = rotateAround(position * size, axis, a);
      vec3 n = rotateAround(normal, axis, a);
      float t = fract(seed * 3.7);
      vec3 wood = t < 0.34 ? vec3(0.82, 0.56, 0.28) : (t < 0.67 ? vec3(0.62, 0.4, 0.19) : vec3(0.9, 0.7, 0.4));
      vColor = wood * (0.55 + 0.6 * max(dot(n, normalize(vec3(-0.4, 0.85, 0.35))), 0.0));
      p.y = max(p.y, 0.02 + size * 0.3);
      gl_Position = projectionMatrix * viewMatrix * vec4(p + local, 1.0);
    #elif KIND == 6 || KIND == 7
      // flat on the floor
      vUv = position.xy + 0.5;
      float r = seed * 6.2832;
      vec2 c = mat2(cos(r), -sin(r), sin(r), cos(r)) * position.xy * size * 2.0;
      gl_Position = projectionMatrix * viewMatrix * vec4(p.x + c.x, p.y, p.z + c.y, 1.0);
    #elif KIND == 3
      // spark: a streak along its screen-space motion
      vec3 vel = aVel.xyz - vec3(0.0, aMisc.w * age, 0.0);
      p.y = max(p.y, 0.03);
      vec4 mv = viewMatrix * vec4(p, 1.0);
      vec2 dir = (viewMatrix * vec4(vel, 0.0)).xy;
      float speed = length(dir);
      dir = speed > 1e-4 ? dir / speed : vec2(1.0, 0.0);
      vec2 side = vec2(-dir.y, dir.x);
      float len = size * (1.0 + speed * 0.9);
      vUv = position.xy + 0.5;
      mv.xy += dir * (position.x * len - len * 0.35) + side * position.y * size * 0.9;
      gl_Position = projectionMatrix * mv;
    #else
      // camera-facing sprite, turned by its seed (+ spin) so no two puffs match
      p.y = max(p.y, size * 0.3);
      vec4 mv = viewMatrix * vec4(p, 1.0);
      float r = seed * 6.2832 + aMisc.y * age;
      vec2 c = mat2(cos(r), -sin(r), sin(r), cos(r)) * position.xy;
      vUv = position.xy + 0.5;
      if (fract(seed * 7.13) > 0.5) vUv.x = 1.0 - vUv.x;
      mv.xy += c * size * 2.0;
      gl_Position = projectionMatrix * mv;
    #endif
  }
`;

const FRAG = /* glsl */ `
  varying vec2 vUv;
  varying float vK;
  varying float vSeed;
  varying vec3 vColor;
  ${PUFF_GLSL}

  void main() {
    float k = vK;
    #if KIND == 2
      gl_FragColor = vec4(vColor, 1.0);
    #elif KIND == 0
      // fire puff: hot and dense when young, cooling to deep red and thinning out
      vec2 pf = puffAt(vUv, k * k * 0.8 + vSeed * 0.12);
      float d = pf.r;
      float heat = clamp(d * (1.1 - k * 1.0) + 0.05, 0.0, 1.0);
      vec3 c = fireRamp(heat) * (1.1 - 0.3 * k);
      float a = d * (1.0 - smoothstep(0.7, 1.0, k));
      // premultiplied, mostly additive: it glows over the floor but still has some body
      gl_FragColor = vec4(c * a, a * 0.75);
    #elif KIND == 1 || KIND == 4
      vec2 pf = puffAt(vUv, 0.08 + k * 0.4);
      #if KIND == 1
        vec3 dark = vec3(0.66, 0.58, 0.47);
        vec3 light = vec3(0.98, 0.93, 0.82);
        float strength = 0.75;
      #else
        vec3 dark = vec3(0.24, 0.22, 0.21);
        vec3 light = vec3(0.66, 0.63, 0.6);
        float strength = 0.62;
      #endif
      vec3 c = mix(dark, light, pf.g);
      float a = pf.r * strength * smoothstep(0.0, 0.08, k) * (1.0 - smoothstep(0.5, 1.0, k));
      gl_FragColor = vec4(c * a, a);
    #elif KIND == 3
      // spark streak: a hot core line, fading along its tail
      float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
      float along = smoothstep(0.0, 0.6, vUv.x) * (1.0 - smoothstep(0.85, 1.0, vUv.x));
      float g = across * across * along;
      vec3 c = mix(vec3(1.0, 0.95, 0.7), vec3(1.0, 0.5, 0.12), k);
      gl_FragColor = vec4(c * g * 2.2 * (1.0 - k * 0.5), 0.0);
    #elif KIND == 5
      // flash: a soft white-hot glow, gone in a blink
      float r = length(vUv - 0.5) * 2.0;
      float g = exp(-r * r * 3.5) * (1.0 - k) * (1.0 - k);
      gl_FragColor = vec4(vec3(1.0, 0.86, 0.6) * g * 1.5, 0.0);
    #elif KIND == 6
      // shockwave: a bright band racing outwards over the floor
      float r = length(vUv - 0.5) * 2.0;
      float band = smoothstep(0.62, 0.9, r) * (1.0 - smoothstep(0.9, 1.0, r));
      float fade = pow(1.0 - k, 1.6);
      gl_FragColor = vec4(vec3(1.0, 0.82, 0.55) * band * fade * 1.1, band * fade * 0.25);
    #else
      // scorch: a sooty blotch with a ragged edge, fading away slowly
      float r = length(vUv - 0.5) * 2.0;
      float fine = texture2D(uPuff, vUv * 0.25 + vec2(0.5, 0.5)).b;
      float a = (1.0 - smoothstep(0.3, 0.95, r + (fine - 0.5) * 0.5)) * 0.78;
      a *= smoothstep(0.0, 0.05, k) * (1.0 - smoothstep(0.55, 1.0, k));
      gl_FragColor = vec4(vec3(0.07, 0.05, 0.04) * a, a);
    #endif
  }
`;

function geometryFor(kind: ParticleKind): BufferGeometry {
  if (kind === 'splinter') return new BoxGeometry(1, 0.3, 0.16);
  // sprites, streaks and floor decals: one quad, the shader places it
  return new PlaneGeometry(1, 1);
}

/**
 * One ring buffer of GPU particles of one kind: a single InstancedMesh. Spawning writes one slot of three instanced
 * attributes (position + time, velocity + life, size / spin / seed / gravity); motion, size, colour and death are all
 * computed in the vertex shader from the shared clock, so the CPU does nothing per particle per frame and a blast costs
 * the same however many particles are alive. Dead slots collapse outside clip space. The oldest slot is reused when the
 * buffer is full (graceful under a 60-TNT chain). Soft kinds read the shared puff flipbook (`puff-atlas.ts`) and blend
 * premultiplied (glowing fire and sparks, see-through smoke) without writing depth.
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
    const soft = kind !== 'splinter';
    this.material = new ShaderMaterial({
      uniforms: { uTime: time, uPuff: { value: puffAtlas() } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      defines: { KIND: KIND_ID[kind] },
      transparent: soft,
      depthWrite: !soft,
      blending: soft ? CustomBlending : undefined,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
    });
    this.mesh = new InstancedMesh(geo, this.material, capacity);
    this.mesh.frustumCulled = false;
    const id = new Matrix4();
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, id);
    this.mesh.renderOrder = ORDER[kind];
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
