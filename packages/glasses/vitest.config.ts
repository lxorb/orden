import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Everything under test here is pure: what the firmware can draw, how wide
    // it draws it, a note as marked lines, and those lines as pages. None of it
    // wants a DOM.
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
