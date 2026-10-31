import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  type Color,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type PerspectiveCamera,
  type Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from 'three';

/**
 * Sun glare: looking towards a low sun, a veiling glow round it and a few faint lens ghosts along the line from the sun
 * through the middle of the screen, dimmed by how much of the sun the world in front of it (trees, hills, buildings)
 * leaves in view.
 *
 * - **How much sun is seen:** PROBES tiny quads on a small disc round the sun, drawn last in the main pass with the
 *   depth test on and no colour, each inside a WebGL occlusion query. Their results arrive a frame or two later and
 *   are eased (EASE), so the glare flickers through a crown instead of popping. Leaf cards write depth, so the sun
 *   through the holes of a crown counts.
 * - **The glare:** one full-screen triangle, added on top of the finished picture, drawn only while the sun is near
 *   the view and some of it is seen.
 *
 * Both are on GLARE_LAYER, which only the game camera sees (not shadow, env-map or other cameras). No other pass, no
 * readback; nothing at all is drawn while the sun is behind the camera.
 */

/** Layer seen only by the game camera (`SunGlare` enables it). */
export const GLARE_LAYER = 7;
/** Probe quads on the disc round the sun, and that disc's angular radius (rad, ~0.6 deg: a branch hides part of it). */
const PROBES = 12;
const DISC = 0.0105;
/** The probes sit this far from the camera (m): inside the sky box (half-size 500 m), past most of the world. */
const PROBE_DISTANCE = 450;
/** Easing rate of the seen share (1/s). */
const EASE = 10;
/** Overall strength (x the sun's colour; display-referred, added after the tone mapping). */
const STRENGTH = 0.6;

const GLARE_VERTEX = /* glsl */ `
  varying vec2 vNdc;
  void main() {
    vNdc = position.xy;
    gl_Position = vec4( position.xy, 0.0, 1.0 );
  }`;

const GLARE_FRAGMENT = /* glsl */ `
  uniform vec2 uSun;
  uniform float uAspect;
  uniform vec3 uColor;
  varying vec2 vNdc;
  // A soft disc of radius r (screen heights) round c.
  float ghost( vec2 c, float r ) {
    float d = length( ( vNdc - c ) * vec2( uAspect, 1.0 ) );
    return 1.0 - smoothstep( r * 0.55, r, d );
  }
  void main() {
    float r = length( ( vNdc - uSun ) * vec2( uAspect, 1.0 ) );
    // Veiling glare: light scattered in the eye / lens, ~1 / r^2 near the sun, and a wide faint haze round it.
    vec3 c = uColor * ( 0.01 / ( r * r + 0.01 ) + 0.05 * exp( - r * 2.2 ) );
    // Ghosts: reflections between lens elements, on the line from the sun through the centre, faintly tinted.
    c += uColor * vec3( 0.55, 0.75, 1.0 ) * ( 0.07 * ghost( uSun * 0.4, 0.07 ) );
    c += uColor * vec3( 1.0, 0.8, 0.5 ) * ( 0.05 * ghost( uSun * -0.25, 0.11 ) );
    c += uColor * vec3( 0.6, 1.0, 0.7 ) * ( 0.06 * ghost( uSun * -0.7, 0.05 ) );
    c += uColor * vec3( 0.7, 0.7, 1.0 ) * ( 0.04 * ghost( uSun * -1.1, 0.16 ) );
    gl_FragColor = vec4( c, 1.0 );
  }`;

export class SunGlare {
  private readonly gl: WebGL2RenderingContext;
  private readonly probes: Mesh[] = [];
  private readonly pending: WebGLQuery[][] = [];
  private readonly free: WebGLQuery[] = [];
  private readonly seenNow: number[] = [];
  private active: WebGLQuery | null = null;
  private readonly glare: Mesh<BufferGeometry, ShaderMaterial>;
  /** Eased share of the probes in view (0..1). */
  private seen = 0;
  private readonly sunNdc = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly at = new Vector3();
  enabled = true;

