import type { WebGLRenderer } from 'three';

/**
 * Corner overlay with FPS, frame time and renderer.info counters.
 * Call `begin()` / `end()` around rendering (or just `end()` once per frame).
 * Toggle with F3.
 */
export class StatsOverlay {
  readonly el: HTMLDivElement;
  private frames = 0;
  private acc = 0;
  private last = performance.now();
  private worst = 0;
  private extra: Record<string, string | number> = {};

  constructor(
    private renderer: WebGLRenderer,
    parent: HTMLElement = document.body,
    visible = true,
  ) {
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      position: 'absolute',
      right: '8px',
      top: '8px',
      padding: '6px 8px',
      background: 'rgba(0,0,0,0.55)',
      color: '#cfe',
      font: '11px/1.35 ui-monospace, Consolas, monospace',
      whiteSpace: 'pre',
      pointerEvents: 'none',
      zIndex: '20',
      borderRadius: '4px',
    } satisfies Partial<CSSStyleDeclaration>);
    this.el.style.display = visible ? '' : 'none';
    parent.append(this.el);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.el.style.display = this.el.style.display === 'none' ? '' : 'none';
      }
    });
  }

  /** Extra lines shown under the counters (e.g. chunk counts). */
  set(key: string, value: string | number): void {
    this.extra[key] = value;
  }

  end(): void {
    const now = performance.now();
    const dt = now - this.last;
    this.last = now;
    this.frames++;
    this.acc += dt;
    this.worst = Math.max(this.worst, dt);
    if (this.acc < 500 || this.el.style.display === 'none') return;
    const info = this.renderer.info;
    const fps = (this.frames * 1000) / this.acc;
    const lines = [
      `fps   ${fps.toFixed(0)}  (${(this.acc / this.frames).toFixed(1)}ms, worst ${this.worst.toFixed(1)})`,
      `calls ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(0)}k`,
      `geo   ${info.memory.geometries}  tex ${info.memory.textures}`,
      ...Object.entries(this.extra).map(([k, v]) => `${k.padEnd(5)} ${v}`),
    ];
    this.el.textContent = lines.join('\n');
    this.frames = 0;
    this.acc = 0;
    this.worst = 0;
  }
}
