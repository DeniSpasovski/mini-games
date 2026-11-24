import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  BackSide,
  CircleGeometry,
  Color,
  ClampToEdgeWrapping,
  CubeCamera,
  DataTexture,
  DataUtils,
  DoubleSide,
  DirectionalLight,
  FogExp2,
  HalfFloatType,
  HemisphereLight,
  LightProbe,
  LinearFilter,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  NeutralToneMapping,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  RGBAFormat,
  Scene,
  SphereGeometry,
  type ToneMapping,
  Vector3,
  Vector4,
  type Texture,
  WebGLCubeRenderTarget,
  type WebGLRenderer,
} from 'three';
import { urlParam } from './url-param';
import {
  daylight,
  luminance,
  meteredExposure,
  mieFromTurbidity,
  SKY_LUT_H,
  SKY_LUT_W,
  type Daylight,
} from './atmosphere';
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
  setAerial,
  setEnvDiffuse,
  setFogBase,
  setHaze,
  setSkyHaze,
  setFogLayer,
  setShadowBox,
  setSkyVis,
  setWet,
  worldUniforms,
  setWorldShading,
  setWorldTime,
} from './world-shading';
import { displayExposure, onDisplayChange } from './display';
import { setGrade, setGradeViewport } from './grade';
import type { QualitySettings } from './quality';
import { shadowCasterLayers } from './layers';
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

/**
 * Day light balance. On flat ground the sky gives about a third of what the sun does (a clear day: cast shadows are
 * dark), and faces turned from the sun get the light the ground throws back (`bounce`), warm.
 * - `sun` / `sunLow`: the sun's intensity high in the sky and how much of it a sun on the horizon loses.
 * - `fill`: the hemisphere light's sky side (`fillIntensity`).
 * - `envDiffuse`: the share of the env map's diffuse light that is used (reflections keep the whole `envIntensity`).
 * - `bounce`: the ground's albedo x how much of it a wall sees unshaded.
 * - `warmLow`: how fast a sinking sun turns golden (exponent on its lowness): with the sun carrying the light, a
 *   mid-morning sun (~20 deg) must stay near white or the whole scene goes yellow.
 * `CLASSIC_LIGHT` = the sky at three quarters of the sun, no bounce: the studio's softboxes are tuned for it, and
 * `?look=classic` shows it in game (dry weather only).
 */
/** `?haze=off`: the fog mixed in after tone mapping (the look before the aerial perspective). */
const HAZE_OFF = urlString('haze') === 'off';
/** How far past ~1 / density the haze keeps growing only linearly (`setAerial`): lower = clearer far ridges. */
const HAZE_TAIL = 1.2;
setAerial(HAZE_TAIL);

/**
 * `?light=v2` (dev comparison; default off): sun, sky dome, sky light, haze and exposure from one physical atmosphere
 * (engine/atmosphere.ts) instead of the per-map numbers. By day outside the studio only; night keeps its own look.
 * Read at each `apply`: change the URL and call `Environment.relight()` to switch on the same page.
 */
export function lightV2(): boolean {
  return urlString('light') === 'v2';
}
/**
 * `light=v2` numbers. Exposure is metered on the light on sunlit flat ground (on the light, not on the frame: no
 * feedback from dark or pale ground, and the shade does not pull it up): at the map's noon it is `lit` / that light x
 * the map's own exposure (a weather's included), so a sunlit surface lands where it does in the default look; away from
 * noon the eye adapts only a little (`adapt`; the default look keeps one exposure all day), so a low sun reads dimmer.
 */
