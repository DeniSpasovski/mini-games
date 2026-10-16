import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  BackSide,
  CircleGeometry,
  Color,
  CubeCamera,
  DoubleSide,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  NeutralToneMapping,
  Object3D,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  type ToneMapping,
  Vector3,
  type Texture,
  WebGLCubeRenderTarget,
  type WebGLRenderer,
} from 'three';
import { LightProbeGenerator } from 'three/examples/jsm/lights/LightProbeGenerator.js';
import { ownValue, paramNumber } from '../../../shared/url-params';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { setTreeSky } from '../trees/materials';
import {
  dome,
  isNightHour,
  lightNeed,
  moonAt,
  NIGHT,
  NIGHT_SUN_ELEVATION,
  NightSky,
} from './night';
import type { EnvironmentDef } from '../maps/shared/types';
import { getTexture } from './textures';
import {
  setFogBase,
  setShadowBox,
  setWorldShading,
  setWorldTime,
} from './world-shading';
import { displayExposure, onDisplayChange } from './display';
import type { QualitySettings } from './quality';

/** Tone-mapping operators a map can pick (`EnvironmentDef.toneMapping`, `?tonemap=` overrides for comparisons). */
export const TONE_MAPPINGS: Record<string, ToneMapping> = {
  aces: ACESFilmicToneMapping,
  agx: AgXToneMapping,
  neutral: NeutralToneMapping,
};

/** Radiance of the studio strip lights (x white; the env map is drawn at `envIntensity`, ~0.3). */
const STUDIO_POWER = 60;
/** Radiance of the studio room around them (linear grey). */
const STUDIO_ROOM = 0.5;

/** Highest sun of the day (deg): late spring at ~42 deg N (all maps are at 40-42 deg N). */
const NOON_ELEVATION = 58;

/**
 * Sun position for a time of day (hours, 6 = sunrise, 12 = noon, 18 = sunset): a plain half-circle sun path,
 * rising in the east (+X), due south (+Z) at noon, setting in the west (-X). Azimuth from +Z towards +X (deg).
 */
export function sunAt(hour: number): { elevation: number; azimuth: number } {
  const t = MathUtils.clamp((hour - 6) / 12, 0, 1);
  return {
    elevation: Math.max(2, NOON_ELEVATION * Math.sin(Math.PI * t)),
    azimuth: (((90 - t * 180) % 360) + 360) % 360,
  };
}

/** `?tod=<hours>` (try a time of day on any map with `timeOfDay`) and `?tonemap=aces|agx|neutral`. */
function urlNumber(name: string): number | undefined {
  if (typeof location === 'undefined') return undefined;
  const v = new URLSearchParams(location.search).get(name);
  return paramNumber(v, -1e6, 1e6, undefined);
}
function urlString(name: string): string | undefined {
  if (typeof location === 'undefined') return undefined;
  return new URLSearchParams(location.search).get(name) ?? undefined;
}

/**
 * Sky dome, sun (with a shadow box that follows the focus point), hemisphere
 * fill, exponential fog and an image-based-lighting env map baked from the sky.
 * The same Environment is used by the game and all debug pages.
 */
export class Environment {
  readonly sky = new Sky();
  readonly sun = new DirectionalLight(0xfff1dc, 3);
  readonly hemi = new HemisphereLight(0xbcd2ee, 0x4a4630, 0.18);
  /** Direction of the main light: the sun, or the moon at night. */
  readonly sunDir = new Vector3();
  /** Effective sun angles (deg) after `timeOfDay` / `?tod=` (below the horizon at night). */
  sunElevation = 0;
  /** Effective hour of day (`timeOfDay` / `?tod=`); missing on maps with fixed sun angles. */
  hour?: number;
  sunAzimuth = 0;
  /** True from ~19:30 to ~04:30 (`timeOfDay` / `?tod=`, not in the studio): moon, stars, dark fog; cars switch their lights on. */
  night = false;
  /** 0..1: how much the car's lights are needed (1 at night, fading in through dusk and dawn). */
  lightNeed = 0;
  private nightSky: NightSky;
  private quality: QualitySettings;
  private target = new Object3D();
  private pmrem: PMREMGenerator;
  private envMap?: Texture;
  private shadowExtent: number;
  private offDisplay: () => void;
  /** Light-space axes of the shadow camera (texel snapping). */
  private lightRight = new Vector3();
  private lightUp = new Vector3();
  private center = new Vector3();
  private t0 = performance.now();
  /** Studio softboxes in the env map (menu car screens): crisp panel highlights on paint and glass. */
  studio: boolean;

