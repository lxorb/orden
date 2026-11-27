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
import { distOf, entryOf, leftOut, ordenApp } from './app-build'

const host = process.env.TAURI_DEV_HOST
const AI_MODULES =
  /\/src\/lib\/(ai-chat|ai-sidebar|ai-providers|agents|mcp-servers|agent-verbs|agent-host|agent-docs|agent-protocol)\/src\//
const NAMES_AI = /ai-chat|ai-sidebar|ai-providers|agents|mcp-servers|agent-verbs|agent-host|agent-docs|agent-protocol/
const ABSENT = '\0orden-absent:'
const LOADED = '?loaded'
const slashed = (id: string) => id.replace(/\\/g, '/')
function without(named: RegExp, inside: RegExp, strict: boolean): Plugin {
  const left = (id: string) => inside.exec(slashed(id))?.[1]
  return {
    name: 'orden-without',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || !named.test(source) || inside.test(slashed(importer))) return null
      const found = await this.resolve(source, importer, { ...options, skipSelf: true })
      const name = found ? left(found.id) : undefined
      if (!name) return null
      return ABSENT + name + ((options as { kind?: string }).kind === 'dynamic-import' ? LOADED : '')
    },
    load: (id) => (id.startsWith(ABSENT) ? 'export {}' : null),
    generateBundle(_options, bundle) {
      if (!strict) return
      const chunks = Object.values(bundle).filter((one) => one.type === 'chunk')
      const live = (ids: readonly string[] = []) =>
        ids.filter((one) => chunks.some((held) => (held.modules[one]?.renderedLength ?? 0) > 0)).map(slashed)
      const said: string[] = []
      for (const chunk of chunks) {
        for (const [id, { renderedLength }] of Object.entries(chunk.modules)) {
          const name = id.startsWith(ABSENT) ? left(`/src/lib/${id.slice(ABSENT.length).replace(LOADED, '')}/src/`) : ''
          if (!name) continue
          const info = this.getModuleInfo(id)
          if (id.endsWith(LOADED))
            said.push(`${name} is loaded by one of\n  ${live(info?.dynamicImporters).join('\n  ')}`)
          else if (renderedLength > 0) said.push(`${name} is used by one of\n  ${live(info?.importers).join('\n  ')}`)
        }
      }
      if (said.length) this.error(`this app leaves these modules out, yet\n${said.join('\n')}`)
    },
  }
}
function releaseChannel(given: string | undefined): 'stable' | 'unstable' | null {
  if (given === 'stable' || given === 'true') return 'stable'
  return given === 'unstable' ? 'unstable' : null
}
function appVersion(): string {
  const given = process.env.ORDEN_VERSION?.trim()
  if (given) return given
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
  const app = ordenApp()
  const left = leftOut(app)
  const names = left.join('|')
  return {
    plugins: [
      svelte(),
      dirOnWords(),
      emojiOutlines(),
      ...(ai ? [] : [without(NAMES_AI, AI_MODULES, false)]),
      ...(left.length ? [without(new RegExp(names), new RegExp(`/src/lib/(${names})/src/`), true)] : []),
    ],
    define: {
      __ORDEN_BUILD__: JSON.stringify(stamp(command === 'serve')),
      __APP_VERSION__: JSON.stringify(appVersion()),
      __ORDEN_RELEASE__: JSON.stringify(releaseChannel(process.env.ORDEN_RELEASE)),
      __APP_COMMIT__: JSON.stringify(commit(command === 'serve')),
      __AI__: JSON.stringify(ai),
      __ORDEN_APP__: JSON.stringify(app),
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
      outDir: distOf(app),
      sourcemap: !!process.env.TAURI_ENV_DEBUG,
      rollupOptions: {
        shimMissingExports: !ai || left.length > 0,
        input:
          app === 'orden'
            ? {
                main: resolve(import.meta.dirname, 'index.html'),
                quickAdd: resolve(import.meta.dirname, 'quick-add.html'),
                handoff: resolve(import.meta.dirname, 'handoff.html'),
                passLink: resolve(import.meta.dirname, 'pass-link.html'),
                pass: resolve(import.meta.dirname, 'pass.html'),
              }
            : { main: resolve(import.meta.dirname, entryOf(app)) },
      },
    },
  }
})
