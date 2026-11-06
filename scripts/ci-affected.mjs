// CI: which integration tests does this change affect?
//   node scripts/ci-affected.mjs <base-ref>   -> prints one line per game: <game>=<test files, space separated>
//   plus rally_cars=<car ids changed under src/games/rally/cars/, comma separated> (`all` without a diff): the rally
//   per-car playtests drive those on top of their representative cars (integration-tests/rally/cars-under-test.ts),
//   and smoke=<games, comma separated> for the browser smoke job (empty = skip; see `smokeGames`).
// A test is affected when a changed file is in its import closure (relative imports and `new URL('./x', import.meta.url)`
// workers, incl. json / data / asset files). Files that can change every test (package files, test / ts config,
// workflows, this script) run everything; src/shared counts only through the closure.
// Without a base ref (push to main, manual run) or when the diff fails, everything runs.
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

/** Integration test files per game (repo-relative) for a list of changed files; null = everything. */
export const affectedTests = (changed) => {
  const all = !changed || changed.some((f) => RUN_ALL.some((re) => re.test(f)));
  const changedAbs = new Set((changed ?? []).map((f) => join(root, f)));
  return Object.fromEntries(
    GAMES.map((g) => [
      g,
      walk(join(root, 'integration-tests', g))
        .filter((f) => f.endsWith('.test.ts'))
        .filter((t) => all || [...closure(t)].some((f) => changedAbs.has(f)))
        .map((t) => relative(root, t).split(sep).join('/')),
    ]),
  );
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

  // A car's folder is its id with dashes (cars/skoda-rally -> skoda_rally); shared car code changes no single car.
  const cars = new Set(
    (changed ?? [])
      .map((f) => f.match(/^src\/games\/rally\/cars\/([^/]+)\//)?.[1])
      .filter((d) => d && d !== 'shared')
      .map((d) => d.replace(/-/g, '_')),
  );
  console.log(`rally_cars=${changed ? [...cars].join(',') : 'all'}`);
  console.log(`smoke=${smokeGames(changed).join(',')}`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
