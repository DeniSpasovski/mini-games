import { readUrlState, writeUrlState } from '../../../shared/url-state';
import { DebugPanel } from '../../../shared/debug-panel';
import { TOOL_LINKS } from '../debug/viewer-shell';
import { MAPS, getMapDef } from '../map/registry';
import { BOT_SKILLS, runBot, type RunResult } from '../sim/bot';
import {
  DIFFICULTIES,
  MAX_LEVEL,
  cumulativeXp,
  holeDiameter,
  itemsToLevel,
  levelTier,
  maxEdibleSize,
  pointsForTier,
  xpToNext,
  TUNING,
} from '../sim/progression';
import { Sim } from '../sim/sim';

/**
 * Balance: runs the real sim headless with a bot over several seeds and
 * difficulties, then plots level and score over time.
 *   balance.html?difficulty=all&runs=10&skill=good&seed=1
 * Targets (DETAILS.md): good bot - Hard ~level 10-15 of 15, Medium level 15 well before the end, Easy cleared.
 * The `TUNING` knobs (sim/progression.ts) are editable in the panel and live in the URL as `t_<name>`, so a
 * tuning is shareable; "Copy tuning" gives the object to paste back into progression.ts.
 */
type TuningKey = keyof typeof TUNING;
const TUNING_DEFAULTS: Record<TuningKey, number> = { ...TUNING };
const tuningUrl = Object.fromEntries(
  Object.entries(TUNING_DEFAULTS).map(([k, v]) => [`t_${k}`, v]),
) as Record<`t_${TuningKey}`, number>;
const DEFAULTS = {
  map: 'city',
  difficulty: 'all',
  runs: 8,
  skill: 'good',
  seed: 1,
  dt: 30,
  ...tuningUrl,
};
const state = readUrlState(DEFAULTS);
const sync = () => writeUrlState(state, DEFAULTS);
for (const k of Object.keys(TUNING) as TuningKey[]) TUNING[k] = state[`t_${k}`];

const panel = new DebugPanel({ title: 'Balance', links: TOOL_LINKS });
const ctl = panel.section('Run');
ctl.select(
  'Map',
  state.map,
  MAPS.map((m) => m.id),
  (v) => ((state.map = v), sync()),
);
ctl.select(
  'Difficulty',
  state.difficulty,
  ['all', ...DIFFICULTIES.map((d) => d.id)],
  (v) => ((state.difficulty = v), sync()),
);
ctl.select(
  'Bot skill',
  state.skill,
  Object.keys(BOT_SKILLS),
  (v) => ((state.skill = v), sync()),
);
ctl.slider(
  'Runs per difficulty (map seeds)',
  state.runs,
  { min: 1, max: 30, step: 1 },
  (v) => ((state.runs = v), sync()),
);
ctl.seed('First map seed', state.seed, (v) => ((state.seed = v), sync()));
ctl.slider(
  'Sim steps per second',
  state.dt,
  { min: 15, max: 60, step: 5 },
  (v) => ((state.dt = v), sync()),
);
const runBtn = ctl.button('Run', () => void run());

/** Slider range per `TUNING` knob (the shipped value sits inside every range). */
const TUNING_UI: Record<
  TuningKey,
  { label: string; min: number; max: number; step: number }
