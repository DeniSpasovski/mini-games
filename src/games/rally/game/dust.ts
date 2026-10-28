import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  Color,
  NormalBlending,
  Points,
  type Texture,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from 'three';
import { imageTexture } from '../engine/image-texture';
import dustUrl from '../engine/particles/dust.webp';
import { WORLD_SHADING_DECL, worldUniforms } from '../engine/world-shading';

let dustTex: Texture | undefined;
/** The puff atlas: 2 x 2 smoke sprites from Kenney's Particle Pack (CC0; scripts/particles/bake-dust.py), alpha only. */
function dustTexture(): Texture {
  if (!dustTex) {
    dustTex = imageTexture(
      dustUrl,
      512,
      512,
      'dust',
      'rgba(255,255,255,0)',
      false,
    );
    dustTex.wrapS = dustTex.wrapT = ClampToEdgeWrapping;
  }
  return dustTex;
}

/**
 * Pooled GPU point-sprite particles for dust clouds / gravel spray.
 * One draw call for the whole system; CPU updates positions in place.
 *
 * Lit like the world: `setLight(sun, ambient)` -> ambient + sun, brighter (and the sun's colour) when the camera
 * looks towards the sun through the particle (forward scattering: backlit dust glows). Each sprite spins slowly.
 * `ground` (optional): particles bounce off it and stay down (gravel); otherwise they fly through the terrain.
 * `floor` (optional): the surface each sprite fades into (soft edge, per pixel) instead of being cut off by it; sampled
 * at emit and every few frames after.
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
  private frame: Float32Array;
  private floorY: Float32Array;
  private next = 0;
  private tick = 0;
  private alive = 0;
  readonly material: ShaderMaterial;

  constructor(
    readonly max: number,
    additive = false,
    private ground?: (x: number, z: number) => number,
    private floor?: (x: number, z: number) => number,
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
    this.frame = new Float32Array(max);
    this.floorY = new Float32Array(max).fill(-1e6);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3));
    g.setAttribute('color', new BufferAttribute(this.col, 3));
    g.setAttribute('size', new BufferAttribute(this.size, 1));
    g.setAttribute('alpha', new BufferAttribute(this.alpha, 1));
    g.setAttribute('spin', new BufferAttribute(this.spin, 1));
    g.setAttribute('frame', new BufferAttribute(this.frame, 1));
    g.setAttribute('floorY', new BufferAttribute(this.floorY, 1));
    this.material = new ShaderMaterial({
      uniforms: UniformsUtils.merge([
        UniformsLib.fog,
        {
          map: { value: dustTexture() },
          uScale: { value: 600 },
          uLight: { value: new Color(1, 1, 1) },
          // Unlit until setLight (ambient 1, no sun) = the old flat look.
          uSun: { value: new Color(0, 0, 0) },
          uAmbient: { value: new Color(1, 1, 1) },
          // Headlight beam at night: colour (black = off), lamp position and aim in world space.
          uHead: { value: new Color(0, 0, 0) },
          uHeadPos: { value: new Vector3() },
          uHeadDir: { value: new Vector3(0, 0, 1) },
          // Tail lamps' red glow at night: colour x level (black = off) and lamp position in world space.
          uTail: { value: new Color(0, 0, 0) },
          uTailPos: { value: new Vector3() },
        },
      ]),
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float alpha;
        attribute float spin;
        attribute float frame;
        attribute float floorY;
        attribute vec3 color;
        varying float vAlpha;
        varying float vFloor;
        varying float vSize;
        varying vec2 vUpY;
        varying float vSpin;
        varying vec2 vCell;
        varying vec3 vColor;
        varying vec3 vRay;
        varying vec3 vWorld;
        uniform float uScale;
        #include <fog_pars_vertex>
        void main() {
          vAlpha = alpha;
          vSpin = spin;
          vCell = vec2( mod( frame, 2.0 ), floor( frame / 2.0 ) ) * 0.5;
          vColor = color;
          vWorld = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
          // Height of the centre above its floor, and how far the sprite's x / y axes (camera right / up) rise.
          vSize = size;
          vFloor = vWorld.y - floorY;
          vUpY = vec2( viewMatrix[ 1 ][ 0 ], viewMatrix[ 1 ][ 1 ] );
          vRay = vWorld - cameraPosition;
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
        uniform vec3 uHead;
        uniform vec3 uHeadPos;
        uniform vec3 uHeadDir;
        uniform vec3 uTail;
        uniform vec3 uTailPos;
        ${WORLD_SHADING_DECL}
        varying float vAlpha;
        varying float vFloor;
        varying float vSize;
        varying vec2 vUpY;
        varying float vSpin;
        varying vec2 vCell;
        varying vec3 vColor;
        varying vec3 vRay;
        varying vec3 vWorld;
        #include <fog_pars_fragment>
        void main() {
          float c = cos( vSpin ), s = sin( vSpin );
          vec2 pc = mat2( c, s, -s, c ) * ( gl_PointCoord - 0.5 ) + 0.5;
          // This particle's puff in the 2 x 2 atlas (each cell fades to 0 at its border).
          float a = texture2D( map, vCell + clamp( pc, 0.0, 1.0 ) * 0.5 ).a * vAlpha;
          // Soft edge on the floor: this pixel's height above it on the camera-facing sprite (point y runs down).
          vec2 q = ( gl_PointCoord - 0.5 ) * vSize;
          a *= smoothstep( 0.0, min( 0.3 * vSize, 0.8 ), vFloor + q.x * vUpY.x - q.y * vUpY.y );
          if (a < 0.01) discard;
          // Forward scattering towards the camera when it looks at the sun through the dust.
          float toSun = max( dot( normalize( vRay ), wsSunDir ), 0.0 );
          float scatter = 0.75 + 1.6 * toSun * toSun * toSun * toSun * toSun;
          // Dust, spray and haze inside the headlight beam glow (night).
          vec3 toP = vWorld - uHeadPos;
          float dHead = max( length( toP ), 0.5 );
          float cone = smoothstep( 0.9, 0.97, dot( toP / dHead, uHeadDir ) );
          vec3 head = uHead * cone * ( 6.0 / ( 1.0 + dHead * 0.08 ) );
          // The tail lamps tint the dust right behind the car red (braking at night).
          float dTail = length( vWorld - uTailPos );
          vec3 tail = uTail * ( 2.5 / ( 1.0 + dTail * dTail * 0.3 ) );
          gl_FragColor = vec4( vColor * uLight * ( uAmbient + uSun * scatter + head + tail ), a );
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

  /** Night: the car's headlight beam (world-space lamp position and aim) lights the particles inside it; black = off. */
  setHeadlight(color: Color, pos: Vector3, dir: Vector3): void {
    const u = this.material.uniforms;
    u.uHead.value.copy(color);
    u.uHeadPos.value.copy(pos);
    u.uHeadDir.value.copy(dir);
  }

  /** Night: the tail lamps' red glow (colour x level, world-space lamp position) tints the particles near the car; black = off. */
  setTaillight(color: Color, pos: Vector3): void {
    const u = this.material.uniforms;
    u.uTail.value.copy(color);
    u.uTailPos.value.copy(pos);
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
    this.frame[i] = Math.floor(Math.random() * 4);
    this.floorY[i] = this.floor ? this.floor(p.x, p.z) : -1e6;
  }

  update(dt: number, drag = 1.6, gravity = -0.3): void {
    const damp = Math.exp(-drag * dt);
    // An eighth of the pool re-samples its floor per frame (they drift slowly).
    const slot = this.tick++ & 7;
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
      if (this.floor && (i & 7) === slot)
        this.floorY[i] = this.floor(this.pos[k], this.pos[k + 2]);
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
    g.getAttribute('frame').needsUpdate = true;
    g.getAttribute('floorY').needsUpdate = true;
  }

  get aliveCount(): number {
    return this.alive;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
