import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DataTexture,
  DoubleSide,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshNormalMaterial,
  RepeatWrapping,
  MeshStandardMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  type Texture,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { Rng } from '../../../shared/rng';
import { CROP_MODELS } from '../assets/builders/crop-models.data';
import { coverageMips } from '../trees/materials';
import { groundLitCard } from './world-shading';

/**
 * Field crops from two CC BY models (`assets/builders/crop-models.data.ts`, credits: THIRD-PARTY.md): a wheat clump
 * and a corn plant, their own triangles and texture. Seasons recolour the texture (green spring wheat, dry autumn
 * corn); the corn cobs wear husks cut from the model's own leaf. In game the crops are cards: renders of the
 * models baked once per page with the game's renderer (`bakeCropCards`), so they keep the models' look.
 */

export type CropLook = 'wheat' | 'green_wheat' | 'corn' | 'dry_corn';
export type CropCard = CropLook | 'corn_row' | 'dry_corn_row';

const MODEL_OF: Record<CropLook, 'wheat' | 'corn'> = {
  wheat: 'wheat',
  green_wheat: 'wheat',
  corn: 'corn',
  dry_corn: 'corn',
};

/** Spring wheat is this much of the ripe height (late April: ~0.45 m, ears still in the leaf sheaths). */
export const SPRING_WHEAT = 0.45;

/** Size of a card (m): wheat = a patch of clumps, corn = one plant, *_row = a 3 m stretch of a corn row. */
export const CROP_CARD_SIZE: Record<CropCard, [number, number]> = {
  wheat: [1, 1.1],
  green_wheat: [1, 0.55],
  corn: [1.3, 2.7],
  dry_corn: [1.3, 2.7],
  corn_row: [3, 2.7],
  dry_corn_row: [3, 2.7],
};

/**
 * Baked variants per card (the asset variants pick one): each its own random mix of plant heights, so the tops of a
 * field are uneven at no cost (one texture, stacked; the same triangles).
 */
export const CARD_VARIANTS = 4;

/** Card texture size (px across; height follows the card's aspect). */
const CARD_PX = 512;
/** Empty rows between the stacked variants (their mipmaps must not bleed into each other). */
const CARD_GAP = 16;

/** Pixel layout of a card's texture: `py` rows per variant, `slot` rows apart, `rows` in all. */
function cardLayout(card: CropCard) {
  const [w, h] = CROP_CARD_SIZE[card];
  const py = Math.round((CARD_PX * h) / w / 4) * 4;
  const slot = py + CARD_GAP;
  return { px: CARD_PX, py, slot, rows: slot * CARD_VARIANTS };
}

/** The look a card is rendered from. */
const lookOf = (card: CropCard): CropLook =>
  card === 'corn_row' ? 'corn' : card === 'dry_corn_row' ? 'dry_corn' : card;

const meshes = new Map<'wheat' | 'corn', BufferGeometry>();

/** The model's own mesh (position, normal, uv; indexed), standing on the origin. Shared: do not modify. */
export function cropGeometry(model: 'wheat' | 'corn'): BufferGeometry {
  let g = meshes.get(model);
  if (g) return g;
  const bytes = Uint8Array.from(atob(CROP_MODELS[model].mesh), (c) =>
    c.charCodeAt(0),
  );
  const dv = new DataView(bytes.buffer);
  const n = dv.getUint16(0, true);
  const lo = [0, 1, 2].map((k) => dv.getFloat32(4 + k * 4, true));
  const size = [0, 1, 2].map((k) => dv.getFloat32(16 + k * 4, true));
  let at = 28;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++)
    pos[i] = lo[i % 3] + (dv.getUint16(at + i * 2, true) / 65535) * size[i % 3];
  at += n * 6;
  const nrm = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) nrm[i] = dv.getInt8(at + i) / 127;
  at += n * 3;
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n * 2; i++)
    uv[i] = dv.getUint16(at + i * 2, true) / 65535;
  at += n * 4;
  const count = dv.getUint32(at, true);
  const idx = new Uint16Array(count);
  for (let i = 0; i < count; i++) idx[i] = dv.getUint16(at + 4 + i * 2, true);
  g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nrm, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(new BufferAttribute(idx, 1));
  meshes.set(model, g);
  return g;
}