> = {
  itemsFirst: {
    label: 'Items to fill the bar, level 1',
    min: 2,
    max: 40,
    step: 1,
  },
  itemsLast: {
    label: 'Items to fill the bar, level 14',
    min: 10,
    max: 150,
    step: 1,
  },
  speedBase: { label: 'Speed base (m/s)', min: 2, max: 14, step: 0.1 },
  speedPerMetre: {
    label: 'Speed per scaled metre',
    min: 0,
    max: 4,
    step: 0.05,
  },
  growthXpFirst: {
    label: 'XP to leave level 15',
    min: 200,
    max: 3000,
    step: 50,
  },
  growthXpStep: {
    label: 'XP step per growth level',
    min: 0,
    max: 400,
    step: 10,
  },
};
const tune = panel.section('Tuning (sim/progression.ts TUNING)');
const tuneSliders = {} as Record<TuningKey, { set: (v: number) => void }>;
for (const k of Object.keys(TUNING) as TuningKey[]) {
  const u = TUNING_UI[k];
  tuneSliders[k] = tune.slider(
    u.label,
    TUNING[k],
    { min: u.min, max: u.max, step: u.step },
    (v) => {
      TUNING[k] = v;
      state[`t_${k}`] = v;
      sync();
      renderLevelTable();
    },
  );
}
tune.button('Reset tuning to shipped values', () => {
  for (const k of Object.keys(TUNING) as TuningKey[]) {
    TUNING[k] = TUNING_DEFAULTS[k];
    state[`t_${k}`] = TUNING_DEFAULTS[k];
    tuneSliders[k].set(TUNING_DEFAULTS[k]);
  }
  sync();
  renderLevelTable();
});
tune.button(
  'Copy tuning',
  () => void navigator.clipboard?.writeText(tuningText()),
);
function tuningText(): string {
  return JSON.stringify(TUNING, null, 2);
}
const status = panel.section('Status').info();

const out = document.createElement('div');
out.style.cssText =
  'padding:16px;overflow:auto;height:100%;box-sizing:border-box;color:#dde;font:13px system-ui';
const results = document.createElement('div');
const levelBox = document.createElement('div');
out.append(results, levelBox);
panel.viewport.append(out);

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}
function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
}

interface Group {
  id: string;
  label: string;
  seconds: number;
  runs: RunResult[];
}

async function run(): Promise<void> {
  runBtn.disabled = true;
  const diffs = DIFFICULTIES.filter(
    (d) => state.difficulty === 'all' || d.id === state.difficulty,
  );
  const groups: Group[] = [];
  const total = diffs.length * state.runs;
  let done = 0;
  for (const d of diffs) {
    const g: Group = { id: d.id, label: d.label, seconds: d.seconds, runs: [] };
    for (let i = 0; i < state.runs; i++) {
      const map = getMapDef(state.map).generate(state.seed + i);
      const sim = new Sim(map, { seconds: d.seconds });
      g.runs.push(
        runBot(sim, BOT_SKILLS[state.skill], {
          dt: 1 / state.dt,
          seed: state.seed + i,
          sample: Math.max(2, d.seconds / 100),
        }),
      );
      done++;
      status({ progress: `${done}/${total}`, now: `${d.label} #${i + 1}` });
      await new Promise((r) => setTimeout(r, 0)); // let the UI breathe
    }
    groups.push(g);
  }
  render(groups);
  runBtn.disabled = false;
}

function render(groups: Group[]): void {
  results.replaceChildren();
  const out = results;
  const h = (tag: string, text: string) => {
    const e = document.createElement(tag);
    e.textContent = text;
    return e;
  };
  out.append(
    h(
      'h3',
      `Bot "${state.skill}" - ${state.runs} runs per difficulty (map seeds ${state.seed}..${state.seed + state.runs - 1})`,
    ),
  );
  const table = document.createElement('table');
  table.style.cssText = 'border-collapse:collapse;margin-bottom:16px';
  const head = [
    'difficulty',
    'time',
    'level p10 / med / p90',
    'score med',
    'eaten med',
    'island % med',
    'cleared',
  ];
  table.append(rowOf(head, true));
  for (const g of groups) {
    const lv = g.runs.map((r) => r.level);
    table.append(
      rowOf([
        g.label,
        `${g.seconds}s`,
        `${quantile(lv, 0.1)} / ${median(lv)} / ${quantile(lv, 0.9)}`,
        String(median(g.runs.map((r) => r.score))),
        String(median(g.runs.map((r) => r.eaten))),
        `${Math.round(median(g.runs.map((r) => r.pct)) * 100)}%`,
        `${g.runs.filter((r) => r.cleared).length}/${g.runs.length}`,
      ]),
    );
  }
  out.append(table);
  const charts = document.createElement('div');
  charts.style.cssText = 'display:flex;gap:16px;flex-wrap:wrap';
  for (const g of groups) {
    charts.append(chart(g, 'level', MAX_LEVEL), chart(g, 'score', 0));
  }
  out.append(charts);
  const copy = document.createElement('button');
  copy.textContent = 'Copy results as JSON';
  copy.onclick = () =>
    void navigator.clipboard?.writeText(
      JSON.stringify(
        {
          map: state.map,
          skill: state.skill,
          tuning: { ...TUNING },
          results: groups.map((g) => ({
            difficulty: g.id,
            runs: g.runs.map((r) => ({
              level: r.level,
              score: r.score,
              eaten: r.eaten,
              pct: r.pct,
              cleared: r.cleared,
            })),
          })),
        },
        null,
        2,
      ),
    );
  out.append(copy);
}

