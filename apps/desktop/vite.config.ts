import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import manifest from './even.app.json'

const host = process.env.TAURI_DEV_HOST

/** Which code this is, in one line, baked in where a screenshot can read it.
 *
 *  A build installed on a phone has no other way of saying which build it is,
 *  and "did the new one actually reach the device" is the first question when
 *  nothing appears to have changed. */
function stamp(): string {
  let sha = 'unknown'
  try {
    sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    // A tree with no git in it still builds; it just cannot say which commit.
  }

  return `${manifest.version} ${sha} ${new Date().toISOString().slice(0, 16)}Z`
}

export default defineConfig({
  plugins: [svelte()],
  define: { __EVEN_BUILD__: JSON.stringify(stamp()) },
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
