import {
  HalfFloatType,
  type PerspectiveCamera,
  type Scene,
  Vector2,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/** Bloom strength at full darkness; scaled by the square of `Environment.lightNeed`. */
const STRENGTH = 0.5;
/** Linear scene brightness above which things glow. The beam lights the ground to tens, so lamp lenses and reflectors are emissive far above it (`night-glow.ts`). */
const THRESHOLD = 20;
const RADIUS = 0.35;

/**
 * Runs before the bloom: a NaN or infinite pixel (a normalize of zero, a highlight past the half-float range) would be
 * blurred into a black square by the bloom's mip chain. Such a pixel takes the mean of its finite neighbours, and values
 * are capped well above the bloom threshold.
 */
const SANITIZE = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    bool ok( vec3 c ) {
      // Comparisons with NaN are false, so NaN fails both.
      return max( c.r, max( c.g, c.b ) ) < 1.0e4 && min( c.r, min( c.g, c.b ) ) > - 1.0e4;
    }
    void main() {
      vec4 c = texture2D( tDiffuse, vUv );
      if ( ok( c.rgb ) ) {
        gl_FragColor = vec4( min( c.rgb, vec3( 2000.0 ) ), c.a );
        return;
      }
      vec2 px = 1.0 / vec2( textureSize( tDiffuse, 0 ) );
      vec3 sum = vec3( 0.0 );
      float n = 0.0;
      for ( int i = 0; i < 4; i++ ) {
        vec2 o = i == 0 ? vec2( px.x, 0.0 ) : i == 1 ? vec2( - px.x, 0.0 ) : i == 2 ? vec2( 0.0, px.y ) : vec2( 0.0, - px.y );
        vec3 s = texture2D( tDiffuse, vUv + o ).rgb;
        if ( ok( s ) ) { sum += s; n += 1.0; }
      }
      gl_FragColor = vec4( n > 0.0 ? min( sum / n, vec3( 2000.0 ) ) : vec3( 0.0 ), 1.0 );
    }`,
};

/**
 * Glow around lamps, reflectors and the beam at night and dusk - high quality only (a half-float scene target, a
 * bright-pass and a blur chain at full resolution). The scene is rendered into a float target and `OutputPass` applies
 * the renderer's tone mapping and colour space, so the look matches the plain render.
 */
export class NightBloom {
  private readonly composer: EffectComposer;

  constructor(
    private readonly renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera,
    antialias: boolean,
    need: number,
  ) {
    const rt = new WebGLRenderTarget(1, 1, {
      type: HalfFloatType,
      samples: antialias ? 4 : 0,
    });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.composer.addPass(new ShaderPass(SANITIZE));
    this.composer.addPass(
      new UnrealBloomPass(
        new Vector2(256, 256),
        STRENGTH * need * need,
        RADIUS,
        THRESHOLD,
      ),
    );
    this.composer.addPass(new OutputPass());
    const resize = (): void => this.resize();
    renderer.domElement.addEventListener('resized', resize);
    this.resize();
  }

  private resize(): void {
    const size = this.renderer.getSize(new Vector2());
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(size.x, size.y);
  }

  render(): void {
    this.composer.render();
  }
}
