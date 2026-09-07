import { resolve } from 'node:path'
import { defineConfig } from 'vite'

/** The content script, on its own.
 *
 *  Chrome runs a content script as a classic script in the page's world: no
 *  imports, no module scope. So it is one self-contained file, built after the
 *  rest and into the same folder without clearing it. */
export default defineConfig({
  publicDir: false,
  build: {
    target: 'esnext',
    outDir: 'dist',
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/content/index.ts'),
      formats: ['iife'],
      name: 'nibClipper',
      fileName: () => 'content.js',
    },
  },
})