// --- textures ------------------------------------------------------------------------------------------------

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Recolour by brightness onto a dark -> light ramp (keeps the texture's own detail and shading). */
function ramp(
  d: Uint8ClampedArray,
  dark: RGB,
  light: RGB,
  lo: number,
  hi: number,
) {
  for (let i = 0; i < d.length; i += 4) {
    const l = (0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) / 255;
    const t = Math.min(1, Math.max(0, (l - lo) / (hi - lo)));
    const c = mix(dark, light, t);
    d[i] = c[0];
    d[i + 1] = c[1];
    d[i + 2] = c[2];
  }
}

/** Keep `sat` of each pixel's colour away from its grey and scale it by `gain` (the model's own detail stays). */
function tone(d: Uint8ClampedArray, sat: number, gain: number) {
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
    for (let k = 0; k < 3; k++) d[i + k] = (l + (d[i + k] - l) * sat) * gain;
  }
}

/**
 * The corn texture: leaf on the left (x 0-0.23), the cob in the middle (0.23-0.54). Husks: the cob's strip is
 * painted over with the leaf, squeezed to its width, a little lighter (field corn never shows its kernels).
 */
function husk(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.save();
  ctx.filter = 'brightness(1.12) saturate(0.85)';
  ctx.drawImage(ctx.canvas, 0.02 * w, 0, 0.2 * w, h, 0.23 * w, 0, 0.31 * w, h);
  ctx.restore();
}

function recolour(
  look: CropLook,
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
) {
  if (look === 'corn' || look === 'dry_corn') husk(ctx, w, h);
  if (look === 'corn') return;
  const img = ctx.getImageData(0, 0, w, h);
  // Ripe wheat: the model's own gold, a little richer (photos of ripe fields: warm gold, saturation ~0.5-0.7). The glow
  // came from the flat unshaded cards and the leaf translucency, not the colour (`canopyShade`, `THROUGH`).
  if (look === 'wheat') {
    tone(img.data, 1.1, 0.95);
    ctx.putImageData(img, 0, 0);
    return;
  }
  // Spring wheat: blue-green (waxy) stalks, leaves and ears, lighter at the ears. Dry corn: warm straw-tan leaves and husks (October field corn is
  // buff, not grey: the dark end stays brown).
  if (look === 'green_wheat')
    ramp(img.data, [80, 112, 78], [184, 218, 156], 0.35, 0.9);
  else ramp(img.data, [118, 86, 46], [218, 188, 126], 0.15, 0.6);
  ctx.putImageData(img, 0, 0);
}

const maps = new Map<CropLook, Texture>();
const loaded: Promise<void>[] = [];

/** The model texture of a look (filled in once the image has decoded). */
export function cropTexture(look: CropLook): Texture {
  const t = maps.get(look);
  if (t) return t;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  maps.set(look, tex);
  const img = new Image();
  loaded.push(
    new Promise<void>((resolve) => {
      img.onload = () => {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return resolve(); // no 2D canvas (tests)
        ctx.drawImage(img, 0, 0, 512, 512);
        recolour(look, ctx, 512, 512);
        tex.needsUpdate = true;
        resolve();
      };
      img.onerror = () => resolve();
    }),
  );
  img.src = CROP_MODELS[MODEL_OF[look]].texture;
  return tex;
}

// --- materials ------------------------------------------------------------------------------------------------

const materials = new Map<string, MeshStandardMaterial>();

/** Wind sway per m² of height (engine/world-shading.ts RALLY_WIND): wheat nods, the tall corn sways less per metre. */
const WIND: Record<'wheat' | 'corn', number> = { wheat: 0.12, corn: 0.03 };
/** Light through the plant against the sun (`RALLY_FOLIAGE`): corn leaves like grass, dry wheat straw much less. */
const THROUGH: Record<'wheat' | 'corn', number> = { wheat: 0.08, corn: 0.25 };

/** The model's material (opaque, both sides, its own texture). */
export function cropMaterial(look: CropLook): MeshStandardMaterial {
  const key = `model:${look}`;
  let m = materials.get(key);
  if (m) return m;
  m = new MeshStandardMaterial({
    map: cropTexture(look),
    side: DoubleSide,
    roughness: 0.85,
  });
  m.name = `crop ${look}`;
  m.defines = {
    RALLY_WIND: WIND[MODEL_OF[look]],
    RALLY_FOLIAGE: THROUGH[MODEL_OF[look]],
    RALLY_GROUND: 1,
  };
  materials.set(key, m);
  return m;
}

