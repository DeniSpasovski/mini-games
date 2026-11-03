import { afterEach, beforeEach, describe, expect, test } from '@rstest/core';
import { InputController } from '../../src/games/rally/game/input';

// Minimal browser stubs: the controller only needs window listeners and navigator.getGamepads.
const g = globalThis as unknown as Record<string, unknown>;
const saved = { window: g.window, navigator: g.navigator };
let pressed: Record<number, boolean> = {};

beforeEach(() => {
  g.window = { addEventListener: () => {} };
  g.navigator = {
    getGamepads: () => [
      {
        connected: true,
        axes: [0, 0],
        buttons: Array.from({ length: 16 }, (_, i) => ({
          pressed: !!pressed[i],
          value: pressed[i] ? 1 : 0,
        })),
      },
    ],
  };
});

afterEach(() => {
  pressed = {};
  g.window = saved.window;
  g.navigator = saved.navigator;
});

describe('gamepad B that closes the pause menu', () => {
  test('does not reset the car', () => {
    const input = new InputController();
    const actions: string[] = [];
    input.onAction((a) => actions.push(a));

    input.enabled = false; // paused
    pressed[1] = true; // B held; the menu handles it first and resumes
    input.enabled = true;
    input.poll(); // the game polls afterwards, B still down
    expect(actions).not.toContain('reset');
  });

  test('B in game still resets', () => {
    const input = new InputController();
    const actions: string[] = [];
    input.onAction((a) => actions.push(a));
    input.poll();
    pressed[1] = true;
    input.poll();
    expect(actions).toContain('reset');
  });
});
