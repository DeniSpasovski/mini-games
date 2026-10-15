import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  MathUtils,
  Mesh,
  Points,
  PointsMaterial,
  ShaderMaterial,
  SphereGeometry,
  type Vector3,
} from 'three';

/** Hours (24 h clock) from which the sun is gone: the moon takes over (`Environment`, `?tod=<hours>`). */
export const NIGHT_FROM = 19.5;
export const NIGHT_UNTIL = 4.5;

/** Night look constants shared by the environment and the cars (see `Environment.apply`). */
export const NIGHT = {
  moonColor: '#9db4e6',
  /** Moon directional light (the sun is 3.1 at midday). */
  moonIntensity: 0.2,
  fogColor: '#0a0e18',
  /** x the map's `fogDensity`: dark air shows little. */
  fogDensity: 2,
  hemiSky: '#1a2744',
  hemiGround: '#0b0c10',
  hemiIntensity: 0.07,
  /** Tone-mapping exposure (replaces the map's day exposure; AgX keeps lamp colours). */
  exposure: 1.25,
  envIntensity: 0.25,
} as const;

export function isNightHour(hour: number): boolean {
  const h = ((hour % 24) + 24) % 24;
  return h >= NIGHT_FROM || h <= NIGHT_UNTIL;
}

/**
 * Moon position for a night hour: it follows the sun's half-circle twelve hours later (rises ~18 h in the east, highest at
 * midnight, sets ~6 h), kept lower than the sun's path so its shadows stay long. Azimuth from +Z towards +X (deg).
 */
export function moonAt(hour: number): { elevation: number; azimuth: number } {
  const t = MathUtils.clamp((((hour + 12) % 24) + 24) % 24, 6, 18);
  const u = (t - 6) / 12;
  return {
    elevation: Math.max(8, 42 * Math.sin(Math.PI * u)),
    azimuth: (((90 - u * 180) % 360) + 360) % 360,
  };
}

const STARS = 2200;
/** Radius of the sky shapes: inside the camera far plane, drawn before everything else (no depth write). */
const RADIUS = 1400;

/**
 * Night sky dome: dark gradient, a warm town glow along the horizon, a moon disc with a halo (one shader, no textures)
 * and a field of stars (one `Points` draw). Both are opaque, ignore depth and draw first, so terrain and trees simply
 * cover them. Follows the camera (`position`); the same dome (`dome()`) builds the night env map.
 */
export class NightSky {
  readonly group = new Group();
  private readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly stars: Points;

  constructor(moonDir: Vector3) {
    this.mesh = dome(moonDir, 6);
    this.mesh.renderOrder = -2;
    const pos = new Float32Array(STARS * 3);
    const col = new Float32Array(STARS * 3);
    let s = 12345;
    const rnd = (): number =>
      (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < STARS; i++) {
      const y = rnd() * 0.97 + 0.03;
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - y * y);
      pos.set(
        [r * Math.cos(a) * RADIUS, y * RADIUS, r * Math.sin(a) * RADIUS],
        i * 3,
      );
      const b = 0.3 + rnd() ** 3 * 0.9;
      const w = rnd();
      col.set([b * (0.85 + 0.15 * w), b * (0.88 + 0.1 * w), b], i * 3);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('color', new BufferAttribute(col, 3));
    this.stars = new Points(
      g,
      new PointsMaterial({
        size: 1.7,
        sizeAttenuation: false,
        vertexColors: true,
        fog: false,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.stars.renderOrder = -1;
    this.stars.frustumCulled = false;
    this.group.add(this.mesh, this.stars);
    this.group.visible = false;
  }

  setMoon(dir: Vector3): void {
    this.mesh.material.uniforms.uMoonDir.value.copy(dir);
  }

  get visible(): boolean {
    return this.group.visible;
  }
  set visible(v: boolean) {
    this.group.visible = v;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.stars.geometry.dispose();
    (this.stars.material as PointsMaterial).dispose();
    this.group.removeFromParent();
  }
}

/** The dome mesh. `moon` = radiance of the moon disc (the env map uses a duller one). */
export function dome(
  moonDir: Vector3,
  moon: number,
): Mesh<SphereGeometry, ShaderMaterial> {
  const m = new Mesh(
    new SphereGeometry(RADIUS, 32, 16),
    new ShaderMaterial({
      side: BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: { value: new Color('#070b16') },
        uHorizon: { value: new Color(NIGHT.fogColor) },
        uGlow: { value: new Color('#3d2c24') },
        uMoonDir: { value: moonDir.clone() },
        uMoonColor: { value: new Color('#fff6e0').multiplyScalar(moon) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uZenith;
        uniform vec3 uHorizon;
        uniform vec3 uGlow;
        uniform vec3 uMoonDir;
        uniform vec3 uMoonColor;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize( vDir );
          float y = max( d.y, 0.0 );
          vec3 col = mix( uHorizon, uZenith, smoothstep( 0.0, 0.55, y ) );
          col += uGlow * exp( - y * 9.0 ) * 0.8 * step( -0.02, d.y );
          float m = dot( d, uMoonDir );
          float disc = smoothstep( 1.0 - 3.0e-4, 1.0 - 2.4e-4, m );
          float halo = exp( ( m - 1.0 ) * 260.0 ) * 0.35 + exp( ( m - 1.0 ) * 4000.0 ) * 0.2;
          gl_FragColor = vec4( col + uMoonColor * ( disc + halo * 0.04 ), 1.0 );
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }),
  );
  m.frustumCulled = false;
  return m;
}
