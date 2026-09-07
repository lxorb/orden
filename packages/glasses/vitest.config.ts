import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Everything under test here is pure: the layout, the greyscale mapping,
    // the ligatures and the bitmap encoding. None of it wants a DOM.
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
