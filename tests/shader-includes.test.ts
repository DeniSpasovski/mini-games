import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@rstest/core';
import { ShaderChunk } from 'three';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(path);
    return e.name.endsWith('.ts') ? [path] : [];
  });
}

// three removes and renames shader chunks between releases; a missing one only throws when that material first compiles
test('every #include <chunk> in a shader string is a chunk three ships', () => {
  const missing: string[] = [];
  let count = 0;
  for (const file of sourceFiles('src')) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/#include\s*<([A-Za-z0-9_]+)>/g)) {
      count++;
      if (!(m[1] in ShaderChunk) && !text.includes(`ShaderChunk.${m[1]}`))
        missing.push(`${file}: ${m[1]}`);
    }
  }
  expect(count).toBeGreaterThan(0);
  expect(missing).toEqual([]);
});