const cards = new Map<CropCard, DataTexture>();
let cardA2C = false;

function emptyCard(): DataTexture {
  const t = new DataTexture(new Uint8Array(4), 1, 1);
  t.needsUpdate = true;
  return t;
}

/** The card material of a look: alpha-tested baked render, normals up like the grass cards. */
export function cropCardMaterial(card: CropCard): MeshStandardMaterial {
  const key = `card:${card}`;
  let m = materials.get(key);
  if (m) return m;
  let t = cards.get(card);
  if (!t) cards.set(card, (t = emptyCard()));
  m = new MeshStandardMaterial({
    map: t,
    alphaTest: 0.5,
    side: DoubleSide,
    roughness: 0.9,
  });
  m.alphaToCoverage = cardA2C;
  m.name = `crop card ${card}`;
  groundLitCard(m, 'crop');
  const model = MODEL_OF[lookOf(card)];
  m.defines = {
    RALLY_WIND: WIND[model],
    RALLY_FOLIAGE: THROUGH[model],
    RALLY_GROUND: 1,
  };
  materials.set(key, m);
  return m;
}

/** Alpha-to-coverage on the cards when the renderer has MSAA (like the grass cards). */
export function setCropAntialias(on: boolean): void {
  cardA2C = on;
  for (const [k, m] of materials)
    if (k.startsWith('card:') && m.alphaToCoverage !== on) {
      m.alphaToCoverage = on;
      m.needsUpdate = true;
    }
}

// --- card bake --------------------------------------------------------------------------------------------------

/** The models laid out for a card: a seeded patch of wheat clumps, one corn plant, or a 3 m stretch of a corn row. */
function cardScene(card: CropCard, variant: number): Group {
  const group = new Group();
  const look = lookOf(card);
  const model = MODEL_OF[look];
  const mat = new MeshBasicMaterial({
    map: cropTexture(look),
    side: DoubleSide,
  });
  const geo = cropGeometry(model);
  const rng = new Rng(card.length * 31 + 7 + variant * 1013);
  const add = (x: number, z: number, s: number, rot: number) => {
    const m = new Mesh(geo, mat);
    m.position.set(x, 0, z);
    m.scale.setScalar(s);
    m.rotation.y = rot;
    group.add(m);
  };
  const [w] = CROP_CARD_SIZE[card];
  if (model === 'wheat') {
    // A dense strip of clumps (a real field is ~100 clumps / m²; the card shows the front of a 1 m patch). The short
    // spring clumps need twice as many to close the patch.
    const n = look === 'green_wheat' ? 30 : 14;
    for (let i = 0; i < n; i++)
      add(
        (rng.next() - 0.5) * (w - 0.3),
        (rng.next() - 0.5) * 0.4,
        (look === 'green_wheat' ? SPRING_WHEAT : 1) * rng.range(0.75, 1.1),
        rng.next() * Math.PI * 2,
      );
  } else if (card !== look) {
    for (let i = 0; i < 12; i++)
      add(
        -w / 2 + (i + 0.5) * (w / 12),
        (rng.next() - 0.5) * 0.1,
        rng.range(0.82, 1.15),
        rng.next() * Math.PI * 2,
      );
  } else add(0, 0, 1, 0.4 + variant * 1.3);
  return group;
}

let baking: Promise<void> | undefined;

/**
 * Bake the crop cards with `renderer` (once per page): the models' own colours, unlit (the cards are lit in the world
 * like the grass), with coverage-preserving mipmaps. The card materials show nothing until this has run.
 */
