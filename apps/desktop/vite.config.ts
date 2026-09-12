import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import manifest from './even.app.json'
import { CSP } from './src/csp'

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
  // This build is the editor: on the desktop, on the web, in the presenter's
  // window, and on the `/even/` page the web serves. The package that goes on a
  // phone is built by `vite.even.config.ts`, which sets the second of these true
  // and leaves out what a pair of glasses cannot use.
  define: { __EVEN_BUILD__: JSON.stringify(stamp()), __EVEN_PLUGIN__: 'false' },
  clearScreen: false,
  // The same policy the installed app is served with. `tauri dev` loads the dev
  // server rather than the bundle, so without this the app being worked on is a
  // looser app than the one that ships - and a policy nobody develops under is a
  // policy that breaks on the day it is turned on. The header as well as the meta
  // in index.html, because only a header carries `frame-ancestors`. See src/csp.ts.
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
    headers: { 'Content-Security-Policy': CSP },
  },
  preview: {
    headers: { 'Content-Security-Policy': CSP },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: 'esnext',
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    // Three pages out of one bundle: the editor, the window a presenter reads
    // their notes in, and the plugin's page as the web serves it at `/even/`. The
    // presenter's window carries none of the app; see docs/slides.md.
    //
    // `even.html` is here so that opening `/even/` in a phone's browser reaches a
    // page with the bridge in it, which is how the glasses are tried without
    // packing anything. It is *not* what goes on a phone: the package is built by
    // `vite.even.config.ts`, which leaves out what a pair of glasses cannot use,
    // and the browser drive runs that build rather than this page. One bundle
    // cannot leave something out of one of its entries, which is why there are two
    // builds at all. See docs/even.md.
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        even: resolve(import.meta.dirname, 'even.html'),
        presenter: resolve(import.meta.dirname, 'presenter.html'),
      },
    },
  },
})