function renderLevelTable(): void {
  const h = (tag: string, text: string) => {
    const e = document.createElement(tag);
    e.textContent = text;
    return e;
  };
  levelBox.replaceChildren(h('h3', 'Level table (live TUNING)'));
  const lt = document.createElement('table');
  lt.style.cssText = 'border-collapse:collapse';
  lt.append(
    rowOf(
      [
        'level',
        'size tier',
        'diameter m',
        'eats ≤ m',
        'points',
        'items/level',
        'xp to next',
        'cum xp',
      ],
      true,
    ),
  );
  for (let l = 1; l <= MAX_LEVEL; l++)
    lt.append(
      rowOf([
        String(l),
        String(levelTier(l)),
        holeDiameter(l).toFixed(2),
        maxEdibleSize(l).toFixed(2),
        String(pointsForTier(levelTier(l))),
        l < MAX_LEVEL ? String(itemsToLevel(l)) : '-',
        l < MAX_LEVEL ? String(xpToNext(l)) : '-',
        String(cumulativeXp(l)),
      ]),
    );
  levelBox.append(lt);
}
renderLevelTable();

function rowOf(cells: string[], header = false): HTMLTableRowElement {
  const tr = document.createElement('tr');
  for (const c of cells) {
    const td = document.createElement(header ? 'th' : 'td');
    td.textContent = c;
    td.style.cssText =
      'padding:3px 10px;border-bottom:1px solid #334;text-align:right';
    tr.append(td);
  }
  return tr;
}

/** Median + spread of `key` over time for one difficulty. */
function chart(
  g: Group,
  key: 'level' | 'score',
  fixedMax: number,
): HTMLElement {
  const W = 360;
  const H = 180;
  const c = document.createElement('canvas');
  c.width = W * 2;
  c.height = H * 2;
  c.style.cssText = `width:${W}px;height:${H}px;background:#161a22;border-radius:6px`;
  const ctx = c.getContext('2d')!;
  ctx.scale(2, 2);
  const n = Math.min(...g.runs.map((r) => r.timeline.length));
  const series: number[][] = [];
  for (let i = 0; i < n; i++)
    series.push(g.runs.map((r) => r.timeline[i][key]));
  const max = fixedMax || Math.max(1, ...series.flat());
  const x = (i: number) => 36 + (i / Math.max(1, n - 1)) * (W - 48);
  const y = (v: number) => H - 22 - (v / max) * (H - 38);
  ctx.strokeStyle = '#2a3140';
  ctx.fillStyle = '#9aa7bd';
  ctx.font = '10px system-ui';
  for (let k = 0; k <= 4; k++) {
    const v = (max * k) / 4;
    ctx.beginPath();
    ctx.moveTo(36, y(v));
    ctx.lineTo(W - 12, y(v));
    ctx.stroke();
    ctx.fillText(String(Math.round(v)), 4, y(v) + 3);
  }
  ctx.fillText(`${g.label} - ${key} over ${g.seconds}s`, 40, 12);
  // spread band p10..p90
  ctx.fillStyle = 'rgba(80,160,255,0.25)';
  ctx.beginPath();
  series.forEach((s, i) =>
    ctx[i ? 'lineTo' : 'moveTo'](x(i), y(quantile(s, 0.9))),
  );
  for (let i = n - 1; i >= 0; i--)
    ctx.lineTo(x(i), y(quantile(series[i], 0.1)));
  ctx.fill();
  ctx.strokeStyle = '#5ab0ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  series.forEach((s, i) => ctx[i ? 'lineTo' : 'moveTo'](x(i), y(median(s))));
  ctx.stroke();
  return c;
}

(window as unknown as { __balance: unknown }).__balance = { run };
