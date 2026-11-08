import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// The demo seed script (npm run seed:demo). Talks to the real database, so it is not part of
// `npm test` or `npm run test:live`. Output goes straight to the terminal while it runs.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['live/seed/**/*.seed.ts'],
    testTimeout: 60 * 60_000,
    hookTimeout: 60_000,
    disableConsoleIntercept: true,
  },
});
