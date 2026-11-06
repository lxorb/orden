import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.long.ts'],
    environment: 'node',
    testTimeout: 0,
  },
})
