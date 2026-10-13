import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  OrthographicCamera,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector4,
  WebGLRenderTarget,
  type Material,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { getMaterial, registerFoliageMaterial } from '../engine/materials';
import { addWorldUniforms } from '../engine/world-shading';
import type { BuiltAsset } from './types';

/**
 * Far-tree impostors (`LodSpec.impostor`): one camera-facing quad (2 triangles) per tree.
 *
 * With a renderer (`setImpostorRenderer`, called by `createRenderer`) the quad shows the tree itself: the first
 * time an asset's impostor is asked for, every variant's previous LOD is rendered from `ANGLES` sides into an atlas
 * (columns = view angle, rows = variant) of colour + view-space normals, read back into CPU textures (so they work
 * in any WebGL context). The shader picks the frame the camera looks from and lights the baked normals with the
 * scene's sun, fog and world shading - no flat cut-outs. The instance's variant (`instVariant`) picks the row.
 *
 * Without a renderer (node tests) it falls back to a flat diamond in the crown's average colour.
 */
const ANGLES = 8;
/** Frame height in texels (width follows the tree's aspect). */
const FRAME_H = 128;

let bakeRenderer: WebGLRenderer | null = null;

/** The renderer that bakes impostor atlases (the latest one created; atlases are CPU textures, any context can draw them). */
export function setImpostorRenderer(r: WebGLRenderer): void {
  bakeRenderer = r;
}

/**
 * Impostor of asset `id`: `variants` rows baked from `source(variant)` = the LOD it replaces (same size and shape at
 * the switch: far tree LODs are built a bit taller than LOD0), `fallback` = that LOD's variant 0.
 */
export function impostorOf(
  id: string,
  variants: number,
  source: (variant: number) => BuiltAsset,
  fallback: () => BuiltAsset,
): BuiltAsset {
  if (!bakeRenderer || typeof document === 'undefined')
    return diamondOf(fallback());
  return bakeImpostor(bakeRenderer, id, variants, source);
}

// --- baked impostor ------------------------------------------------------------------------------------------

