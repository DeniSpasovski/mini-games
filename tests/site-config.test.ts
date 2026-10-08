import { expect, test } from '@rstest/core';
import { isAllowedHost, isDevLanHost } from '../src/site.config';

test('host guard allows deni.io, the GitHub Pages host + localhost only', () => {
  for (const h of [
    'deni.io',
    'www.deni.io',
    'games.deni.io',
    'denispasovski.github.io',
    'localhost',
    '127.0.0.1',
    'LOCALHOST',
  ])
    expect(isAllowedHost(h)).toBe(true);
  for (const h of [
    'evil.com',
    'deni.io.evil.com',
    'notdeni.io',
    'example.org',
    'github.io',
    'other.github.io',
  ])
    expect(isAllowedHost(h)).toBe(false);
});

test('dev LAN hosts are private ranges only (never allowed by isAllowedHost)', () => {
  for (const h of [
    '192.168.1.20',
    '10.0.0.5',
    '172.16.4.2',
    '172.31.255.1',
    'ipad.local',
  ])
    expect(isDevLanHost(h)).toBe(true);
  for (const h of [
    '8.8.8.8',
    '172.32.0.1',
    '192.169.1.1',
    'evil.com',
    '11.0.0.1',
  ])
    expect(isDevLanHost(h)).toBe(false);
  expect(isAllowedHost('192.168.1.20')).toBe(false);
});
