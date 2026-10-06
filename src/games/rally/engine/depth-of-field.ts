import {
  DepthTexture,
  HalfFloatType,
  type PerspectiveCamera,
  type Scene,
  ShaderMaterial,
  Vector2,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/** Gather taps per pixel (golden-angle spiral). */
const TAPS = 28;

/**
 * Shallow depth of field for the menu's car screens (game/showroom.ts): the scene goes into a float target with a
 * depth texture, then one full-screen pass blurs every pixel by its circle of confusion and applies the renderer's
 * tone mapping + output colour space (rendering into a target skips them).
 *
 * Circle of confusion: `max(0, |1 - focus / z| - range) * aperture` px, capped at `maxBlur` x the height - `range`
 * keeps the whole subject sharp. Gather-only: a nearer, sharper sample (the car) never bleeds into the blurred
 * background behind it (it must reach the pixel with its own blur to count).
 */
export class DepthOfField {
  private target: WebGLRenderTarget;
  private quad: FullScreenQuad;
  private material: ShaderMaterial;
  private size = new Vector2();

  constructor(
    private renderer: WebGLRenderer,
    msaa: boolean,
  ) {
    this.target = new WebGLRenderTarget(1, 1, {
      type: HalfFloatType,
      samples: msaa ? 4 : 0,
      depthTexture: new DepthTexture(1, 1),
    });
    this.material = new ShaderMaterial({
      uniforms: {
        tColor: { value: this.target.texture },
        tDepth: { value: this.target.depthTexture },
        uTexel: { value: new Vector2() },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uFocus: { value: 8 },
        uRange: { value: 0.4 },
        uAperture: { value: 20 },
        uMaxPx: { value: 12 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        #include <packing>
        uniform sampler2D tColor, tDepth;
        uniform vec2 uTexel;
        uniform float uNear, uFar, uFocus, uRange, uAperture, uMaxPx;
        varying vec2 vUv;
        float viewZ(vec2 uv) {
          return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar);
        }
        float coc(float z) {
          return min(uMaxPx, max(0.0, abs(1.0 - uFocus / z) - uRange) * uAperture);
        }
        void main() {
          vec3 c0 = texture2D(tColor, vUv).rgb;
          float z0 = viewZ(vUv);
          float r0 = coc(z0);
          vec3 acc = c0;
          float wsum = 1.0;
          if (r0 > 0.5) {
            for (int i = 0; i < ${TAPS}; i++) {
              float t = (float(i) + 0.5) / float(${TAPS});
              float rad = sqrt(t) * r0;
              float a = float(i) * 2.39996;
              vec2 uv = vUv + vec2(cos(a), sin(a)) * rad * uTexel;
              float z = viewZ(uv);
              // A nearer sample only counts if its own blur reaches this pixel (no sharp-subject halo).
              float w = z >= z0 - 0.5 ? 1.0 : smoothstep(rad * 0.5, rad, coc(z));
              acc += texture2D(tColor, uv).rgb * w;
              wsum += w;
            }
          }
          gl_FragColor = vec4(acc / wsum, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  /**
   * Render `scene` to the screen with the focus `focus` m in front of `camera`. `maxBlur` = largest blur as a share of
   * the height; `range` = how far from the focus (as |1 - focus / z|) stays sharp.
   */
  render(
    scene: Scene,
    camera: PerspectiveCamera,
    focus: number,
    maxBlur = 0.011,
    range = 0.4,
  ): void {
    const r = this.renderer;
    r.getDrawingBufferSize(this.size);
    const { x: w, y: h } = this.size;
    if (this.target.width !== w || this.target.height !== h)
      this.target.setSize(w, h);
    const u = this.material.uniforms;
    u.uTexel.value.set(1 / w, 1 / h);
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uFocus.value = focus;
    u.uRange.value = range;
    u.uMaxPx.value = maxBlur * h;
    // Full blur ~half way between the sharp range and infinity.
    u.uAperture.value = (maxBlur * h) / Math.max(0.1, (1 - range) * 0.55);
    r.setRenderTarget(this.target);
    r.render(scene, camera);
    r.setRenderTarget(null);
    this.quad.render(r);
  }

  dispose(): void {
    this.target.depthTexture?.dispose();
    this.target.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}
