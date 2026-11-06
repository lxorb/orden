import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.drive.ts'],
    environment: 'node',
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
})
