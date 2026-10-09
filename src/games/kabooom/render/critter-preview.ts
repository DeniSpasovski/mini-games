import {
  DirectionalLight,
  Group,
  HemisphereLight,
  NoToneMapping,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { Player } from '../sim/state';
import type { CritterId } from '../sim/types';
import { Crew } from './characters';
import { FUR_SHELLS } from './fur';
import { BlobShadows } from './shadows';

/** Turns per second of the turntable. */
const SPIN = 0.12;

/**
 * The setup screen's critter picker: ONE critter, live in 3D, turning slowly on a little stage in the player's team
 * colour (hat and vest), fur and all. It has its own small renderer that lives only while the setup card is open
 * (`dispose` frees the GL context); `show` swaps the critter (with a happy squash) or recolours it in place.
 * Browser only.
 */
export class CritterPreview {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(26, 1, 0.1, 20);
  private readonly stage = new Group();
  private readonly shadow = new BlobShadows(1);
  private crew: Crew | null = null;
  private player: Player | null = null;
  private critter: CritterId | null = null;
  private raf = 0;
  private last = 0;

  constructor(size = 220) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(size, size);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.setClearColor(0x000000, 0);
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'kb-preview';

    const sun = new DirectionalLight(0xfff0d8, 2.4);
    sun.position.set(-2, 3, 4);
    this.scene.add(sun, new HemisphereLight(0xcfe6ff, 0xb08a60, 1.5));
    this.scene.add(this.stage, this.shadow.mesh);
    // framed for the whole turntable: the critter's height with its hat, and its tail swinging out to the side
    this.camera.position.set(0, 1.05, 3.85);
    this.camera.lookAt(0, 0.6, 0);
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  /** Show `critter` in team colour `color` (palette index): a new critter pops in, a new colour just repaints. */
  show(critter: CritterId, color: number): void {
    if (critter !== this.critter) {
      this.critter = critter;
      if (this.crew) {
        this.stage.remove(this.crew.group);
        this.crew.dispose();
      }
      const p = new Player(0, critter, false, color);
      p.x = p.px = p.y = p.py = 0;
      this.player = p;
      this.crew = new Crew([p], 0, 0, {
        shells: FUR_SHELLS.high,
        smooth: true,
      });
      this.stage.add(this.crew.group);
      this.crew.onEvent({ type: 'tntPlaced', x: 0, y: 0, owner: 0 });
    }
    if (this.player) this.player.color = color;
  }

  private loop(now: number): void {
    this.raf = requestAnimationFrame(this.loop);
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0;
    this.last = now;
    if (!this.crew || !this.canvas.isConnected) return;
    this.stage.rotation.y += dt * SPIN * Math.PI * 2;
    this.crew.update(1, dt);
    this.shadow.begin();
    this.shadow.add(0, 0, 0.42);
    this.shadow.end();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.crew?.dispose();
    this.shadow.mesh.geometry.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
