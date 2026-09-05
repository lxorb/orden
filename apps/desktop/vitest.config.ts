import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The Svelte plugin is what compiles the runes in `.svelte.ts` stores.
  plugins: [svelte()],
  test: {
    // Vitest skips CSS by default, which makes the `?raw` imports the export
    // bakes into a document come back empty - the very thing under test.
    css: true,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    // The sync tests rebuild the whole store graph in `beforeEach`, and the
    // first one of them pays for compiling it. Ten seconds is close enough to
    // that on a cold cache to fail for no reason.
    hookTimeout: 30000,
  },
})
