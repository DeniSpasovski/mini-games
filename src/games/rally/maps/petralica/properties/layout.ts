/**
 * Hazelnut farm above the hamlet north of the E-871 (Petralica ~1.75 km): the fenced plantation west of the road and
 * the fenced yard across it. Outlines from the owner's hand trace (straightened, fitted to the baked route, edges
 * along the road held 5.2 m off its centre line); the tall trees lining the road through the hedge from the
 * owner's dots, kept 6.5 m off the centre line. World metres (x east, z south). Pure: no three.js.
 */

export type P = [number, number];

/** Chain-link fence round the hazelnut plantation (closed ring). */
export const ORCHARD: P[] = [
  [-527.2, 2441.0],
  [-491.4, 2426.1],
  [-483.1, 2420.6],
  [-481.6, 2392.8],
  [-435.4, 2384.1],
  [-399.4, 2382.9],
  [-386.4, 2387.9],
  [-367.7, 2406.6],
  [-392.7, 2434.1],
  [-400.5, 2440.5],
  [-403.0, 2441.6],
  [-409.4, 2438.7],
  [-437.3, 2436.9],
  [-454.7, 2446.8],
  [-489.2, 2478.5],
  [-497.1, 2479.7],
  [-509.6, 2473.4],
  [-516.6, 2463.7],
];

/** Chain-link fence round the yard across the road (closed ring). */
export const LOT: P[] = [
  [-357.8, 2411.0],
  [-319.4, 2428.4],
  [-329.2, 2459.9],
  [-377.2, 2435.8],
];

export interface Gate {
  /** Ring and the edge (from vertex `edge` to the next) the gate sits in. */
  ring: P[];
  edge: number;
  /** Centre of the opening along the edge (0..1) and its width (m). */
  t: number;
  width: number;
}

/** Wooden plank gates on concrete pillars, on the road side of both fences. */
export const GATES: Gate[] = [
  { ring: ORCHARD, edge: 7, t: 0.45, width: 4.2 },
  { ring: LOT, edge: 3, t: 0.62, width: 4.2 },
];

/** Tall trees lining the road where it runs through the hedge below the plantation. */
export const ROAD_TREES: P[] = [
  [-439.8, 2443.3],
  [-427.5, 2443.4],
  [-416.2, 2442.7],
  [-409.4, 2444.2],
  [-446.9, 2448.9],
  [-438.9, 2448.6],
  [-451.6, 2451.5],
  [-453.7, 2454.7],
  [-460.1, 2458.5],
  [-465.2, 2462.6],
  [-469.4, 2464.9],
  [-475.3, 2470.0],
  [-430.9, 2464.3],
  [-421.8, 2462.3],
  [-416.0, 2461.0],
  [-407.0, 2459.3],
  [-437.7, 2465.6],
  [-447.5, 2468.6],
  [-455.1, 2474.8],
  [-465.0, 2480.1],
];

/** Young fruit trees in the yard. */
export const YARD_TREES: P[] = [
  [-350, 2422],
  [-342, 2425],
  [-334, 2429],
  [-352, 2430],
  [-344, 2434],
  [-336, 2438],
  [-326, 2434],
  [-346, 2442],
];

/**
 * Copper water tanks in the plantation's north-west corner (owner's placement on a map viewer shot): two pairs, each
 * pair side by side on two concrete sleepers. `yaw` = heading of the tanks' long axis (rad, atan2(dz, dx)).
 */
export const TANK = { length: 5, width: 1, height: 2, gap: 0.4 } as const;
export const TANK_PAIRS: { x: number; z: number; yaw: number }[] = [
  { x: -478.5, z: 2398.1, yaw: (89.7 * Math.PI) / 180 },
  { x: -495.8, z: 2431.1, yaw: (-21 * Math.PI) / 180 },
];
/** Sleepers: centred this far either side of the tank middle, this long (along the tanks), this far past the pair. */
export const SLEEPER = { at: 1.6, length: 0.5, overhang: 0.2 } as const;
/** Half extents of a pair's footprint (along, across) incl. the sleepers. */
export const PAIR_HALF: P = [
  TANK.length / 2,
  TANK.width + TANK.gap / 2 + SLEEPER.overhang,
];