const V2 = {
  /**
   * The default look's light on a sunlit surface at noon: its sun, sky and fill plus the sun disc its env map spreads
   * over every face (matched on paired stills of sunlit road, gravel and walls).
   */
  lit: 6.9,
  adapt: 0.1,
  /** Camera height for the sky (m): the maps lie 300-1500 m up; the sky barely changes over that. */
  altitude: 600,
  /** Share of the sky's diffuse light used (`setEnvDiffuse`): all of it, so the noon sky / sun ratio stays ~0.17. */
  envDiffuse: 1,
  /** A cloud deck lets this share of the clear day's light through, more as the sun breaks through (`WeatherLook.sun`). */
  deckMin: 0.15,
  deckSun: 0.8,
  /** Ground albedo (the ground disc of the env map, the bounce): its colour comes from the map's grass. */
  albedo: 0.15,
  /** The sky light a closed stand of trees shuts out (`setSkyVis`): off a face turned sideways or down, off one turned up. */
  standCut: [0.8, 0.45] as const,
  /**
   * The share of the sky a crown's leaves see past the rest of the crown (`setSkyVis`), on top of their baked AO: the
   * default look's foliage takes about this much less sky than the ground (it never sampled the env map).
   */
  leaves: 0.4,
  /**
   * Camera white balance on the scene's light (sun, sky light; not the dome or the haze), r g b at unit luminance: a
   * little cooler than the atmosphere's neutral noon, so a sunlit grey road has the default look's colour (without it
   * the frame reads yellow).
   */
  white: [0.9 / 0.9947, 1 / 0.9947, 1.22 / 0.9947] as const,
};

const V2_WHITE = new Color(...V2.white);
const V2_WHITE_V = new Vector3(...V2.white);

export const DAY_LIGHT = {
  sun: 4.5,
  sunLow: 1.6,
  fill: 0.15,
  envDiffuse: 0.57,
  bounce: 0.75,
  warmLow: 2,
};
const CLASSIC_LIGHT: typeof DAY_LIGHT = {
  sun: 3.1,
  sunLow: 1.1,
  fill: 0.26,
  envDiffuse: 1,
  bounce: 0,
  warmLow: 1,
};
/** The env map's diffuse light on flat ground at `envIntensity` 1, about (the sky's share of the light the ground bounces). */
const ENV_SKY_IRRADIANCE = 2.3;

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
    fillIntensity:
      (def.fillIntensity ??
        MathUtils.lerp(DAY_LIGHT.fill, CLASSIC_LIGHT.fill, dark)) +
      0.5 * dark,
    // ... and all of the env map's: under a deck there is no sun for it to be weighed against.
    envDiffuse: MathUtils.lerp(def.envDiffuse ?? DAY_LIGHT.envDiffuse, 1, dark),
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
  mat.uniforms.skyLut = { value: null };
  mat.uniforms.skySunE = { value: new Color() };
  mat.uniforms.skyAmb = { value: new Color() };
  const out = 'gl_FragColor = vec4( texColor, 1.0 );';
  for (const s of [out, ...Object.keys(SKY_V2)])
    if (!mat.fragmentShader.includes(s))
      throw new Error('environment: Sky shader changed (three upgrade?)');
  for (const [from, to] of Object.entries(SKY_V2))
    mat.fragmentShader = mat.fragmentShader.replace(from, to);
  mat.fragmentShader = mat.fragmentShader
    .replace(
      'void main() {',
      'uniform float skyGain;\nuniform vec4 skyOvercast;\nuniform vec4 skyFog;\nuniform vec3 skyFogColor;\n' +
        SKY_V2_PARS +
        '\nvoid main() {',
    )
    .replace(
      out,
      'texColor = mix( texColor, skyOvercast.rgb * ( 0.5 + 0.5 * max( direction.y, 0.0 ) ), skyOvercast.a );\n\t\t\tgl_FragColor = vec4( texColor * skyGain, 1.0 );\n' +
        SKY_FOG_LAYER,
    );
  return sky;
}

/**
 * `?light=v2`: the sky dome drawn from the physical atmosphere's sky-view table (engine/atmosphere.ts, scene light),
 * its clouds lit by the same sun and sky, the sun disc in the sun's own colour (`SKY_V2`, `setSkyV2`).
 */
