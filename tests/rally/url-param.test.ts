import { afterEach, describe, expect, test } from '@rstest/core';
import {
  setInferredParams,
  urlParam,
} from '../../src/games/rally/engine/url-param';

describe('urlParam', () => {
  afterEach(() => setInferredParams({}));

  test('no URL and nothing inferred: null', () => {
    expect(urlParam('season')).toBeNull();
  });

  test('inferred values win; empty means none', () => {
    setInferredParams({ season: 'autumn', tod: undefined });
    expect(urlParam('season')).toBe('autumn');
    expect(urlParam('tod')).toBe('');
    expect(urlParam('weather')).toBeNull();
  });
});
