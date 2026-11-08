import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { spacetimedbModuleTestPlugin } from 'spacetimedb/server/test-utils/vitest';

export default defineConfig({
  plugins: [spacetimedbModuleTestPlugin()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'spacetimedb/src/**/*.test.ts', 'tests/**/*.test.{ts,tsx}'],
  },
});