function bakeImpostor(
  renderer: WebGLRenderer,
  id: string,
  variants: number,
  source: (variant: number) => BuiltAsset,
): BuiltAsset {
  const assets = Array.from({ length: variants }, (_, v) => source(v));
  // One frame box for every variant: the quad is the same size, each frame keeps the variant's true scale.
  let r = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  const avg = new Color(0, 0, 0);
  let n = 0;
  for (const a of assets)
    for (const p of a.parts) {
      const pos = p.geometry.getAttribute('position');
      const col = p.geometry.getAttribute('color');
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        r = Math.max(r, Math.hypot(pos.getX(i), pos.getZ(i)));
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        if (col) {
          avg.r += col.getX(i);
          avg.g += col.getY(i);
          avg.b += col.getZ(i);
          n++;
        }
      }
    }
  if (n) avg.multiplyScalar(1 / n);
  else avg.set(0x4d6a2a);
  const halfW = r * 1.03;
  const pad = (maxY - minY) * 0.015;
  minY -= pad;
  maxY += pad;
  const fh = FRAME_H;
  const fw = Math.min(
    256,
    Math.max(16, Math.round((fh * 2 * halfW) / (maxY - minY) / 4) * 4),
  );
  const aw = fw * ANGLES;
  const ah = fh * variants;

  const scene = new Scene();
  const camera = new OrthographicCamera(
    -halfW,
    halfW,
    maxY,
    minY,
    0.1,
    4 * r + 10,
  );
  const dist = 2 * r + 5;

  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevAutoClear = renderer.autoClear;
  renderer.autoClear = false;

  // Albedo into an sRGB target (8-bit without banding in the darks), normals linear.
  const pass = (kind: 'albedo' | 'normal', clear: Color): Uint8Array => {
    const rt = new WebGLRenderTarget(aw, ah, {
      colorSpace: kind === 'albedo' ? SRGBColorSpace : NoColorSpace,
    });
    rt.scissorTest = true;
    renderer.setClearColor(clear, 0);
    for (let v = 0; v < variants; v++) {
      scene.clear();
      for (const p of assets[v].parts)
        scene.add(new Mesh(p.geometry, bakeMaterial(kind, p.material)));
      for (let k = 0; k < ANGLES; k++) {
        const a = (k / ANGLES) * Math.PI * 2;
        camera.position.set(Math.sin(a) * dist, 0, Math.cos(a) * dist);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();
        rt.viewport.set(k * fw, v * fh, fw, fh);
        rt.scissor.set(k * fw, v * fh, fw, fh);
        renderer.setRenderTarget(rt);
        renderer.clear(true, true, false);
        renderer.render(scene, camera);
      }
    }
    const px = new Uint8Array(aw * ah * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, aw, ah, px);
    rt.dispose();
    dilate(px, aw, ah, 6);
    return px;
  };
  // Clear colours = what the edges fade to in the mip chain: the crown's colour / a facing normal.
  const albedo = pass('albedo', avg);
  const normal = pass('normal', new Color(0.5, 0.5, 1));

  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.autoClear = prevAutoClear;
  scene.clear();

  const tex = (data: Uint8Array, srgb: boolean): Texture => {
    const t = new DataTexture(data, aw, ah, RGBAFormat);
    t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
    t.mipmaps = mipChain(data, aw, ah, srgb);
    t.generateMipmaps = false;
    t.minFilter = LinearMipmapLinearFilter;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  };
  const material = bakedMaterial(
    id,
    tex(albedo, true),
    tex(normal, false),
    variants,
  );

  // Quad: x = sideways offset (turned to the camera in the shader), y = height, uv = position inside a frame.
  const g = new BufferGeometry();
  g.setAttribute(
    'position',
    new BufferAttribute(
      new Float32Array([
        -halfW,
        minY,
        0,
        halfW,
        minY,
        0,
        halfW,
        maxY,
        0,
        -halfW,
        maxY,
        0,
      ]),
      3,
    ),
  );
  g.setAttribute(
    'normal',
    new BufferAttribute(
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
      3,
    ),
  );
  g.setAttribute(
    'uv',
    new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2),
  );
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeBoundingSphere();
  return { parts: [{ geometry: g, material }], perInstanceVariant: true };
}

/**
 * Mip levels down to 1 x 1 (2 x 2 box filter). `keepCoverage`: each level's alpha is scaled so as many texels pass
 * the 0.5 alpha test as in level 0 - otherwise averaged alpha drops under the cut and far trees thin out to twigs.
 */
function mipChain(
  px: Uint8Array,
  w: number,
  h: number,
  keepCoverage: boolean,
): { data: Uint8Array; width: number; height: number }[] {
  const coverage = (d: Uint8Array, scale: number) => {
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] * scale >= 127.5) n++;
    return n / (d.length / 4);
  };
  const target = coverage(px, 1);
  const levels = [{ data: px, width: w, height: h }];
  let src = px;
  while (w > 1 || h > 1) {
    const w2 = Math.max(1, w >> 1);
    const h2 = Math.max(1, h >> 1);
    const dst = new Uint8Array(w2 * h2 * 4);
    for (let y = 0; y < h2; y++)
      for (let x = 0; x < w2; x++) {
        const x0 = Math.min(w - 1, x * 2);
        const x1 = Math.min(w - 1, x * 2 + 1);
        const y0 = Math.min(h - 1, y * 2);
        const y1 = Math.min(h - 1, y * 2 + 1);
        const a = (y0 * w + x0) * 4;
        const b = (y0 * w + x1) * 4;
        const c = (y1 * w + x0) * 4;
        const d = (y1 * w + x1) * 4;
        const o = (y * w2 + x) * 4;
        for (let k = 0; k < 4; k++)
          dst[o + k] =
            (src[a + k] + src[b + k] + src[c + k] + src[d + k] + 2) >> 2;
      }
    if (keepCoverage && target > 0) {
      let lo = 1;
      let hi = 8;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        if (coverage(dst, mid) < target) lo = mid;
        else hi = mid;
      }
      for (let i = 3; i < dst.length; i += 4)
        dst[i] = Math.min(255, Math.round(dst[i] * hi));
    }
    levels.push({ data: dst, width: w2, height: h2 });
    src = dst;
    w = w2;
    h = h2;
  }
  return levels;
}

