import {
  ACESFilmicToneMapping,
  PCFShadowMap,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
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
  renderer.domElement.style.display = 'block';
  container.append(renderer.domElement);

  const resize = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.dispatchEvent(
      new CustomEvent('resized', { detail: { w, h } }),
    );
  };
  new ResizeObserver(resize).observe(container);
  resize();
  return renderer;
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
