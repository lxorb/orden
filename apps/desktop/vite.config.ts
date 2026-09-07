import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: 'esnext',
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    // Two pages out of one bundle: the editor, and the Even Realities plugin.
    // The plugin is the same app plus the bridge in `src/lib/even`, so almost
    // all of the output is shared; see docs/even.md.
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        even: resolve(import.meta.dirname, 'even.html'),
      },
    },
  },
})
