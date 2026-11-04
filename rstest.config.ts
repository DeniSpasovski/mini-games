import { withRsbuildConfig } from '@rstest/adapter-rsbuild';
import { defineConfig } from '@rstest/core';

// Docs: https://rstest.rs/config/
export default defineConfig({
  extends: withRsbuildConfig(),
  setupFiles: ['./tests/rstest.setup.ts'],
  // session worktrees hold whole repo copies; a path filter like `tests/rally` would match theirs too.
  // A CLI --exclude replaces this list, so the package.json scripts that pass one repeat '.claude/**'.
  exclude: ['.claude/**'],
});
