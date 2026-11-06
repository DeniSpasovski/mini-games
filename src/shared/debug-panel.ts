import './debug-panel.css';

/**
 * Left-side debug menu used by all tool pages (map viewer, car viewer, asset
 * debugger). Zero dependencies; every control is a plain DOM element.
 *
 *   const panel = new DebugPanel({ title: 'Asset debugger' });
 *   const s = panel.section('Variables');
 *   s.slider('Scale', 1, { min: 0.1, max: 4, step: 0.1 }, (v) => ...);
 *
 * Press "H" to hide/show the panel.
 */
export interface PanelLink {
  label: string;
  href: string;
}

export interface PanelOptions {
  title: string;
  links?: PanelLink[];
  /** localStorage key: remember which sections are open (per page) across reloads. */
  rememberSections?: string;
}

export interface Control<T> {
  el: HTMLElement;
  set(value: T): void;
}

export interface SliderControl extends Control<number> {
  /** New min / max (e.g. the variant count of the picked asset). */
  setRange(min: number, max: number): void;
}

export interface ListItem {
  id: string;
  label: string;
  group?: string;
  hint?: string;
  /** Chip filters this row matches (`list(..., { chips })`, e.g. its drivetrain). */
  tags?: string[];
}

export class DebugPanel {
  readonly el: HTMLElement;
  readonly viewport: HTMLElement;
  private sectionsEl: HTMLElement;
  private remember?: string;
  private openState: Record<string, boolean> = {};
  private titles = new Map<string, number>();

  constructor(opts: PanelOptions) {
    this.remember = opts.rememberSections;
    if (this.remember)
      try {
        this.openState = JSON.parse(
          localStorage.getItem(this.remember) ?? '{}',
        ) as Record<string, boolean>;
      } catch {
        this.openState = {};
      }
    document.body.classList.add('dp-body');
    this.el = h('aside', 'dp-panel');
    const header = h('div', 'dp-header');
    header.append(
      h('a', 'dp-home', '←', { href: '../../', title: 'Back to portal' }),
      h('h1', '', opts.title),
    );
    this.el.append(header);
    if (opts.links?.length) {
      const nav = h('nav', 'dp-links');
      for (const l of opts.links) {
        const a = h('a', '', l.label, { href: l.href });
        const target = new URL(l.href, location.href).pathname;
        const here = location.pathname.replace(/index\.html$/, '');
        if (target.replace(/index\.html$/, '') === here)
          a.classList.add('active');
        nav.append(a);
      }
      this.el.append(nav);
    }
    this.sectionsEl = h('div', 'dp-sections');
    this.el.append(this.sectionsEl);
    this.viewport = h('main', 'dp-viewport');
    document.body.append(this.el, this.viewport);

    window.addEventListener('keydown', (e) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.metaKey)
        DebugPanel.toggle();
    });
  }

  /** Hide / show the panel (the "H" key). */
  static toggle(): void {
    document.body.classList.toggle('dp-hidden');
  }

  section(title: string, open = true): PanelSection {
    // Key = title (+ #n for a second section of the same title), so a remembered state follows its section.
    const n = (this.titles.get(title) ?? 0) + 1;
    this.titles.set(title, n);
    const key = n > 1 ? `${title}#${n}` : title;
    const s = new PanelSection(title, this.openState[key] ?? open);
    const store = this.remember;
    if (store)
      s.el.addEventListener('toggle', () => {
        this.openState[key] = (s.el as HTMLDetailsElement).open;
        try {
          localStorage.setItem(store, JSON.stringify(this.openState));
        } catch {
          // Storage blocked: the panel just forgets.
        }
      });
    this.sectionsEl.append(s.el);
    return s;
  }
}

export class PanelSection {
  readonly el: HTMLElement;
  readonly body: HTMLElement;

  constructor(title: string, open: boolean) {
    this.el = h('details', 'dp-section');
    (this.el as HTMLDetailsElement).open = open;
    this.el.append(h('summary', '', title));
    this.body = h('div', 'dp-section-body');
    this.el.append(this.body);
  }

  clear(): void {
    this.body.replaceChildren();
  }

