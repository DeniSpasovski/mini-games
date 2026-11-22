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
  blendColor,
  colorToDirection,
  diffuseColor,
  directionToColor,
  metalness,
  mrt,
  normalView,
  output,
  pass,
  roughness,
  sample,
  vec2,
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

/** Cascaded shadows on the sun (call before the first render). */
export function useCsm(sun: DirectionalLight, camera: PerspectiveCamera): void {
  const csm = new CSMShadowNode(sun, {
    cascades: 4,
    maxFar: 600,
    mode: 'practical',
    lightMargin: 120,
  });
  csm.fade = true;
  csm.camera = camera;
  sun.shadow.mapSize.set(2048, 2048);
  (sun.shadow as unknown as { shadowNode: unknown }).shadowNode = csm;
}

/** The post pipeline for a picture; `render()` replaces renderer.render(scene, camera). */
export function buildPipeline(
  renderer: WebGPURenderer,
  scene: Scene,
  camera: Camera,
  p: Picture,
): RenderPipeline {
  const scenePass = pass(scene, camera);
  const temporal = p.aa === 'traa' || p.aa === 'taau';
  const outputs: Record<string, unknown> = { output };
  if (p.gi || p.ssr) outputs.normal = directionToColor(normalView);
  if (p.gi) outputs.diffuse = diffuseColor;
  if (p.ssr) outputs.metalrough = vec2(metalness, roughness);
  if (temporal) outputs.velocity = velocity;
  scenePass.setMRT(mrt(outputs as Parameters<typeof mrt>[0]));
  if (p.aa === 'taau') scenePass.setResolutionScale(p.scale);

  // Small attachments in 8 bits (bandwidth); colour and velocity stay half float.
  for (const name of ['normal', 'diffuse', 'metalrough'])
    if (name in outputs) scenePass.getTexture(name).type = UnsignedByteType;
  if (temporal) scenePass.getTexture('velocity').type = HalfFloatType;

  const color = scenePass.getTextureNode('output');
  const depth = scenePass.getTextureNode('depth');
  const normalTex =
    'normal' in outputs ? scenePass.getTextureNode('normal') : null;
  const normal = normalTex
    ? sample((uv) => colorToDirection(normalTex.sample(uv)))
    : null;

  // A texture node at first; the effects below wrap it (the TSL helpers take either at run time).
  let beauty: Node = color;
  if (p.gi && normal) {
    const gi = ssgi(color, depth, normal, camera as PerspectiveCamera);
    gi.sliceCount.value = 2;
    gi.stepCount.value = 8;
    gi.radius.value = 6;
    gi.giIntensity.value = 4;
    gi.useTemporalFiltering = temporal;
    const diffuse = scenePass.getTextureNode('diffuse');
    beauty = vec4(color.rgb.mul(gi.a).add(diffuse.rgb.mul(gi.rgb)), color.a);
  }
  if (p.ssr && normal) {
    const mr = scenePass.getTextureNode('metalrough');
    const refl = ssr(beauty as TextureNode, depth, normal, {
      metalnessNode: mr.r,
      roughnessNode: mr.g,
      reflectNonMetals: true,
      camera,
    });
    refl.maxDistance.value = 40;
    refl.thickness.value = 0.3;
    refl.quality.value = 0.5;
    beauty = blendColor(beauty as TextureNode, refl);
  }

  const pipeline = new RenderPipeline(renderer);
  const velocityTex = temporal ? scenePass.getTextureNode('velocity') : null;
  pipeline.outputNode =
    p.aa === 'traa'
      ? traa(beauty as TextureNode, depth, velocityTex!, camera)
      : p.aa === 'taau'
        ? taau(beauty as TextureNode, depth, velocityTex!, camera)
        : beauty;
  return pipeline;
}
