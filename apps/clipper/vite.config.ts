import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { manifest } from './src/manifest'

/** The manifest is TypeScript so the permissions can carry their reasons; this
 *  drops the JSON Chrome actually reads beside the bundles. */
function writeManifest(): Plugin {
  return {
    name: 'nib-manifest',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: `${JSON.stringify(manifest, null, 2)}\n`,
      })
    },
  }
}

/** The two pages and the service worker. Chrome loads all three as modules, so
 *  they can share chunks; the content script cannot, and is built next door in
 *  `vite.content.config.ts`.
 *
 *  Names are flat and unhashed because the manifest names them: a hash would
 *  mean rewriting the manifest on every build for nothing. */
export default defineConfig({
  plugins: [svelte(), writeManifest()],
  build: {
    target: 'esnext',
    outDir: 'dist',
    emptyOutDir: true,
    // Nothing here is served over a network, so a byte saved is not a
    // millisecond saved, and a readable bundle is worth more when Chrome shows
    // a stack trace from a service worker.
    minify: false,
    rollupOptions: {
      input: {
        popup: resolve(import.meta.dirname, 'popup.html'),
        options: resolve(import.meta.dirname, 'options.html'),
        background: resolve(import.meta.dirname, 'src/background/index.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        // What two entries have in common is nobody's module in particular, so
        // it is named for what it is rather than for whichever file it was cut
        // from.
        chunkFileNames: 'chunks/shared-[hash].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})