export function bakeCropCards(renderer: WebGLRenderer): Promise<void> {
  if (baking) return baking;
  (Object.keys(MODEL_OF) as CropLook[]).forEach((l) => cropTexture(l));
  baking = Promise.all(loaded).then(() => {
    const prevTarget = renderer.getRenderTarget();
    const prevColor = renderer.getClearColor(new Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevTone = renderer.toneMapping;
    renderer.toneMapping = 0;
    renderer.setClearColor(0x000000, 0);
    for (const card of Object.keys(CROP_CARD_SIZE) as CropCard[]) {
      const [w, h] = CROP_CARD_SIZE[card];
      const { px, py, slot, rows } = cardLayout(card);
      const data = new Uint8Array(px * rows * 4);
      const rt = new WebGLRenderTarget(px, py, { colorSpace: SRGBColorSpace });
      const rn = new WebGLRenderTarget(px, py);
      const cam = new OrthographicCamera(-w / 2, w / 2, h, 0, -10, 10);
      cam.position.set(0, 0, 5);
      cam.lookAt(0, 0, 0);
      for (let v = 0; v < CARD_VARIANTS; v++) {
        const scene = new Scene();
        scene.add(cardScene(card, v));
        renderer.setRenderTarget(rt);
        renderer.clear();
        renderer.render(scene, cam);
        const one = new Uint8Array(px * py * 4);
        renderer.readRenderTargetPixels(rt, 0, 0, px, py, one);
        if (MODEL_OF[lookOf(card)] === 'corn') {
          // A corn card is a 2.4 m wall of leaves: bake their own shading in (unlit, the card would be one flat colour).
          scene.overrideMaterial = normals;
          renderer.setRenderTarget(rn);
          renderer.clear();
          renderer.render(scene, cam);
          const n = new Uint8Array(px * py * 4);
          renderer.readRenderTargetPixels(rn, 0, 0, px, py, n);
          leafShade(one, n, card === lookOf(card) ? 1 : 0.85);
        }
        if (MODEL_OF[lookOf(card)] === 'wheat') canopyShade(one, px, py);
        // Variant v fills rows v * slot .. + py (row 0 = the bottom, uv v = 0).
        data.set(one, v * slot * px * 4);
      }
      rt.dispose();
      rn.dispose();
      bleed(data, px, rows);
      const t = cards.get(card) ?? emptyCard();
      const mips = coverageMips(data, px, rows, false);
      t.image = { data, width: px, height: rows };
      t.mipmaps = mips.main;
      t.generateMipmaps = false;
      // Repeats across (`cropBlock` strips run several cards long); the variants are stacked the other way.
      t.wrapS = RepeatWrapping;
      t.magFilter = LinearFilter;
      t.minFilter = LinearMipmapLinearFilter;
      t.colorSpace = SRGBColorSpace;
      t.needsUpdate = true;
      cards.set(card, t);
    }
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevAlpha);
    renderer.toneMapping = prevTone;
  });
  return baking;
}

const normals = new MeshNormalMaterial({ side: DoubleSide });

/**
 * Darken the baked colour by the leaf normal (`n`: view-space normals packed 0..255, the camera looking along -z with
 * y up): leaves facing the sky stay bright, those turned down or edge-on fall to ~45 %; a row card (`row` < 1) a little
 * darker overall (the leaves deeper in the row are in shade).
 */
function leafShade(d: Uint8Array, n: Uint8Array, row: number) {
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const ny = (n[i + 1] / 255) * 2 - 1;
    const nz = Math.abs((n[i + 2] / 255) * 2 - 1);
    const k = (0.55 + 0.45 * (0.5 + 0.5 * ny) ** 1.3) * (0.8 + 0.2 * nz) * row;
    d[i] *= k;
    d[i + 1] *= k;
    d[i + 2] *= k;
  }
}

/**
 * Darken a wheat card toward its base (rows from the bottom): inside a dense field the stalks shade each other, only
 * the ears on top take the full sun. Without it the card is one flat sheet of lit straw and the field glows.
 */
function canopyShade(d: Uint8Array, w: number, h: number) {
  for (let y = 0; y < h; y++) {
    const t = Math.min(1, y / (0.85 * h));
    const k = 0.62 + 0.38 * t * t * (3 - 2 * t);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      d[i] *= k;
      d[i + 1] *= k;
      d[i + 2] *= k;
    }
  }
}

/** Push colour into transparent texels so filtering never pulls in black at the card edges. */
function bleed(d: Uint8Array, w: number, h: number) {
  // Same result as averaging the filled 4-neighbours of every empty texel per pass, without per-texel allocations.
  const prev = new Uint8Array(d.length);
  for (let pass = 0; pass < 6; pass++) {
    prev.set(d);
    let changed = false;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (prev[i + 3] > 0 || prev[i] + prev[i + 1] + prev[i + 2] > 0)
          continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        const take = (j: number) => {
          if (prev[j + 3] === 0 && prev[j] + prev[j + 1] + prev[j + 2] === 0)
            return;
          r += prev[j];
          g += prev[j + 1];
          b += prev[j + 2];
          n++;
        };
        if (x + 1 < w) take(i + 4);
        if (x > 0) take(i - 4);
        if (y + 1 < h) take(i + w * 4);
        if (y > 0) take(i - w * 4);
        if (n) {
          d[i] = r / n;
          d[i + 1] = g / n;
          d[i + 2] = b / n;
          changed = true;
        }
      }
    // Nothing filled: the later passes would not either.
    if (!changed) break;
  }
}

