import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The Svelte plugin compiles the runes in `.svelte.ts`, which is where the
  // dictionaries live.
  plugins: [svelte()],
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // The pipeline under test is a DOM one at both ends: Readability walks a
    // document, and Turndown parses HTML with whatever DOM it finds around it.
    // jsdom is that DOM here, standing in for the page the content script runs
    // in, so the tests exercise the same code the extension does.
    environment: 'jsdom',
  },
})
