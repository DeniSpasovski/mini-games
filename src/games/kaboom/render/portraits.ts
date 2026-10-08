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
import type { CritterId } from '../sim/types';
import { Crew } from './characters';

const BACKDROP = 0xfff0d6;
const FOV = 22;

/** A critter's portrait in a team colour (palette index), as an image URL. */
export type PortraitFn = (critter: CritterId, color: number) => string;

/**
 * Critter portraits for the menu, the HUD chips and the results card: drawn with the game's own renderer into an
 * offscreen target, ON DEMAND per critter and team colour (the hat and vest show the player's real colour), cached as
 * PNG data URLs. Each critter is framed by its own height, hat included, so tall and short ones all fit. Browser only.
 */
export class PortraitStudio {
  private readonly cache = new Map<string, string>();
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 1, 0.1, 30);
  private readonly target: WebGLRenderTarget;
  private readonly pixels: Uint8Array;
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly image: ImageData;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly size = 160,
  ) {
    this.scene.background = new Color(BACKDROP);
    const sun = new DirectionalLight(0xfff0d8, 2.4);
    sun.position.set(-2, 3, 4);
    this.scene.add(sun, new HemisphereLight(0xcfe6ff, 0xb08a60, 1.5));
    this.target = new WebGLRenderTarget(size, size, { samples: 4 });
    this.target.texture.colorSpace = SRGBColorSpace;
    this.pixels = new Uint8Array(size * size * 4);
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d')!;
    this.image = this.ctx.createImageData(size, size);
  }

  /** The portrait of `critter` in team colour `color` (rendered the first time it is asked for). */
  get: PortraitFn = (critter, color) => {
    const key = `${critter}:${color}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const url = this.render(critter, color);
    this.cache.set(key, url);
    return url;
  };

  private render(critter: CritterId, color: number): string {
    const { renderer, scene, camera, target, size, pixels } = this;
    const p = new Player(0, critter, false, color);
    p.x = p.px = p.y = p.py = 0;
    const crew = new Crew([p], 0, 0);
    crew.update(1, 0);
    scene.add(crew.group);
    // frame the whole critter, feet to hat, a little from the side
    const top = crew.topOf(0);
    const half = top / 2 + 0.08;
    const dist = half / Math.tan((FOV * Math.PI) / 360);
    camera.position.set(dist * 0.17, top * 0.55, dist);
    camera.lookAt(0, top / 2, 0);

    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
    renderer.setRenderTarget(prevTarget);
    // GL rows run bottom-up: flip while copying
    for (let y = 0; y < size; y++)
      this.image.data.set(
        pixels.subarray((size - 1 - y) * size * 4, (size - y) * size * 4),
        y * size * 4,
      );
    this.ctx.putImageData(this.image, 0, 0);
    scene.remove(crew.group);
    crew.dispose();
    return this.canvas.toDataURL('image/png');
  }

  dispose(): void {
    this.target.dispose();
    this.cache.clear();
  }
}