  constructor(
    private scene: Scene,
    private renderer: WebGLRenderer,
    public def: EnvironmentDef,
    quality: QualitySettings,
    opts: { studio?: boolean } = {},
  ) {
    this.studio = opts.studio ?? false;
    this.quality = quality;
    this.nightSky = new NightSky(this.sunDir);
    scene.add(this.nightSky.group);
    // Box half-size 1500 m: keep camera.far >= ~2700 (corner distance). Drawn first, never writes depth.
    this.sky.scale.setScalar(3000);
    this.sky.renderOrder = -1;
    scene.add(this.sky);
    scene.add(this.hemi);

    const s = this.sun;
    s.castShadow = true;
    s.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    this.shadowExtent = quality.shadowExtent;
    const cam = s.shadow.camera;
    cam.left = cam.bottom = -this.shadowExtent;
    cam.right = cam.top = this.shadowExtent;
    cam.near = 1;
    cam.far = 600;
    cam.updateProjectionMatrix();
    s.shadow.bias = -0.0004;
    s.shadow.normalBias = 0.04;
    s.target = this.target;
    scene.add(s, this.target);

    this.pmrem = new PMREMGenerator(renderer);
    this.offDisplay = onDisplayChange(() => this.refreshExposure());
    this.apply(def);
  }