/** Pair-local (u along the tanks, v across) -> world. */
export function pairToWorld(
  pair: { x: number; z: number; yaw: number },
  u: number,
  v: number,
): P {
  const c = Math.cos(pair.yaw);
  const s = Math.sin(pair.yaw);
  return [pair.x + c * u - s * v, pair.z + s * u + c * v];
}

/**
 * Top of a pair's sleepers (= the tanks' level bottom): 0.3 m above the highest ground under the footprint, so the
 * sleepers stand 30-50 cm proud on a gentle slope and the tanks are level.
 */
export function tankBase(
  pair: { x: number; z: number; yaw: number },
  height: (x: number, z: number) => number,
): number {
  let top = -Infinity;
  for (const u of [-1, 0, 1])
    for (const v of [-1, 0, 1])
      top = Math.max(
        top,
        height(...pairToWorld(pair, u * PAIR_HALF[0], v * PAIR_HALF[1])),
      );
  return top + 0.3;
}

/** Inside a pair's footprint grown by `m` m. */
export function onTanks(x: number, z: number, m = 0): boolean {
  return TANK_PAIRS.some((t) => {
    const dx = x - t.x;
    const dz = z - t.z;
    const c = Math.cos(t.yaw);
    const s = Math.sin(t.yaw);
    const u = dx * c + dz * s;
    const v = -dx * s + dz * c;
    return Math.abs(u) <= PAIR_HALF[0] + m && Math.abs(v) <= PAIR_HALF[1] + m;
  });
}

const lerp = (a: P, b: P, t: number): P => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];

/** The two pillar positions of a gate (the ends of its opening). */
export function gateEnds(g: Gate): [P, P] {
  const a = g.ring[g.edge];
  const b = g.ring[(g.edge + 1) % g.ring.length];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const h = g.width / 2 / len;
  return [lerp(a, b, g.t - h), lerp(a, b, g.t + h)];
}

/** Fence runs (open polylines): each ring cut open at its gates. */
export function fenceRuns(): P[][] {
  const runs: P[][] = [];
  for (const ring of [ORCHARD, LOT]) {
    const gates = GATES.filter((g) => g.ring === ring).sort(
      (a, b) => a.edge - b.edge || a.t - b.t,
    );
    if (!gates.length) {
      runs.push([...ring, ring[0]]);
      continue;
    }
    // Walk the ring once, starting at the far pillar of the first gate.
    const n = ring.length;
    const first = gates[0];
    let run: P[] = [gateEnds(first)[1]];
    for (let k = 1; k <= n; k++) {
      const i = (first.edge + k) % n;
      // Gates on the edge ending at vertex i (the edge from i - 1) close the run before i.
      const edge = (i - 1 + n) % n;
      for (const g of gates.filter((q) => q.edge === edge && q !== first)) {
        const [p0, p1] = gateEnds(g);
        run.push(p0);
        runs.push(run);
        run = [p1];
      }
      run.push(ring[i]);
    }
    run.push(gateEnds(first)[0]);
    runs.push(run);
  }
  return runs;
}

/** Distance from a point to a polyline. */
export function distToLine(x: number, z: number, line: P[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = line[i - 1];
    const [bx, bz] = line[i];
    const ex = bx - ax;
    const ez = bz - az;
    const l2 = ex * ex + ez * ez || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
    best = Math.min(best, Math.hypot(ax + ex * t - x, az + ez * t - z));
  }
  return best;
}

/** Bounding box of everything (+ 10 m): cheap reject for the per-point queries. */
export const BOUNDS = (() => {
  const all = [...ORCHARD, ...LOT, ...ROAD_TREES];
  const xs = all.map((p) => p[0]);
  const zs = all.map((p) => p[1]);
  return [
    Math.min(...xs) - 10,
    Math.max(...xs) + 10,
    Math.min(...zs) - 10,
    Math.max(...zs) + 10,
  ] as const;
})();

export const inBounds = (x: number, z: number): boolean =>
  x >= BOUNDS[0] && x <= BOUNDS[1] && z >= BOUNDS[2] && z <= BOUNDS[3];
