import {
  DepthTexture,
  HalfFloatType,
  LinearFilter,
  type PerspectiveCamera,
  RGBAFormat,
  type Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import type { QualitySettings } from './quality';

/**
 * Optional post pass for the game (medium / high quality, `?post=0` turns it off). The scene goes into a float target
 * with a depth texture (MSAA as before), then, in screen space:
 *  1. ambient occlusion from the depth buffer at half resolution (Alchemy-style, 14 taps) + a depth-aware blur,
 *  2. bloom from the HDR colour (bright pass at quarter resolution, two blur passes),
 *  3. one composite: AO (fading out with distance), bloom, a mild grade (cool shadows, warm highlights, a little
 *     more colour) and a light vignette, then the renderer's tone mapping and output colour space.
 * No extra scene render: the draw calls stay the same. Tuning switches scale one effect: `?postao=`, `?postbloom=`,
 * `?postgrade=` (1 = default, 0 = off, 2 = twice as strong).
 */
export function postEnabled(quality: QualitySettings): boolean {
  if (quality.name === 'low') return false;
  return new URLSearchParams(location.search).get('post') !== '0';
}

const knob = (name: string) => {
  const v = Number(new URLSearchParams(location.search).get(name) ?? 1);
  return Number.isFinite(v) && v >= 0 ? v : 1;
};

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

/** Taps of the AO gather (golden-angle spiral, jittered per pixel). */
const AO_TAPS = 14;

const DEPTH_CHUNK = /* glsl */ `
  #include <packing>
  uniform sampler2D tDepth;
  uniform float uNear, uFar;
  uniform vec2 uProj; // projection[0][0], projection[1][1]
  float distAt(vec2 uv) {
    return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar);
  }
  vec3 viewPos(vec2 uv, float d) {
    vec2 ndc = uv * 2.0 - 1.0;
    return vec3(ndc * d / uProj, -d);
  }`;

export class PostFx {
  private scene: WebGLRenderTarget;
  private ao: WebGLRenderTarget;
  private aoBlur: WebGLRenderTarget;
  private bloomA: WebGLRenderTarget;
  private bloomB: WebGLRenderTarget;
  private quad = new FullScreenQuad();
  private size = new Vector2();
  private aoMat: ShaderMaterial;
  private blurMat: ShaderMaterial;
  private brightMat: ShaderMaterial;
  private gaussMat: ShaderMaterial;
  private compMat: ShaderMaterial;
  private kAo = knob('postao');
  private kBloom = knob('postbloom');

  constructor(
    private renderer: WebGLRenderer,
    msaa: boolean,
  ) {
    this.scene = new WebGLRenderTarget(1, 1, {
      type: HalfFloatType,
      samples: msaa ? 4 : 0,
      depthTexture: new DepthTexture(1, 1),
    });
    const small = () =>
      new WebGLRenderTarget(1, 1, {
        type: UnsignedByteType,
        format: RGBAFormat,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        depthBuffer: false,
      });
    const smallHdr = () =>
      new WebGLRenderTarget(1, 1, {
        type: HalfFloatType,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        depthBuffer: false,
      });
    this.ao = small();
    this.aoBlur = small();
    this.bloomA = smallHdr();
    this.bloomB = smallHdr();

    const depthUniforms = () => ({
      tDepth: { value: this.scene.depthTexture },
      uNear: { value: 0.1 },
      uFar: { value: 1000 },
      uProj: { value: new Vector2(1, 1) },
    });

    this.aoMat = new ShaderMaterial({
      uniforms: {
        ...depthUniforms(),
        uTexel: { value: new Vector2() },
        uRadius: { value: 1.3 },
        uMaxPx: { value: 48 },
        uIntensity: { value: 1.7 },
      },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        ${DEPTH_CHUNK}
        uniform vec2 uTexel;
        uniform float uRadius, uMaxPx, uIntensity;
        varying vec2 vUv;
        float noise(vec2 p) {
          return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
        }
        void main() {
          float d = distAt(vUv);
          if (d > uFar * 0.5) { gl_FragColor = vec4(1.0); return; }
          vec3 P = viewPos(vUv, d);
          // Normal from the smaller depth step on each axis (no smearing across silhouettes).
          vec2 dx = vec2(uTexel.x, 0.0), dy = vec2(0.0, uTexel.y);
          vec3 Pr = viewPos(vUv + dx, distAt(vUv + dx)), Pl = viewPos(vUv - dx, distAt(vUv - dx));
          vec3 Pu = viewPos(vUv + dy, distAt(vUv + dy)), Pd = viewPos(vUv - dy, distAt(vUv - dy));
          vec3 ddx = abs(Pr.z - P.z) < abs(P.z - Pl.z) ? Pr - P : P - Pl;
          vec3 ddy = abs(Pu.z - P.z) < abs(P.z - Pd.z) ? Pu - P : P - Pd;
          vec3 N = normalize(cross(ddx, ddy));
          if (N.z < 0.0) N = -N;
          // World radius -> screen radius (uv), clamped.
          vec2 rUv = uRadius * uProj / (2.0 * d);
          float rPx = rUv.y / uTexel.y;
          if (rPx < 1.5) { gl_FragColor = vec4(1.0); return; }
          rUv *= min(1.0, uMaxPx / rPx);
          float jitter = noise(gl_FragCoord.xy);
          float occ = 0.0;
          for (int i = 0; i < ${AO_TAPS}; i++) {
            float t = (float(i) + jitter) / float(${AO_TAPS});
            float a = (float(i) + jitter) * 2.39996 + jitter * 6.2831;
            vec2 uv = vUv + vec2(cos(a), sin(a)) * rUv * sqrt(t);
            vec3 S = viewPos(uv, distAt(uv));
            vec3 v = S - P;
            float len2 = dot(v, v);
            float len = sqrt(len2);
            float w = 1.0 - smoothstep(0.5 * uRadius, 1.4 * uRadius, len);
            occ += max(0.0, dot(N, v) - 0.03 * d) / (len2 + 0.02) * w;
          }
          occ = occ * uRadius * 2.0 / float(${AO_TAPS});
          gl_FragColor = vec4(vec3(clamp(1.0 - occ * uIntensity, 0.0, 1.0)), 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });

    this.blurMat = new ShaderMaterial({
      uniforms: {
        ...depthUniforms(),
        tAo: { value: this.ao.texture },
        uTexel: { value: new Vector2() },
      },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        ${DEPTH_CHUNK}
        uniform sampler2D tAo;
        uniform vec2 uTexel;
        varying vec2 vUv;
        void main() {
          float d0 = distAt(vUv);
          float sum = 0.0, wsum = 0.0;
          for (int y = -2; y < 2; y++)
            for (int x = -2; x < 2; x++) {
              vec2 uv = vUv + (vec2(float(x), float(y)) + 0.5) * uTexel;
              float d = distAt(uv);
              float w = exp(-abs(d - d0) / (0.04 * d0 + 0.05));
              sum += texture2D(tAo, uv).r * w;
              wsum += w;
            }
          gl_FragColor = vec4(vec3(sum / max(wsum, 1e-4)), 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });

    this.brightMat = new ShaderMaterial({
      uniforms: {
        tColor: { value: this.scene.texture },
        tDepth: { value: this.scene.depthTexture },
        uTexel: { value: new Vector2() },
        uThreshold: { value: 2.0 },
      },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor, tDepth;
        uniform vec2 uTexel;
        uniform float uThreshold;
        varying vec2 vUv;
        void main() {
          // The sky is bright everywhere: it would glow over every silhouette, so only geometry blooms.
          if (texture2D(tDepth, vUv).x > 0.99999) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
          vec3 c = vec3(0.0);
          for (int y = 0; y < 2; y++)
            for (int x = 0; x < 2; x++)
              c += texture2D(tColor, vUv + (vec2(float(x), float(y)) - 0.5) * uTexel).rgb;
          c *= 0.25;
          float l = max(c.r, max(c.g, c.b));
          // Soft knee: only what is brighter than the threshold blooms.
          float k = clamp((l - uThreshold * 0.7) / (uThreshold * 0.6), 0.0, 1.0);
          gl_FragColor = vec4(min(c, vec3(6.0)) * k * k, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });

    this.gaussMat = new ShaderMaterial({
      uniforms: {
        tSrc: { value: this.bloomA.texture },
        uDir: { value: new Vector2(1, 0) },
      },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc;
        uniform vec2 uDir;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270;
          c += (texture2D(tSrc, vUv + uDir * 1.3846).rgb + texture2D(tSrc, vUv - uDir * 1.3846).rgb) * 0.3162162;
          c += (texture2D(tSrc, vUv + uDir * 3.2308).rgb + texture2D(tSrc, vUv - uDir * 3.2308).rgb) * 0.0702703;
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });

    this.compMat = new ShaderMaterial({
      uniforms: {
        ...depthUniforms(),
        tColor: { value: this.scene.texture },
        tAo: { value: this.aoBlur.texture },
        tBloom: { value: this.bloomA.texture },
        uAo: { value: 1 },
        uAoFar: { value: 220 },
        uBloom: { value: 0.35 },
        uSat: { value: 1.15 },
        uVig: { value: 0.28 },
        uTint: { value: 1 },
        uAspect: { value: 1 },
      },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        ${DEPTH_CHUNK}
        uniform sampler2D tColor, tAo, tBloom;
        uniform float uAo, uAoFar, uBloom, uSat, uVig, uTint, uAspect;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tColor, vUv).rgb;
          float d = distAt(vUv);
          float ao = texture2D(tAo, vUv).r;
          // Fade the AO out with distance (and on the sky) so far trees and terrain do not get noisy halos.
          float fade = 1.0 - smoothstep(uAoFar * 0.35, uAoFar, d);
          c *= mix(1.0, ao, uAo * fade);
          c += texture2D(tBloom, vUv).rgb * uBloom;
          // Grade (linear, before tone mapping): a little more colour, cool shadows, warm highlights.
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(vec3(l), c, uSat);
          vec3 tint = mix(vec3(0.94, 0.98, 1.07), vec3(1.06, 1.02, 0.92), smoothstep(0.05, 1.2, l));
          c *= mix(vec3(1.0), tint, uTint);
          vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
          c *= 1.0 - uVig * smoothstep(0.25, 0.95, length(q));
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      depthTest: false,
      depthWrite: false,
    });
    const kGrade = knob('postgrade');
    const u = this.compMat.uniforms;
    u.uSat.value = 1 + (u.uSat.value - 1) * kGrade;
    u.uVig.value *= kGrade;
    u.uTint.value = kGrade;
  }

  private pass(mat: ShaderMaterial, target: WebGLRenderTarget | null): void {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.quad.render(this.renderer);
  }

  private resize(w: number, h: number): void {
    const half = (t: WebGLRenderTarget, k: number) => {
      const tw = Math.max(1, Math.round(w / k));
      const th = Math.max(1, Math.round(h / k));
      if (t.width !== tw || t.height !== th) t.setSize(tw, th);
    };
    if (this.scene.width !== w || this.scene.height !== h)
      this.scene.setSize(w, h);
    half(this.ao, 2);
    half(this.aoBlur, 2);
    half(this.bloomA, 4);
    half(this.bloomB, 4);
  }

  /** Render `scene` to the screen through the pass chain. */
  render(scene: Scene, camera: PerspectiveCamera): void {
    const r = this.renderer;
    r.getDrawingBufferSize(this.size);
    const { x: w, y: h } = this.size;
    this.resize(w, h);

    const proj = camera.projectionMatrix.elements;
    for (const m of [this.aoMat, this.blurMat, this.compMat]) {
      const u = m.uniforms;
      u.uNear.value = camera.near;
      u.uFar.value = camera.far;
      u.uProj.value.set(proj[0], proj[5]);
    }
    const prevAuto = r.autoClear;
    r.setRenderTarget(this.scene);
    r.render(scene, camera);
    r.autoClear = false;

    if (this.kAo > 0) {
      this.aoMat.uniforms.uTexel.value.set(
        1 / this.ao.width,
        1 / this.ao.height,
      );
      this.pass(this.aoMat, this.ao);
      this.blurMat.uniforms.uTexel.value.set(
        1 / this.ao.width,
        1 / this.ao.height,
      );
      this.pass(this.blurMat, this.aoBlur);
    }
    const bu = this.compMat.uniforms;
    bu.uAo.value = Math.min(1, 1.0 * this.kAo);
    this.aoMat.uniforms.uIntensity.value = 1.7 * Math.max(1, this.kAo);
    if (this.kBloom > 0) {
      this.brightMat.uniforms.uTexel.value.set(1 / w, 1 / h);
      this.pass(this.brightMat, this.bloomA);
      const g = this.gaussMat.uniforms;
      g.tSrc.value = this.bloomA.texture;
      g.uDir.value.set(1 / this.bloomA.width, 0);
      this.pass(this.gaussMat, this.bloomB);
      g.tSrc.value = this.bloomB.texture;
      g.uDir.value.set(0, 1 / this.bloomA.height);
      this.pass(this.gaussMat, this.bloomA);
    }
    bu.uBloom.value = 0.4 * this.kBloom;
    bu.uAspect.value = w / h;
    this.pass(this.compMat, null);
    r.autoClear = prevAuto;
  }

  dispose(): void {
    for (const t of [
      this.scene,
      this.ao,
      this.aoBlur,
      this.bloomA,
      this.bloomB,
    ])
      t.dispose();
    this.scene.depthTexture?.dispose();
    for (const m of [
      this.aoMat,
      this.blurMat,
      this.brightMat,
      this.gaussMat,
      this.compMat,
    ])
      m.dispose();
    this.quad.dispose();
  }
}
