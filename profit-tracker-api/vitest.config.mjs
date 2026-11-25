import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/setup/tempFolder.mjs'],
    setupFiles: ['./test/setup/blockCashoutProviders.mjs'],
  },
});