const SKY_V2_PARS = /* glsl */ `
uniform sampler2D skyLut;
uniform vec3 skySunE;
uniform vec3 skyAmb;
vec3 skyView( vec3 dir, vec3 sunDir ) {
	float az = acos( clamp( dot( normalize( dir.xz + vec2( 1e-5 ) ), normalize( sunDir.xz + vec2( 1e-5 ) ) ), -1.0, 1.0 ) ) / 3.14159265;
	float v = sqrt( clamp( asin( clamp( dir.y, 0.0, 1.0 ) ) / 1.5707963, 0.0, 1.0 ) );
	vec2 uv = ( vec2( az, v ) * vec2( ${SKY_LUT_W - 1}.0, ${SKY_LUT_H - 1}.0 ) + 0.5 ) / vec2( ${SKY_LUT_W}.0, ${SKY_LUT_H}.0 );
	return texture2D( skyLut, uv ).rgb;
}`;
/** Either / or (`SKY_V2` defined = light=v2): a define, so the compiler drops the Preetham terms the v2 sky leaves unused. */
const v2Or = (v2: string, old: string) =>
  `\n#ifdef SKY_V2\n${v2}\n#else\n${old}\n#endif\n`;
const SKY_V2: Record<string, string> = {
  'vec3 texColor = ( Lin + L0 ) * 0.04 + sundiscColor + vec3( 0.0, 0.0003, 0.00075 );':
    v2Or(
      'vec3 texColor = skyView( direction, vSunDirection ) + sundisc * skySunE * 1.4e4;',
      'vec3 texColor = ( Lin + L0 ) * 0.04 + sundiscColor + vec3( 0.0, 0.0003, 0.00075 );',
    ),
  'vec3 sunColor = vSunE * Fex * 0.22 * 0.04;': v2Or(
    'vec3 sunColor = skySunE * 0.22;',
    'vec3 sunColor = vSunE * Fex * 0.22 * 0.04;',
  ),
  'vec3 skyAmbient = Lin * 0.04 + vec3( 0.0, 0.0003, 0.00075 );': v2Or(
    'vec3 skyAmbient = skyAmb;',
    'vec3 skyAmbient = Lin * 0.04 + vec3( 0.0, 0.0003, 0.00075 );',
  ),
  // Preetham's extinction tints far clouds pink against the table's sky: fade them into the sky near the horizon instead.
  'vec3 cloudAerial = mix( texColor, cloudColor, Fex );': v2Or(
    'vec3 cloudAerial = mix( texColor, cloudColor, smoothstep( 0.0, 0.3, direction.y ) );',
    'vec3 cloudAerial = mix( texColor, cloudColor, Fex );',
  ),
};

/** The light=v2 sky program on / off (a define: recompiles on change). */
function setSkyV2(sky: Sky, on: boolean): void {
  const d = sky.material.defines as Record<string, string>;
  if (on === 'SKY_V2' in d) return;
  if (on) d.SKY_V2 = '';
  else delete d.SKY_V2;
  sky.material.needsUpdate = true;
}

