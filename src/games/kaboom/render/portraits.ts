import {
  Color,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import { Player } from '../sim/state';
import { CRITTERS, type CritterId } from '../sim/types';
import { Crew } from './characters';

const BACKDROP = 0xfff0d6;

/**
 * One small head-and-shoulders portrait per critter, drawn once with the game's own renderer into an offscreen target and
 * returned as PNG data URLs (menu cards, HUD chips, results). Browser only (needs GL and a canvas).
 */
export function renderPortraits(
  renderer: WebGLRenderer,
  size = 160,
): Record<CritterId, string> {
  const scene = new Scene();
  scene.background = new Color(BACKDROP);
  const sun = new DirectionalLight(0xfff0d8, 2.4);
  sun.position.set(-2, 3, 4);
  scene.add(sun, new HemisphereLight(0xcfe6ff, 0xb08a60, 1.5));
  const camera = new PerspectiveCamera(22, 1, 0.1, 20);
  camera.position.set(0.5, 1.05, 2.9);
  camera.lookAt(0, 0.6, 0);

  const target = new WebGLRenderTarget(size, size, { samples: 4 });
  target.texture.colorSpace = SRGBColorSpace;
  const pixels = new Uint8Array(size * size * 4);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(size, size);

  const out = {} as Record<CritterId, string>;
  const prevTarget = renderer.getRenderTarget();
  for (const id of CRITTERS) {
    const p = new Player(0, id, false);
    p.x = p.px = p.y = p.py = 0;
    const crew = new Crew([p], 0, 0);
    crew.update(1, 0);
    scene.add(crew.group);
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
    // GL rows run bottom-up: flip while copying
    for (let y = 0; y < size; y++)
      image.data.set(
        pixels.subarray((size - 1 - y) * size * 4, (size - y) * size * 4),
        y * size * 4,
      );
    ctx.putImageData(image, 0, 0);
    out[id] = canvas.toDataURL('image/png');
    scene.remove(crew.group);
    crew.dispose();
  }
  renderer.setRenderTarget(prevTarget);
  target.dispose();
  return out;
}
