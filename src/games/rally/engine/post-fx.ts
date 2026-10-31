import {
  AddEquation,
  CustomBlending,
  DepthTexture,
  HalfFloatType,
  LinearFilter,
  NoBlending,
  OneFactor,
  type PerspectiveCamera,
  type Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { gradeUniforms } from './grade';

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
  varying vec2 vUv;
  // Display mode: the target holds the finished picture (sRGB, tone mapped); back to an HDR estimate by the inverse of
  // c / (1 + max(c)) (hue kept; ENCODE undoes it exactly).
  vec3 toHdr( vec3 c ) {
    if ( decode < 0.5 ) return c;
    vec3 l = mix( c / 12.92, pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), step( 0.04045, c ) );
    l = clamp( l, 0.0, 1.0 );
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
      gl_FragColor = vec4( min( toHdr( c.rgb ), vec3( 2000.0 ) ), c.a );
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
    gl_FragColor = vec4( n > 0.0 ? min( toHdr( sum / n ), vec3( 2000.0 ) ) : vec3( 0.0 ), 1.0 );
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
}

/**
 * High quality post effects on a half-float copy of the scene (see `display` for day vs night).
 * - night bloom: lamps, reflectors and the beam glow at dusk and night (threshold bloom);
 * - day bloom: soft light spread from everything bright (soft light spread from everything bright);
 * - AO: screen-space ambient occlusion (GTAO) from the scene depth.
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
  });
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
    this.opts = { night: 0, day: 0, ao: false, ...opts };
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
    return this.nightOn || this.opts.day > 0 || this.opts.ao || this.scale < 1;
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

  private resize(): void {
    const size = this.renderer.getDrawingBufferSize(new Vector2());
    const w = Math.max(1, size.x);
    const h = Math.max(1, size.y);
    this.scene.setSize(w, h);
    this.a.setSize(w, h);
    this.b.setSize(w, h);
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

  render(): void {
    const r = this.renderer;
    const autoClear = r.autoClear;
    r.setRenderTarget(this.scene);
    r.render(this.world, this.camera);
    r.autoClear = false;

    this.sanitize.uniforms.tDiffuse.value = this.scene.texture;
    this.pass(this.sanitize, this.a);

    if (this.opts.ao) {
      this.gtao.render(r, this.b, this.a, 0, false);
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

    if (this.display) {
      this.encode.uniforms.tDiffuse.value = this.a.texture;
      this.pass(this.encode, null);
    } else {
      // Draws onto `a` in place.
      if (this.nightOn) this.nightBloom.render(r, this.b, this.a, 0, false);
      this.output.renderToScreen = true;
      this.output.render(
        r,
        null as unknown as WebGLRenderTarget,
        this.a,
        0,
        false,
      );
    }
    r.autoClear = autoClear;
  }

  dispose(): void {
    this.renderer.domElement.removeEventListener('resized', this.onResize);
    for (const t of [this.scene, this.a, this.b, ...this.mips]) t.dispose();
    for (const m of [
      this.sanitize,
      this.encode,
      this.down,
      this.up,
      this.mixer,
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
