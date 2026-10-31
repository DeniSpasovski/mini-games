import { afterEach, expect, rs, test } from '@rstest/core';
import { Sfx } from '../../src/games/hole/game/audio';

class FakeNode {
  gain = { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} };
  frequency = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
  playbackRate = { value: 1 };
  buffer: unknown = null;
  onended: (() => void) | null = null;
  connect(n: unknown) {
    return n;
  }
  disconnect() {}
  start() {
    started++;
  }
  stop() {}
}
let started = 0;
let created = 0;
class FakeContext {
  state = 'running';
  currentTime = 0;
  destination = {};
  constructor() {
    created++;
  }
  createGain = () => new FakeNode();
  createOscillator = () => new FakeNode();
  createBufferSource = () => new FakeNode();
  decodeAudioData = async () => ({}) as AudioBuffer;
  resume = async () => {};
  suspend = async () => {};
}

afterEach(() => {
  started = 0;
  created = 0;
  rs.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

test('?mute=1 never creates a context or requests a file', () => {
  window.history.replaceState(null, '', '/?mute=1');
  const fetchSpy = rs.fn();
  rs.stubGlobal('AudioContext', FakeContext);
  rs.stubGlobal('fetch', fetchSpy);
  const sfx = new Sfx();
  sfx.unlock();
  sfx.gulp(3, 'plush');
  sfx.roar();
  sfx.levelUp();
  expect(created).toBe(0);
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('unlock twice makes one context; gulps merge within 35 ms; failed loads fall back to the synth', () => {
  window.history.replaceState(null, '', '/');
  rs.stubGlobal('AudioContext', FakeContext);
  rs.stubGlobal('fetch', async () => {
    throw new Error('offline');
  });
  const sfx = new Sfx();
  sfx.unlock();
  sfx.unlock();
  expect(created).toBe(1);
  sfx.gulp(3, 'plush');
  const first = started;
  expect(first).toBeGreaterThan(0); // synth tone(s) still play with no samples
  sfx.gulp(3, 'plush');
  expect(started).toBe(first);
});
