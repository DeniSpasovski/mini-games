import type { TreeRenderer } from './draw';
import type { TreeLibrary } from './load';

/**
 * Tree stats overlay (spec: trees/Performance.md#counters), shown while the LOD debug view is on
 * (`TreeRenderer.debug`, trees/Lod.md#debug-view): last frame's trees per level and fading, draw calls / triangles
 * / GPU ms of the tree main and shadow passes, the CPU ms of level selection, the trees re-selected / drawn from
 * static batches / cells checked, which mitigations are on, and what loading the variants cost.
 * Call `update()` every frame; it redraws a few times a second.
 */
export class TreeStatsOverlay {
  readonly el: HTMLDivElement;
  private last = 0;

  constructor(
    parent: HTMLElement,
    private trees: TreeRenderer,
    private library: TreeLibrary,
  ) {
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      position: 'absolute',
      left: '8px',
      top: '76px',
      padding: '6px 8px',
      background: 'rgba(0,0,0,0.6)',
      color: '#dfc',
      font: '11px/1.35 ui-monospace, Consolas, monospace',
      whiteSpace: 'pre',
      pointerEvents: 'none',
      zIndex: '21',
      borderRadius: '4px',
      display: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    parent.append(this.el);
  }

  update(): void {
    const on = this.trees.debug;
    this.el.style.display = on ? '' : 'none';
    const now = performance.now();
    if (!on || now - this.last < 250) return;
    this.last = now;
    const s = this.trees.stats;
    const l = this.library.stats;
    const ms = (x: number) => (Number.isNaN(x) ? 'n/a' : `${x.toFixed(2)} ms`);
    const k = (n: number) =>
      n >= 1e6
        ? `${(n / 1e6).toFixed(2)}M`
        : n >= 1e3
          ? `${(n / 1e3).toFixed(1)}k`
          : `${n}`;
    const mb = (b: number) => `${(b / 1048576).toFixed(1)} MB`;
    this.el.textContent = [
      `TREES   debug: ${['', 'levels', 'lighting only', 'normals', 'depth', 'equal-test misses'][this.trees.debugMode]} (F6 next)`,
      `levels  LOD0 ${s.levels[0]}  LOD1 ${s.levels[1]}  impostor ${s.levels[2]}  sprites ${k(s.sprites)}`,
      `        fading ${s.fading}  flickering ${this.trees.flickering}`,
      `select  re-selected ${s.active}  static ${s.statics}  cells checked ${s.cellsChecked} (last job ${this.trees.lastJob.cells}, ${this.trees.lastJob.occluded} trees hidden by terrain)`,
      `main    ${s.mainDraws} draws  ${k(s.mainTriangles)} tris  GPU ${ms(s.gpuMainMs)}`,
      `shadow  ${s.shadowDraws} draws  ${k(s.shadowTriangles)} tris  GPU ${ms(s.gpuShadowMs)}`,
      `CPU     select+fade ${ms(s.selectMs)}  batching job ${ms(s.jobMs)}`,
      `load    ${l.variants} variants (${l.cached} cached)  generate ${l.generateMs.toFixed(0)} ms  bake ${l.bakeMs.toFixed(0)} ms  total ${l.totalMs.toFixed(0)} ms`,
      `memory  GPU ${mb(l.gpuBytes)}  disk ${mb(l.diskBytes)}`,
      `mitig.  ${Object.entries(this.trees.mitigations())
        .map(([name, on]) => `${name} ${on ? 'on' : 'OFF'}`)
        .join('  ')}`,
      this.trees.timer?.available === false
        ? '(no GPU timer: EXT_disjoint_timer_query_webgl2 missing)'
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  dispose(): void {
    this.el.remove();
  }
}
