import {
  CanvasTexture,
  Color,
  LinearMipmapLinearFilter,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  NotEqualStencilFunc,
  RepeatWrapping,
  ReplaceStencilOp,
  AlwaysStencilFunc,
  SRGBColorSpace,
  ShaderChunk,
  Vector4,
  type Material,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type { ItemStyle } from '../items/catalog';

/**
 * Shared materials. Items use vertex colours only; buildings add a tiled
 * pixel-art window texture. A per-vertex `paint` attribute decides which parts
 * take the per-instance colour (car paint, petals, wall colours...).
 */

/**
 * The per-vertex `paint` attribute: 0 = plain, 1 = takes the instance colour, 2 = glows (`glow` parts of
 * the Mesher: arcade screens, lamps, robot eyes). Glow adds the vertex colour on top of the lighting.
 */
const PAINT_COLOR_VERTEX =
  ShaderChunk.color_vertex
    .replace(
      'vColor.rgb *= instanceColor.rgb;',
      'vColor.rgb *= mix( vec3( 1.0 ), instanceColor.rgb, ( paint > 0.5 && paint < 1.5 ) ? 1.0 : 0.0 );',
    )
    // items are BatchedMeshes (render/item-instances.ts): same rule for the batch colour
    .replace(
      'vColor *= getBatchingColor( getIndirectIndex( gl_DrawID ) );',
      'vColor *= mix( vec4( 1.0 ), getBatchingColor( getIndirectIndex( gl_DrawID ) ), ( paint > 0.5 && paint < 1.5 ) ? 1.0 : 0.0 );',
    ) + '\nvGlow = paint > 1.5 ? 1.0 : 0.0;';

/**
 * Building fade: items that are nearer to the camera than the hole and drawn over
 * it (screen space) turn into a dither, so the hole is never hidden.
 * `uHoleFade` = (hole x px, hole y px, hole view depth m, fade radius px); radius 0 = off.
 * `uFadeMargin` = how much nearer than the hole (m) a surface must be to fade.
 */
export const holeFade = {
  uHoleFade: { value: new Vector4(0, 0, 0, 0) },
  uFadeMargin: { value: 0 },
};

const FADE_FRAGMENT = /* glsl */ `
  {
    float fadeR = uHoleFade.w;
    float nearer = uHoleFade.z - vViewPosition.z;
    if (fadeR > 0.0 && nearer > uFadeMargin) {
      float d = length(gl_FragCoord.xy - uHoleFade.xy);
      float f = (1.0 - smoothstep(fadeR * 0.55, fadeR, d)) * smoothstep(uFadeMargin, uFadeMargin * 2.0, nearer);
      float keep = 1.0 - 0.88 * f;
      float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      if (dither > keep) discard;
    }
  }
`;

function patchPaint(shader: WebGLProgramParametersWithUniforms): void {
  Object.assign(shader.uniforms, holeFade);
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      '#include <common>\nattribute float paint;\nvarying float vGlow;',
    )
    .replace('#include <color_vertex>', PAINT_COLOR_VERTEX);
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      '#include <common>\nuniform vec4 uHoleFade;\nuniform float uFadeMargin;\nvarying float vGlow;',
    )
    .replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vGlow * 0.85;',
    )
    .replace('void main() {', `void main() {${FADE_FRAGMENT}`);
}

function windowTexture(style: Exclude<ItemStyle, 'prop'>): CanvasTexture {
  const S = 16;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, S, S);
  const rect = (x: number, y: number, w: number, h: number, col: string) => {
    g.fillStyle = col;
    g.fillRect(x, y, w, h);
  };
  if (style === 'punched') {
    rect(4, 4, 8, 9, '#6f8aa6');
    rect(4, 4, 8, 2, '#8fb0cf');
    rect(3, 13, 10, 1, '#d9d9d9');
  } else if (style === 'ribbon') {
    rect(0, 3, 16, 9, '#6f8aa6');
    rect(0, 3, 16, 2, '#8fb0cf');
    rect(7, 3, 2, 9, '#e6e6e6');
    rect(0, 12, 16, 1, '#d4d4d4');
  } else {
    rect(1, 1, 14, 14, '#7ea3c6');
    rect(1, 1, 14, 3, '#a6c6e0');
    rect(7, 1, 1, 14, '#c9d6e2');
    rect(0, 0, 16, 1, '#e6e6e6');
    rect(0, 0, 1, 16, '#e6e6e6');
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = NearestFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

export type ItemMaterials = Record<ItemStyle, MeshLambertMaterial>;

let shared: ItemMaterials | null = null;

/** One material per item style (created once, shared by game and viewers). */
export function getItemMaterials(): ItemMaterials {
  if (shared) return shared;
  const make = (style: ItemStyle): MeshLambertMaterial => {
    const m = new MeshLambertMaterial({
      vertexColors: true,
      map: style === 'prop' ? null : windowTexture(style),
    });
    m.onBeforeCompile = patchPaint;
    m.customProgramCacheKey = () => 'hole-paint';
    return m;
  };
  shared = {
    prop: make('prop'),
    punched: make('punched'),
    ribbon: make('ribbon'),
    glass: make('glass'),
  };
  return shared;
}

// ---------------------------------------------------------------- hole stencil

/** Ground materials draw only where the hole mask has NOT written stencil = 1. */
export function applyHoleCut<T extends Material>(mat: T): T {
  mat.stencilWrite = true;
  mat.stencilRef = 1;
  mat.stencilFunc = NotEqualStencilFunc;
  return mat;
}

/** Invisible disc that writes stencil = 1 where the ground must be cut away. */
export function createMaskMaterial(): MeshBasicMaterial {
  const m = new MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false,
    depthTest: false,
  });
  m.stencilWrite = true;
  m.stencilRef = 1;
  m.stencilFunc = AlwaysStencilFunc;
  m.stencilZPass = ReplaceStencilOp;
  m.stencilFail = ReplaceStencilOp;
  m.stencilZFail = ReplaceStencilOp;
  return m;
}

export function createGroundMaterial(): MeshLambertMaterial {
  return applyHoleCut(new MeshLambertMaterial({ vertexColors: true }));
}

export const SKY = new Color(0xbfe3f5);
