import {
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
  Vector4,
  type BufferGeometry,
} from 'three';

/** Height of the sea surface under the raft (the tiles' tops are at 0). */
export const WATER_Y = -0.8;
/** Edge of the water plane: far more than the camera ever sees. */
const WATER_SIZE = 280;
/** Splashes the water remembers at once (a ring buffer). */
const RIPPLES = 12;
/** Seconds a splash ring takes to fade. */
export const RIPPLE_S = 2.2;

const VERT = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorld;
  varying vec3 vN;
  // three drifting swells: the height and (by finite differences) the slope
  float swell(vec2 p, float t) {
    return 0.032 * sin(p.x * 0.9 + t * 1.1)
         + 0.022 * sin(p.y * 1.3 - t * 1.4 + 1.7)
         + 0.014 * sin((p.x + p.y) * 2.1 + t * 2.3);
  }
  void main() {
    vec3 p = position;
    float e = 0.06;
    float h0 = swell(p.xz, uTime);
    float hx = swell(p.xz + vec2(e, 0.0), uTime);
    float hz = swell(p.xz + vec2(0.0, e), uTime);
    p.y += h0;
    vN = normalize(vec3(-(hx - h0) / e, 1.0, -(hz - h0) / e));
    vec4 w = modelMatrix * vec4(p, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec2 uHalf;
  uniform vec4 uRip[${RIPPLES}];
  varying vec3 vWorld;
  varying vec3 vN;
  float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  }
  void main() {
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 N = normalize(vN);
    float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    float d = sdBox(vWorld.xz, uHalf);
    vec3 shallow = vec3(0.04, 0.30, 0.38);
    vec3 deep = vec3(0.012, 0.115, 0.2);
    vec3 col = mix(shallow, deep, smoothstep(0.0, 28.0, d));
    col = mix(col, vec3(0.45, 0.7, 0.8), fres * 0.4);
    #ifndef LOW
    // fine glitter that drifts with the swell, and the sun's glint (skipped on the low tier: fill rate)
    float g = sin(vWorld.x * 3.1 + uTime * 1.3) * sin(vWorld.z * 2.7 - uTime * 1.1)
            + sin((vWorld.x - vWorld.z) * 4.3 + uTime * 1.9);
    col += 0.018 * g;
    vec3 L = normalize(vec3(-0.5, 1.0, 0.7));
    col += vec3(1.0, 0.92, 0.75) * pow(max(dot(reflect(-L, N), V), 0.0), 70.0) * 0.55;
    #endif
    // in the raft's shade
    col *= 1.0 - 0.55 * smoothstep(0.1, -0.5, d);
    // foam lapping at the raft's edge
    float lap = 0.5 + 0.5 * sin(vWorld.x * 5.0 + vWorld.z * 3.0 + uTime * 2.0);
    float foam = smoothstep(0.5 + 0.22 * lap, 0.0, d) * smoothstep(-0.25, 0.05, d);
    col = mix(col, vec3(0.82, 0.93, 0.95), foam * 0.75);
    // splashes: a foam blob where the tile went in, a ring racing outwards
    for (int i = 0; i < ${RIPPLES}; i++) {
      vec4 r = uRip[i];
      float age = uTime - r.z;
      if (age > 0.0 && age < ${RIPPLE_S.toFixed(1)}) {
        float dist = length(vWorld.xz - r.xy);
        float k = age / ${RIPPLE_S.toFixed(1)};
        float ring = smoothstep(0.2, 0.0, abs(dist - age * 2.4)) * (1.0 - k);
        float blob = smoothstep(0.75, 0.0, dist) * (1.0 - smoothstep(0.35, 0.9, k));
        col = mix(col, vec3(0.9, 0.97, 0.98), clamp(ring * 0.7 + blob * 0.85, 0.0, 1.0));
      }
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

let geo: BufferGeometry | null = null;

/** The sea under the raft and out to the horizon: one plane, waves and glitter in the shaders, no texture. */
export class Sea {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private readonly ripples: Vector4[] = [];
  private head = 0;

  /** `hx`, `hz` = half extents of the raft incl. its margin (the shaded patch and the foam follow it). */
  constructor(hx: number, hz: number, low: boolean) {
    geo ??= new PlaneGeometry(WATER_SIZE, WATER_SIZE, 140, 140).rotateX(
      -Math.PI / 2,
    );
    for (let i = 0; i < RIPPLES; i++)
      this.ripples.push(new Vector4(0, 0, 1e9, 0));
    this.material = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uHalf: { value: new Vector2(hx, hz) },
        uRip: { value: this.ripples },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      defines: low ? { LOW: '' } : {},
    });
    this.mesh = new Mesh(
      low
        ? new PlaneGeometry(WATER_SIZE, WATER_SIZE, 70, 70).rotateX(
            -Math.PI / 2,
          )
        : geo,
      this.material,
    );
    this.mesh.position.y = WATER_Y;
    this.mesh.frustumCulled = false;
  }

  update(t: number): void {
    this.material.uniforms.uTime.value = t;
  }

  /** A tile hits the water at world `(x, z)` at clock time `t`. */
  ripple(x: number, z: number, t: number): void {
    this.ripples[this.head].set(x, z, t, 0);
    this.head = (this.head + 1) % RIPPLES;
  }

  dispose(): void {
    this.material.dispose();
    if (this.mesh.geometry !== geo) this.mesh.geometry.dispose();
  }
}
