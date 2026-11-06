// CI: which integration tests does this change affect?
//   node scripts/ci-affected.mjs <base-ref>   -> prints one line per game: <game>=<test files, space separated>,
//   rally_cars=<car ids> (the rally drives run these on top of REPRESENTATIVE_CARS, integration-tests/rally/cars-under-test.ts),
//   rally_hill_cars=<car ids> + rally_hill_maps=<map ids> (the worst-tyre hill test of car-matrix.test.ts: those cars on
//   every map, those maps with the representative cars), each `all` or a comma list, and smoke=<games> for the browser
//   smoke job (empty = skip; see `smokeGames`).
// A test is affected when a changed file is in its import closure (relative imports and `new URL('./x', import.meta.url)`
// workers, incl. json / data / asset files). Files that can change every test (package files, test / ts config,
// workflows, this script) run everything; src/shared counts only through the closure.
// Rally drive tests (a rally playtest that reaches world/world.ts: stage-<map>, car-matrix, tyres, gearing, replay) import
// the whole World, so scenery (scatter, trees, culverts, road wear, buildings, colliders beside the road) would run them:
// they run only for the inputs of a drive, one line each below (`DRIVE_*`, `MAP_ROAD`, `CAR`); main runs them all.
// Without a base ref (push to main, manual run) or when the diff fails, everything runs with every car.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const GAMES = ['rally', 'hole', 'kaboom'];
const EXT = [
  '',
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.json',
  '/index.ts',
  '/index.js',
];
export const RUN_ALL = [
  /^package(-lock)?\.json$/,
  /^rstest\.config\./,
  /^tsconfig.*\.json$/,
  /^rsbuild\.config\./,
  /^\.(npmrc|nvmrc|node-version)$/,
  /^\.github\//,
  /^scripts\/ci-affected\.mjs$/,
  /^tests\/rstest\.setup\.ts$/,
  /^integration-tests\/tsconfig\.json$/,
];
/** Every drive with every car, every hill. */
export const DRIVE_EVERYTHING = [
  /^src\/games\/rally\/physics\//, // the car model every drive runs on
  /^src\/games\/rally\/game\/autopilot\.ts$/, // the driver of every drive
];
/** The drive tests that reach it, representative cars, every map's hills: shared road / terrain code and the harness. */
export const DRIVE_SHARED = [
  /^src\/games\/rally\/world\/(world|road|heightfield|terrain-gen)\.ts$/, // ground sampling + spawn, road line, height grid, road carved into the terrain
  /^src\/games\/rally\/world\/(real-data|lakes)\.ts$/, // real elevation samplers; lakes carve the ground
  /^src\/games\/rally\/world\/(junctions|twin-decks|portals|plazas|under-bridges|pads|parkway-lanes)\.ts$/, // decks, slabs, plazas, pads: heights the car drives on
  /^src\/games\/rally\/maps\/shared\/(types|real-map)\.ts$/, // road surface per stretch (roadSurfaceAt), real-map route / elevation helpers
  /^src\/games\/rally\/maps\/shared\/(climate|day-temperature)\.ts$/, // stage climate: the tyre / brake temperatures of a drive
  /^src\/shared\/(noise|rng)\.ts$/, // the procedural terrain heights (test map)
  /^integration-tests\/rally\/[^/]+\.ts$/, // the tests and their harness (stage-harness, handling-harness, cars-under-test)
];
/** The replay recorder / re-simulation (replay.test.ts only, through its closure; no hill effect). */
const DRIVE_CODE = [/^src\/games\/rally\/game\/replay\//];
/**
 * A map's road: its definition, stages (tyre, climate) and baked road / elevation data; its landmarks, buildings, service
 * park, horizon and menu info are scenery. Runs the drive tests that import that map's `map.ts` themselves.
 */
export const MAP_ROAD =
  /^src\/games\/rally\/maps\/([^/]+)\/(map\.ts|stages\.ts|data\.json|route\.json|junction[^/]*\.json)$/;
/** A car's own folder (physics + model): that car joins the drives and every map's hills. cars/shared = model code. */
const CAR = /^src\/games\/rally\/cars\/([^/]+)\//;
// Docs (markdown, licence, screenshots) never reach the browser.
const DOCS = [/\.md$/i, /^LICENSE$/, /(^|\/)screenshots\//];

const walk = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const resolveImport = (from, spec) => {
  const base = resolve(dirname(from), spec.split('?')[0]);
  for (const e of EXT) {
    const p = base + e;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
};

/** Every file `entry` reaches through relative imports and `new URL('./x', import.meta.url)` (workers, assets). */
export const closure = (entry) => {
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    if (!/\.(ts|tsx|js|mjs)$/.test(f)) continue;
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(
      /(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*|new\s+URL\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g,
    )) {
      const r = resolveImport(f, m[1]);
      if (r) stack.push(r);
    }
  }
  return seen;
};

/**
 * The browser smoke test's games (scripts/smoke.mjs `--games`): a change in src/games/<id>/ or in the import closure
 * of a game's pages picks that game; any other src/ file (portal, unused shared code) none; a non-docs file outside
 * src/ (configs, public/, the smoke script) every game.
 */
export const smokeGames = (changed) => {
  if (!changed) return GAMES;
  const code = changed.filter((f) => !DOCS.some((re) => re.test(f)));
  if (code.some((f) => !f.startsWith('src/'))) return GAMES;
  const abs = new Set(code.map((f) => join(root, f)));
  return GAMES.filter(
    (g) =>
      code.some((f) => f.startsWith(`src/games/${g}/`)) ||
      walk(join(root, 'src/games', g, 'pages')).some((p) =>
        [...closure(p)].some((f) => abs.has(f)),
      ),
  );
};

const rel = (f) => relative(root, f).split(sep).join('/');
const any = (list, f) => list.some((re) => re.test(f));
const WORLD = join(root, 'src/games/rally/world/world.ts');

/** Car ids (folder with `_`: cars/skoda-rally -> skoda_rally) whose own folder changed, docs left out. */
const changedCars = (changed) => [
  ...new Set(
    changed
      .filter((f) => !any(DOCS, f))
      .map((f) => f.match(CAR)?.[1])
      .filter((d) => d && d !== 'shared')
      .map((d) => d.replace(/-/g, '_')),
  ),
];

/** Does a change run this rally drive test (`test`: absolute path, `files`: its closure)? */
const drives = (test, files, changed) => {
  const src = readFileSync(test, 'utf8');
  // The maps it drives: the `maps/<id>/map` modules the test file imports itself.
  const maps = new Set(
    [...src.matchAll(/maps\/([^/'"]+)\/map['"]/g)].map((m) => m[1]),
  );
  // The cars it drives: the cars under test / every car, else the ids it names (tyres: the Fabia only).
  const everyCar =
    files.has(join(root, 'integration-tests/rally/cars-under-test.ts')) ||
    /ALL_CARS\.(filter|map)\(/.test(src);
  return changed.some((f) => {
    if (any(DOCS, f)) return false;
    const road = f.match(MAP_ROAD);
    if (road) return maps.has(road[1]);
    const car = changedCars([f])[0];
    if (car) return everyCar || src.includes(`'${car}'`);
    return (
      files.has(join(root, f)) &&
      (any(DRIVE_EVERYTHING, f) || any(DRIVE_SHARED, f) || any(DRIVE_CODE, f))
    );
  });
};

/** Integration test files per game (repo-relative) for a list of changed files; null = everything. */
export const affectedTests = (changed) => {
  const all = !changed || changed.some((f) => any(RUN_ALL, f));
  const changedAbs = new Set((changed ?? []).map((f) => join(root, f)));
  return Object.fromEntries(
    GAMES.map((g) => [
      g,
      walk(join(root, 'integration-tests', g))
        .filter((f) => f.endsWith('.test.ts'))
        .filter((t) => {
          if (all) return true;
          const files = closure(t);
          return g === 'rally' && files.has(WORLD)
            ? drives(t, files, changed)
            : [...files].some((f) => changedAbs.has(f));
        })
        .map(rel),
    ]),
  );
};

/**
 * The rally drives' cars and the worst-tyre hill test's scope (`all` or ids): physics / autopilot or no diff = all; a
 * changed car = that car (on every map's hills); a changed map road = that map's hills with the representative cars;
 * shared road / terrain code, the harness or a run-everything file = every map's hills with the representative cars.
 */
export const rallyCars = (changed) => {
  if (!changed || changed.some((f) => any(DRIVE_EVERYTHING, f)))
    return { cars: 'all', hillCars: 'all', hillMaps: 'all' };
  const cars = changedCars(changed);
  const hillMaps = changed.some((f) => any(RUN_ALL, f) || any(DRIVE_SHARED, f))
    ? 'all'
    : [...new Set(changed.map((f) => f.match(MAP_ROAD)?.[1]).filter(Boolean))];
  return { cars, hillCars: cars, hillMaps };
};

const main = () => {
  const base = process.argv[2];
  let changed = null;
  if (base) {
    try {
      changed = execSync(`git diff --name-only ${base}...HEAD`, {
        cwd: root,
        encoding: 'utf8',
      })
        .split('\n')
        .filter(Boolean);
    } catch {
      changed = null;
    }
  }

  for (const [g, hit] of Object.entries(affectedTests(changed)))
    console.log(`${g}=${hit.join(' ')}`);

  const r = rallyCars(changed);
  const list = (v) => (v === 'all' ? v : v.join(','));
  console.log(`rally_cars=${list(r.cars)}`);
  console.log(`rally_hill_cars=${list(r.hillCars)}`);
  console.log(`rally_hill_maps=${list(r.hillMaps)}`);
  console.log(`smoke=${smokeGames(changed).join(',')}`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
