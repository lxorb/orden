import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { everySurface } from '@orden/themes/write'
import { emojiOutlines } from './emoji-outlines'
import manifest from './even.app.json'
import tauri from './src-tauri/tauri.conf.json'
import { CSP } from './src/csp'

const host = process.env.TAURI_DEV_HOST

function appVersion(): string {
  try {
    const given: unknown = JSON.parse(process.env.TAURI_CONFIG ?? '{}')
    const version = (given as { version?: unknown } | null)?.version
    if (typeof version === 'string' && version.trim()) return version.trim()
  } catch {
    // Not JSON, or a path: the file's version is the one to say.
  }
  return tauri.version
}

function stamp(serving: boolean): string {
  if (serving) return `${manifest.version} dev server started ${when()}`
  return `${manifest.version} ${commit(false) || 'unknown'} ${when()}`
}

function commit(serving: boolean): string {
  if (serving) return ''
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

function when(): string {
  return `${new Date().toISOString().slice(0, 16)}Z`
}

const everyPage = {
  postcssPlugin: 'orden-every-page',
  Rule(rule: { selector: string }) {
    const wide = everySurface(rule.selector)
    if (wide !== rule.selector) rule.selector = wide
  },
}

export default defineConfig(({ command, mode }) => ({
  plugins: [svelte(), emojiOutlines()],
  define: {
    __EVEN_BUILD__: JSON.stringify(stamp(command === 'serve')),
    __EVEN_PLUGIN__: 'false',
    __APP_VERSION__: JSON.stringify(appVersion()),
    __APP_COMMIT__: JSON.stringify(commit(command === 'serve')),
    __CLAUDE_CODE__: JSON.stringify(
      !['off', '0', 'false'].includes(
        process.env.ORDEN_CLAUDE_CODE ?? process.env.NIB_CLAUDE_CODE ?? '',
      ),
    ),
    __DRIVEABLE__: JSON.stringify(
      command === 'serve' || mode === 'drive' || mode === 'development',
    ),
  },
  css: { postcss: { plugins: [everyPage] } },
  clearScreen: false,
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
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        even: resolve(import.meta.dirname, 'even.html'),
        presenter: resolve(import.meta.dirname, 'presenter.html'),
        quickAdd: resolve(import.meta.dirname, 'quick-add.html'),
        handoff: resolve(import.meta.dirname, 'handoff.html'),
        passLink: resolve(import.meta.dirname, 'pass-link.html'),
        pass: resolve(import.meta.dirname, 'pass.html'),
      },
    },
  },
}))
