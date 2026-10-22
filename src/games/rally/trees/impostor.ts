import {
  Color,
  DataArrayTexture,
  DoubleSide,
  FrontSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderTarget,
  type BufferGeometry,
  type Texture,
  type WebGLRenderer,
} from 'three';
import {
  ALPHA_TEST,
  coverageChains,
  hemiOctDecode,
  IMPOSTOR_FRAMES,
  IMPOSTOR_LAYERS,
} from './materials';
import { TREE_SPRITE_AXES } from './sprite-attr';

/**
 * Stage 4, impostor baking (spec: trees/Lod.md#levels): LOD0 branches and every foliage sprite (billboarded towards
 * each bake view) rendered from N x N directions over the upper hemisphere (hemi-octahedral grid, frame (i, j)
 * looks from `hemiOctDecode(i / (N-1), j / (N-1))`) into three atlases: albedo (sRGB) + coverage, object-space
 * normal + depth along the view (0.5 = the bounding sphere centre), and thickness. All are premultiplied by coverage
 * (empty texels are 0), so frame blending and mipmaps never pull in a background colour; the impostor shader divides
 * by the blended coverage and lights the result like the geometry (trees/materials.ts).
 */

/** Pixels per frame (the impostor only draws trees a few dozen px tall). */
export const IMPOSTOR_FRAME_PX = 48;

export interface ImpostorPixels {
  size: number;
  albedo: Uint8Array;
  normal: Uint8Array;
  thickness: Uint8Array;
}

const BRANCH_VERT = /* glsl */ `
attribute vec4 treeWind;
uniform vec3 uCenter;
uniform vec3 uDir;
uniform float uR;
varying vec3 vColor;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vR;
varying vec3 vU;
varying float vDepth;
varying float vAO;
void main() {
	vColor = color;
	vUv = uv;
	vN = normal;
	vR = vec3( 0.0 );
	vU = vec3( 0.0 );
	vAO = treeWind.w;
	vDepth = 0.5 + 0.5 * dot( position - uCenter, uDir ) / uR;
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

/** Sprites face the bake view (the impostor is seen from that direction), turned and sized as in the game. */
const SPRITE_VERT = /* glsl */ `
attribute vec4 treeWind;
attribute vec4 treeSprite;
uniform vec3 uCenter;
uniform vec3 uDir;
uniform float uR;
varying vec3 vColor;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vR;
varying vec3 vU;
varying float vDepth;
varying float vAO;
${TREE_SPRITE_AXES}
void main() {
	vec3 right = cross( vec3( 0.0, 1.0, 0.0 ), uDir );
	right = dot( right, right ) > 1e-6 ? normalize( right ) : vec3( 1.0, 0.0, 0.0 );
	vec3 up = cross( uDir, right );
	vec2 corner;
	vec3 heading;
	float aligned;
	treeSpriteCorner( treeSprite, corner, heading, aligned );
	float stretch;
	treeSpriteAxes( right, up, heading, aligned, treeWind.y, 0.0, vR, vU, stretch );
	vec3 p = position + ( vR * ( corner.x * stretch ) + vU * corner.y ) * treeSprite.z;
	vColor = color;
	vUv = uv;
	vN = normal;
	vAO = treeWind.w;
	vDepth = 0.5 + 0.5 * dot( p - uCenter, uDir ) / uR;
	gl_Position = projectionMatrix * modelViewMatrix * vec4( p, 1.0 );
}`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform sampler2D uNormalMap;
uniform float uAlphaTest;
uniform int uMode;
uniform int uSprite;
varying vec3 vColor;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vR;
varying vec3 vU;
varying float vDepth;
varying float vAO;
vec3 toSRGB( vec3 c ) {
	return mix( c * 12.92, 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, step( vec3( 0.0031308 ), c ) );
}
void main() {
	vec4 t = texture2D( uMap, vUv );
	if ( t.a < uAlphaTest ) discard;
	vec3 n = normalize( vN );
	float thick = 1.0;
	if ( uSprite == 1 ) {
		vec4 nt = texture2D( uNormalMap, vUv );
		vec3 tn = nt.xyz * 2.0 - 1.0;
		n = normalize( n + ( vR * tn.x + vU * tn.y ) * SPRITE_BEND );
		thick = nt.w;
	}
	if ( uMode == 0 ) gl_FragColor = vec4( toSRGB( vColor * t.rgb * mix( 0.65, 1.0, vAO ) ), 1.0 );
	else if ( uMode == 1 ) gl_FragColor = vec4( n * 0.5 + 0.5, clamp( vDepth, 0.0, 1.0 ) );
	else gl_FragColor = vec4( thick, thick, thick, 1.0 );
}`;

const shared = {
  uCenter: { value: new Vector3() },
  uDir: { value: new Vector3() },
  uR: { value: 1 },
  uMode: { value: 0 },
};

export interface BakePart {
  geometry: BufferGeometry;
  map: Texture;
  /** Sprites: their normal + thickness map. */
  normalMap?: Texture;
}

function bakeMaterial(p: BakePart): ShaderMaterial {
  const sprite = !!p.normalMap;
  return new ShaderMaterial({
    vertexShader: sprite ? SPRITE_VERT : BRANCH_VERT,
    fragmentShader: FRAG,
    vertexColors: true,
    side: sprite ? DoubleSide : FrontSide,
    defines: { SPRITE_BEND: '0.8' },
    uniforms: {
      ...shared,
      uMap: { value: p.map },
      uNormalMap: { value: p.normalMap ?? p.map },
      uSprite: { value: sprite ? 1 : 0 },
      uAlphaTest: { value: sprite ? ALPHA_TEST : 0 },
    },
  });
}

