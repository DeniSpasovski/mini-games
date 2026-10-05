import { DIFFICULTIES } from '../sim/progression';
import type { KV } from './storage';

/**
 * Version of the scoring rules the saved high scores were earned under.
 *
 * BUMP THIS whenever scoring changes, so old scores are erased (they would no
 * longer be comparable): item points / size tiers (items/catalog.ts,
 * sim/progression.ts), the clear bonus, the difficulty times, the amount of
 * content on the map (map/generate.ts) or how a run is scored (sim/sim.ts).
 * On every game start `purgeStaleScores` compares it with the version stored in
 * `hole.scores.version` and wipes all top-10 lists when they differ.
 *
 * History: 1 = first release (unversioned lists); 2 = 15 hole levels, hole
 * 20 % bigger, Easy 500 s, clear bonus 2 points per second.
 * 3 = every map holds exactly 25000 points (10 x 10 tiles x 250), 10 x 10 grid.
 * 4 = 25 hole levels (levels 16-25 only grow the hole, +XP to level up).
 * 5 = City Island holds 30000 points (10 x 10 tiles x 300) and items only spawn on their own
 *     ground (map/spawn.ts), so the map content changed.
 * 6 = City Island rework: a real harbour bay with headlands, more coast features, warped district rings
 *     plus a commercial avenue, a traffic light / street sign on every crossing corner (every seed changed).
 * 7 = a canal along one road line (rowboats on it), every run starts at a random spot.
 */
export const SCORING_VERSION = 7;
/**
 * Scoring version per map. City Island keeps `SCORING_VERSION` (and the original storage key), so
 * adding a map never erases another map's lists. Bump a map's number when ITS scoring changes
 * (for the toy store: toy item dimensions / points, `map/toy/*`, the clear bonus, difficulty times).
 * Toy history: 1 = first release (25000 points, 600 x 400 m Grand Hall); 2 = 25 hole levels;
 * 3 = Layout A atrium spread out as a hall with Ferris wheel / carousel pairs (map content changed);
 * Animal history: 1 = first release (21000 points, moving animals, 37 giants, secret zoo + lab).
 * 4 = Plush Meadow thinned (shares of layouts A / B), whale and penguin plush stocked in the Splash Zone, random start.
 */
export const MAP_SCORING_VERSIONS: Record<string, number> = {
  city: SCORING_VERSION,
  toy: 4,
  animal: 1,
};
const versionKey = (map: string) =>
  map === 'city' ? 'hole.scores.version' : `hole.scores.version.${map}`;
/** Maps that have score lists (see scoreKey). */
const MAPS = Object.keys(MAP_SCORING_VERSIONS);

export interface ScoreEntry {
  score: number;
  level: number;
  eaten: number;
  /** Share of the island's points eaten, 0..1. */
  pct: number;
  color: string;
  date: number;
}

export const TOP_N = 10;

export function scoreKey(map: string, difficulty: string): string {
  return `hole.scores.${map}.${difficulty}`;
}

/** Best first: score, then level, then the earlier run. */
export function compareScores(a: ScoreEntry, b: ScoreEntry): number {
  return b.score - a.score || b.level - a.level || a.date - b.date;
}

export function loadScores(
  store: KV,
  map: string,
  difficulty: string,
): ScoreEntry[] {
  try {
    const raw = store.getItem(scoreKey(map, difficulty));
    const list = raw ? (JSON.parse(raw) as ScoreEntry[]) : [];
    return list
      .filter((e) => typeof e?.score === 'number')
      .sort(compareScores)
      .slice(0, TOP_N);
  } catch {
    return [];
  }
}

export interface RecordResult {
  list: ScoreEntry[];
  /** 1-based rank of the new entry, or 0 when it did not make the top 10. */
  rank: number;
}

/** Insert a run into the top 10 of its difficulty (and save it). */
export function recordScore(
  store: KV,
  map: string,
  difficulty: string,
  entry: ScoreEntry,
): RecordResult {
  const list = loadScores(store, map, difficulty);
  const all = [...list, entry].sort(compareScores);
  const top = all.slice(0, TOP_N);
  const rank = top.indexOf(entry) + 1;
  try {
    store.setItem(scoreKey(map, difficulty), JSON.stringify(top));
  } catch {
    /* storage full / blocked: the run still shows on the results screen */
  }
  return { list: top, rank };
}

export function bestScore(store: KV, map: string, difficulty: string): number {
  return loadScores(store, map, difficulty)[0]?.score ?? 0;
}

/**
 * Erase every saved top-10 list when they were saved under another
 * `SCORING_VERSION` (or before versions existed). Returns true when it wiped.
 * Call once when the game opens.
 */
export function purgeStaleScores(store: KV): boolean {
  let wiped = false;
  for (const map of MAPS) {
    try {
      const v = String(MAP_SCORING_VERSIONS[map]);
      if (store.getItem(versionKey(map)) === v) continue;
      for (const d of DIFFICULTIES) store.removeItem(scoreKey(map, d.id));
      store.setItem(versionKey(map), v);
      wiped = true;
    } catch {
      /* storage blocked: nothing to purge */
    }
  }
  return wiped;
}
