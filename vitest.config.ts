import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 120000,
    // Los cálculos usan la hora local del CD
    env: { TZ: 'America/El_Salvador' },
  },
});
