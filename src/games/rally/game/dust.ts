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
import { WORLD_SHADING_DECL, worldUniforms } from '../engine/world-shading';

/**
 * Pooled GPU point-sprite particles for dust clouds / gravel spray.
 * One draw call for the whole system; CPU updates positions in place.
 *
 * Lit like the world: `setLight(sun, ambient)` -> ambient + sun, brighter (and the sun's colour) when the camera
 * looks towards the sun through the particle (forward scattering: backlit dust glows). Each sprite spins slowly.
 * `ground` (optional): particles bounce off it and stay down (gravel); otherwise they fly through the terrain.
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
  private spin: Float32Array;
  private spinRate: Float32Array;
  private next = 0;
  private alive = 0;
  readonly material: ShaderMaterial;

  constructor(
    readonly max: number,
    additive = false,
    private ground?: (x: number, z: number) => number,
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
    this.spin = new Float32Array(max);
    this.spinRate = new Float32Array(max);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3));
    g.setAttribute('color', new BufferAttribute(this.col, 3));
    g.setAttribute('size', new BufferAttribute(this.size, 1));
    g.setAttribute('alpha', new BufferAttribute(this.alpha, 1));
    g.setAttribute('spin', new BufferAttribute(this.spin, 1));
    this.material = new ShaderMaterial({
      uniforms: UniformsUtils.merge([
        UniformsLib.fog,
        {
          map: { value: getTexture('dust') },
          uScale: { value: 600 },
          uLight: { value: new Color(1, 1, 1) },
          // Unlit until setLight (ambient 1, no sun) = the old flat look.
          uSun: { value: new Color(0, 0, 0) },
          uAmbient: { value: new Color(1, 1, 1) },
        },
      ]),
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float alpha;
        attribute float spin;
        attribute vec3 color;
        varying float vAlpha;
        varying float vSpin;
        varying vec3 vColor;
        varying vec3 vRay;
        uniform float uScale;
        #include <fog_pars_vertex>
        void main() {
          vAlpha = alpha;
          vSpin = spin;
          vColor = color;
          vRay = ( modelMatrix * vec4( position, 1.0 ) ).xyz - cameraPosition;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / max(0.5, -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        uniform vec3 uLight;
        uniform vec3 uSun;
        uniform vec3 uAmbient;
        ${WORLD_SHADING_DECL}
        varying float vAlpha;
        varying float vSpin;
        varying vec3 vColor;
        varying vec3 vRay;
        #include <fog_pars_fragment>
        void main() {
          float c = cos( vSpin ), s = sin( vSpin );
          vec2 pc = mat2( c, s, -s, c ) * ( gl_PointCoord - 0.5 ) + 0.5;
          float a = texture2D( map, clamp( pc, 0.0, 1.0 ) ).a * vAlpha;
          if (a < 0.01) discard;
          // Forward scattering towards the camera when it looks at the sun through the dust.
          float toSun = max( dot( normalize( vRay ), wsSunDir ), 0.0 );
          float scatter = 0.75 + 1.6 * toSun * toSun * toSun * toSun * toSun;
          gl_FragColor = vec4( vColor * uLight * ( uAmbient + uSun * scatter ), a );
          #include <fog_fragment>
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: additive ? AdditiveBlending : NormalBlending,
    });
    // Height fog / sun glow / sun direction like the world (engine/world-shading.ts): shared uniform objects.
    Object.assign(this.material.uniforms, worldUniforms);
    this.points = new Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  /** Light the particles: sun colour x intensity scale and the ambient (sky) colour. */
  setLight(sun: Color, ambient: Color): void {
    this.material.uniforms.uSun.value.copy(sun);
    this.material.uniforms.uAmbient.value.copy(ambient);
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
    this.spin[i] = Math.random() * Math.PI * 2;
    this.spinRate[i] = (Math.random() - 0.5) * 1.2;
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
      if (this.ground) {
        const gy =
          this.ground(this.pos[k], this.pos[k + 2]) + this.size[i] * 0.5;
        if (this.pos[k + 1] < gy) {
          // Bounce once or twice, then lie on the ground.
          this.pos[k + 1] = gy;
          this.vel[k + 1] =
            Math.abs(this.vel[k + 1]) > 1 ? -this.vel[k + 1] * 0.3 : 0;
          this.vel[k] *= 0.45;
          this.vel[k + 2] *= 0.45;
        }
      }
      this.spin[i] += this.spinRate[i] * dt;
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
    g.getAttribute('spin').needsUpdate = true;
  }

  get aliveCount(): number {
    return this.alive;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
