// CI: which integration tests does this change affect?
//   node scripts/ci-affected.mjs <base-ref>   -> prints one line per game: <game>=<test files, space separated>
// A test is affected when a changed file is in its import closure (relative imports, incl. json / data files).
// Files that can change every test (package files, test / ts config, workflows, this script, src/shared) run everything.
// Without a base ref (push to main, manual run) or when the diff fails, everything runs.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const GAMES = ['rally', 'hole', 'kaboom'];
const EXT = ['', '.ts', '.tsx', '.js', '.mjs', '.json', '/index.ts', '/index.js'];
const RUN_ALL = [
  /^package(-lock)?\.json$/,
  /^rstest\.config\./,
  /^tsconfig.*\.json$/,
  /^rsbuild\.config\./,
  /^\.github\//,
  /^scripts\/ci-affected\.mjs$/,
  /^tests\/rstest\.setup\.ts$/,
  /^integration-tests\/tsconfig\.json$/,
  /^src\/shared\//,
];

const walk = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const tests = Object.fromEntries(
  GAMES.map((g) => [g, walk(join(root, 'integration-tests', g)).filter((f) => f.endsWith('.test.ts'))]),
);

const resolveImport = (from, spec) => {
  const base = resolve(dirname(from), spec.split('?')[0]);
  for (const e of EXT) {
    const p = base + e;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
};

const closure = (entry) => {
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    if (!/\.(ts|tsx|js|mjs)$/.test(f)) continue;
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const r = resolveImport(f, m[1]);
      if (r) stack.push(r);
    }
  }
  return seen;
};

const base = process.argv[2];
let changed = null;
if (base) {
  try {
    changed = execSync(`git diff --name-only ${base}...HEAD`, { cwd: root, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
  } catch {
    changed = null;
  }
}

const all = !changed || changed.some((f) => RUN_ALL.some((re) => re.test(f)));
const changedAbs = new Set((changed ?? []).map((f) => join(root, f)));
for (const g of GAMES) {
  const hit = tests[g].filter((t) => all || [...closure(t)].some((f) => changedAbs.has(f)));
  console.log(`${g}=${hit.map((t) => relative(root, t)).join(' ')}`);
}
