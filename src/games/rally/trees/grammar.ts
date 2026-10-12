import { TreeRng } from './math';
import type { SpeciesDef } from './species';

/**
 * Stage 1, grammar (spec: trees/Grammar.md): a species' parametric, stochastic, bracketed L-system rewritten
 * `iterations` times into a module string. Pure: a function of the species and the seed only.
 */

/** The symbols the turtle reads (trees/skeleton.ts). */
export const ALPHABET = 'FfAB+-&^<>|![]L';

export interface Module {
  s: string;
  a: number[];
}

interface Env {
  v: Record<string, number>;
  rng: TreeRng;
}
type Expr = (env: Env) => number;

// --- expressions ---------------------------------------------------------------------------------------------

const TOKEN =
  /\s*(\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+|[A-Za-z_]\w*|<=|>=|==|!=|&&|\|\||[-+*/(),<>])/y;

function tokenize(src: string): string[] {
  const out: string[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < src.length) {
    if (/^\s*$/.test(src.slice(TOKEN.lastIndex))) break;
    const m = TOKEN.exec(src);
    if (!m) throw new Error(`Tree grammar: bad expression "${src}"`);
    out.push(m[1]);
  }
  return out;
}

const BINARY: Record<string, [number, (a: number, b: number) => number]> = {
  '||': [1, (a, b) => (a || b ? 1 : 0)],
  '&&': [2, (a, b) => (a && b ? 1 : 0)],
  '==': [3, (a, b) => (a === b ? 1 : 0)],
  '!=': [3, (a, b) => (a !== b ? 1 : 0)],
  '<': [4, (a, b) => (a < b ? 1 : 0)],
  '>': [4, (a, b) => (a > b ? 1 : 0)],
  '<=': [4, (a, b) => (a <= b ? 1 : 0)],
  '>=': [4, (a, b) => (a >= b ? 1 : 0)],
  '+': [5, (a, b) => a + b],
  '-': [5, (a, b) => a - b],
  '*': [6, (a, b) => a * b],
  '/': [6, (a, b) => a / b],
};

const FUNCTIONS: Record<string, (env: Env, args: number[]) => number> = {
  /** Parameter jitter: uniform in [a, b) from the tree's PRNG. */
  rnd: (env, [a, b]) => env.rng.range(a, b),
  min: (_e, [a, b]) => Math.min(a, b),
  max: (_e, [a, b]) => Math.max(a, b),
};

/** Arithmetic / comparison expression -> closure (no eval). */
export function compileExpr(src: string): Expr {
  const t = tokenize(src);
  let i = 0;
  const peek = () => t[i];
  const expect = (s: string) => {
    if (t[i++] !== s)
      throw new Error(`Tree grammar: expected "${s}" in "${src}"`);
  };
  const primary = (): Expr => {
    const tok = t[i++];
    if (tok === undefined)
      throw new Error(`Tree grammar: unexpected end of "${src}"`);
    if (tok === '(') {
      const e = binary(0);
      expect(')');
      return e;
    }
    if (tok === '-') {
      const e = primary();
      return (env) => -e(env);
    }
    if (/^[\d.]/.test(tok)) {
      const n = Number(tok);
      return () => n;
    }
    if (peek() === '(') {
      const f = FUNCTIONS[tok];
      if (!f)
        throw new Error(`Tree grammar: unknown function "${tok}" in "${src}"`);
      i++;
      const args: Expr[] = [];
      if (peek() !== ')')
        for (;;) {
          args.push(binary(0));
          if (peek() !== ',') break;
          i++;
        }
      expect(')');
      return (env) =>
        f(
          env,
          args.map((a) => a(env)),
        );
    }
    return (env) => {
      const v = env.v[tok];
      if (v === undefined)
        throw new Error(`Tree grammar: unknown name "${tok}" in "${src}"`);
      return v;
    };
  };
  const binary = (min: number): Expr => {
    let left = primary();
    for (;;) {
      const op = BINARY[peek()];
      if (!op || op[0] < min) break;
      i++;
      const right = binary(op[0] + 1);
      const l = left;
      const f = op[1];
      left = (env) => f(l(env), right(env));
    }
    return left;
  };
  const e = binary(0);
  if (i !== t.length)
    throw new Error(`Tree grammar: trailing tokens in "${src}"`);
  return e;
}

