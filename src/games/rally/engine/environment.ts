import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  BackSide,
  CircleGeometry,
  Color,
  CubeCamera,
  DataUtils,
  DoubleSide,
  DirectionalLight,
  FogExp2,
  HalfFloatType,
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
  Vector2,
  Vector3,
  Vector4,
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
  setCarEnvSun,
  setFogBase,
  setFogLayer,
  setShadowBox,
  setWet,
  worldUniforms,
  setWorldShading,
  setWorldTime,
} from './world-shading';
import { displayExposure, onDisplayChange } from './display';
import { setGrade, setGradeViewport } from './grade';
import type { QualitySettings } from './quality';
import {
  WEATHER_LOOKS,
  weatherLook,
  weatherParam,
  type Weather,
  type WeatherLook,
  type WeatherTuning,
} from '../weather';

/** Tone-mapping operators a map can pick (`EnvironmentDef.toneMapping`, `?tonemap=` overrides for comparisons). */
export const TONE_MAPPINGS: Record<string, ToneMapping> = {
  aces: ACESFilmicToneMapping,
  agx: AgXToneMapping,
  neutral: NeutralToneMapping,
};

/**
 * `?look=<name>`: test variants of sky, fog and grade over the map's own settings (tuned on Galichica; `before` = its
 * old look). For comparing in the browser only.
 */