  /** Re-apply settings (sun angle, fog, exposure) and rebuild the env map; `studio` = with softboxes (or keep). */
  apply(def: EnvironmentDef, studio = this.studio): void {
    this.def = def;
    this.studio = studio;
    const u = this.sky.material.uniforms;
    u.turbidity.value = def.turbidity;
    u.rayleigh.value = def.rayleigh;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    u.cloudCoverage.value = def.cloudCoverage ?? 0.4;
    u.cloudDensity.value = def.cloudDensity ?? 0.4;

    // Time of day (map default, `?tod=` to try others) or the fixed angles. Night: the moon is the light.
    let elevation = def.sunElevation;
    let azimuth = def.sunAzimuth;
    const hour =
      def.timeOfDay !== undefined
        ? (urlNumber('tod') ?? def.timeOfDay)
        : undefined;
    this.hour = hour;
    this.night = !this.studio && hour !== undefined && isNightHour(hour);
    if (hour !== undefined) {
      const s = sunAt(hour);
      elevation = this.night ? NIGHT_SUN_ELEVATION : s.elevation;
      azimuth = s.azimuth;
    }
    this.sunElevation = elevation;
    this.lightNeed = this.studio ? 0 : lightNeed(elevation);
    this.sunAzimuth = azimuth;
    const lamp = this.night && hour !== undefined ? moonAt(hour) : null;
    const phi = MathUtils.degToRad(90 - (lamp?.elevation ?? elevation));
    const theta = MathUtils.degToRad(lamp?.azimuth ?? azimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(this.sunDir);
    this.sky.visible = !this.night;
    this.nightSky.visible = this.night;
    this.nightSky.setMoon(this.sunDir);
    // Shadow camera axes (DirectionalLight looks at its target with up = +Y): x = up x dir, y = dir x x.
    this.lightRight.set(0, 1, 0).cross(this.sunDir).normalize();
    this.lightUp.copy(this.sunDir).cross(this.lightRight).normalize();

    if (this.night) {
      // Moon: dim and blue; the headlights' own shadow map (game/headlights.ts) carries the scene, so the moon casts
      // shadows on high quality only. Cool sky fill, almost no ground bounce.
      this.sun.color.set(NIGHT.moonColor);
      this.sun.intensity = NIGHT.moonIntensity;
      this.sun.castShadow = this.quality.name === 'high';
      this.hemi.color.set(NIGHT.hemiSky);
      this.hemi.groundColor.set(NIGHT.hemiGround);
      this.hemi.intensity = NIGHT.hemiIntensity;
    } else {
      // Warmer, dimmer sun near the horizon (golden below ~25 deg), unless the map sets it.
      const low = MathUtils.clamp(1 - elevation / 40, 0, 1);
      if (def.sunColor) this.sun.color.set(def.sunColor);
      else this.sun.color.setRGB(1, 0.93 - low * 0.2, 0.84 - low * 0.38);
      this.sun.intensity = def.sunIntensity ?? 3.1 - low * 1.1;
      this.sun.castShadow = true;

      // Fill: cool sky light in the shadows, warm bounce from the map's ground.
      this.hemi.color.set(def.fillSky ?? '#9fb8e6');
      this.hemi.groundColor
        .set(def.groundTint?.grass ?? '#7a6a48')
        .lerp(new Color('#8a6a40'), 0.45)
        .multiplyScalar(0.7);
      this.hemi.intensity = def.fillIntensity ?? 0.26;
    }

    this.renderer.toneMapping =
      ownValue(
        TONE_MAPPINGS,
        urlString('tonemap') ??
          (this.night ? 'agx' : (def.toneMapping ?? 'aces')),
      ) ?? ACESFilmicToneMapping;

    this.scene.fog = this.night
      ? new FogExp2(
          new Color(NIGHT.fogColor),
          def.fogDensity * NIGHT.fogDensity,
        )
      : new FogExp2(new Color(def.fogColor), def.fogDensity);
    // Cloud shadows, height fog + sun glow, foliage wind (engine/world-shading.ts).
    setWorldShading({
      sunDir: this.sunDir,
      sunColor: this.sun.color,
      cloudShadow: this.night ? 0 : (def.cloudShadow ?? 0.5),
      cloudCoverage: def.cloudCoverage ?? 0.4,
      cloudSpeed: def.cloudSpeed ?? 1,
      wind: def.wind ?? 1,
      fogSunGlow: this.night ? 0 : (def.fogSunGlow ?? 0.45),
      fogFalloff: def.fogFalloff ?? 0.004,
      macro: getTexture('macro'),
    });
    this.refreshExposure();
    this.rebuildEnvMap();
  }

  /** Map exposure, scaled for the display (engine/display.ts: HDR monitors get less). */
  refreshExposure(): void {
    this.renderer.toneMappingExposure =
      (this.night ? NIGHT.exposure : this.def.exposure) * displayExposure();
  }

  private rebuildEnvMap(): void {
    const envScene = new Scene();
    const nightDome = this.night ? dome(this.sunDir, 40) : null;
    const sky = new Sky();
    sky.scale.setScalar(1000);
    const src = this.sky.material.uniforms;
    const dst = sky.material.uniforms;
    for (const k of [
      'turbidity',
      'rayleigh',
      'mieCoefficient',
      'mieDirectionalG',
      'cloudCoverage',
      'cloudDensity',
      'cloudScale',
      'cloudElevation',
    ] as const)
      dst[k].value = src[k].value;
    dst.sunPosition.value.copy(src.sunPosition.value);
    // Studio: a dim grey room instead of the sky, so the strip lights below dominate the reflections.
    if (nightDome) {
      nightDome.renderOrder = -2;
      envScene.add(nightDome);
    } else if (!this.studio) envScene.add(sky);
    // Ground under the sky: paint, glass and water reflect earth below the horizon, not more sky. Its radiance
    // ~ albedo x (sun + sky), in the map's ground colour, a little warm.
    const groundCol = new Color(this.def.groundTint?.grass ?? '#7a6a48')
      .lerp(new Color('#6b5a3e'), 0.5)
      .multiplyScalar(
        this.night
          ? 0.012
          : 0.25 + 0.55 * Math.sin(MathUtils.degToRad(this.sunElevation)),
      );
    const ground = new Mesh(
      new CircleGeometry(900, 48).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ color: groundCol, fog: false }),
    );
    ground.position.y = -12;
    envScene.add(ground);
    const panels: Mesh[] = [];
    if (this.studio) {
      // Strip lights: two long ones overhead, a tall one either side, a low one behind each end - the long
      // clean highlights of a car photo shoot. Thin and very bright: crisp in the clearcoat, little extra diffuse.
      const panel = (
        w: number,
        h: number,
        x: number,
        y: number,
        z: number,
        rx: number,
        ry: number,
        power: number,
      ) => {
        const m = new Mesh(
          new PlaneGeometry(w, h).rotateX(rx).rotateY(ry),
          new MeshBasicMaterial({
            color: new Color(1, 0.98, 0.95).multiplyScalar(power),
            side: DoubleSide,
            fog: false,
          }),
        );
        m.position.set(x, y, z);
        envScene.add(m);
        panels.push(m);
      };
      const room = new Mesh(
        new SphereGeometry(400, 24, 12),
        new MeshBasicMaterial({
          color: new Color(STUDIO_ROOM, STUDIO_ROOM, STUDIO_ROOM * 1.04),
          side: BackSide,
          fog: false,
        }),
      );
      envScene.add(room);
      panels.push(room);
      const P = STUDIO_POWER;
      panel(14, 0.7, 0, 9, 2.5, Math.PI / 2, 0, P);
      panel(14, 0.7, 0, 9, -2.5, Math.PI / 2, 0, P);
      panel(0.7, 8, 11, 3.5, 0, 0, Math.PI / 2, P * 0.75);
      panel(0.7, 8, -11, 3.5, 0, 0, Math.PI / 2, P * 0.75);
      panel(16, 0.5, 0, 2, 12, 0, 0, P * 0.6);
      panel(16, 0.5, 0, 2, -12, 0, 0, P * 0.6);
    }
    this.envMap?.dispose();
    this.envMap = this.pmrem.fromScene(envScene, 0, 0.1, 2000).texture;
    this.scene.environment = this.envMap;
    // Key/fill balance: keep IBL + hemi low enough that sun shadows read clearly.
    this.scene.environmentIntensity = this.night
      ? NIGHT.envIntensity
      : (this.def.envIntensity ?? 0.3);
    // The same sky's diffuse light as spherical harmonics, for the tree foliage (it does not sample the env map:
    // trees/materials.ts `setTreeSky`). A tiny cube of the environment scene, read back once.
    const cube = new WebGLCubeRenderTarget(32);
    new CubeCamera(0.1, 2000, cube).update(this.renderer, envScene);
    const intensity = this.scene.environmentIntensity;
    void LightProbeGenerator.fromCubeRenderTarget(this.renderer, cube)
      .then((probe) => setTreeSky(probe.sh.coefficients, intensity))
      .finally(() => cube.dispose());
    sky.material.dispose();
    sky.geometry.dispose();
    if (nightDome) {
      nightDome.geometry.dispose();
      nightDome.material.dispose();
    }
    for (const m of [ground, ...panels]) {
      m.geometry.dispose();
      (m.material as MeshBasicMaterial).dispose();
    }
  }

  /**
   * Place the sun's shadow box. It covers the area AHEAD of the camera (`forward`, horizontal; centred half a box
   * in front of `focus`) and is snapped to shadow-map texels in light space, so its edges don't crawl while driving.
   */
  update(focus: Vector3, forward?: Vector3): void {
    setFogBase(focus.y);
    const c = this.center.copy(focus);
    if (forward) {
      const l = Math.hypot(forward.x, forward.z);
      if (l > 1e-3) {
        c.x += (forward.x / l) * this.shadowExtent * 0.5;
        c.z += (forward.z / l) * this.shadowExtent * 0.5;
      }
    }
    // Snap along the shadow camera's right / up axes (its texel grid); depth along the light needs no snap.
    const texel = (this.shadowExtent * 2) / this.sun.shadow.mapSize.x;
    for (const axis of [this.lightRight, this.lightUp]) {
      const a = c.dot(axis);
      c.addScaledVector(axis, Math.round(a / texel) * texel - a);
    }
    this.target.position.copy(c);
    setShadowBox(c.x, c.z, this.shadowExtent);
    this.sun.position.copy(c).addScaledVector(this.sunDir, 300);
    this.sun.updateMatrixWorld();
    this.target.updateMatrixWorld();
  }

  /** Move the sky dome with the camera so it never clips; drift the clouds. */
  follow(cameraPos: Vector3): void {
    this.sky.position.copy(cameraPos);
    this.nightSky.group.position.copy(cameraPos);
    setWorldTime((performance.now() - this.t0) / 1000);
    this.sky.material.uniforms.time.value =
      ((performance.now() - this.t0) / 1000) * (this.def.cloudSpeed ?? 1);
  }

  dispose(): void {
    this.offDisplay();
    this.nightSky.dispose();
    this.envMap?.dispose();
    this.pmrem.dispose();
  }
}
