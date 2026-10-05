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
}

export interface Control<T> {
  el: HTMLElement;
  set(value: T): void;
}

export interface ListItem {
  id: string;
  label: string;
  group?: string;
  hint?: string;
}

export class DebugPanel {
  readonly el: HTMLElement;
  readonly viewport: HTMLElement;
  private sectionsEl: HTMLElement;

  constructor(opts: PanelOptions) {
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
        e.target instanceof HTMLSelectElement
      )
        return;
      if (e.key === 'h' || e.key === 'H')
        document.body.classList.toggle('dp-hidden');
    });
  }

  section(title: string, open = true): PanelSection {
    const s = new PanelSection(title, open);
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

  /** Grouped, filterable list. Used for "pick an asset / car / map". */
  list(
    items: ListItem[],
    selected: string,
    onSelect: (id: string) => void,
  ): Control<string> {
    const wrap = h('div', 'dp-list');
    const filter = h('input', 'dp-filter', '', {
      type: 'search',
      placeholder: 'filter…',
    }) as HTMLInputElement;
    const ul = h('div', 'dp-list-items');
    wrap.append(filter, ul);
    const rows = new Map<string, HTMLElement>();
    let lastGroup: string | undefined;
    for (const it of items) {
      if (it.group && it.group !== lastGroup) {
        ul.append(h('div', 'dp-list-group', it.group));
        lastGroup = it.group;
      }
      const row = h('button', 'dp-list-item', it.label, {
        type: 'button',
        title: it.hint ?? it.id,
      });
      row.dataset.search =
        `${it.id} ${it.label} ${it.group ?? ''}`.toLowerCase();
      row.addEventListener('click', () => {
        set(it.id);
        onSelect(it.id);
      });
      rows.set(it.id, row);
      ul.append(row);
    }
    filter.addEventListener('input', () => {
      const q = filter.value.trim().toLowerCase();
      for (const row of rows.values())
        row.style.display = !q || row.dataset.search!.includes(q) ? '' : 'none';
    });
    const set = (id: string) => {
      for (const [rid, row] of rows) row.classList.toggle('active', rid === id);
    };
    set(selected);
    this.body.append(wrap);
    return { el: wrap, set };
  }

  slider(
    label: string,
    value: number,
    o: { min: number; max: number; step?: number },
    onChange: (v: number) => void,
  ): Control<number> {
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
    row.append(sel);
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

  button(label: string, onClick: () => void): HTMLButtonElement {
    const b = h('button', 'dp-btn dp-wide', label, {
      type: 'button',
    }) as HTMLButtonElement;
    b.addEventListener('click', onClick);
    this.body.append(b);
    return b;
  }

  /** Read-only key/value block; call the returned function to update it. */
  info(): (values: Record<string, string | number>) => void {
    const el = h('dl', 'dp-info');
    this.body.append(el);
    return (values) => {
      el.replaceChildren(
        ...Object.entries(values).flatMap(([k, v]) => [
          h('dt', '', k),
          h('dd', '', String(v)),
        ]),
      );
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