  /**
   * Grouped list, a filter box from 8 rows (Enter picks the first match). Used for "pick an asset / car / map".
   * The picked row starts scrolled into view. `chips` (e.g. All / AWD / FWD / RWD, first = everything): a segmented
   * filter on top matching `ListItem.tags`, and a flat list with each row's group in small type on its right instead
   * of group header rows (saves the height of the headers).
   */
  list(
    items: ListItem[],
    selected: string,
    onSelect: (id: string) => void,
    o: { chips?: string[] } = {},
  ): Control<string> {
    const wrap = h('div', 'dp-list');
    const filter = h('input', 'dp-filter', '', {
      type: 'search',
      placeholder: 'filter…',
    }) as HTMLInputElement;
    const ul = h('div', 'dp-list-items');
    const chips = o.chips ?? [];
    let chip = chips[0];
    if (chips.length) {
      const seg = h('div', 'dp-chips');
      for (const c of chips) {
        const b = h('button', 'dp-chip', c, { type: 'button' });
        b.classList.toggle('on', c === chip);
        b.addEventListener('click', () => {
          chip = c;
          for (const x of seg.children) x.classList.toggle('on', x === b);
          refresh();
        });
        seg.append(b);
      }
      wrap.append(seg);
    }
    if (items.length >= 8) wrap.append(filter);
    wrap.append(ul);
    const rows = new Map<string, HTMLElement>();
    const tagsOf = new Map<HTMLElement, string[]>();
    let lastGroup: string | undefined;
    for (const it of items) {
      if (!chips.length && it.group && it.group !== lastGroup) {
        ul.append(h('div', 'dp-list-group', it.group));
        lastGroup = it.group;
      }
      const row = h('button', 'dp-list-item', chips.length ? '' : it.label, {
        type: 'button',
        title: it.hint ?? it.id,
      });
      if (chips.length)
        row.append(h('span', '', it.label), h('small', '', it.group ?? ''));
      row.dataset.search =
        `${it.id} ${it.label} ${it.group ?? ''}`.toLowerCase();
      row.addEventListener('click', () => {
        set(it.id);
        onSelect(it.id);
      });
      rows.set(it.id, row);
      tagsOf.set(row, it.tags ?? []);
      ul.append(row);
    }
    const refresh = () => {
      const q = filter.value.trim().toLowerCase();
      for (const row of rows.values())
        row.style.display =
          (chip === chips[0] || tagsOf.get(row)!.includes(chip)) &&
          (!q || row.dataset.search!.includes(q))
            ? ''
            : 'none';
    };
    filter.addEventListener('input', refresh);
    filter.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      for (const row of rows.values())
        if (row.style.display !== 'none') return row.click();
    });
    const set = (id: string) => {
      for (const [rid, row] of rows) row.classList.toggle('active', rid === id);
    };
    set(selected);
    this.body.append(wrap);
    // Once laid out: the picked row in the middle of the list (a long list would open on its first group).
    // A section that starts closed has no layout yet: centre again when it opens.
    const centre = () => {
      const row = ul.querySelector<HTMLElement>('.active');
      if (row && ul.scrollHeight > ul.clientHeight)
        ul.scrollTop = row.offsetTop - (ul.clientHeight - row.offsetHeight) / 2;
    };
    requestAnimationFrame(centre);
    this.el.addEventListener('toggle', () => {
      if ((this.el as HTMLDetailsElement).open) centre();
    });
    return { el: wrap, set };
  }

  slider(
    label: string,
    value: number,
    o: { min: number; max: number; step?: number },
    onChange: (v: number) => void,
  ): SliderControl {
    const row = this.row(label);
    const input = h('input', '', '', {
      type: 'range',
      min: String(o.min),
      max: String(o.max),
      step: String(o.step ?? 0.01),
    }) as HTMLInputElement;
    const out = h('input', 'dp-num', '', {
      type: 'number',
      step: String(o.step ?? 0.01),
    }) as HTMLInputElement;
    const set = (v: number) => {
      input.value = String(v);
      out.value = String(+v.toFixed(4));
    };
    input.addEventListener('input', () => {
      out.value = input.value;
      onChange(Number(input.value));
    });
    out.addEventListener('change', () => {
      input.value = out.value;
      onChange(Number(out.value));
    });
    set(value);
    row.append(input, out);
    const setRange = (min: number, max: number) => {
      input.min = out.min = String(min);
      input.max = out.max = String(max);
    };
    return { el: row, set, setRange };
  }

  /** Plain number field (e.g. "go to building #"); `onChange` on Enter / blur. */
  number(
    label: string,
    value: number,
    onChange: (v: number) => void,
    o: { min?: number; placeholder?: string } = {},
  ): Control<number> {
    const row = this.row(label);
    const input = h('input', 'dp-field', '', {
      type: 'number',
      step: '1',
      ...(o.min !== undefined && { min: String(o.min) }),
      ...(o.placeholder && { placeholder: o.placeholder }),
    }) as HTMLInputElement;
    const set = (v: number) => (input.value = v ? String(v) : '');
    input.addEventListener('change', () => onChange(Number(input.value)));
    set(value);
    row.append(input);
    return { el: row, set };
  }

  checkbox(
    label: string,
    value: boolean,
    onChange: (v: boolean) => void,
  ): Control<boolean> {
    const row = h('label', 'dp-row dp-check');
    const input = h('input', '', '', { type: 'checkbox' }) as HTMLInputElement;
    input.checked = value;
    input.addEventListener('change', () => onChange(input.checked));
    row.append(input, h('span', '', label));
    this.body.append(row);
    return { el: row, set: (v) => (input.checked = v) };
  }

  select(
    label: string,
    value: string,
    options: (string | { value: string; label: string })[],
    onChange: (v: string) => void,
  ): Control<string> {
    const row = this.row(label);
    const sel = h('select', '') as HTMLSelectElement;
    for (const o of options) {
      const opt = typeof o === 'string' ? { value: o, label: o } : o;
      sel.append(h('option', '', opt.label, { value: opt.value }));
    }
    sel.value = value;
    sel.addEventListener('change', () => onChange(sel.value));
    // Wrapped, so a page style can draw its own chevron (`::after`).
    const wrap = h('span', 'dp-select');
    wrap.append(sel);
    row.append(wrap);
    return { el: row, set: (v) => (sel.value = v) };
  }

  color(
    label: string,
    value: string,
    onChange: (v: string) => void,
  ): Control<string> {
    const row = this.row(label);
    const input = h('input', '', '', { type: 'color' }) as HTMLInputElement;
    input.value = value;
    input.addEventListener('input', () => onChange(input.value));
    row.append(input);
    return { el: row, set: (v) => (input.value = v) };
  }

  /** Integer seed input with a "random" button. */
  seed(
    label: string,
    value: number,
    onChange: (v: number) => void,
  ): Control<number> {
    const row = this.row(label);
    const input = h('input', 'dp-seed', '', {
      type: 'number',
      step: '1',
    }) as HTMLInputElement;
    input.value = String(value);
    const dice = h('button', 'dp-btn', '🎲', {
      type: 'button',
      title: 'Random seed',
    });
    const prev = h('button', 'dp-btn', '‹', {
      type: 'button',
      title: 'Previous seed',
    });
    const next = h('button', 'dp-btn', '›', {
      type: 'button',
      title: 'Next seed',
    });
    const emit = (v: number) => {
      input.value = String(v);
      onChange(v);
    };
    input.addEventListener('change', () =>
      emit(Math.floor(Number(input.value) || 0)),
    );
    dice.addEventListener('click', () =>
      emit(Math.floor(Math.random() * 100000)),
    );
    prev.addEventListener('click', () => emit(Number(input.value) - 1));
    next.addEventListener('click', () => emit(Number(input.value) + 1));
    row.append(prev, input, next, dice);
    return { el: row, set: (v) => (input.value = String(v)) };
  }

  /** Several short buttons side by side (e.g. camera presets). */
  buttons(items: [label: string, onClick: () => void][]): HTMLButtonElement[] {
    const row = h('div', 'dp-buttons');
    this.body.append(row);
    return items.map(([label, onClick]) => {
      const b = h('button', 'dp-btn', label, {
        type: 'button',
      }) as HTMLButtonElement;
      b.addEventListener('click', onClick);
      row.append(b);
      return b;
    });
  }

  /** A short explanation under a control (visible text, not a tooltip). */
  note(text: string): HTMLElement {
    const el = h('p', 'dp-note', text);
    this.body.append(el);
    return el;
  }

  /** Key / mouse help, one row per binding: `['Shift drag', 'pan']` draws each word as a key. */
  keys(rows: [keys: string, what: string][]): HTMLElement {
    const el = h('dl', 'dp-keys');
    for (const [k, what] of rows) {
      const dt = h('dt', '');
      for (const part of k.split(' ')) dt.append(h('kbd', '', part));
      el.append(dt, h('dd', '', what));
    }
    this.body.append(el);
    return el;
  }

  button(label: string, onClick: () => void): HTMLButtonElement {
    const b = h('button', 'dp-btn dp-wide', label, {
      type: 'button',
    }) as HTMLButtonElement;
    b.addEventListener('click', onClick);
    this.body.append(b);
    return b;
  }

  /**
   * Read-only key/value block; call the returned function to update it. Only changed values touch the DOM, so it
   * may run every frame.
   */
  info(): (values: Record<string, string | number>) => void {
    const el = h('dl', 'dp-info');
    this.body.append(el);
    let keys = '';
    let cells: HTMLElement[] = [];
    return (values) => {
      const entries = Object.entries(values);
      const next = entries.map(([k]) => k).join('\n');
      if (next !== keys) {
        keys = next;
        cells = [];
        el.replaceChildren(
          ...entries.flatMap(([k]) => {
            const dd = h('dd', '');
            cells.push(dd);
            return [h('dt', '', k), dd];
          }),
        );
      }
      entries.forEach(([, v], i) => {
        const text = String(v);
        if (cells[i].textContent !== text) cells[i].textContent = text;
      });
    };
  }

  html(content: string): HTMLElement {
    const el = h('div', 'dp-html');
    el.innerHTML = content;
    this.body.append(el);
    return el;
  }

  private row(label: string): HTMLElement {
    const row = h('div', 'dp-row');
    row.append(h('span', 'dp-label', label));
    this.body.append(row);
    return row;
  }
}

function h(
  tag: string,
  cls: string,
  text = '',
  attrs: Record<string, string> = {},
): HTMLElement {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}
