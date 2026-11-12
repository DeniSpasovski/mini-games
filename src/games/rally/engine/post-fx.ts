import {
  AddEquation,
  Color,
  CustomBlending,
  DepthTexture,
  HalfFloatType,
  LinearFilter,
  NoBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  type PerspectiveCamera,
  type Scene,
  ShaderMaterial,
  SRGBColorSpace,
  SrcAlphaFactor,
  Vector2,
  Vector3,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { gradeUniforms } from './grade';
import { worldUniforms } from './world-shading';

/** Night glow strength at full darkness; scaled by the square of `Environment.lightNeed`. */
const NIGHT_STRENGTH = 0.5;
/** Linear scene brightness above which things glow at night. The beam lights the ground to tens, so lamp lenses and reflectors are emissive far above it (`night-glow.ts`). */
const NIGHT_THRESHOLD = 20;
const NIGHT_RADIUS = 0.35;

/**
 * Daytime bloom (mix from the Bloom option, `BLOOM_MIX` in game/settings.ts): the whole HDR image, no threshold, blurred through a mip chain and mixed back in at a few percent
 * (the energy-conserving bloom of Jimenez 2014, "Next generation post processing in Call of Duty: AW", also Unreal's
 * default). Bright things (sun, sky, sunlit chrome and paint, wet glints) spread light because they are bright, not
 * because they cross a cut-off, so nothing pops in or out.
 */
/** Bloom source brightness cap (linear, the sky is ~5-10 and the sun far above). */
const BLOOM_CAP = 32;
/** Mip levels below half resolution (half, quarter ... 1/64). */
const DAY_MIPS = 6;

/** Screen-space ambient occlusion (GTAO, Jimenez 2016) at half resolution: contact darkening the baked AO can't give (car on the road, wheel arches, walls, kerbs). */
const AO = {
  radius: 0.9,
  distanceExponent: 2,
  thickness: 3,
  distanceFallOff: 1,
  scale: 1,
  samples: 12,
};
const AO_INTENSITY = 0.7;

const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4( position.xy, 0.0, 1.0 );
  }`;

/**
 * Runs first: a NaN or infinite pixel (a normalize of zero, a highlight past the half-float range) would be blurred
 * into a black square by a bloom's mip chain. Such a pixel takes the mean of its finite neighbours, and values are
 * capped well above the night bloom threshold.
 */
const SANITIZE = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float decode;
  // Render scale (\`PostFx.setScale\`): the scene fills this share of the target from its corner; uv max clamps the
  // bilinear upscale inside it.
  uniform vec2 uvScale;
  uniform vec2 uvMax;
  // Share of this image in a motion blur mean (\`render\` with a shutter); 1 otherwise.
  uniform float weight;
  varying vec2 vUv;
  // Display mode: the target holds the finished picture (sRGB, tone mapped); back to an HDR estimate by the inverse of
  // c / (1 + max(c)) (hue kept; ENCODE undoes it exactly). decode 2 (a motion blur image) stops at the linear picture:
  // the estimate makes a near-white pixel hundreds of times brighter than its neighbours, so one image of a white
  // tyre print would outweigh every image of the black tyre around it (SHUTTER_MIX takes the mean to the estimate).
  vec3 toHdr( vec3 c ) {
    if ( decode < 0.5 ) return c;
    vec3 l = mix( c / 12.92, pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), step( 0.04045, c ) );
    l = clamp( l, 0.0, 1.0 );
    if ( decode > 1.5 ) return l;
    return l / ( 1.0 - min( max( l.r, max( l.g, l.b ) ), 0.999 ) );
  }
  bool ok( vec3 c ) {
    // Comparisons with NaN are false, so NaN fails both.
    return max( c.r, max( c.g, c.b ) ) < 1.0e4 && min( c.r, min( c.g, c.b ) ) > - 1.0e4;
  }
  void main() {
    vec2 uv = min( vUv * uvScale, uvMax );
    vec4 c = texture2D( tDiffuse, uv );
    if ( ok( c.rgb ) ) {
      gl_FragColor = vec4( min( toHdr( c.rgb ), vec3( 2000.0 ) ), c.a ) * weight;
      return;
    }
    vec2 px = 1.0 / vec2( textureSize( tDiffuse, 0 ) );
    vec3 sum = vec3( 0.0 );
    float n = 0.0;
    for ( int i = 0; i < 4; i++ ) {
      vec2 o = i == 0 ? vec2( px.x, 0.0 ) : i == 1 ? vec2( - px.x, 0.0 ) : i == 2 ? vec2( 0.0, px.y ) : vec2( 0.0, - px.y );
      vec3 s = texture2D( tDiffuse, uv + o ).rgb;
      if ( ok( s ) ) { sum += s; n += 1.0; }
    }
    gl_FragColor = vec4( n > 0.0 ? min( toHdr( sum / n ), vec3( 2000.0 ) ) : vec3( 0.0 ), 1.0 ) * weight;
  }`;