/**
 * Fill the colour of transparent texels from their opaque neighbours (`passes` texels deep), so mipmaps and
 * filtering at the cut-out edge never blend in the clear colour. Alpha is left alone.
 */
function dilate(px: Uint8Array, w: number, h: number, passes: number): void {
  let filled = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) filled[i] = px[i * 4 + 3] > 0 ? 1 : 0;
  for (let p = 0; p < passes; p++) {
    const next = filled.slice();
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (filled[i]) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let c = 0;
        for (const [dx, dy] of NEIGHBOURS) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (!filled[j]) continue;
          r += px[j * 4];
          g += px[j * 4 + 1];
          b += px[j * 4 + 2];
          c++;
        }
        if (!c) continue;
        px[i * 4] = r / c;
        px[i * 4 + 1] = g / c;
        px[i * 4 + 2] = b / c;
        next[i] = 1;
      }
    filled = next;
  }
}
const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const bakeMats = new Map<string, ShaderMaterial>();

/** Unlit bake material for a part drawn with `src`: albedo (vertex colour x map, sRGB out) or view-space normals. */
function bakeMaterial(
  kind: 'albedo' | 'normal',
  src: Material,
): ShaderMaterial {
  const s = src as MeshStandardMaterial;
  const map = kind === 'albedo' ? (s.map ?? null) : null;
  const key = `${kind}:${map?.uuid ?? '-'}:${s.side}:${s.vertexColors}`;
  let m = bakeMats.get(key);
  if (m) return m;
  m = new ShaderMaterial({
    uniforms: { map: { value: map } },
    vertexColors: kind === 'albedo' && s.vertexColors,
    side: s.side === DoubleSide ? DoubleSide : s.side,
    defines: map ? { BAKE_MAP: 1 } : {},
    vertexShader: /* glsl */ `
varying vec3 vCol;
varying vec2 vUv;
varying vec3 vN;
void main() {
#ifdef USE_COLOR
	vCol = color;
#else
	vCol = vec3( 1.0 );
#endif
	vUv = uv;
	vN = normalize( normalMatrix * normal );
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,
    fragmentShader:
      kind === 'albedo'
        ? /* glsl */ `
uniform sampler2D map;
varying vec3 vCol;
varying vec2 vUv;
void main() {
	vec3 c = vCol;
#ifdef BAKE_MAP
	c *= texture2D( map, vUv ).rgb;
#endif
	gl_FragColor = vec4( c, 1.0 );
	#include <colorspace_fragment>
}`
        : /* glsl */ `
varying vec3 vN;
void main() {
	vec3 n = normalize( vN ) * ( gl_FrontFacing ? 1.0 : -1.0 );
	gl_FragColor = vec4( n * 0.5 + 0.5, 1.0 );
}`,
  });
  bakeMats.set(key, m);
  return m;
}

/**
 * Lit impostor material of one asset (its own atlas textures, one shared program). Vertex: the quad turns to the
 * camera round the tree's axis and picks the frame baked closest to the view direction (in the tree's own frame,
 * so its rotation counts). Fragment: atlas colour x tint, alpha-tested; the baked normal turned by what is left of
 * the angle becomes the view-space shading normal.
 */
function bakedMaterial(
  id: string,
  albedo: Texture,
  normal: Texture,
  rows: number,
): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ roughness: 0.92, alphaTest: 0.5 });
  m.name = `impostor:${id}`;
  m.userData.impostor = { albedo, normal }; // debugging: the atlas textures
  m.defines = { RALLY_FOLIAGE: 0.3, IMP_ANGLES: `${ANGLES}.0` };
  const grid = new Vector4(ANGLES, rows, 0, 0);
  m.onBeforeCompile = (shader) => {
    addWorldUniforms(shader);
    shader.uniforms.impAlbedo = { value: albedo };
    shader.uniforms.impNormal = { value: normal };
    shader.uniforms.impGrid = { value: grid };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec4 impGrid;
attribute float instVariant;
varying vec2 vImpUv;
varying float vImpTurn;`,
      )
      .replace(
        '#include <project_vertex>',
        `mat4 impModel = modelMatrix;
#ifdef USE_INSTANCING
	impModel = modelMatrix * instanceMatrix;
	float impRow = instVariant;
#else
	float impRow = 0.0;
#endif
vec3 impAxisX = impModel[ 0 ].xyz;
vec3 impAxisZ = impModel[ 2 ].xyz;
vec3 impToCam = cameraPosition - impModel[ 3 ].xyz;
float impYaw = atan( dot( impToCam, impAxisX ) / dot( impAxisX, impAxisX ), dot( impToCam, impAxisZ ) / dot( impAxisZ, impAxisZ ) );
float impStep = 6.28318530718 / IMP_ANGLES;
float impFrame = floor( impYaw / impStep + 0.5 );
vImpTurn = impYaw - impFrame * impStep;
impFrame = mod( impFrame, IMP_ANGLES );
vImpUv = vec2( ( impFrame + uv.x ) / impGrid.x, ( clamp( impRow, 0.0, impGrid.y - 1.0 ) + uv.y ) / impGrid.y );
vec4 mvPosition = viewMatrix * impModel * vec4( 0.0, transformed.y, 0.0, 1.0 );
mvPosition.x += transformed.x * length( impAxisX );
gl_Position = projectionMatrix * mvPosition;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D impAlbedo;
uniform sampler2D impNormal;
varying vec2 vImpUv;
varying float vImpTurn;`,
      )
      .replace(
        '#include <map_fragment>',
        `vec4 impTex = texture2D( impAlbedo, vImpUv );
diffuseColor *= impTex;`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
vec3 impN = texture2D( impNormal, vImpUv ).xyz * 2.0 - 1.0;
float impC = cos( vImpTurn );
float impS = sin( vImpTurn );
normal = normalize( vec3( impN.x * impC - impN.z * impS, impN.y, impN.x * impS + impN.z * impC ) );
nonPerturbedNormal = normal;`,
      );
  };
  m.customProgramCacheKey = () => 'tree-impostor-baked-v1';
  registerFoliageMaterial(m);
  return m;
}

// --- fallback: flat diamond ----------------------------------------------------------------------------------

/**
 * A flat diamond (2 triangles) the 'tree_impostor' material turns towards the camera, sized and coloured from the
 * asset's previous LOD: bottom tip at the trunk foot, widest where the crown is, top tip at the top; the crown's
 * average vertex colour, darker at the foot.
 */
function diamondOf(from: BuiltAsset): BuiltAsset {
  let maxY = 0;
  for (const p of from.parts) {
    const pos = p.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) maxY = Math.max(maxY, pos.getY(i));
  }
  let r = 0;
  let y = 0;
  let n = 0;
  const c = new Color(0, 0, 0);
  for (const p of from.parts) {
    const pos = p.geometry.getAttribute('position');
    const col = p.geometry.getAttribute('color');
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < maxY * 0.35) continue; // the crown, not the trunk
      r = Math.max(r, Math.hypot(pos.getX(i), pos.getZ(i)));
      y += pos.getY(i);
      n++;
      if (col)
        c.setRGB(c.r + col.getX(i), c.g + col.getY(i), c.b + col.getZ(i));
    }
  }
  if (!n || c.r + c.g + c.b === 0) c.set(0x4d6a2a);
  else c.multiplyScalar(1 / n);
  const mid = n ? y / n : maxY * 0.6;
  // A crown's silhouette is a bit narrower than its widest vertex.
  const w = r * 0.9;
  const foot = c.clone().multiplyScalar(0.45);
  // bottom, right, top, left
  const pos = new Float32Array([0, 0, 0, w, mid, 0, 0, maxY, 0, -w, mid, 0]);
  const col = new Float32Array([
    foot.r,
    foot.g,
    foot.b,
    c.r,
    c.g,
    c.b,
    c.r * 1.08,
    c.g * 1.08,
    c.b * 1.08,
    c.r,
    c.g,
    c.b,
  ]);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(12), 3));
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(8), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeBoundingSphere();
  return { parts: [{ geometry: g, material: getMaterial('tree_impostor') }] };
}
