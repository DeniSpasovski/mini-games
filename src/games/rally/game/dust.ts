import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  NormalBlending,
  Points,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  type Vector3,
} from 'three';
import { getTexture } from '../engine/textures';

/**
 * Pooled GPU point-sprite particles for dust clouds / gravel spray.
 * One draw call for the whole system; CPU updates positions in place.
 */
export class ParticleSystem {
  readonly points: Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private grow: Float32Array;
  private baseAlpha: Float32Array;
  private next = 0;
  private alive = 0;
  readonly material: ShaderMaterial;

  constructor(
    readonly max: number,
    additive = false,
  ) {
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.baseAlpha = new Float32Array(max);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3));
    g.setAttribute('color', new BufferAttribute(this.col, 3));
    g.setAttribute('size', new BufferAttribute(this.size, 1));
    g.setAttribute('alpha', new BufferAttribute(this.alpha, 1));
    this.material = new ShaderMaterial({
      uniforms: UniformsUtils.merge([
        UniformsLib.fog,
        {
          map: { value: getTexture('dust') },
          uScale: { value: 600 },
          uLight: { value: new Color(1, 1, 1) },
        },
      ]),
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float alpha;
        attribute vec3 color;
        varying float vAlpha;
        varying vec3 vColor;
        uniform float uScale;
        #include <fog_pars_vertex>
        void main() {
          vAlpha = alpha;
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / max(0.5, -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        uniform vec3 uLight;
        varying float vAlpha;
        varying vec3 vColor;
        #include <fog_pars_fragment>
        void main() {
          float a = texture2D(map, gl_PointCoord).a * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor * uLight, a);
          #include <fog_fragment>
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: additive ? AdditiveBlending : NormalBlending,
    });
    this.points = new Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  /** Projection scale so `size` is in world metres. Call on resize / FOV change. */
  setViewport(heightPx: number, fovDeg: number): void {
    this.material.uniforms.uScale.value =
      heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  emit(
    p: Vector3,
    vx: number,
    vy: number,
    vz: number,
    size: number,
    grow: number,
    life: number,
    color: Color,
    alpha: number,
  ): void {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = color.r;
    this.col[i * 3 + 1] = color.g;
    this.col[i * 3 + 2] = color.b;
    this.size[i] = size;
    this.grow[i] = grow;
    this.age[i] = 0;
    this.life[i] = life;
    this.baseAlpha[i] = alpha;
    this.alpha[i] = 0;
  }

  update(dt: number, drag = 1.6, gravity = -0.3): void {
    const damp = Math.exp(-drag * dt);
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      const a = (this.age[i] += dt);
      const t = a / this.life[i];
      if (t >= 1) {
        this.life[i] = 0;
        this.alpha[i] = 0;
        continue;
      }
      alive++;
      const k = i * 3;
      this.vel[k] *= damp;
      this.vel[k + 1] = this.vel[k + 1] * damp + gravity * dt;
      this.vel[k + 2] *= damp;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      this.size[i] += this.grow[i] * dt * (1 - t);
      // Quick fade in, long fade out.
      this.alpha[i] =
        this.baseAlpha[i] * Math.min(1, t * 8) * (1 - t) * (1 - t);
    }
    this.alive = alive;
    const g = this.points.geometry;
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('size').needsUpdate = true;
    g.getAttribute('alpha').needsUpdate = true;
    g.getAttribute('color').needsUpdate = true;
  }

  get aliveCount(): number {
    return this.alive;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
