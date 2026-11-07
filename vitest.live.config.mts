import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Live checks against Maincloud. Not part of `npm test` (needs network).
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: { environment: 'node', include: ['live/**/*.live.ts'], testTimeout: 60_000, hookTimeout: 60_000 },
});
