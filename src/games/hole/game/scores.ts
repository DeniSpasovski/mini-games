import { DIFFICULTIES } from '../sim/progression';
import type { KV } from './storage';

/**
 * Scoring version per map: the rules its saved high scores were earned under.
 *
 * On every game start `migrateScores` compares each map's number with the one stored next to its
 * lists; when they differ, ONLY that map's entries are tagged with the version they were set on
 * (`ScoreEntry.ver`) and kept: they list below every current entry, dimmed. Bump a map when ITS scoring changes:
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
 *   7 = 22 000 points; 8 = smaller floor test; 9 = 220 x 160 m floor, 9 000 points, hole level capped at 15, one copy per very big type, half of them per seed.
 * Animal history: 1 = first release (21000 points, moving animals, 37 giants, secret zoo + lab);
 *   2 = clear bonus 10 points per second; 3 = panda_big + tiger_big.
 * Construction history: 1 = first version (21000 points, 540 x 420 m site, 117 types).
 */
export const MAP_SCORING_VERSIONS: Record<string, number> = {
  city: 10,
  toy: 9,
  animal: 4,
  construction: 1,
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
  /** Scoring version the run was set under; missing = the map's current one (see `migrateScores`). */
  ver?: number;
}

export const TOP_N = 10;

export function scoreKey(map: string, difficulty: string): string {
  return `hole.scores.${map}.${difficulty}`;
}

/** True for an entry set under an older scoring version of `map` (listed below the current ones). */
export function isOldScore(map: string, e: Pick<ScoreEntry, 'ver'>): boolean {
  return e.ver !== undefined && e.ver !== MAP_SCORING_VERSIONS[map];
}

/** Current entries best first, then older versions (newest version first), each best first. */
export function compareScores(a: ScoreEntry, b: ScoreEntry): number {
  return (
    (b.ver ?? Infinity) - (a.ver ?? Infinity) ||
    b.score - a.score ||
    b.level - a.level ||
    a.date - b.date
  );
}

function readList(store: KV, map: string, difficulty: string): ScoreEntry[] {
  try {
    const raw = store.getItem(scoreKey(map, difficulty));
    const list = raw ? (JSON.parse(raw) as ScoreEntry[]) : [];
    return list.filter((e) => typeof e?.score === 'number');
  } catch {
    return [];
  }
}

/** Keep the top 10 current entries plus the top 10 of each older version. */
function trim(map: string, sorted: ScoreEntry[]): ScoreEntry[] {
  const seen = new Map<number, number>();
  return sorted.filter((e) => {
    const k = isOldScore(map, e) ? e.ver! : -1;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return n <= TOP_N;
  });
}

/** All saved entries of a map + difficulty: current first, then older versions. */
export function loadScores(
  store: KV,
  map: string,
  difficulty: string,
): ScoreEntry[] {
  return trim(map, readList(store, map, difficulty).sort(compareScores));
}

export interface RecordResult {
  list: ScoreEntry[];
  /** 1-based rank of the new entry among the current ones, or 0 when it did not make the top 10. */
  rank: number;
}

/** Insert a run into the top 10 of its difficulty (and save it). */
export function recordScore(
  store: KV,
  map: string,
  difficulty: string,
  entry: ScoreEntry,
): RecordResult {
  const all = [...readList(store, map, difficulty), entry].sort(compareScores);
  const kept = trim(map, all);
  const rank = kept.filter((e) => !isOldScore(map, e)).indexOf(entry) + 1;
  try {
    store.setItem(scoreKey(map, difficulty), JSON.stringify(kept));
  } catch {
    /* storage full / blocked: the run still shows on the results screen */
  }
  return { list: kept, rank };
}

/** Best score of the map's CURRENT version (older versions don't count for the menu cards). */
export function bestScore(store: KV, map: string, difficulty: string): number {
  return (
    loadScores(store, map, difficulty).find((e) => !isOldScore(map, e))
      ?.score ?? 0
  );
}

/**
 * Per map: when its lists were saved under another `MAP_SCORING_VERSIONS` number (or before versions
 * existed, tagged 0), tag every untagged entry with the stored version and keep them. Other maps are
 * untouched. Returns true when any map changed. Call once when the game opens.
 */
export function migrateScores(store: KV): boolean {
  let changed = false;
  for (const map of MAPS) {
    try {
      const v = String(MAP_SCORING_VERSIONS[map]);
      const prev = store.getItem(versionKey(map));
      if (prev === v) continue;
      const oldVer = prev === null ? 0 : Number(prev) || 0;
      for (const d of DIFFICULTIES) {
        const list = readList(store, map, d.id);
        if (!list.length) continue;
        for (const e of list) e.ver ??= oldVer;
        store.setItem(scoreKey(map, d.id), JSON.stringify(list));
      }
      store.setItem(versionKey(map), v);
      changed = true;
    } catch {
      /* storage blocked: nothing to migrate */
    }
  }
  return changed;
}