const SKY_FOG: Partial<EnvironmentDef> = {
  turbidity: 2,
  rayleigh: 2.2,
  skyBrightness: 0.3,
  fogColor: 'sky',
  fogBrightness: 0.55,
  exposure: 0.92,
};
const SHADE = { color: '#2f6f6a', amount: 0.08 };
const LOOKS: Record<string, Partial<EnvironmentDef>> = {
  before: {
    turbidity: 3.5,
    rayleigh: 1.4,
    skyBrightness: 1,
    fogColor: '#c6d2dc',
    exposure: 0.95,
    grade: undefined,
  },
  sky: { ...SKY_FOG, grade: undefined },
  soft: {
    ...SKY_FOG,
    exposure: 0.95,
    grade: {
      contrast: 1.1,
      saturation: 1.08,
      vibrance: 0.15,
      shadowTint: SHADE,
      vignette: 0.15,
    },
  },
  crisp: {
    ...SKY_FOG,
    grade: {
      warmth: 0.05,
      contrast: 1.15,
      saturation: 1.1,
      vibrance: 0.2,
      shadowTint: SHADE,
      vignette: 0.15,
    },
  },
  warm: {
    ...SKY_FOG,
    grade: {
      warmth: 0.1,
      contrast: 1.15,
      saturation: 1.1,
      vibrance: 0.2,
      shadowTint: SHADE,
      highlightTint: { color: '#ffe2b8', amount: 0.06 },
      vignette: 0.15,
    },
  },
  // Vodno day candidates.
  'vodno-before': {
    turbidity: 4.6,
    rayleigh: 1.5,
    skyBrightness: 1,
    fogColor: '#c5ccd2',
    exposure: 0.95,
    grade: undefined,
  },
  forest: {
    ...SKY_FOG,
    turbidity: 3,
    skyBrightness: 0.35,
    fogBrightness: 0.6,
    exposure: 1.02,
    grade: {
      warmth: 0.12,
      contrast: 1.05,
      saturation: 1.08,
      vibrance: 0.12,
      highlightTint: { color: '#ffd9a0', amount: 0.06 },
      vignette: 0.1,
    },
  },
  'forest-haze': {
    turbidity: 4,
    rayleigh: 1.8,
    skyBrightness: 0.5,
    fogColor: '#c9ccc6',
    exposure: 1,
    grade: {
      warmth: 0.08,
      contrast: 1.04,
      saturation: 1.05,
      vibrance: 0.1,
      vignette: 0.1,
    },
  },
  cool: {
    ...SKY_FOG,
    rayleigh: 2.4,
    skyBrightness: 0.25,
    fogBrightness: 0.5,
    grade: {
      warmth: -0.05,
      contrast: 1.18,
      saturation: 1.15,
      vibrance: 0.25,
      shadowTint: { color: '#2f6f6a', amount: 0.12 },
      highlightTint: { color: '#ffe6c0', amount: 0.05 },
      vignette: 0.18,
    },
  },
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

/** Evening golden hour: from 17:00 (sun below ~12 deg in the west) until night. */
export function isGoldenHour(hour: number): boolean {
  const h = ((hour % 24) + 24) % 24;
  return h >= 17 && !isNightHour(h);
}

/**
 * A weather's look over a map's environment (`weather.ts`): cloud cover, the sun dimmed under it, a soft grey sky
 * light in place of the blue fill, the air's visibility as fog density (FogExp2 reaches 98 % at 1.98 / density) and
 * a duller, cooler grade. Dry returns the map's own. The sun itself is dimmed in `Environment.apply` (`WeatherLook.sun`).
 */
export function weatherEnv(
  def: EnvironmentDef,
  w: WeatherLook,
): EnvironmentDef {
  if (w.clouds === null)
    return w.wind === 1 ? def : { ...def, wind: (def.wind ?? 1) * w.wind };
  // 0 = overcast / breaking cloud, 1 = heavy rain.
  const dark = 1 - w.sun;
  const g = def.grade ?? {};
  const out: EnvironmentDef = {
    ...def,
    cloudCoverage: Math.max(def.cloudCoverage ?? 0.4, w.clouds),
    cloudDensity: Math.max(def.cloudDensity ?? 0.4, 0.4 + 0.5 * w.clouds),
    cloudShadow: w.clouds >= 1 ? 0 : (def.cloudShadow ?? 0.5),
    turbidity: def.turbidity + 8 * dark,
    rayleigh: def.rayleigh * (1 - 0.9 * dark),
    mieCoefficient: 0.004 + 0.02 * dark,
    skyBrightness: (def.skyBrightness ?? 1) * (1 - 0.35 * dark),
    fogSunGlow: (def.fogSunGlow ?? 0.45) * w.sun,
    fillSky: dark > 0.5 ? '#c4cad1' : (def.fillSky ?? '#9fb8e6'),
    // The sky carries the light under cloud: more fill as the sun goes.
    fillIntensity: (def.fillIntensity ?? 0.26) + 0.5 * dark,
    wind: (def.wind ?? 1) * w.wind,
    // The eye (and a camera) opens up under a dark sky.
    exposure: def.exposure * (1 + 0.3 * dark),
    grade: {
      ...g,
      warmth: (g.warmth ?? 0) * w.sun - 0.04 * dark,
      contrast: 1 + ((g.contrast ?? 1) - 1) * w.sun - 0.04 * dark,
      saturation: (g.saturation ?? 1) * (1 - 0.25 * dark),
      vibrance: (g.vibrance ?? 0) * w.sun,
      highlightTint: dark > 0.5 ? undefined : g.highlightTint,
      vignette: Math.max(g.vignette ?? 0, 0.12 * dark),
    },
  };
  if (w.visibility !== null) {
    out.fogDensity = Math.max(def.fogDensity, 1.98 / w.visibility);
    // Rain fills the air at every height (the height falloff is for clear-day haze in the valleys).
    out.fogFalloff = (def.fogFalloff ?? 0.004) * (w.rain > 0 ? 0.25 : 1);
    if (dark > 0.5) {
      out.fogColor = w.rain > 4 ? '#8f969d' : '#a1a7ad';
      out.fogBrightness = undefined;
    }
  }
  return out;
}

/**
 * A fog layer over the sky dome (`skyFog`: x the layer's top above the camera (m), y density, z falloff above the top, w
 * on): the optical depth from the camera out of the layer along the view ray (`layerTau` in closed form for an endless
 * ray). From inside, the sky goes the fog's colour; from above, the view down onto the layer is solid fog.
 */
const SKY_FOG_LAYER = /* glsl */ `
			if ( skyFog.w > 0.0 ) {
				float dy = max( direction.y, 1e-3 );
				float tau = skyFog.x > 0.0
					? skyFog.y * ( skyFog.x / dy + 1.0 / ( skyFog.z * dy ) )
					: ( direction.y <= 0.0 ? 1e3 : skyFog.y / skyFog.z * exp( skyFog.z * skyFog.x ) / dy );
				gl_FragColor.rgb = mix( gl_FragColor.rgb, skyFogColor, 1.0 - exp( - tau ) );
			}`;

/**
 * Two additions to three's Sky shader: `skyGain` (`skyBrightness`: the dome only; the env map keeps the full sky, so
 * the world's sky light does not change) and `skyOvercast` (rgb = a cloud deck's zenith colour, a = how much of the
 * sky it hides): an overcast sky twice as bright overhead as at the horizon (the CIE overcast sky has 3x; rain-filled
 * air lightens the horizon), over the clear sky and its clouds.
 */
function patchSky(sky: Sky): Sky {
  const mat = sky.material;
  mat.uniforms.skyGain = { value: 1 };
  mat.uniforms.skyOvercast = { value: new Vector4(0, 0, 0, 0) };
  mat.uniforms.skyFog = { value: new Vector4(0, 0, 0.05, 0) };
  mat.uniforms.skyFogColor = { value: new Color() };
  const out = 'gl_FragColor = vec4( texColor, 1.0 );';
  if (!mat.fragmentShader.includes(out))
    throw new Error('environment: Sky shader changed (three upgrade?)');
  mat.fragmentShader = mat.fragmentShader
    .replace(
      'void main() {',
      'uniform float skyGain;\nuniform vec4 skyOvercast;\nuniform vec4 skyFog;\nuniform vec3 skyFogColor;\nvoid main() {',
    )
    .replace(
      out,
      'texColor = mix( texColor, skyOvercast.rgb * ( 0.5 + 0.5 * max( direction.y, 0.0 ) ), skyOvercast.a );\n\t\t\tgl_FragColor = vec4( texColor * skyGain, 1.0 );\n' +
        SKY_FOG_LAYER,
    );
  return sky;
}

/** `?tod=<hours>` (try a time of day on any map with `timeOfDay`), `?tonemap=aces|agx|neutral` and `?grade=off`. */
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
  /** 0..1: how much the car's lights are needed (1 at night, fading in through dusk and dawn, some in the rain). */
  lightNeed = 0;
  /** Weather of the run (`?weather=`, dry by default; never in the studio) and what it does (`weather.ts`). */
  weather: Weather = 'dry';
  weatherLook: WeatherLook = WEATHER_LOOKS.dry;
  /** The stage's own weather numbers (`StageDef.weather`). */
  private stageWeather?: Partial<Record<Weather, WeatherTuning>>;
  /** World height (m) of the stage start: a fog layer's top is measured from it (`setStageBase`). */
  private stageBase = 0;
  /** The sun's intensity before a fog layer dims it (`update`). */
  private sunBase = 0;
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
    opts: {
      studio?: boolean;
      weather?: Partial<Record<Weather, WeatherTuning>>;
    } = {},
  ) {
    this.studio = opts.studio ?? false;
    this.stageWeather = opts.weather;
    this.quality = quality;
    this.nightSky = new NightSky(this.sunDir);
    scene.add(this.nightSky.group);
    // Box half-size 1500 m: keep camera.far >= ~2700 (corner distance). Never writes depth. Drawn after every opaque
    // object, at the far plane (three's Sky: z = w): the depth test skips each pixel something already covers (a full
    // screen of sky shading was ~0.4 ms of GPU a frame). The horizon backdrop keeps its pixels in front of it
    // (world/horizon.ts `depthPush`).
    this.sky.scale.setScalar(3000);
    this.sky.renderOrder = 100;
    // `skyBrightness`: the dome only (the env map keeps the full sky, so the world's sky light does not change).
    patchSky(this.sky);
    // The grade's vignette needs the canvas size; the sky is drawn every day frame.
    const size = new Vector2();
    this.sky.onBeforeRender = (r) => {
      r.getDrawingBufferSize(size);
      setGradeViewport(size.x, size.y);
    };
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
    // Evening golden hour (~17:00 till night): the map's `goldenHour` look over its day look.
    const at =
      def.timeOfDay !== undefined
        ? (urlNumber('tod') ?? def.timeOfDay)
        : undefined;
    if (def.goldenHour && !studio && at !== undefined && isGoldenHour(at))
      def = { ...def, ...def.goldenHour };
    const look = ownValue(LOOKS, urlString('look') ?? '');
    if (look) def = { ...def, ...look };
    this.weather = studio ? 'dry' : weatherParam(urlString('weather'));
    this.weatherLook = weatherLook(this.weather, this.stageWeather);
    def = weatherEnv(def, this.weatherLook);
    this.def = def;
    this.studio = studio;
    const u = this.sky.material.uniforms;
    u.turbidity.value = def.turbidity;
    u.rayleigh.value = def.rayleigh;
    u.mieCoefficient.value = def.mieCoefficient ?? 0.004;
    u.skyGain.value = def.skyBrightness ?? 1;
    u.mieDirectionalG.value = 0.82;
    u.cloudCoverage.value = def.cloudCoverage ?? 0.4;
    u.cloudDensity.value = def.cloudDensity ?? 0.4;
    // A solid cloud deck (rain, overcast): the dome turns the deck's grey.
    const w = this.weatherLook;
    u.skyOvercast.value.set(w.deck, w.deck, w.deck * 1.04, w.deck > 0 ? 1 : 0);

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
    setCarEnvSun(elevation, this.night);
    // Rain darkens the day: rally crews drive with their lights on.
    this.lightNeed = this.studio
      ? 0
      : Math.max(
          lightNeed(elevation),
          this.weatherLook.rain > 4
            ? 0.35
            : this.weatherLook.rain > 0 || this.weatherLook.fog
              ? 0.2
              : 0,
        );
    const fog = this.weatherLook.fog;
    if (fog) setWet(fog.damp, 0, this.stageBase + fog.top);
    else setWet(this.weatherLook.wet, this.weatherLook.rain);
    this.sunAzimuth = azimuth;
    const lamp = this.night && hour !== undefined ? moonAt(hour) : null;
    const phi = MathUtils.degToRad(90 - (lamp?.elevation ?? elevation));
    const theta = MathUtils.degToRad(lamp?.azimuth ?? azimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(this.sunDir);
    this.sky.visible = !this.night;
    // No stars or moon through a cloud deck, rain or fog.
    const wl = this.weatherLook;
    this.nightSky.visible =
      this.night &&
      !(wl.deck > 0 || wl.rain > 0 || wl.fog || (wl.clouds ?? 0) >= 1);
    this.nightSky.setMoon(this.sunDir);
    // Shadow camera axes (DirectionalLight looks at its target with up = +Y): x = up x dir, y = dir x x.
    this.lightRight.set(0, 1, 0).cross(this.sunDir).normalize();
    this.lightUp.copy(this.sunDir).cross(this.lightRight).normalize();

    if (this.night) {
      // Moon: dim and blue; the headlights' own shadow map (game/headlights.ts) carries the scene, so the moon casts
      // shadows on high quality only. Cool sky fill, almost no ground bounce.
      this.sun.color.set(NIGHT.moonColor);
      this.sun.intensity = NIGHT.moonIntensity * this.weatherLook.sun;
      this.sun.castShadow =
        this.quality.name === 'high' && this.sun.intensity > 0;
      this.hemi.color.set(NIGHT.hemiSky);
      this.hemi.groundColor.set(NIGHT.hemiGround);
      this.hemi.intensity = NIGHT.hemiIntensity;
    } else {
      // Warmer, dimmer sun near the horizon (golden below ~25 deg), unless the map sets it.
      const low = MathUtils.clamp(1 - elevation / 40, 0, 1);
      if (def.sunColor) this.sun.color.set(def.sunColor);
      else this.sun.color.setRGB(1, 0.93 - low * 0.2, 0.84 - low * 0.38);
      this.sun.intensity =
        (def.sunIntensity ?? 3.1 - low * 1.1) * this.weatherLook.sun;
      // Under a rain deck there is no sun or moon disc, only the grey sky's light (no glint on the wet road).
      this.sun.castShadow = this.sun.intensity > 0;

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
    // Colour grade on top (engine/grade.ts): day only, never in the studio.
    setGrade(
      this.night || this.studio || urlString('grade') === 'off'
        ? null
        : def.grade,
    );

    this.scene.fog = this.night
      ? new FogExp2(
          new Color(NIGHT.fogColor),
          def.fogDensity * NIGHT.fogDensity,
        )
      : new FogExp2(
          // 'sky': the sky's horizon, read once the env map is built (`rebuildEnvMap`).
          new Color(def.fogColor === 'sky' ? '#c3c9cf' : def.fogColor),
          def.fogDensity,
        );
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
    this.sunBase = this.sun.intensity;
    this.applyFogLayer();
  }

  /**
   * World height (m) of the stage start: a weather's fog top is measured from it (Vodno's valley fog sits ~110 m above
   * its start). Call once the stage is known.
   */
  setStageBase(y: number): void {
    this.stageBase = y;
    this.applyFogLayer();
    const fog = this.weatherLook.fog;
    if (fog) setWet(fog.damp, 0, y + fog.top);
  }

  /** The weather's fog layer (or none): density, top and a colour lit like the day's fog (`setFogLayer`). */
  private applyFogLayer(): void {
    const fog = this.weatherLook.fog;
    const sky = this.sky.material.uniforms.skyFog.value as Vector4;
    if (!fog) {
      setFogLayer(null);
      sky.w = 0;
      return;
    }
    // Water droplets scatter all colours alike: white by day, lit from above and brighter than the haze (only a hint of
    // the haze's tint, which made the fog read as smoke); dark blue-grey at night.
    // Night fog is a grey veil (the little light about scatters in it), not black: black fog just looks like a clear night.
    const color = this.night
      ? new Color(0.03, 0.032, 0.036)
      : (this.scene.fog?.color.clone() ?? new Color(0.6, 0.62, 0.64)).lerp(
          new Color(0.9, 0.92, 0.94),
          0.88,
        );
    setFogLayer(
      { top: this.stageBase + fog.top, visibility: fog.visibility },
      color,
    );
    const u = worldUniforms.wsFogLayer.value;
    sky.set(0, u.y, u.z, 1);
    (this.sky.material.uniforms.skyFogColor.value as Color).copy(color);
  }

  /** Map exposure, scaled for the display (engine/display.ts: HDR monitors get less). */
  refreshExposure(): void {
    this.renderer.toneMappingExposure =
      (this.night ? NIGHT.exposure : this.def.exposure) * displayExposure();
  }

  private rebuildEnvMap(): void {
    const envScene = new Scene();
    const nightDome = this.night ? dome(this.sunDir, 40) : null;
    const sky = patchSky(new Sky());
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
    dst.skyOvercast.value.copy(src.skyOvercast.value);
    // Studio: a dim grey room instead of the sky, so the strip lights below dominate the reflections.
    if (nightDome) {
      nightDome.renderOrder = -2;
      envScene.add(nightDome);
    } else if (!this.studio) envScene.add(sky);
    // Ground under the sky: paint, glass and water reflect earth below the horizon, not more sky. Its radiance
    // ~ albedo x (sun + sky), in the map's ground colour, a little warm, mostly greyed: road, shade and fields
    // mixed (a full grass green turned grey paint olive on green maps).
    const groundCol = new Color(this.def.groundTint?.grass ?? '#7a6a48').lerp(
      new Color('#6b5a3e'),
      0.5,
    );
    const grey =
      0.2126 * groundCol.r + 0.7152 * groundCol.g + 0.0722 * groundCol.b;
    groundCol
      .lerp(new Color(grey, grey, grey), 0.65)
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
    if (!this.night && this.def.fogColor === 'sky' && this.scene.fog)
      this.scene.fog.color.copy(this.horizonColor(envScene));
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
   * The sky's colour just above the horizon all round (a tiny half-float cube of the env scene: the four side faces'
   * band up to ~11 deg), at the luminance `fogBrightness`: the sky dome is far brighter than lit ground, so fog at the
   * sky's own radiance would turn distant hills white.
   */
  private horizonColor(envScene: Scene): Color {
    const n = 16;
    const rows = 2;
    const cube = new WebGLCubeRenderTarget(n, { type: HalfFloatType });
    new CubeCamera(0.1, 2000, cube).update(this.renderer, envScene);
    const buf = new Uint16Array(n * rows * 4);
    const sum = [0, 0, 0];
    let count = 0;
    // Faces +X, -X, +Z, -Z; CubeCamera's side faces are drawn upside down, so the sky is below the middle row.
    for (const face of [0, 1, 4, 5]) {
      this.renderer.readRenderTargetPixels(
        cube,
        0,
        n / 2 - rows,
        n,
        rows,
        buf,
        face,
      );
      for (let i = 0; i < buf.length; i += 4) {
        for (let c = 0; c < 3; c++)
          sum[c] += DataUtils.fromHalfFloat(buf[i + c]);
        count++;
      }
    }
    cube.dispose();
    const lum = 0.2126 * sum[0] + 0.7152 * sum[1] + 0.0722 * sum[2];
    const k = (this.def.fogBrightness ?? 0.62) / Math.max(1e-6, lum);
    return new Color().setRGB(sum[0] * k, sum[1] * k, sum[2] * k);
  }

  /**
   * Place the sun's shadow box. It covers the area AHEAD of the camera (`forward`, horizontal; centred half a box
   * in front of `focus`) and is snapped to shadow-map texels in light space, so its edges don't crawl while driving.
   */
  update(focus: Vector3, forward?: Vector3): void {
    setFogBase(focus.y);
    // In a fog layer the sun comes through dimmed (the climb out of it brings the sun and hard shadows back).
    const layer = worldUniforms.wsFogLayer.value;
    if (layer.w > 0 && !this.night) {
      // Most of the light still gets through, scattered: ~0.25 of the sun 100 m deep (the plan's 0.2-0.35).
      const tau = layer.y * Math.max(0, layer.x - focus.y) * 0.5;
      this.sun.intensity = this.sunBase * Math.max(0.2, Math.exp(-tau));
    }
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
    const sky = this.sky.material.uniforms.skyFog.value as Vector4;
    if (sky.w > 0) sky.x = worldUniforms.wsFogLayer.value.x - cameraPos.y;
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
