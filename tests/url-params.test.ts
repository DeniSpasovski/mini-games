import { describe, expect, it } from '@rstest/core';
import {
  cleanParam,
  escapeHtml,
  isSafeId,
  ownValue,
  paramInt,
  paramNumber,
  paramOneOf,
} from '../src/shared/url-params';

describe('url params', () => {
  it('paramOneOf only returns allowed values', () => {
    expect(paramOneOf('low', ['low', 'high'], null)).toBe('low');
    expect(paramOneOf('<img>', ['low', 'high'], null)).toBeNull();
    expect(paramOneOf(null, ['low'], 'x')).toBe('x');
  });

  it('paramNumber clamps and rejects junk', () => {
    expect(paramNumber('5', 0, 10, null)).toBe(5);
    expect(paramNumber('99', 0, 10, null)).toBe(10);
    expect(paramNumber('-3', 0, 10, null)).toBe(0);
    expect(paramNumber('abc', 0, 10, 7)).toBe(7);
    expect(paramNumber('Infinity', 0, 10, 7)).toBe(7);
    expect(paramNumber('', 0, 10, 7)).toBe(7);
    expect(paramNumber(null, 0, 10, 7)).toBe(7);
  });

  it('paramInt rounds down', () => {
    expect(paramInt('3.9', 0, 10, 0)).toBe(3);
    expect(paramInt('NaN', 0, 10, 2)).toBe(2);
  });

  it('ownValue ignores prototype keys', () => {
    const t = { aces: 1 };
    expect(ownValue(t, 'aces')).toBe(1);
    expect(ownValue(t, 'constructor')).toBeUndefined();
    expect(ownValue(t, '__proto__')).toBeUndefined();
  });

  it('cleanParam strips control chars and caps length', () => {
    expect(cleanParam('a\u0000b\nc')).toBe('abc');
    expect(cleanParam('x'.repeat(500))).toHaveLength(200);
  });

  it('isSafeId and escapeHtml block markup', () => {
    expect(isSafeId('skoda_rally')).toBe(true);
    expect(isSafeId('"><script>')).toBe(false);
    expect(escapeHtml('<img src=x onerror="a()">')).toBe(
      '&lt;img src=x onerror=&quot;a()&quot;&gt;',
    );
  });
});
