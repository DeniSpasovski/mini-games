import {
  NoToneMapping,
  PCFSoftShadowMap,
  PerspectiveCamera,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';

export type QualityName = 'low' | 'high';

export interface Quality {
  name: QualityName;
  maxPixelRatio: number;
  antialias: boolean;
  shadows: boolean;
  shadowMapSize: number;
}

export const QUALITY: Record<QualityName, Quality> = {
  low: {
    name: 'low',
    maxPixelRatio: 1.5,
    antialias: false,
    shadows: false,
    shadowMapSize: 1024,
  },
  high: {
    name: 'high',
    maxPixelRatio: 2,
    antialias: true,
    shadows: true,
    shadowMapSize: 2048,
  },
};

/** Phones and small tablets start on `low`. */
export function defaultQuality(): QualityName {
  const coarse =
    typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return coarse && Math.min(screen.width, screen.height) < 700 ? 'low' : 'high';
}

export function isQualityName(v: string | null): v is QualityName {
  return v === 'low' || v === 'high';
}

/** Renderer shared by the game and every tool page. Fires a `resized` event on the canvas after each resize. */
export function createRenderer(
  container: HTMLElement,
  quality: Quality,
): WebGLRenderer {
  const renderer = new WebGLRenderer({
    antialias: quality.antialias,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(
    Math.min(window.devicePixelRatio, quality.maxPixelRatio),
  );
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = PCFSoftShadowMap;
  // The arena shadow map is static: the game sets `needsUpdate` when a crate breaks (Arena.consumeShadowDirty).
  renderer.shadowMap.autoUpdate = false;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';
  container.append(renderer.domElement);

  const resize = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.dispatchEvent(new CustomEvent('resized'));
  };
  new ResizeObserver(resize).observe(container);
  resize();
  return renderer;
}

/** Keep `camera.aspect` equal to the canvas; `onChange` runs after each update (e.g. re-fit the arena). */
export function bindCameraAspect(
  renderer: WebGLRenderer,
  camera: PerspectiveCamera,
  onChange?: () => void,
): void {
  const update = () => {
    const c = renderer.domElement;
    camera.aspect = (c.width || 1) / (c.height || 1);
    camera.updateProjectionMatrix();
    onChange?.();
  };
  renderer.domElement.addEventListener('resized', update);
  update();
}
