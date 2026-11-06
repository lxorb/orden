import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/lib/sync2/walks/*.long.ts'],
    environment: 'node',
    testTimeout: 0,
  },
})
