import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The Svelte plugin is what compiles the runes in `.svelte.ts` stores.
  plugins: [svelte()],
  // The build stamps the first in and sets the second; a test is the app rather
  // than the plugin, and the one test that wants the plugin says so for itself.
  define: { __EVEN_BUILD__: JSON.stringify('under test'), __EVEN_PLUGIN__: 'false' },
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