  constructor(
    renderer: WebGLRenderer,
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
  ) {
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    camera.layers.enable(GLARE_LAYER);
    const quad = new PlaneGeometry(1, 1);
    const probeMat = new MeshBasicMaterial({
      colorWrite: false,
      depthWrite: false,
      fog: false,
    });
    for (let i = 0; i < PROBES; i++) {
      const m = new Mesh(quad, probeMat);
      m.name = 'sun glare probe';
      m.layers.set(GLARE_LAYER);
      m.frustumCulled = false;
      m.renderOrder = 1e6;
      m.visible = false;
      m.onBeforeRender = (_r, _s, cam) => {
        // Only the game camera's pass; a probe waits while it has a few queries in flight.
        if (cam !== this.camera || this.active || this.pending[i].length > 4)
          return;
        const q = this.free.pop() ?? this.gl.createQuery();
        this.gl.beginQuery(this.gl.ANY_SAMPLES_PASSED_CONSERVATIVE, q);
        this.active = q;
      };
      m.onAfterRender = () => {
        if (!this.active) return;
        this.gl.endQuery(this.gl.ANY_SAMPLES_PASSED_CONSERVATIVE);
        this.pending[i].push(this.active);
        this.active = null;
      };
      this.probes.push(m);
      this.pending.push([]);
      this.seenNow.push(0);
      scene.add(m);
    }
    const tri = new BufferGeometry();
    tri.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
    );
    this.glare = new Mesh(
      tri,
      new ShaderMaterial({
        vertexShader: GLARE_VERTEX,
        fragmentShader: GLARE_FRAGMENT,
        uniforms: {
          uSun: { value: new Vector2() },
          uAspect: { value: 1 },
          uColor: { value: new Vector3() },
        },
        blending: AdditiveBlending,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        fog: false,
      }),
    );
    this.glare.name = 'sun glare';
    this.glare.layers.set(GLARE_LAYER);
    this.glare.frustumCulled = false;
    this.glare.renderOrder = 1e6;
    this.glare.visible = false;
    scene.add(this.glare);
  }

  /**
   * Before the frame's render: read finished queries, ease the seen share, place the probes on the sun and set the
   * glare. `strength` 0 = none (night, studio, overcast).
   */
  update(dt: number, sunDir: Vector3, sunColor: Color, strength: number): void {
    const gl = this.gl;
    for (let i = 0; i < PROBES; i++) {
      const list = this.pending[i];
      while (
        list.length &&
        gl.getQueryParameter(list[0], gl.QUERY_RESULT_AVAILABLE)
      ) {
        const q = list.shift()!;
        this.seenNow[i] = gl.getQueryParameter(q, gl.QUERY_RESULT) ? 1 : 0;
        this.free.push(q);
      }
    }
    const cam = this.camera;
    // Where the sun is on screen; off when it is behind the camera or well outside the view.
    const ndc = this.sunNdc
      .copy(cam.position)
      .addScaledVector(sunDir, PROBE_DISTANCE)
      .project(cam);
    const edge = Math.max(Math.abs(ndc.x), Math.abs(ndc.y));
    const inView = ndc.z < 1 && edge < 1.6;
    const on = this.enabled && strength > 0 && inView;
    for (const p of this.probes) p.visible = on;
    if (!on) {
      this.seen = 0;
      this.seenNow.fill(0);
      this.glare.visible = false;
      return;
    }
    let target = 0;
    for (const s of this.seenNow) target += s;
    target /= PROBES;
    this.seen += (target - this.seen) * (1 - Math.exp(-EASE * dt));
    // Probes: a Vogel disc round the sun, each facing the camera.
    this.right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const size = PROBE_DISTANCE * DISC * 0.12;
    for (let i = 0; i < PROBES; i++) {
      const rr = PROBE_DISTANCE * DISC * Math.sqrt((i + 0.5) / PROBES);
      const a = i * 2.39996;
      const p = this.probes[i];
      this.at
        .copy(cam.position)
        .addScaledVector(sunDir, PROBE_DISTANCE)
        .addScaledVector(this.right, Math.cos(a) * rr)
        .addScaledVector(this.up, Math.sin(a) * rr);
      p.position.copy(this.at);
      p.quaternion.copy(cam.quaternion);
      p.scale.setScalar(size);
    }
    // The glare fades out as the sun leaves the view (it still lights the lens from just outside).
    const k =
      STRENGTH *
      strength *
      this.seen *
      (1 - Math.min(1, Math.max(0, (edge - 1.1) / 0.5)));
    this.glare.visible = k > 0.002;
    const u = this.glare.material.uniforms;
    (u.uSun.value as Vector2).set(ndc.x, ndc.y);
    u.uAspect.value = cam.aspect;
    (u.uColor.value as Vector3)
      .set(sunColor.r, sunColor.g, sunColor.b)
      .multiplyScalar(k);
  }

  dispose(): void {
    for (const p of this.probes) this.scene.remove(p);
    this.scene.remove(this.glare);
    this.probes[0]?.geometry.dispose();
    (this.probes[0]?.material as MeshBasicMaterial | undefined)?.dispose();
    this.glare.geometry.dispose();
    this.glare.material.dispose();
    for (const list of this.pending)
      for (const q of list) this.gl.deleteQuery(q);
    for (const q of this.free) this.gl.deleteQuery(q);
    this.camera.layers.disable(GLARE_LAYER);
  }
}
