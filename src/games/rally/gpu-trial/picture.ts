import {
  HalfFloatType,
  UnsignedByteType,
  type Camera,
  type DirectionalLight,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import {
  RenderPipeline,
  type Node,
  type TextureNode,
  type WebGPURenderer,
} from 'three/webgpu';
import {
  diffuseColor,
  mrt,
  normalView,
  output,
  packNormalToRGB,
  pass,
  roughness,
  sample,
  unpackRGBToNormal,
  vec4,
  velocity,
} from 'three/tsl';
import { traa } from 'three/examples/jsm/tsl/display/TRAANode.js';
import { taau } from 'three/examples/jsm/tsl/display/TAAUNode.js';
import { ssgi } from 'three/examples/jsm/tsl/display/SSGINode.js';
import { ssr } from 'three/examples/jsm/tsl/display/SSRNode.js';
import { CSMShadowNode } from 'three/examples/jsm/csm/CSMShadowNode.js';

/**
 * Picture switches of the GPU trial (WebGPURenderer only), the v2 picture pipeline in pieces so each one's look and
 * cost can be judged on its own:
 *
 * - `aa=msaa` (default, as the game) | `traa` temporal AA | `taau` temporal AA + upscaling from `scale` (0.5-1,
 *   default 0.67) | `none`.
 * - `gi=1` screen-space GI + AO (SSGI), composited on the diffuse colour.
 * - `ssr=1` screen-space reflections (roughness-driven, dielectrics too, so the road and painted metal reflect).
 * - `csm=1` cascaded sun shadows (4 cascades to 600 m) instead of the one 160 m map that follows the camera.
 */
export interface Picture {
  aa: 'msaa' | 'traa' | 'taau' | 'none';
  scale: number;
  gi: boolean;
  /** SSGI bounce strength (`gis`, default 1). */
  giStrength: number;
  ssr: boolean;
  csm: boolean;
}

const AA = ['msaa', 'traa', 'taau', 'none'] as const;

export function parsePicture(params: URLSearchParams): Picture {
  const aa = params.get('aa') as Picture['aa'] | null;
  const scale = Number(params.get('scale'));
  return {
    aa: aa && AA.includes(aa) ? aa : 'msaa',
    scale:
      Number.isFinite(scale) && scale > 0
        ? Math.min(1, Math.max(0.5, scale))
        : 0.67,
    gi: params.get('gi') === '1',
    giStrength: Number(params.get('gis')) > 0 ? Number(params.get('gis')) : 1,
    ssr: params.get('ssr') === '1',
    csm: params.get('csm') === '1',
  };
}

export function pictureLabel(p: Picture): string {
  const parts: string[] = [
    p.aa === 'taau'
      ? `TAAU ${Math.round(p.scale * 100)} %`
      : p.aa.toUpperCase(),
  ];
  if (p.gi) parts.push('SSGI');
  if (p.ssr) parts.push('SSR');
  if (p.csm) parts.push('CSM');
  return parts.join(' + ');
}

/** True when the picture needs the post pipeline (anything but plain MSAA / no AA). */
export function needsPipeline(p: Picture): boolean {
  return p.aa === 'traa' || p.aa === 'taau' || p.gi || p.ssr;
}

/**
 * Cascaded shadows on the sun (call before the first render). The node takes its camera from the first render: it
 * builds its cascades only while `camera` is unset, so setting it here left it with none (black picture).
 */
export function useCsm(sun: DirectionalLight): void {
  const csm = new CSMShadowNode(sun, {
    cascades: 4,
    maxFar: 600,
    mode: 'practical',
    lightMargin: 120,
  });
  csm.fade = true;
  sun.shadow.mapSize.set(2048, 2048);
  (sun.shadow as unknown as { shadowNode: unknown }).shadowNode = csm;
}

/**
 * The post pipeline for a picture: `pipeline.render()` replaces renderer.render(scene, camera). `compile()` builds the
 * scene pass's shaders ahead: its extra outputs (velocity, normals ...) give every material a new variant that the
 * plain `compileAsync` does not cover, and building them on the first frames froze the page for seconds.
 */
export function buildPipeline(
  renderer: WebGPURenderer,
  scene: Scene,
  camera: Camera,
  p: Picture,
): { pipeline: RenderPipeline; compile: () => Promise<void> } {
  const scenePass = pass(scene, camera);
  const temporal = p.aa === 'traa' || p.aa === 'taau';
  // WebGPU allows 32 bytes of colour attachments per pixel: colour (RGBA16F, 8) + normal (8 bits, 4) + diffuse (4) +
  // velocity (RGBA16F, 8). Roughness rides in the normal's spare alpha instead of an attachment of its own, which
  // took "All" to 40 bytes and failed its pipelines. Metalness is not stored: the slice has no bare metal that
  // matters, and SSR reflects dielectrics by roughness.
  const outputs: Record<string, unknown> = { output };
  if (p.gi || p.ssr)
    outputs.normal = vec4(packNormalToRGB(normalView), roughness);
  if (p.gi) outputs.diffuse = diffuseColor;
  if (temporal) outputs.velocity = velocity;
  scenePass.setMRT(mrt(outputs as Parameters<typeof mrt>[0]));
  if (p.aa === 'taau') scenePass.setResolutionScale(p.scale);

  // Small attachments in 8 bits (bandwidth); colour and velocity stay half float.
  for (const name of ['normal', 'diffuse'])
    if (name in outputs) scenePass.getTexture(name).type = UnsignedByteType;
  if (temporal) scenePass.getTexture('velocity').type = HalfFloatType;

  const color = scenePass.getTextureNode('output');
  const depth = scenePass.getTextureNode('depth');
  const normalTex =
    'normal' in outputs ? scenePass.getTextureNode('normal') : null;
  const normal = normalTex
    ? sample((uv) => unpackRGBToNormal(normalTex.sample(uv).rgb))
    : null;

  // A texture node at first; the effects below wrap it (the TSL helpers take either at run time).
  let beauty: Node = color;
  if (p.gi && normal) {
    const gi = ssgi(color, depth, normal, camera as PerspectiveCamera);
    gi.sliceCount.value = 2;
    gi.stepCount.value = 8;
    gi.radius.value = 6;
    // 4 washed the whole slice out (pale ground, bright trees): bounce light under an open sky is a small addition.
    gi.giIntensity.value = p.giStrength;
    gi.useTemporalFiltering = temporal;
    const diffuse = scenePass.getTextureNode('diffuse');
    beauty = vec4(color.rgb.mul(gi.a).add(diffuse.rgb.mul(gi.rgb)), color.a);
  }
  if (p.ssr && normal) {
    // The mirror path weights each hit by "metalness": smoothness squared here, so a rough road or grass barely
    // reflects and smooth paint / water does.
    const rough = normalTex!.a;
    // SSR samples its input as a texture: it traces the plain scene colour (with SSGI on, the reflection misses the bounce).
    const refl = ssr(color, depth, normal, {
      metalnessNode: rough.oneMinus().pow(2),
      roughnessNode: rough,
      reflectNonMetals: true,
      camera,
    });
    refl.maxDistance.value = 40;
    refl.thickness.value = 0.3;
    refl.quality.value = 0.5;
    // Traced at half resolution: full resolution cost 16 ms of GPU on the 3070 Ti for a barely visible dry-road reflection.
    refl.resolutionScale = 0.5;
    // The SSR output is the weighted reflection with the ray length in alpha (not a blend weight): add it.
    beauty = vec4((beauty as TextureNode).rgb.add(refl.rgb), color.a);
  }

  const pipeline = new RenderPipeline(renderer);
  const velocityTex = temporal ? scenePass.getTextureNode('velocity') : null;
  pipeline.outputNode =
    p.aa === 'traa'
      ? traa(beauty as TextureNode, depth, velocityTex!, camera)
      : p.aa === 'taau'
        ? taau(beauty as TextureNode, depth, velocityTex!, camera)
        : beauty;
  return {
    pipeline,
    compile: async () => {
      await scenePass.compileAsync(renderer);
      // The post passes' own shaders build on their first render: do it here, behind the loading label.
      pipeline.render();
    },
  };
}
