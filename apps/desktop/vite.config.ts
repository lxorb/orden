import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { everySurface } from '@orden/themes/write'
import { emojiOutlines } from './emoji-outlines'
import { dirOnWords } from './svelte-dir'
import tauri from './src-tauri/tauri.conf.json'
import { CSP } from './src/csp'
import { carriesAi } from './ai-build'

const host = process.env.TAURI_DEV_HOST
const AI_MODULES =
  /\/src\/lib\/(?:ai-chat|ai-sidebar|ai-providers|agents|mcp-servers|agent-verbs|agent-host|agent-docs|agent-protocol)\/src\//
const NAMES_AI = /ai-chat|ai-sidebar|ai-providers|agents|mcp-servers|agent-verbs|agent-host|agent-docs|agent-protocol/
const WITHOUT_AI = '\0orden-without-ai'
function withoutAi(): Plugin {
  const slashed = (id: string) => id.replace(/\\/g, '/')
  return {
    name: 'orden-without-ai',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || !NAMES_AI.test(source) || AI_MODULES.test(slashed(importer))) return null
      const found = await this.resolve(source, importer, { ...options, skipSelf: true })
      return found && AI_MODULES.test(slashed(found.id)) ? WITHOUT_AI : null
    },
    load: (id) => (id === WITHOUT_AI ? 'export {}' : null),
  }
}
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
  if (serving) return `${appVersion()} dev server started ${when()}`
  return `${appVersion()} ${commit(false) || 'unknown'} ${when()}`
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
export default defineConfig(({ command, mode }) => {
  const ai = carriesAi(mode)
  return {
    plugins: [svelte(), dirOnWords(), emojiOutlines(), ...(ai ? [] : [withoutAi()])],
    define: {
      __ORDEN_BUILD__: JSON.stringify(stamp(command === 'serve')),
      __APP_VERSION__: JSON.stringify(appVersion()),
      __APP_COMMIT__: JSON.stringify(commit(command === 'serve')),
      __AI__: JSON.stringify(ai),
      __CLAUDE_CODE__: JSON.stringify(!['off', '0', 'false'].includes(process.env.ORDEN_CLAUDE_CODE ?? '')),
      __DRIVEABLE__: JSON.stringify(command === 'serve' || mode === 'drive' || mode === 'development'),
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
        shimMissingExports: !ai,
        input: {
          main: resolve(import.meta.dirname, 'index.html'),
          quickAdd: resolve(import.meta.dirname, 'quick-add.html'),
          handoff: resolve(import.meta.dirname, 'handoff.html'),
          passLink: resolve(import.meta.dirname, 'pass-link.html'),
          pass: resolve(import.meta.dirname, 'pass.html'),
        },
      },
    },
  }
})