// --- module strings ------------------------------------------------------------------------------------------

interface Template {
  s: string;
  args: Expr[];
}

/** Split `a, b(c, d), e` at its top-level commas. */
function splitArgs(src: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      out.push(src.slice(start, i));
      start = i + 1;
    }
  }
  out.push(src.slice(start));
  return out.filter((s) => s.trim() !== '');
}

/** `F(l*0.9)[+B(l,o+1)]L` -> templates whose arguments are evaluated per rewrite. */
export function parseModules(src: string): Template[] {
  const out: Template[] = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (/\s/.test(c)) continue;
    if (!ALPHABET.includes(c))
      throw new Error(
        `Tree grammar: "${c}" is not in the alphabet (${ALPHABET}) in "${src}"`,
      );
    let args: Expr[] = [];
    if (src[i + 1] === '(') {
      let depth = 0;
      let j = i + 1;
      for (; j < src.length; j++) {
        if (src[j] === '(') depth++;
        else if (src[j] === ')' && --depth === 0) break;
      }
      args = splitArgs(src.slice(i + 2, j)).map(compileExpr);
      i = j;
    }
    out.push({ s: c, args });
  }
  return out;
}

interface Rule {
  params: string[];
  cond: Expr | null;
  succ: Template[];
  p: number;
}

export interface Grammar {
  axiom: Template[];
  rules: Map<string, Rule[]>;
}

export function compileGrammar(def: SpeciesDef): Grammar {
  const rules = new Map<string, Rule[]>();
  for (const r of def.rules) {
    const m = /^\s*([A-Za-z])\s*(?:\(([^)]*)\))?\s*$/.exec(r.pred);
    if (!m)
      throw new Error(
        `Tree grammar: bad predecessor "${r.pred}" (${def.name})`,
      );
    const params = m[2] ? m[2].split(',').map((s) => s.trim()) : [];
    let list = rules.get(m[1]);
    if (!list) rules.set(m[1], (list = []));
    list.push({
      params,
      cond: r.cond ? compileExpr(r.cond) : null,
      succ: parseModules(r.succ),
      p: r.p ?? 1,
    });
  }
  return { axiom: parseModules(def.axiom), rules };
}

function expand(t: Template[], env: Env, out: Module[]): number {
  let segments = 0;
  for (const m of t) {
    out.push({ s: m.s, a: m.args.map((e) => e(env)) });
    if (m.s === 'F') segments++;
  }
  return segments;
}

/**
 * Rewrite the axiom `iterations` times. Rule choice and `rnd` jitter come from ONE PRNG seeded with `seed`; stops
 * early (keeping the last string) when the next one would exceed the species' segment cap.
 */
export function derive(def: SpeciesDef, seed: number): Module[] {
  const g = compileGrammar(def);
  const rng = new TreeRng(seed);
  const constants = def.constants ?? {};
  let cur: Module[] = [];
  expand(g.axiom, { v: { ...constants }, rng }, cur);
  for (let it = 0; it < def.iterations; it++) {
    const next: Module[] = [];
    let segments = 0;
    for (const m of cur) {
      const rules = g.rules.get(m.s);
      if (!rules) {
        next.push(m);
        if (m.s === 'F') segments++;
        continue;
      }
      const matching: { r: Rule; env: Env }[] = [];
      for (const r of rules) {
        if (r.params.length !== m.a.length) continue;
        const v: Record<string, number> = { ...constants };
        r.params.forEach((p, k) => (v[p] = m.a[k]));
        const env = { v, rng };
        if (!r.cond || r.cond(env)) matching.push({ r, env });
      }
      if (!matching.length) {
        next.push(m);
        if (m.s === 'F') segments++;
        continue;
      }
      let pick = matching[0];
      if (matching.length > 1) {
        let total = 0;
        for (const x of matching) total += x.r.p;
        let u = rng.next() * total;
        for (const x of matching) {
          pick = x;
          if ((u -= x.r.p) < 0) break;
        }
      }
      segments += expand(pick.r.succ, pick.env, next);
    }
    if (segments > def.segmentCap) break;
    cur = next;
  }
  return cur;
}
