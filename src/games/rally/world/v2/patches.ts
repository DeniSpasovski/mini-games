import type { EdgeData, NetworkData, NetworkPatch } from './types';

/**
 * Applies a map's hand edits (network-patches.json) to the imported graph, by stable id. Unknown ids are reported, never
 * silently skipped: a re-import that drops an id shows up in the dev console and the network test. Pure.
 */
export interface PatchResult {
  data: NetworkData;
  /** Node pins (m, world height) from `pinHeight`. */
  pins: Map<number, number>;
  /** Structure overrides per edge id. */
  structures: Map<string, { from: number; to: number; kind: string }[]>;
  /** Patches whose target was not found. */
  missing: NetworkPatch[];
}

export function applyPatches(
  src: NetworkData,
  patches: readonly NetworkPatch[] = [],
): PatchResult {
  const nodes = src.nodes.map((n) => [...n] as NetworkData['nodes'][number]);
  let edges: EdgeData[] = src.edges.map((e) => ({ ...e }));
  const sets = [...src.tagSets];
  const byId = () => new Map(edges.map((e) => [e.id, e]));
  let ids = byId();
  const pins = new Map<number, number>();
  const structures = new Map<
    string,
    { from: number; to: number; kind: string }[]
  >();
  const missing: NetworkPatch[] = [];
  for (const p of patches) {
    switch (p.op) {
      case 'moveNode': {
        const n = nodes.find((q) => q[0] === p.node);
        if (!n) {
          missing.push(p);
          break;
        }
        const [, ox, oz] = n;
        n[1] = p.to[0];
        n[2] = p.to[1];
        // every edge vertex on the node moves with it
        for (const e of edges) {
          if (!e.nodes.includes(p.node)) continue;
          const pts = [...e.pts];
          for (let k = 0; k < pts.length; k += 2)
            if (Math.hypot(pts[k] - ox, pts[k + 1] - oz) < 0.05) {
              pts[k] = p.to[0];
              pts[k + 1] = p.to[1];
            }
          e.pts = pts;
        }
        break;
      }
      case 'dropEdge':
        if (!ids.has(p.edge)) missing.push(p);
        edges = edges.filter((e) => e.id !== p.edge);
        ids = byId();
        break;
      case 'addEdge':
        edges.push(p.edge);
        ids = byId();
        break;
      case 'setTemplate': {
        const e = ids.get(p.edge);
        if (e) e.template = p.template;
        else missing.push(p);
        break;
      }
      case 'setLanes': {
        const e = ids.get(p.edge);
        if (!e) {
          missing.push(p);
          break;
        }
        // a new tag set with the lanes overridden on every segment
        e.tags = e.tags.map(([seg, ti]) => {
          const t = {
            ...sets[ti],
            lanesFwd: p.fwd,
            lanesBack: p.back ?? 0,
            lanes: p.fwd + (p.back ?? 0),
          };
          sets.push(t);
          return [seg, sets.length - 1] as [number, number];
        });
        break;
      }
      case 'pinHeight':
        pins.set(p.node, p.y);
        break;
      case 'setStructure': {
        if (!ids.has(p.edge)) {
          missing.push(p);
          break;
        }
        const l = structures.get(p.edge) ?? [];
        l.push({ from: p.from, to: p.to, kind: p.kind });
        structures.set(p.edge, l);
        break;
      }
    }
  }
  return {
    data: { ...src, nodes, edges, tagSets: sets },
    pins,
    structures,
    missing,
  };
}
