import { afterEach, expect, test } from '@rstest/core';
import {
  GamepadMenuNav,
  type NavAction,
} from '../../src/games/rally/game/pad-nav';

type FakePad = { axes: number[]; mapping?: string; id?: string };
let pads: FakePad[] = [];
const realGet = navigator.getGamepads;

function nav(): {
  actions: NavAction[];
  poll: () => void;
  dispose: () => void;
} {
  Object.defineProperty(navigator, 'getGamepads', {
    configurable: true,
    value: () =>
      pads.map((p, index) => ({
        id: p.id ?? 'pad',
        index,
        connected: true,
        mapping: p.mapping ?? 'standard',
        axes: p.axes,
        buttons: Array.from({ length: 17 }, () => ({
          pressed: false,
          value: 0,
        })),
      })),
  });
  const actions: NavAction[] = [];
  const n = new GamepadMenuNav((a) => actions.push(a));
  const poll = () => (n as unknown as { poll(dt: number): void }).poll(0.016);
  return { actions, poll, dispose: () => n.dispose() };
}

afterEach(() => {
  Object.defineProperty(navigator, 'getGamepads', {
    configurable: true,
    value: realGet,
  });
});

test('pad nav: axis resting off-centre never navigates', () => {
  pads = [{ axes: [0, -1] }]; // e.g. pedal / trigger axis resting at -1
  const n = nav();
  for (let i = 0; i < 200; i++) n.poll();
  expect(n.actions).toEqual([]);
  n.dispose();
});

test('pad nav: stick drift below the threshold is ignored, a real push fires once', () => {
  pads = [{ axes: [0.05, -0.5] }]; // drifting stick
  const n = nav();
  for (let i = 0; i < 100; i++) n.poll();
  expect(n.actions).toEqual([]);
  pads[0].axes = [0, 0.1];
  n.poll();
  pads[0].axes = [0, -0.9];
  n.poll();
  pads[0].axes = [0, -0.5]; // easing off stays held (hysteresis), no new press
  n.poll();
  pads[0].axes = [0, 0];
  n.poll();
  expect(n.actions).toEqual(['up']);
  n.dispose();
});

test('pad nav: a standard pad is preferred over other devices', () => {
  pads = [
    { axes: [0, -1], mapping: '', id: 'wheel' },
    { axes: [0, 0], mapping: 'standard', id: 'xbox' },
  ];
  const n = nav();
  n.poll();
  pads[1].axes = [0, 1];
  n.poll();
  expect(n.actions).toEqual(['down']);
  n.dispose();
});