/** `?tod=<hours>` (try a time of day on any map with `timeOfDay`), `?tonemap=aces|agx|neutral` and `?grade=off`. */
function urlNumber(name: string): number | undefined {
  const v = urlParam(name);
  return paramNumber(v, -1e6, 1e6, undefined);
}
function urlString(name: string): string | undefined {
  return urlParam(name) ?? undefined;
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
  /**
   * `light=v2`: the env scene's diffuse light (sky + ground disc) as SH9 for EVERY material (Lambert ones - trees,
   * crops, far forest, the horizon backdrop - take no IBL), while the env map gives reflections only (`setEnvDiffuse(0)`).
   * Added to the scene only then (it changes every program).
   */
  readonly probe = new LightProbe(undefined, 0);
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
  /** Share of the env map's diffuse light in use (`DAY_LIGHT.envDiffuse`; 1 at night and in the studio). */
  private envDiffuse = 1;
  /** The sun's intensity before a fog layer dims it (`update`). */
  private sunBase = 0;
  /** `?light=v2` daylight of this apply (null: the per-map light, at night and in the studio). */
  daylight: Daylight | null = null;
  /** `light=v2`: exposure from the metered light, before the display's factor. */
  private v2Exposure = 1;
  /** `light=v2`: the env map's ground disc radiance (scene units). */
  private v2Ground = new Color();
  /** `light=v2`: the haze's light round the view (the sky's horizon). */
  private v2Horizon: Daylight['horizon'] | null = null;
  private skyLut?: DataTexture;
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
  /**
   * Photo mode: the world clock (wind sway, cloud drift) stands still, so a motion blur drawn over several frames
   * averages one instant. Set to the clock's time (s) to hold it, `undefined` to let it run.
   */
  heldTime?: number;

  /** The world clock (s). */
  get time(): number {
    return this.heldTime ?? (performance.now() - this.t0) / 1000;
  }
  /** Studio softboxes in the env map (menu car screens): crisp panel highlights on paint and glass. */
  studio: boolean;
  /** Radiance of the env map's ground disc (below its horizon): the car's surroundings are lit like it (car-surround.ts). */
  readonly groundRadiance = new Color();

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
    // The viewport drawn into (a render scale draws the scene into part of the post target).
    const size = new Vector4();
    this.sky.onBeforeRender = (r) => {
      r.getCurrentViewport(size);
      setGradeViewport(size.z, size.w);
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
    shadowCasterLayers(cam);
    s.shadow.bias = -0.0004;
    s.shadow.normalBias = 0.04;
    s.shadow.radius = quality.shadowRadius;
    s.target = this.target;
    scene.add(s, this.target);

    this.pmrem = new PMREMGenerator(renderer);
    this.offDisplay = onDisplayChange(() => this.refreshExposure());
    this.apply(def);
  }

  /** The settings as last passed to `apply` (before golden hour, look and weather). */
  private source?: EnvironmentDef;

  /** Apply the last settings again (after a URL change: `light`, `look`, `tonemap`). */
  relight(): void {
    if (this.source) this.apply(this.source);
  }

  /** Re-apply settings (sun angle, fog, exposure) and rebuild the env map; `studio` = with softboxes (or keep). */
  apply(def: EnvironmentDef, studio = this.studio): void {
    this.source = def;
    // Evening golden hour (~17:00 till night): the map's `goldenHour` look over its day look.
    const at =
      def.timeOfDay !== undefined
        ? (urlNumber('tod') ?? def.timeOfDay)
        : undefined;
    if (
      def.goldenHour &&
      !studio &&
      !lightV2() &&
      at !== undefined &&
      isGoldenHour(at)
    )
      def = { ...def, ...def.goldenHour };
    const look = ownValue(LOOKS, urlString('look') ?? '');
    if (look) def = { ...def, ...look };
    const light =
      studio || urlString('look') === 'classic' ? CLASSIC_LIGHT : DAY_LIGHT;
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

    let envDiffuse = 1;
    this.daylight = null;
    setSkyV2(this.sky, false);
    setAerial(HAZE_TAIL);
    if (lightV2() && !this.night && !this.studio) {
      envDiffuse = this.applyDaylight(def, elevation);
    } else if (this.night) {
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
      else {
        const warm = low ** light.warmLow;
        this.sun.color.setRGB(1, 0.93 - warm * 0.2, 0.84 - warm * 0.38);
      }
      this.sun.intensity =
        (def.sunIntensity ?? light.sun - low * light.sunLow) *
        this.weatherLook.sun;
      // Under a rain deck there is no sun or moon disc, only the grey sky's light (no glint on the wet road).
      this.sun.castShadow = this.sun.intensity > 0;

      // Fill: cool sky light in the shadows, warm bounce from the map's ground.
      this.hemi.color.set(def.fillSky ?? '#9fb8e6');
      this.hemi.groundColor
        .set(def.groundTint?.grass ?? '#7a6a48')
        .lerp(new Color('#8a6a40'), 0.45)
        .multiplyScalar(0.7);
      this.hemi.intensity = def.fillIntensity ?? light.fill;
      envDiffuse = def.envDiffuse ?? light.envDiffuse;
      if (light.bounce > 0) {
        // The ground's bounce: its colour (half greyed: road, soil and shade mixed in) x the light that falls on it,
        // as the irradiance of a face looking straight down (the hemisphere light scales it by its intensity).
        const c = this.hemi.groundColor;
        const grey = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
        const onGround =
          this.sun.intensity * Math.sin(MathUtils.degToRad(elevation)) +
          (def.envIntensity ?? 0.3) * envDiffuse * ENV_SKY_IRRADIANCE +
          this.hemi.intensity * 0.5;
        c.lerp(new Color(grey, grey, grey), 0.5).multiplyScalar(
          (light.bounce * 0.2 * onGround) /
            Math.max(1e-3, grey * this.hemi.intensity),
        );
      }
    }
    this.envDiffuse = envDiffuse;
    // light=v2: the sky's diffuse light comes from the probe (`rebuildEnvMap`), the env map gives reflections only.
    setEnvDiffuse(this.daylight ? 0 : envDiffuse);
    setSkyVis(this.daylight ? V2.standCut : null, V2.leaves);
    // In the scene only under light=v2: a light probe turns on USE_LIGHT_PROBES in every program.
    if (this.daylight) this.scene.add(this.probe);
    else {
      this.probe.removeFromParent();
      this.probe.intensity = 0;
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
      (this.night
        ? NIGHT.exposure
        : this.daylight
          ? this.v2Exposure
          : this.def.exposure) * displayExposure();
  }

  /**
   * `?light=v2` by day: the sun, the sky dome and its light, the ground's bounce, the haze and the exposure from the
   * physical atmosphere at this sun height (engine/atmosphere.ts); a weather's cloud deck passes a share of the clear
   * day's light. Returns the share of the env map's diffuse light to use.
   */
  private applyDaylight(def: EnvironmentDef, elevation: number): number {
    const day = daylight(elevation, {
      mie: mieFromTurbidity(def.turbidity),
      altitude: V2.altitude,
      albedo: V2.albedo,
    });
    this.daylight = day;
    const w = this.weatherLook;
    const sinE = Math.sin(MathUtils.degToRad(elevation));
    const sunL = luminance(day.sun);
    this.sun.color.setRGB(
      day.sun[0] / sunL,
      day.sun[1] / sunL,
      day.sun[2] / sunL,
    );
    this.sun.color.multiply(V2_WHITE);
    this.sun.intensity = sunL * w.sun;
    this.sun.castShadow = this.sun.intensity > 0;
    // The sky: the table in scene light; a cloud deck (rain, overcast) passes a share of the clear day's light,
    // spread as a sky twice as bright overhead as at the horizon (`patchSky`: E = 0.83 pi Lz).
    const sky = [...day.sky];
    const u = this.sky.material.uniforms;
    setSkyV2(this.sky, true);
    u.skyLut.value = this.skyTexture(day.lut);
    u.skyGain.value = 1;
    (u.skySunE.value as Color)
      .setRGB(day.sun[0], day.sun[1], day.sun[2])
      .multiplyScalar(w.sun);
    (u.skyAmb.value as Color)
      .setRGB(sky[0], sky[1], sky[2])
      .multiplyScalar(1 / Math.PI);
    let horizon = day.horizon;
    if (w.deck > 0) {
      const clear = sunL * sinE + luminance(day.sky);
      const through = clear * (V2.deckMin + V2.deckSun * w.sun);
      // All of it from the deck (the dimmed sun the game keeps under it is for shape, not taken out of the deck:
      // subtracting it left the deck darker than the ground).
      const deckE = through;
      const lz = deckE / (0.833 * Math.PI);
      u.skyOvercast.value.set(lz, lz, lz * 1.04, 1);
      sky[0] = deckE;
      sky[1] = deckE;
      sky[2] = deckE * 1.04;
      (u.skyAmb.value as Color).setRGB(lz, lz, lz * 1.04);
      // The deck's horizon: half its zenith, the same all round.
      const h = lz * 0.5;
      horizon = { a: [h, h, h * 1.04], b: [0, 0, 0], d: [0, 0, 0] };
    }
    this.v2Horizon = horizon;
    // Bounce: the env map's ground disc at the radiance of the map's ground under this light (`rebuildEnvMap`).
    const onGround = this.sun.intensity * sinE + luminance(sky);
    const g = new Color(def.groundTint?.grass ?? '#7a6a48').lerp(
      new Color('#6b5a3e'),
      0.5,
    );
    const grey = luminance([g.r, g.g, g.b]);
    g.lerp(new Color(grey, grey, grey), 0.65).multiplyScalar(
      (V2.albedo * onGround) / Math.PI / Math.max(1e-3, grey),
    );
    this.v2Ground.copy(g);
    // The hemisphere light carries the sky only until the probe is ready (`rebuildEnvMap`); its colour stays the sky's,
    // for the dust (rally-game.ts `lightParticles`).
    this.hemi.color.setRGB(sky[0], sky[1], sky[2]).multiply(V2_WHITE);
    this.hemi.groundColor.copy(g).multiplyScalar(Math.PI);
    this.hemi.intensity = this.probe.intensity > 0 ? 0 : V2.envDiffuse;
    // Meter: the light on sunlit flat ground, against the same at this map's noon (`V2`).
    const noon = this.noonLight(def);
    this.v2Exposure = meteredExposure(
      def.exposure,
      V2.lit,
      noon,
      onGround,
      V2.adapt,
    );
    setAerial(HAZE_TAIL, undefined, day.extinction);
    return V2.envDiffuse;
  }

  /** `light=v2`: the light on sunlit flat ground under a clear noon sun through this map's air (cached per air). */
  private noonLight(def: EnvironmentDef): number {
    const mie = mieFromTurbidity(def.turbidity);
    let e = this.noonCache.get(mie);
    if (e === undefined) {
      const day = daylight(NOON_ELEVATION, {
        mie,
        altitude: V2.altitude,
        albedo: V2.albedo,
      });
      e =
        luminance(day.sun) * Math.sin(MathUtils.degToRad(NOON_ELEVATION)) +
        luminance(day.sky);
      this.noonCache.set(mie, e);
    }
    return e;
  }
  private noonCache = new Map<number, number>();

  /** The sky-view table as a half-float texture (made once, refilled per apply). */
  private skyTexture(lut: Float32Array): DataTexture {
    const n = SKY_LUT_W * SKY_LUT_H;
    if (!this.skyLut) {
      this.skyLut = new DataTexture(
        new Uint16Array(n * 4),
        SKY_LUT_W,
        SKY_LUT_H,
        RGBAFormat,
        HalfFloatType,
      );
      this.skyLut.magFilter = this.skyLut.minFilter = LinearFilter;
      this.skyLut.wrapS = this.skyLut.wrapT = ClampToEdgeWrapping;
      this.skyLut.generateMipmaps = false;
    }
    const data = this.skyLut.image.data as Uint16Array;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++)
        data[i * 4 + c] = DataUtils.toHalfFloat(Math.min(6e4, lut[i * 3 + c]));
      data[i * 4 + 3] = DataUtils.toHalfFloat(1);
    }
    this.skyLut.needsUpdate = true;
    return this.skyLut;
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
    setSkyV2(sky, !!this.daylight);
    dst.skyLut.value = src.skyLut.value;
    (dst.skySunE.value as Color).copy(src.skySunE.value);
    (dst.skyAmb.value as Color).copy(src.skyAmb.value);
    // light=v2: no sun disc in the env map (the sun is the directional light; its disc in the PMREM lit everything twice).
    if (this.daylight) dst.showSunDisc.value = 0;
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
    if (this.daylight) groundCol.copy(this.v2Ground);
    this.groundRadiance.copy(groundCol);
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
    // light=v2: the sky is in scene light already.
    this.scene.environmentIntensity = this.night
      ? NIGHT.envIntensity
      : this.daylight
        ? 1
        : (this.def.envIntensity ?? 0.3);
    // The same sky's diffuse light as spherical harmonics, for the tree foliage (it does not sample the env map:
    // trees/materials.ts `setTreeSky`). A tiny cube of the environment scene, read back once.
    const cube = new WebGLCubeRenderTarget(32);
    new CubeCamera(0.1, 2000, cube).update(this.renderer, envScene);
    const intensity = this.scene.environmentIntensity;
    const diffuse = this.envDiffuse;
    if (!this.night && this.def.fogColor === 'sky' && this.scene.fog)
      this.scene.fog.color.copy(this.horizonColor(envScene));
    const v2 = !!this.daylight;
    void LightProbeGenerator.fromCubeRenderTarget(this.renderer, cube)
      .then((probe) => {
        // light=v2: the probe lights everything, trees included (their own SH term off); the hemisphere light
        // carried the sky until it was ready.
        setTreeSky(probe.sh.coefficients, v2 ? 0 : intensity * diffuse);
        if (v2 && this.daylight) {
          this.probe.sh.copy(probe.sh);
          for (const c of this.probe.sh.coefficients) c.multiply(V2_WHITE_V);
          this.probe.intensity = intensity * diffuse;
          this.hemi.intensity = 0;
        }
      })
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
    // Aerial perspective before tone mapping by day (`?haze=off`: the display-space fog of before).
    const fog = this.scene.fog;
    const hz = this.daylight && this.v2Horizon;
    if (hz && fog && !HAZE_OFF) setSkyHaze(hz.a, hz.b, hz.d);
    else
      setHaze(
        this.night || !fog || HAZE_OFF ? null : fog.color,
        this.renderer.toneMappingExposure,
      );
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
    setWorldTime(this.time);
    this.sky.material.uniforms.time.value =
      this.time * (this.def.cloudSpeed ?? 1);
  }

  /** Kept by `warmOutdoor` so its programs stay compiled (three frees a program with its last material). */
  private warm?: { sky: Sky; ground: MeshBasicMaterial };

  /**
   * Compile the programs of the outdoor env map pass (sky + ground disc drawn into a cube target, `rebuildEnvMap`)
   * without drawing anything, in the background where the GPU allows it (KHR_parallel_shader_compile). The menu
   * builds only the studio env map until the stage screen, whose first view otherwise waited on these.
   */
  warmOutdoor(): Promise<unknown> {
    if (this.warm) return Promise.resolve();
    const sky = patchSky(new Sky());
    const ground = new MeshBasicMaterial({ fog: false });
    this.warm = { sky, ground };
    const scene = new Scene();
    const disc = new PlaneGeometry();
    scene.add(sky, new Mesh(disc, ground));
    // Programs differ for a render target (linear output, no tone mapping): compile them as the cube pass sees them.
    const target = new WebGLCubeRenderTarget(1, { type: HalfFloatType });
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    const done = this.renderer.compileAsync(scene, new PerspectiveCamera());
    this.renderer.setRenderTarget(prev);
    return done.finally(() => {
      target.dispose();
      disc.dispose();
    });
  }

  dispose(): void {
    this.offDisplay();
    if (this.warm) {
      this.warm.sky.material.dispose();
      this.warm.sky.geometry.dispose();
      this.warm.ground.dispose();
    }
    this.nightSky.dispose();
    this.envMap?.dispose();
    this.skyLut?.dispose();
    this.pmrem.dispose();
  }
}