/**
 * Motion blur (\`PostFx.render\` with a shutter): a copy with an opacity (a frame's images blended into the running
 * mean) and, with \`decode\`, the mean of the linear pictures taken to the HDR estimate (SANITIZE's \`toHdr\`).
 */
const SHUTTER_MIX = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float decode, opacity;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D( tDiffuse, vUv ).rgb;
    if ( decode > 0.5 ) {
      c = clamp( c, 0.0, 1.0 );
      c /= 1.0 - min( max( c.r, max( c.g, c.b ) ), 0.999 );
    }
    gl_FragColor = vec4( c, opacity );
  }`;

/** Display mode, last pass: the HDR estimate back to the picture (exact inverse of SANITIZE's decode). */
const ENCODE = /* glsl */ `
  uniform sampler2D tDiffuse;
  varying vec2 vUv;
  void main() {
    vec3 h = max( texture2D( tDiffuse, vUv ).rgb, 0.0 );
    vec3 l = min( h / ( 1.0 + max( h.r, max( h.g, h.b ) ) ), 1.0 );
    gl_FragColor = vec4( mix( l * 12.92, 1.055 * pow( l, vec3( 1.0 / 2.4 ) ) - 0.055, step( 0.0031308, l ) ), 1.0 );
  }`;

/** 13-tap downsample (Jimenez 2014). The first level weighs each 2x2 group by 1 / (1 + luma) (Karis average): a lone sun glint can't flicker into a big blob. */
const DOWN = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 texel;
  uniform float karis;
  varying vec2 vUv;
  uniform float cap;
  vec3 s( float x, float y ) {
    vec3 c = texture2D( tSrc, vUv + texel * vec2( x, y ) ).rgb;
    // First level: the brightest pixels (the sun, a glint) are capped so they spread as a glow, not a flood.
    float m = max( c.r, max( c.g, c.b ) );
    return karis > 0.5 && m > cap ? c * ( cap / m ) : c;
  }
  vec4 group( vec3 a, vec3 b, vec3 c, vec3 d, float k ) {
    vec3 m = ( a + b + c + d ) * 0.25;
    if ( karis > 0.5 ) k /= 1.0 + dot( m, vec3( 0.2126, 0.7152, 0.0722 ) );
    return vec4( m * k, k );
  }
  void main() {
    vec3 a = s( -2.0, 2.0 ), b = s( 0.0, 2.0 ), c = s( 2.0, 2.0 );
    vec3 d = s( -2.0, 0.0 ), e = s( 0.0, 0.0 ), f = s( 2.0, 0.0 );
    vec3 g = s( -2.0, -2.0 ), h = s( 0.0, -2.0 ), i = s( 2.0, -2.0 );
    vec3 j = s( -1.0, 1.0 ), k = s( 1.0, 1.0 ), l = s( -1.0, -1.0 ), m = s( 1.0, -1.0 );
    vec4 o = group( j, k, l, m, 0.5 )
      + group( a, b, d, e, 0.125 ) + group( b, c, e, f, 0.125 )
      + group( d, e, g, h, 0.125 ) + group( e, f, h, i, 0.125 );
    gl_FragColor = vec4( o.rgb / o.a, 1.0 );
  }`;

/** 3x3 tent upsample, added onto the next larger level. */
const UP = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 texel;
  varying vec2 vUv;
  vec3 s( float x, float y ) { return texture2D( tSrc, vUv + texel * vec2( x, y ) ).rgb; }
  void main() {
    vec3 o = s( 0.0, 0.0 ) * 4.0
      + ( s( -1.0, 0.0 ) + s( 1.0, 0.0 ) + s( 0.0, -1.0 ) + s( 0.0, 1.0 ) ) * 2.0
      + s( -1.0, -1.0 ) + s( 1.0, -1.0 ) + s( -1.0, 1.0 ) + s( 1.0, 1.0 );
    gl_FragColor = vec4( o / 16.0, 1.0 );
  }`;

/** Scene mixed with the bloom (the bloom sum is normalised by its level count). */
const MIX = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tBloom;
  uniform float strength;
  uniform float levels;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D( tScene, vUv );
    vec3 b = texture2D( tBloom, vUv ).rgb / levels;
    gl_FragColor = vec4( mix( c.rgb, b, strength ), c.a );
  }`;

/**
 * Rain drops on the lens: two layers of procedural drops (big and small cells), each drop a little lens that shows the
 * scene behind it upside down and blurred at the rim. A drop appears, sits, runs down (or, at speed, is blown out from
 * the centre by the air) and dries. `amount` 0..1 is how many cells hold a drop.
 */
