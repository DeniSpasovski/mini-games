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
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/** Bloom strength at full darkness; scaled by the square of `Environment.lightNeed`. */
const STRENGTH = 0.5;
/** Linear scene brightness above which things glow. The beam lights the ground to tens, so lamp lenses and reflectors are emissive far above it (`night-glow.ts`). */
const THRESHOLD = 20;
const RADIUS = 0.35;

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