export function bakeImpostor(
  renderer: WebGLRenderer,
  parts: BakePart[],
  sphere: { cy: number; r: number },
): ImpostorPixels {
  const N = IMPOSTOR_FRAMES;
  const F = IMPOSTOR_FRAME_PX;
  const size = N * F;
  const scene = new Scene();
  const mats = parts.map(bakeMaterial);
  parts.forEach((p, i) => scene.add(new Mesh(p.geometry, mats[i])));
  for (const o of scene.children) o.frustumCulled = false;
  const R = sphere.r;
  const center = new Vector3(0, sphere.cy, 0);
  const cam = new OrthographicCamera(-R, R, R, -R, R * 0.01, R * 4);
  const rt = new WebGLRenderTarget(size, size);
  const prevTarget = renderer.getRenderTarget();
  const prevColor = renderer.getClearColor(new Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevAutoClear = renderer.autoClear;
  const prevShadow = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false;
  renderer.autoClear = false;
  renderer.setClearColor(0x000000, 0);
  const out: Uint8Array[] = [];
  shared.uCenter.value.copy(center);
  shared.uR.value = R;
  for (let mode = 0; mode < 3; mode++) {
    shared.uMode.value = mode;
    rt.scissorTest = false;
    rt.viewport.set(0, 0, size, size);
    renderer.setRenderTarget(rt);
    renderer.clear(true, true, false);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const d = hemiOctDecode(i / (N - 1), j / (N - 1));
        shared.uDir.value.set(...d);
        cam.position.copy(center).addScaledVector(shared.uDir.value, R * 2);
        // Upright like the impostor billboard; looking straight down, +X stays the frame's right.
        cam.up.set(
          ...((d[1] > 0.999 ? [0, 0, -1] : [0, 1, 0]) as [
            number,
            number,
            number,
          ]),
        );
        cam.lookAt(center);
        cam.updateMatrixWorld();
        rt.viewport.set(i * F, j * F, F, F);
        rt.scissor.set(i * F, j * F, F, F);
        rt.scissorTest = true;
        renderer.setRenderTarget(rt);
        renderer.clearDepth();
        renderer.render(scene, cam);
      }
    const px = new Uint8Array(size * size * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);
    out.push(px);
  }
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevColor, prevAlpha);
  renderer.autoClear = prevAutoClear;
  renderer.shadowMap.autoUpdate = prevShadow;
  rt.dispose();
  for (const m of mats) m.dispose();
  return { size, albedo: out[0], normal: out[1], thickness: out[2] };
}

/**
 * Every variant's impostor in ONE texture array (trees/Performance.md#mitigations: all impostors draw in a single
 * call): layers 3i, 3i + 1, 3i + 2 = variant i's albedo + coverage, normal + depth, thickness, all premultiplied by
 * coverage. The albedo stays sRGB-encoded (one array has one colour space; the shader decodes it). Mip levels are the
 * coverage-preserving chain (trees/Foliage.md#alpha), written into the array after three allocates it (three uploads
 * only level 0 of an array texture itself).
 */
/**
 * The part of an impostor's frames any baked view covers (frame coordinates 0..1: u0, v0, u1, v1, 1 texel margin):
 * the billboard is cropped to it, so a narrow conifer does not cost the pixels of a square around its sphere.
 */
export function impostorBounds(
  px: ImpostorPixels,
): [number, number, number, number] {
  const N = IMPOSTOR_FRAMES;
  const F = px.size / N;
  let x0 = F;
  let y0 = F;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < px.size; y++)
    for (let x = 0; x < px.size; x++) {
      if (px.albedo[(y * px.size + x) * 4 + 3] < 8) continue;
      const fx = x % F;
      const fy = y % F;
      if (fx < x0) x0 = fx;
      if (fx > x1) x1 = fx;
      if (fy < y0) y0 = fy;
      if (fy > y1) y1 = fy;
    }
  if (x1 < 0) return [0, 0, 1, 1];
  const c = (t: number) => Math.min(1, Math.max(0, t / F));
  return [c(x0 - 1), c(y0 - 1), c(x1 + 2), c(y1 + 2)];
}

export function impostorArray(
  renderer: WebGLRenderer,
  pixels: ImpostorPixels[],
): DataArrayTexture {
  const size = pixels[0].size;
  const layer = size * size * 4;
  const L = IMPOSTOR_LAYERS;
  const data = new Uint8Array(layer * pixels.length * L);
  const chains = pixels.map((px, i) => {
    data.set(px.albedo, layer * (L * i));
    data.set(px.normal, layer * (L * i + 1));
    data.set(px.thickness, layer * (L * i + 2));
    const r = coverageChains(px.albedo, size, size, true, [
      px.normal,
      px.thickness,
    ]);
    return [r.main, r.companions[0], r.companions[1]];
  });
  const t = new DataArrayTexture(data, size, size, pixels.length * L);
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  renderer.initTexture(t);
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const handle = (
    renderer.properties.get(t) as { __webglTexture?: WebGLTexture }
  ).__webglTexture;
  if (handle) {
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, handle);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    chains.forEach((c, i) => {
      c.forEach((chain, k) => {
        for (let level = 1; level < chain.length; level++) {
          const m = chain[level];
          gl.texSubImage3D(
            gl.TEXTURE_2D_ARRAY,
            level,
            0,
            0,
            L * i + k,
            m.width,
            m.height,
            1,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            m.data,
          );
        }
      });
    });
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    renderer.resetState();
  }
  return t;
}
