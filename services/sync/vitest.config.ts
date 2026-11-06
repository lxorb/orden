import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: { __TESTING__: 'true' },
  test: {
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
