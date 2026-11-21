import {
  ACESFilmicToneMapping,
  PCFShadowMap,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { setTreeFoliageAntialias } from '../trees/materials';
import { setFoliageAntialias } from './materials';
import type { QualitySettings } from './quality';

/** Shared renderer setup for the game and every debug page (same look everywhere). */
export function createRenderer(
  container: HTMLElement,
  quality: QualitySettings,
): WebGLRenderer {
  const renderer = new WebGLRenderer({
    antialias: quality.antialias,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(
    Math.min(window.devicePixelRatio, quality.maxPixelRatio),
  );
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  // MSAA on -> alpha-to-coverage on the grass / leaf cards.
  setFoliageAntialias(quality.antialias);
  setTreeFoliageAntialias(quality.antialias);
  renderer.domElement.style.display = 'block';
  container.append(renderer.domElement);

  const resize = () => {
    const fixed = fixedSizes.get(renderer);
    const w = fixed?.w ?? (container.clientWidth || window.innerWidth);
    const h = fixed?.h ?? (container.clientHeight || window.innerHeight);
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.dispatchEvent(
      new CustomEvent('resized', { detail: { w, h } }),
    );
  };
  new ResizeObserver(resize).observe(container);
  resizers.set(renderer, resize);
  resize();
  return renderer;
}

const resizers = new WeakMap<WebGLRenderer, () => void>();
const fixedSizes = new WeakMap<
  WebGLRenderer,
  { w: number; h: number; ratio: number }
>();

/**
 * Draw at exactly `w` x `h` pixels whatever the window (a replay export, game/replay/export.ts; the page shows it
 * stretched), or back to the window's size and pixel ratio (null). Cameras and post effects follow the 'resized' event.
 */
export function fixRenderSize(
  renderer: WebGLRenderer,
  size: { w: number; h: number } | null,
): void {
  const resize = resizers.get(renderer);
  if (!resize) return;
  const was = fixedSizes.get(renderer);
  if (size) {
    fixedSizes.set(renderer, {
      ...size,
      ratio: was?.ratio ?? renderer.getPixelRatio(),
    });
    renderer.setPixelRatio(1);
  } else {
    if (!was) return;
    fixedSizes.delete(renderer);
    renderer.setPixelRatio(was.ratio);
  }
  resize();
}

/** Keep a perspective camera's aspect in sync with the canvas. */
export function bindCameraAspect(
  renderer: WebGLRenderer,
  camera: { aspect: number; updateProjectionMatrix(): void },
): void {
  const update = () => {
    const c = renderer.domElement;
    camera.aspect = (c.width || 1) / (c.height || 1);
    camera.updateProjectionMatrix();
  };
  renderer.domElement.addEventListener('resized', update);
  update();
}
