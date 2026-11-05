/**
 * Small DOM pieces for managing saved replays (results, replay bar, Stage times; menu.css "Replays", STYLEGUIDE
 * "Replay"): the name field of a named save, a two-step confirm button, and the storage line with "Delete auto saves"
 * that turns into the soft-limit notice at `REPLAY_SOFT_LIMIT` (store.ts `replayTotals`). Text is always set with textContent (names are the
 * player's).
 */
import {
  autoDeleteIds,
  bytesOf,
  deleteReplays,
  listReplays,
  NAME_MAX,
  replayTotals,
  storageEstimate,
} from './store';

export const formatBytes = (b: number): string =>
  b >= 1024 * 1024 * 1024
    ? `${(b / 1024 ** 3).toFixed(1)} GB`
    : b >= 1024 * 1024
      ? `${(b / 1024 ** 2).toFixed(1)} MB`
      : `${Math.max(1, Math.round(b / 1024))} KB`;

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/**
 * A name field + Save / Cancel. Keys typed in it never reach the game, menu or replay shortcuts. Enter saves, Esc
 * cancels. `onSave` gets the raw text (the store cleans it).
 */
export function nameForm(
  value: string,
  onSave: (name: string) => void | Promise<void>,
  onCancel: () => void,
): HTMLFormElement {
  const f = el('form', 'replay-name');
  const input = el('input', 'replay-name-input');
  input.type = 'text';
  input.maxLength = NAME_MAX;
  input.placeholder = 'Name this replay';
  input.value = value;
  input.setAttribute('aria-label', 'Replay name');
  const save = el('button', 'replay-name-save', 'Save');
  save.type = 'submit';
  const cancel = el('button', 'replay-name-cancel', 'Cancel');
  cancel.type = 'button';
  f.append(input, save, cancel);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  });
  input.addEventListener('keyup', (e) => e.stopPropagation());
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    void onSave(input.value);
  });
  cancel.addEventListener('click', onCancel);
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
  return f;
}

/** A button that asks once: the first click shows `ask` (penalty colour) for 3 s, the second runs it. */
export function confirmButton(
  cls: string,
  idle: string | Node,
  ask: string,
  run: () => void | Promise<void>,
  title?: string,
): HTMLButtonElement {
  const b = el('button', `${cls} replay-confirm`);
  b.type = 'button';
  if (title) {
    b.title = title;
    b.setAttribute('aria-label', title);
  }
  const show = (v: string | Node) =>
    b.replaceChildren(
      typeof v === 'string' ? document.createTextNode(v) : v.cloneNode(true),
    );
  show(idle);
  let armed: ReturnType<typeof setTimeout> | undefined;
  b.addEventListener('click', async () => {
    if (!armed) {
      b.classList.add('armed');
      show(ask);
      armed = setTimeout(() => {
        armed = undefined;
        b.classList.remove('armed');
        show(idle);
      }, 3000);
      return;
    }
    clearTimeout(armed);
    armed = undefined;
    b.disabled = true;
    await run();
  });
  return b;
}

/**
 * "N replays · X MB (of the browser's Y)" and "Delete auto saves (n · size)" with "Keep personal bests" (on). At the
 * soft limit the line becomes a notice. Calls `changed` after a delete (the caller redraws). Empty when nothing is saved.
 */
export async function storageLine(
  changed: () => void,
): Promise<HTMLElement | null> {
  const [list, est] = await Promise.all([listReplays(), storageEstimate()]);
  if (!list.length) return null;
  const t = replayTotals(list);
  const box = el('div', `replay-storage${t.full ? ' full' : ''}`);
  const msg = el('p', 'replay-storage-msg');
  const n = `${t.count} replay${t.count === 1 ? '' : 's'}`;
  msg.textContent = t.full
    ? `${n} saved (${formatBytes(t.bytes)}${est ? ` of the ${formatBytes(est.quota)} this browser allows` : ''}). New runs still save; delete auto saves to make room.`
    : `${n} · ${formatBytes(t.bytes)}${t.named ? ` · ${t.named} named` : ''}`;
  box.append(msg);
  const row = el('div', 'replay-storage-actions');
  const keep = el('label', 'replay-keep');
  const check = el('input', '');
  check.type = 'checkbox';
  check.checked = true;
  keep.append(check, document.createTextNode(' Keep personal bests'));
  const action = el('span', 'replay-bulk');
  const draw = () => {
    const ids = autoDeleteIds(list, check.checked);
    action.replaceChildren(
      ids.length
        ? confirmButton(
            'menu-btn replay-bulk-btn',
            `Delete auto saves (${ids.length} · ${formatBytes(bytesOf(list, ids))})`,
            `Delete ${ids.length} replays?`,
            async () => {
              await deleteReplays(ids);
              changed();
            },
          )
        : el('span', 'replay-bulk-none', 'No auto saves to delete'),
    );
  };
  check.addEventListener('change', draw);
  draw();
  row.append(action, keep);
  box.append(row);
  return box;
}
