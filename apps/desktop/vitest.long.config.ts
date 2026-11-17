import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/lib/sync-client/test/walks/*.long.ts'],
    environment: 'node',
    setupFiles: ['src/lib/backend-ports.ts'],
    testTimeout: 0,
  },
})
