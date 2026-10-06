import { DIFFICULTIES } from '../sim/progression';
import type { KV } from './storage';

/**
 * Scoring version per map: the rules its saved high scores were earned under.
 *
 * On every game start `purgeStaleScores` compares each map's number with the one stored next to its
 * lists and erases ONLY that map's top-10 lists when they differ. Bump a map when ITS scoring changes:
 * item points / sizes, point total, map content (its generator), difficulty times or the clear bonus.
 * A shared rule (`sim/progression.ts`, `sim/sim.ts`, the clear bonus) changes every map: bump them all.
 *
 * City history: 1 = first release (unversioned lists); 2 = 15 hole levels, hole 20 % bigger, Easy 500 s,
 *   clear bonus 2 points per second; 3 = exactly 25000 points, 10 x 10 grid; 4 = 25 hole levels;
 *   5 = 30000 points, items spawn on their own ground; 6 = harbour bay, coast features, district rings,
 *   commercial avenue, traffic lights / street signs; 7 = canal with rowboats, random start;
 *   8 = clear bonus 10 points per second; 9 = balance change; 10 = driving cars and walking people.
 * Toy history: 1 = first release (25000 points, 600 x 400 m Grand Hall); 2 = 25 hole levels;
 *   3 = Layout A atrium as a hall with Ferris wheel / carousel pairs; 4 = Plush Meadow thinned, whale and
 *   penguin plush in the Splash Zone, random start; 5 = clear bonus 10 points per second;
 *   7 = own time limits and 21 000 points (Easy 600 / Medium 300 / Hard 150 s).
 * Animal history: 1 = first release (21000 points, moving animals, 37 giants, secret zoo + lab);
 *   2 = clear bonus 10 points per second; 3 = panda_big + tiger_big.
 */
export const MAP_SCORING_VERSIONS: Record<string, number> = {
  city: 10,
  toy: 7,
  animal: 4,
};
/** City Island keeps the original (pre-multi-map) storage key, so its old lists stay valid. */
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
 * Per map: erase that map's top-10 lists when they were saved under another
 * `MAP_SCORING_VERSIONS` number (or before versions existed). Other maps are
 * untouched. Returns true when anything was wiped. Call once when the game opens.
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