/** Crossed card geometry (`planes` quads about the y axis), bottom on the origin, uv over `variant`'s baked card. */
export function crossedCards(
  card: CropCard,
  planes: number,
  seed: number,
  variant: number,
): BufferGeometry {
  const [w, h] = CROP_CARD_SIZE[card];
  const { py, slot, rows } = cardLayout(card);
  const v0 = ((variant % CARD_VARIANTS) * slot) / rows;
  const dv = py / rows;
  const rng = new Rng(seed);
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < planes; i++) {
    const g = new PlaneGeometry(w, h);
    g.translate(0, h / 2, 0);
    g.rotateY((i * Math.PI) / planes + (planes > 1 ? rng.next() * 0.3 : 0));
    const n = g.getAttribute('normal') as BufferAttribute;
    // Lit like the ground they stand on (no dark back faces), as the grass cards.
    for (let k = 0; k < n.count; k++) n.setXYZ(k, 0, 1, 0);
    // This variant's slot of the stacked texture.
    const uv = g.getAttribute('uv') as BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setY(k, v0 + uv.getY(k) * dv);
    parts.push(g.index ? g.toNonIndexed() : g);
  }
  return mergeCards(parts);
}

/** Size of a `cropBlock` (m): along the field strips x across them. */
export const CROP_BLOCK: [number, number] = [3, 2];

/**
 * A block of a field as one geometry (one instance instead of a dozen card patches): cards running the block's length
 * every `gap` m, more across it, the card texture repeated along each (wrapS) and every strip its own variant, so the
 * tops stay uneven. Long axis = local x (rows face along the field strips).
 */
export function cropBlock(
  card: CropCard,
  seed: number,
  variant: number,
  gap = 0.4,
): BufferGeometry {
  const [w, h] = CROP_CARD_SIZE[card];
  const { py, slot, rows } = cardLayout(card);
  const [len, wide] = CROP_BLOCK;
  const rng = new Rng(seed * 31 + variant);
  const parts: BufferGeometry[] = [];
  const strip = (l: number, across: boolean, at: number) => {
    const g = new PlaneGeometry(l, h * rng.range(0.92, 1.06));
    g.translate(rng.range(-0.15, 0.15), (h * rng.range(0.92, 1.06)) / 2, 0);
    if (across) g.rotateY(Math.PI / 2 + rng.range(-0.08, 0.08));
    else g.rotateY(rng.range(-0.04, 0.04));
    g.translate(across ? at : 0, 0, across ? 0 : at);
    const n = g.getAttribute('normal') as BufferAttribute;
    for (let k = 0; k < n.count; k++) n.setXYZ(k, 0, 1, 0);
    const v =
      (variant + Math.floor(rng.next() * CARD_VARIANTS)) % CARD_VARIANTS;
    const u0 = rng.next();
    const uv = g.getAttribute('uv') as BufferAttribute;
    for (let k = 0; k < uv.count; k++)
      uv.setXY(
        k,
        u0 + (uv.getX(k) * l) / w,
        (v * slot) / rows + (uv.getY(k) * py) / rows,
      );
    parts.push(g.toNonIndexed());
  };
  for (let z = -wide / 2 + gap / 2; z < wide / 2; z += gap)
    strip(len, false, z);
  for (let x = -len / 2 + gap / 2; x < len / 2; x += gap) strip(wide, true, x);
  return mergeCards(parts);
}

/** Non-indexed card quads (position, normal, uv) as one geometry. */
function mergeCards(parts: BufferGeometry[]): BufferGeometry {
  const out = new BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const arrs = parts.map((p) => p.getAttribute(name).array as Float32Array);
    const len = arrs.reduce((s, a) => s + a.length, 0);
    const merged = new Float32Array(len);
    let o = 0;
    for (const a of arrs) {
      merged.set(a, o);
      o += a.length;
    }
    out.setAttribute(name, new BufferAttribute(merged, name === 'uv' ? 2 : 3));
  }
  return out;
}
