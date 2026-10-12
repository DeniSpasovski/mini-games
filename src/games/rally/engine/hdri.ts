import {
  DataTexture,
  DataUtils,
  EquirectangularReflectionMapping,
  FloatType,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
} from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

/**
 * HDRI image-based lighting (spec: rally/Lighting.md): Poly Haven equirect HDRIs (CC0) in public/hdri/, built into
 * the rally folder (rsbuild.config.ts `gamePublicFiles`). A map picks one with `EnvironmentDef.hdri`; the
 * Environment lights paint, glass, water, terrain and the tree sky light with it, the visible sky stays procedural.
 */
export const HDRIS = {
  noon_grass: {
    file: 'noon_grass_1k.hdr',
    credit: 'Noon Grass by Greg Zaal, Poly Haven (CC0)',
  },
  blaubeuren_hillside: {
    file: 'blaubeuren_hillside_1k.hdr',
    credit: 'Blaubeuren Hillside by Andreas Mischok, Poly Haven (CC0)',
  },
} as const;

export type HdriId = keyof typeof HDRIS;

/** About-screen row for a map lit by `id` (MapInfo.sources). */
export function hdriSource(id: HdriId): {
  label: string;
  url: string;
  note: string;
} {
  return {
    label: `Poly Haven HDRI: ${HDRIS[id].credit.split(' by ')[0]}`,
    url: `https://polyhaven.com/a/${id}`,
    note: `image-based lighting - ${HDRIS[id].credit}`,
  };
}

export function isHdriId(id: string | undefined): id is HdriId {
  return id !== undefined && Object.prototype.hasOwnProperty.call(HDRIS, id);
}

/** A stage load never waits longer than this for an HDRI (ms): past it, the procedural sky lights the stage. */
const LOAD_TIMEOUT_MS = 8000;
/**
 * The HDRI's sun is clamped to this multiple of its 99.5th-percentile luminance: the DirectionalLight is the sun
 * (direct light + shadows), so the image must not add a second one.
 */
const SUN_CAP = 2;

/** A loaded HDRI with its sun clamped out: linear RGB floats (rows top to bottom) and where its sun was. */
export interface HdriSource {
  width: number;
  height: number;
  rgb: Float32Array;
  /** Angle of the sun around the vertical, atan2(z, x) in three's equirect convention (rad). */
  sunAngle: number;
}

const cache = new Map<HdriId, Promise<HdriSource | null>>();

/** Load and prepare an HDRI once (cached); null when it fails or times out (callers keep the procedural sky). */
export function loadHdri(id: HdriId): Promise<HdriSource | null> {
  let p = cache.get(id);
  if (!p) {
    const url = new URL(`hdri/${HDRIS[id].file}`, location.href).href;
    const load = new HDRLoader()
      .setDataType(FloatType)
      .loadAsync(url)
      .then((tex) => {
        const img = tex.image as {
          width: number;
          height: number;
          data: Float32Array;
        };
        const src = prepareHdri(img.width, img.height, img.data);
        tex.dispose();
        return src;
      });
    const timeout = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), LOAD_TIMEOUT_MS),
    );
    p = Promise.race([load, timeout]).catch((err: unknown) => {
      console.warn(`[hdri] ${id} failed, lighting with the sky`, err);
      return null;
    });
    // A failure is not cached: the next stage load tries again.
    void p.then((s) => s ?? cache.delete(id));
    cache.set(id, p);
  }
  return p;
}

const lum = (r: number, g: number, b: number) =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;

/** RGBA floats -> RGB with the sun found and clamped out. */
export function prepareHdri(
  w: number,
  h: number,
  rgba: Float32Array,
): HdriSource {
  const rgb = new Float32Array(w * h * 3);
  const l = new Float32Array(w * h);
  let sun = 0;
  for (let i = 0; i < w * h; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    rgb[i * 3] = r;
    rgb[i * 3 + 1] = g;
    rgb[i * 3 + 2] = b;
    l[i] = lum(r, g, b);
    if (l[i] > l[sun]) sun = i;
  }
  const sorted = l.slice().sort();
  const cap = sorted[Math.floor(sorted.length * 0.995)] * SUN_CAP;
  for (let i = 0; i < w * h; i++)
    if (l[i] > cap) {
      const k = cap / l[i];
      rgb[i * 3] *= k;
      rgb[i * 3 + 1] *= k;
      rgb[i * 3 + 2] *= k;
    }
  const u = ((sun % w) + 0.5) / w;
  return { width: w, height: h, rgb, sunAngle: (u - 0.5) * Math.PI * 2 };
}

/**
 * An equirect texture of `src` turned about the vertical so its sun sits at `sunAngle` (atan2(z, x) of the scene's
 * sun direction, rad): a column shift, since a turn about Y moves every column by the same angle. Half float, so it
 * filters on every GPU.
 */
export function hdriTexture(src: HdriSource, sunAngle: number): DataTexture {
  const { width: w, height: h, rgb } = src;
  const turn = (sunAngle - src.sunAngle) / (Math.PI * 2);
  const shift = (((Math.round(turn * w) % w) + w) % w) | 0;
  const out = new Uint16Array(w * h * 4);
  const one = DataUtils.toHalfFloat(1);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const o = (y * w + ((x + shift) % w)) * 4;
      out[o] = DataUtils.toHalfFloat(rgb[i]);
      out[o + 1] = DataUtils.toHalfFloat(rgb[i + 1]);
      out[o + 2] = DataUtils.toHalfFloat(rgb[i + 2]);
      out[o + 3] = one;
    }
  const tex = new DataTexture(out, w, h);
  tex.type = HalfFloatType;
  tex.mapping = EquirectangularReflectionMapping;
  tex.colorSpace = LinearSRGBColorSpace;
  tex.minFilter = tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  // Rows run top to bottom, as HDRLoader leaves them.
  tex.flipY = true;
  tex.needsUpdate = true;
  return tex;
}