const DROPS = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float time;
  uniform float amount;
  uniform float speed;
  uniform float aspect;
  varying vec2 vUv;
  float h( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
  vec3 drop( vec2 uv, float cells, float seed, float size ) {
    vec2 p = uv * vec2( cells * aspect, cells );
    vec2 id = floor( p );
    vec2 f = fract( p ) - 0.5;
    float r1 = h( id + seed );
    float r2 = h( id + seed + 7.31 );
    float r3 = h( id + seed + 3.17 );
    if ( r3 > amount ) return vec3( 0.0 );
    float t = fract( time / ( 2.5 + 4.0 * r2 ) + r1 );
    vec2 flow = mix( vec2( 0.0, -0.25 ), normalize( uv - 0.5 + vec2( 1e-4 ) ) * 0.5, speed );
    vec2 c = ( vec2( r1, r2 ) - 0.5 ) * 0.3 + flow * smoothstep( 0.2, 1.0, t ) * ( 0.2 + 0.3 * speed );
    float rad = size * ( 0.6 + 0.4 * r3 / max( amount, 1e-3 ) );
    vec2 d = ( f - c ) / rad;
    d.y *= 1.0 + 0.6 * smoothstep( 0.3, 1.0, t );
    float l = length( d );
    float fade = smoothstep( 0.0, 0.04, t ) * ( 1.0 - smoothstep( 0.6, 1.0, t ) );
    return vec3( d, ( 1.0 - smoothstep( 0.8, 1.0, l ) ) * fade );
  }
  void main() {
    vec3 a = drop( vUv, 7.0, 0.0, 0.2 );
    vec3 b = drop( vUv, 19.0, 13.7, 0.22 );
    vec3 d = a.z >= b.z ? a : b;
    vec4 c = texture2D( tDiffuse, vUv );
    if ( d.z <= 0.0 ) { gl_FragColor = c; return; }
    float l = length( d.xy );
    // A water lens: the view behind it flipped and squeezed, darker towards the rim (refraction out of the frame).
    vec2 uvR = vUv - d.xy * vec2( 1.0 / aspect, 1.0 ) * 0.012;
    vec3 r = texture2D( tDiffuse, uvR ).rgb * ( 1.0 - 0.18 * smoothstep( 0.6, 1.0, l ) );
    // The sky's light caught at the top of the drop.
    r += 0.05 * smoothstep( 0.35, 0.0, length( d.xy - vec2( -0.25, 0.45 ) ) );
    gl_FragColor = vec4( mix( c.rgb, r, 0.85 * d.z ), c.a );
  }`;

/** Photo mode lens blur: taps per pixel (golden-angle spiral, turned per pixel so the pattern doesn't band). */
const PHOTO_TAPS = 64;

/**
 * Photo mode (game/photo/): thin-lens depth of field and exposure on the HDR image. The blur radius of a point at z m is
 * `lens * |z - focus| / z` px (`photoLens`); gather only, so the sharp car never bleeds into the blurred background
 * behind it (a nearer sample counts only if its own blur reaches the pixel).
 */
const PHOTO = /* glsl */ `
  #include <packing>
  uniform sampler2D tDiffuse, tDepth;
  uniform vec2 texel, depthUvScale;
  uniform float near, far, focus, lens, maxPx, exposure;
  varying vec2 vUv;
  float viewZ( vec2 uv ) {
    return - perspectiveDepthToViewZ( texture2D( tDepth, uv * depthUvScale ).x, near, far );
  }
  float coc( float z ) {
    return min( maxPx, lens * abs( z - focus ) / max( z, 1e-3 ) );
  }
  void main() {
    vec3 c0 = texture2D( tDiffuse, vUv ).rgb;
    float z0 = viewZ( vUv );
    float r0 = coc( z0 );
    vec3 acc = c0;
    float wsum = 1.0;
    if ( r0 > 0.5 ) {
      // Interleaved gradient noise: a per-pixel turn of the spiral.
      float turn = 6.2832 * fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
      for ( int i = 0; i < ${PHOTO_TAPS}; i++ ) {
        float t = ( float( i ) + 0.5 ) / float( ${PHOTO_TAPS} );
        float rad = sqrt( t ) * r0;
        float a = float( i ) * 2.39996 + turn;
        vec2 uv = vUv + vec2( cos( a ), sin( a ) ) * rad * texel;
        float z = viewZ( uv );
        float w = z >= z0 - 0.3 ? 1.0 : smoothstep( rad * 0.5, rad, coc( z ) );
        acc += texture2D( tDiffuse, uv ).rgb * w;
        wsum += w;
      }
    }
    gl_FragColor = vec4( acc / wsum * exposure, 1.0 );
  }`;

/**
 * Photo mode filters (the finished picture's look, `PHOTO_LOOK`): saturation (1 = as is), contrast (0 = as is, an
 * S-curve), a colour tint, faded blacks (0..1) and dark corners (0..1, the share taken off in a corner).
 */
const FILTER = {
  sat: 1,
  contrast: 0,
  tint: [1, 1, 1] as readonly number[],
  fade: 0,
  vignette: 0,
};
export const PHOTO_FILTERS = {
  none: { ...FILTER, label: 'None' },
  vivid: { ...FILTER, label: 'Vivid', sat: 1.35, contrast: 0.4 },
  warm: {
    ...FILTER,
    label: 'Warm',
    sat: 1.1,
    contrast: 0.15,
    tint: [1.06, 1, 0.9],
  },
  cool: {
    ...FILTER,
    label: 'Cool',
    sat: 1.02,
    contrast: 0.15,
    tint: [0.93, 1, 1.08],
  },
  faded: {
    ...FILTER,
    label: 'Faded',
    sat: 0.78,
    tint: [1.03, 1, 0.96],
    fade: 1,
  },
  mono: { ...FILTER, label: 'Black & white', sat: 0, contrast: 0.35 },
  vignette: { ...FILTER, label: 'Vignette', vignette: 0.7 },
};
export type PhotoFilter = keyof typeof PHOTO_FILTERS;

/**
 * Photo mode, last pass: the filter on the finished picture (sRGB, as the screen gets it), mixed in by `strength`.
 */
const PHOTO_LOOK = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec3 tint;
  uniform float sat, contrast, fade, vignette, aspect, strength;
  varying vec2 vUv;
  void main() {
    vec3 c0 = clamp( texture2D( tDiffuse, vUv ).rgb, 0.0, 1.0 );
    vec3 c = mix( vec3( dot( c0, vec3( 0.2126, 0.7152, 0.0722 ) ) ), c0, sat );
    c = clamp( c * tint, 0.0, 1.0 );
    c = mix( c, c * c * ( 3.0 - 2.0 * c ), contrast );
    c = mix( c, c * 0.84 + 0.1, fade );
    // Darker towards the corners (0 at the middle, 1 in a corner).
    vec2 p = ( vUv - 0.5 ) * vec2( aspect, 1.0 );
    float d = length( p ) / length( vec2( aspect, 1.0 ) * 0.5 );
    c *= 1.0 - vignette * smoothstep( 0.3, 1.05, d );
    gl_FragColor = vec4( mix( c0, c, strength ), 1.0 );
  }`;

/** Photo mode camera (game/photo/photo-mode.ts): what the lens pass needs. */
export interface PhotoLens {
  /** Focus distance (m). */
  focus: number;
  /** Focal length (mm, 35 mm full frame: 24 mm sensor height). */
  focal: number;
  /** Aperture (f-number); 0 = no blur. */
  fStop: number;
  /** Exposure compensation (EV). */
  ev: number;
  /** The picture's look (`PHOTO_FILTERS`). */
  filter: PhotoFilter;
  /** How much of the filter is mixed in, 0..1. */
  filterStrength: number;
}

/** Sensor height of a 35 mm full-frame camera (mm): the focal length to field of view. */
export const SENSOR_MM = 24;

/**
 * Thin-lens blur: a point at z m has a circle of confusion of `A * |z - s| / z` mm on the sensor with
 * A = f^2 / (N (s - f)); returned as the blur radius factor in px for an image `height` px tall.
 */
export function photoLens(l: PhotoLens, height: number): number {
  if (l.fStop <= 0) return 0;
  const f = l.focal / 1000;
  const s = Math.max(l.focus, f * 1.5);
  const a = (f * f) / (l.fStop * (s - f));
  return (0.5 * a * 1000 * height) / SENSOR_MM;
}

function quadMaterial(
  fragmentShader: string,
  uniforms: Record<string, { value: unknown }>,
): ShaderMaterial {
  return new ShaderMaterial({
    uniforms,
    vertexShader: QUAD_VERT,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
  });
}

export interface PostFxOptions {
  /** `Environment.lightNeed`: the night glow around lamps and reflectors from LIGHTS_MIN_NEED up. */
  night: number;
  /** Daytime bloom mix (0 = off). */
  day: number;
  ao: boolean;
  /** Rain drops on the lens, 0..1 (0 = none). */
  drops: number;
  /** How hard the air blows them off (0 parked ... 1 fast), 0..1. */
  dropSpeed: number;
  /** Photo mode lens (depth of field, exposure); null = none. Lens drops are off while it is set. */
  photo: PhotoLens | null;
}

/** Photo mode motion blur (`PostFx.render`): the open shutter as many images of the scene, averaged. */
export interface Shutter {
  /** Images across the shutter (rounded up to whole frames of `perFrame`). */
  samples: number;
  /** Images drawn per frame; the picture gets smoother over the next frames until all are in. */
  perFrame: number;
  /** Move the car / camera to `t` (-0.5 ... 0.5 of the shutter time). */
  pose: (t: number) => void;
  /** The view or the shutter changed: start over. */
  restart: boolean;
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

/**
 * High quality post effects on a half-float copy of the scene (see `display` for day vs night).
 * - night bloom: lamps, reflectors and the beam glow at dusk and night (threshold bloom);
 * - day bloom: soft light spread from everything bright (soft light spread from everything bright);
 * - AO: screen-space ambient occlusion (GTAO) from the scene depth;
 * - rain drops on the lens (`drops`, in the rain).
 * Live: `__rally.post.set({ day: 0.06, ao: true })`.
 */
export class PostFx {
  private readonly scene: WebGLRenderTarget;
  private a: WebGLRenderTarget;
  private b: WebGLRenderTarget;
  private readonly mips: WebGLRenderTarget[] = [];
  private readonly quad = new FullScreenQuad();
  private readonly sanitize = quadMaterial(SANITIZE, {
    tDiffuse: { value: null },
    decode: { value: 0 },
    uvScale: { value: new Vector2(1, 1) },
    uvMax: { value: new Vector2(1, 1) },
    weight: { value: 1 },
  });
  /** SANITIZE added onto the target (motion blur: the mean of one frame's images). */
  private readonly sanitizeAdd: ShaderMaterial;
  /** Motion blur: a frame's images blended into `shutterMean`, and the mean handed on to the effects. */
  private readonly shutterBlend = quadMaterial(SHUTTER_MIX, {
    tDiffuse: { value: null },
    decode: { value: 0 },
    opacity: { value: 1 },
  });
  private readonly shutterOut = quadMaterial(SHUTTER_MIX, {
    tDiffuse: { value: null },
    decode: { value: 0 },
    opacity: { value: 1 },
  });
  /** Motion blur: the mean of the images drawn so far (made on first use, `releaseShutter`). */
  private shutterMean?: WebGLRenderTarget;
  /** Motion blur progress: images in the mean, the total and the step through them. */
  private readonly shutter = { done: 0, total: 0, stride: 1 };
  /** Render scale: the scene is drawn into this share of the full-size target (a viewport, no resize). */
  private scale = 1;
  /** Depth uv scale handed to the AO's shaders (`scaledDepth`). */
  private readonly depthUvScale = { value: new Vector2(1, 1) };
  private readonly encode = quadMaterial(ENCODE, { tDiffuse: { value: null } });
  private readonly down = quadMaterial(DOWN, {
    tSrc: { value: null },
    texel: { value: new Vector2() },
    karis: { value: 0 },
    cap: { value: BLOOM_CAP },
  });
  private readonly up = quadMaterial(UP, {
    tSrc: { value: null },
    texel: { value: new Vector2() },
  });
  private readonly mixer = quadMaterial(MIX, {
    tScene: { value: null },
    tBloom: { value: null },
    strength: { value: 0 },
    levels: { value: DAY_MIPS },
  });
  private readonly drops = quadMaterial(DROPS, {
    tDiffuse: { value: null },
    time: { value: 0 },
    amount: { value: 0 },
    speed: { value: 0 },
    aspect: { value: 1 },
  });
  private readonly lens = quadMaterial(PHOTO, {
    tDiffuse: { value: null },
    tDepth: { value: null },
    texel: { value: new Vector2() },
    depthUvScale: { value: new Vector2(1, 1) },
    near: { value: 0.1 },
    far: { value: 1000 },
    focus: { value: 8 },
    lens: { value: 0 },
    maxPx: { value: 24 },
    exposure: { value: 1 },
  });
  private readonly look = quadMaterial(PHOTO_LOOK, {
    tDiffuse: { value: null },
    tint: { value: new Vector3(1, 1, 1) },
    sat: { value: 1 },
    contrast: { value: 0 },
    fade: { value: 0 },
    vignette: { value: 0 },
    aspect: { value: 1 },
    strength: { value: 1 },
  });
  private readonly nightBloom: UnrealBloomPass;
  private readonly gtao: GTAOPass;
  private readonly output = new OutputPass();
  readonly opts: PostFxOptions;
  /**
   * Day: the scene is drawn exactly as on the canvas and the effects work on an HDR estimate of it (SANITIZE / ENCODE),
   * so with them off the picture is unchanged. Night: the scene is drawn linear and `OutputPass` tone maps it (the
   * night glow's threshold is in real scene brightness); fog then sits before the tone mapping, as approved for night.
   */
  private readonly display: boolean;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly world: Scene,
    private readonly camera: PerspectiveCamera,
    antialias: boolean,
    opts: Partial<PostFxOptions> = {},
  ) {
    this.opts = {
      night: 0,
      day: 0,
      ao: false,
      drops: 0,
      dropSpeed: 0,
      photo: null,
      ...opts,
    };
    const depthTexture = new DepthTexture(1, 1);
    this.scene = new WebGLRenderTarget(1, 1, {
      type: HalfFloatType,
      samples: antialias ? 4 : 0,
      depthTexture,
    });
    this.display = this.opts.night <= 0;
    if (this.display) {
      // three tone maps, grades, encodes and fogs (fog comes after the tone mapping in its shaders) only for the canvas
      // or an XR target; flagged as one, this target gets exactly the canvas picture.
      (this.scene as { isXRRenderTarget?: boolean }).isXRRenderTarget = true;
      this.scene.texture.colorSpace = SRGBColorSpace;
      this.sanitize.uniforms.decode.value = 1;
    }
    this.a = new WebGLRenderTarget(1, 1, {
      type: HalfFloatType,
      depthBuffer: false,
    });
    this.b = this.a.clone();
    for (let i = 0; i < DAY_MIPS; i++) {
      const t = this.a.clone();
      t.texture.minFilter = t.texture.magFilter = LinearFilter;
      this.mips.push(t);
    }
    this.sanitizeAdd = this.sanitize.clone();
    this.sanitizeAdd.uniforms = this.sanitize.uniforms;
    this.sanitizeAdd.blending = CustomBlending;
    this.sanitizeAdd.blendEquation = AddEquation;
    this.sanitizeAdd.blendSrc = OneFactor;
    this.sanitizeAdd.blendDst = OneFactor;
    this.sanitizeAdd.blendSrcAlpha = OneFactor;
    this.sanitizeAdd.blendDstAlpha = OneFactor;
    this.shutterBlend.blending = CustomBlending;
    this.shutterBlend.blendEquation = AddEquation;
    this.shutterBlend.blendSrc = SrcAlphaFactor;
    this.shutterBlend.blendDst = OneMinusSrcAlphaFactor;
    this.up.blending = CustomBlending;
    this.up.blendEquation = AddEquation;
    this.up.blendSrc = OneFactor;
    this.up.blendDst = OneFactor;
    this.nightBloom = new UnrealBloomPass(
      new Vector2(256, 256),
      0,
      NIGHT_RADIUS,
      NIGHT_THRESHOLD,
    );
    // Normals come from the depth (no second scene render). Passing the depth to the constructor trips over a missing
    // normal target (three r186), so it is set after.
    this.gtao = new GTAOPass(world, camera, 1, 1);
    this.gtao.setGBuffer(depthTexture);
    this.gtao.updateGtaoMaterial(AO);
    this.gtao.blendIntensity = AO_INTENSITY;
    for (const m of [this.gtao.gtaoMaterial, this.gtao.pdMaterial])
      scaledDepth(m, this.depthUvScale);
    // The grade lives in the tone-mapping chunk; OutputPass needs the shared uniforms or it renders ungraded.
    Object.assign(this.output.material.uniforms, gradeUniforms);
    this.set(this.opts);
    renderer.domElement.addEventListener('resized', this.onResize);
    this.resize();
  }

  /** True when any effect is on or the scene is drawn at a render scale (else the caller renders directly). */
  get active(): boolean {
    return (
      this.nightOn ||
      this.opts.day > 0 ||
      this.opts.ao ||
      this.opts.drops > 0 ||
      !!this.opts.photo ||
      this.scale < 1
    );
  }

  /**
   * Render scale without a resize (three r187: a render target's viewport is in its own pixels): the scene is drawn
   * into the corner of the full-size target and SANITIZE upscales it, the effects after it run at full size. A step
   * only changes a viewport and a few uniforms, where resizing the canvas and every target was a 70-180 ms hitch.
   */
  setScale(scale: number): void {
    this.scale = scale;
    this.applyScale();
  }

  private applyScale(): void {
    const t = this.scene;
    const w = Math.max(1, Math.round(t.width * this.scale));
    const h = Math.max(1, Math.round(t.height * this.scale));
    t.viewport.set(0, 0, w, h);
    t.scissor.set(0, 0, w, h);
    t.scissorTest = this.scale < 1;
    const u = this.sanitize.uniforms;
    u.uvScale.value.set(w / t.width, h / t.height);
    u.uvMax.value.set((w - 0.5) / t.width, (h - 0.5) / t.height);
    this.depthUvScale.value.copy(u.uvScale.value);
  }

  private get nightOn(): boolean {
    return this.opts.night > 0;
  }

  set(o: Partial<PostFxOptions>): void {
    Object.assign(this.opts, o);
    this.nightBloom.strength =
      NIGHT_STRENGTH * this.opts.night * this.opts.night;
  }

  private readonly onResize = (): void => this.resize();
  private readonly clearColor = new Color();

  private resize(): void {
    const size = this.renderer.getDrawingBufferSize(new Vector2());
    const w = Math.max(1, size.x);
    const h = Math.max(1, size.y);
    this.scene.setSize(w, h);
    this.a.setSize(w, h);
    this.b.setSize(w, h);
    this.shutterMean?.setSize(w, h);
    this.shutter.done = 0;
    let mw = w;
    let mh = h;
    for (const m of this.mips) {
      mw = Math.max(1, mw >> 1);
      mh = Math.max(1, mh >> 1);
      m.setSize(mw, mh);
    }
    this.nightBloom.setSize(w, h);
    this.gtao.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    this.output.setSize(w, h);
    this.applyScale();
  }

  private pass(
    material: ShaderMaterial,
    target: WebGLRenderTarget | null,
  ): void {
    this.renderer.setRenderTarget(target);
    this.quad.material = material;
    this.quad.render(this.renderer);
  }

  private swap(): void {
    [this.a, this.b] = [this.b, this.a];
  }

  /**
   * Photo mode motion blur: this frame's share of the shutter's images into the running mean, then the mean into
   * `a`. The images are taken in an order that spreads every frame's share over the whole shutter (a fixed step
   * through them, coprime with their number), so the picture is whole from the first frame and only gets smoother;
   * the middle of the shutter comes last, so the depth of field and the AO end on its depth. Once all are in, the
   * scene is not drawn again. The mean is of linear pictures (SANITIZE `decode` 2) in whole-frame shares, blended
   * 1 / n: a half-float sum of hundreds of small shares would round each one.
   */
  private renderShutter(sh: Shutter, autoClear: boolean): void {
    const r = this.renderer;
    const st = this.shutter;
    const per = Math.max(1, Math.min(sh.perFrame, sh.samples));
    const total = Math.ceil(sh.samples / per) * per;
    if (!this.shutterMean) {
      this.shutterMean = this.a.clone();
      st.done = 0;
    }
    if (sh.restart || total !== st.total) {
      st.done = 0;
      st.total = total;
      st.stride = Math.max(1, Math.round(total * 0.618));
      while (gcd(st.stride, total) > 1) st.stride++;
    }
    const display = this.display ? 1 : 0;
    if (st.done < total) {
      const clear = r.getClearAlpha();
      const color = r.getClearColor(this.clearColor);
      r.setRenderTarget(this.b);
      r.setClearColor(0x000000, 0);
      r.clear();
      r.setClearColor(color, clear);
      const u = this.sanitize.uniforms;
      u.weight.value = 1 / per;
      u.decode.value = display * 2;
      const mid = total >> 1;
      for (let i = 0; i < per; i++) {
        const k = (mid + (st.done + i + 1) * st.stride) % total;
        sh.pose((k + 0.5) / total - 0.5);
        r.autoClear = autoClear;
        r.setRenderTarget(this.scene);
        r.render(this.world, this.camera);
        r.autoClear = false;
        this.pass(this.sanitizeAdd, this.b);
      }
      u.weight.value = 1;
      u.decode.value = display;
      st.done += per;
      this.shutterBlend.uniforms.tDiffuse.value = this.b.texture;
      this.shutterBlend.uniforms.opacity.value = per / st.done;
      this.pass(this.shutterBlend, this.shutterMean);
    }
    r.autoClear = false;
    this.shutterOut.uniforms.tDiffuse.value = this.shutterMean.texture;
    this.shutterOut.uniforms.decode.value = display;
    this.pass(this.shutterOut, this.a);
  }

  /** Motion blur: the share of the shutter's images drawn so far, 0..1. */
  get shutterProgress(): number {
    const st = this.shutter;
    return st.total > 0 ? Math.min(1, st.done / st.total) : 1;
  }

  /** Motion blur off: free its image (as large as the picture). */
  releaseShutter(): void {
    this.shutterMean?.dispose();
    this.shutterMean = undefined;
    this.shutter.done = 0;
  }

  /**
   * Draw the scene and the effects to the screen. Photo mode motion blur: with a `shutter` the scene is drawn many
   * times across it and averaged, a share per frame (`renderShutter`); returns false while images are still missing.
   */
  render(shutter?: Shutter): boolean {
    const r = this.renderer;
    const autoClear = r.autoClear;
    this.sanitize.uniforms.tDiffuse.value = this.scene.texture;
    if (shutter && shutter.samples > 1) this.renderShutter(shutter, autoClear);
    else {
      r.setRenderTarget(this.scene);
      r.render(this.world, this.camera);
      r.autoClear = false;
      this.pass(this.sanitize, this.a);
    }

    if (this.opts.ao) {
      this.gtao.render(r, this.b, this.a, 0, false);
      this.swap();
    }

    const photo = this.opts.photo;
    if (photo) {
      const u = this.lens.uniforms;
      const h = this.a.height;
      u.tDiffuse.value = this.a.texture;
      u.tDepth.value = this.scene.depthTexture;
      u.texel.value.set(1 / this.a.width, 1 / h);
      u.depthUvScale.value.copy(this.depthUvScale.value);
      u.near.value = this.camera.near;
      u.far.value = this.camera.far;
      u.focus.value = photo.focus;
      u.lens.value = photoLens(photo, h);
      // Largest blur: 2.5 % of the height (a long lens wide open).
      u.maxPx.value = 0.025 * h;
      u.exposure.value = 2 ** photo.ev;
      this.pass(this.lens, this.b);
      this.swap();
    }

    if (this.opts.day > 0) {
      let src = this.a;
      for (let i = 0; i < this.mips.length; i++) {
        const dst = this.mips[i];
        this.down.uniforms.tSrc.value = src.texture;
        this.down.uniforms.texel.value.set(1 / src.width, 1 / src.height);
        this.down.uniforms.karis.value = i === 0 ? 1 : 0;
        this.pass(this.down, dst);
        src = dst;
      }
      for (let i = this.mips.length - 1; i > 0; i--) {
        const s = this.mips[i];
        this.up.uniforms.tSrc.value = s.texture;
        this.up.uniforms.texel.value.set(1 / s.width, 1 / s.height);
        this.pass(this.up, this.mips[i - 1]);
      }
      this.mixer.uniforms.tScene.value = this.a.texture;
      this.mixer.uniforms.tBloom.value = this.mips[0].texture;
      this.mixer.uniforms.strength.value = this.opts.day;
      this.pass(this.mixer, this.b);
      this.swap();
    }

    if (this.opts.drops > 0 && !photo) {
      const u = this.drops.uniforms;
      u.tDiffuse.value = this.a.texture;
      u.time.value = worldUniforms.wsTime.value;
      u.amount.value = this.opts.drops;
      u.speed.value = this.opts.dropSpeed;
      u.aspect.value = this.a.width / this.a.height;
      this.pass(this.drops, this.b);
      this.swap();
    }

    // Photo mode filter: the finished picture goes through `b` and PHOTO_LOOK to the screen.
    const look =
      !!photo && photo.filter !== 'none' && photo.filterStrength > 0
        ? this.b
        : null;
    if (this.display) {
      this.encode.uniforms.tDiffuse.value = this.a.texture;
      this.pass(this.encode, look);
    } else {
      // Draws onto `a` in place.
      if (this.nightOn) this.nightBloom.render(r, this.b, this.a, 0, false);
      this.output.renderToScreen = !look;
      this.output.render(
        r,
        look as unknown as WebGLRenderTarget,
        this.a,
        0,
        false,
      );
    }
    if (look && photo) {
      const f = PHOTO_FILTERS[photo.filter];
      const u = this.look.uniforms;
      u.tDiffuse.value = look.texture;
      u.tint.value.fromArray(f.tint);
      u.sat.value = f.sat;
      u.contrast.value = f.contrast;
      u.fade.value = f.fade;
      u.vignette.value = f.vignette;
      u.strength.value = photo.filterStrength;
      u.aspect.value = look.width / look.height;
      this.pass(this.look, null);
    }
    r.autoClear = autoClear;
    return !shutter || this.shutter.done >= this.shutter.total;
  }

  dispose(): void {
    this.shutterMean?.dispose();
    this.renderer.domElement.removeEventListener('resized', this.onResize);
    for (const t of [this.scene, this.a, this.b, ...this.mips]) t.dispose();
    for (const m of [
      this.sanitize,
      this.sanitizeAdd,
      this.shutterBlend,
      this.shutterOut,
      this.encode,
      this.down,
      this.up,
      this.mixer,
      this.drops,
      this.lens,
      this.look,
    ])
      m.dispose();
    this.quad.dispose();
    this.nightBloom.dispose();
    this.gtao.dispose();
    this.output.dispose();
  }
}

/**
 * The effects for a High quality page: night glow from `night`, day bloom mix and AO from the options; `?bloom=<mix>`
 * (0 = off) and `?ao=0|1` override them for testing.
 */
export function postFxFromUrl(
  night: number,
  day: number,
  ao: boolean,
): PostFxOptions {
  const p = new URLSearchParams(location.search);
  const bloom = Number(p.get('bloom') ?? Number.NaN);
  const aoParam = p.get('ao');
  return {
    night,
    day: Number.isFinite(bloom) ? bloom : day,
    ao: aoParam === null ? ao : aoParam === '1',
    drops: 0,
    dropSpeed: 0,
    photo: null,
  };
}

/** GTAO / its denoise read the scene depth at full-screen uv: scaled to the part the scene was drawn into. */
function scaledDepth(
  m: ShaderMaterial,
  depthUvScale: { value: Vector2 },
): void {
  const get = 'textureLod(tDepth, uv.xy, 0.0)';
  const at = 'ivec2(uv * size)';
  if (!m.fragmentShader.includes(get) || !m.fragmentShader.includes(at))
    throw new Error('post-fx: GTAO depth lookups changed (three upgrade?)');
  m.uniforms.depthUvScale = depthUvScale;
  m.fragmentShader =
    'uniform vec2 depthUvScale;\n' +
    m.fragmentShader
      .replace(get, 'textureLod(tDepth, uv.xy * depthUvScale, 0.0)')
      .replace(at, 'ivec2(uv * depthUvScale * size)');
  m.needsUpdate = true;
}
