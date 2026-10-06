import type { RoadNet } from '../map/types';

/** The road network of a map as adjacency lists (DOM-free). Built once per `Movers`. */
export class RoadGraph {
  readonly x: Float32Array;
  readonly z: Float32Array;
  readonly adj: number[][];

  constructor(net: RoadNet) {
    const n = net.nodes.length;
    this.x = new Float32Array(n);
    this.z = new Float32Array(n);
    this.adj = Array.from({ length: n }, () => []);
    net.nodes.forEach(([x, z], i) => {
      this.x[i] = x;
      this.z[i] = z;
    });
    for (const [a, b] of net.edges) {
      this.adj[a].push(b);
      this.adj[b].push(a);
    }
  }

  get size(): number {
    return this.x.length;
  }

  /** Index of the node within 1 m of (x, z), or -1. */
  nodeAt(x: number, z: number): number {
    for (let i = 0; i < this.x.length; i++)
      if (Math.abs(this.x[i] - x) < 1 && Math.abs(this.z[i] - z) < 1) return i;
    return -1;
  }
}
