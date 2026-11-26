import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DESKTOP = join(fileURLToPath(new URL('..', import.meta.url)), 'apps', 'desktop')
export async function modulesOf(app, platform = 'android') {
  process.env.ORDEN_APP = app
  process.env.TAURI_ENV_PLATFORM = platform
  const { build } = await import(pathToFileURL(createRequire(join(DESKTOP, 'package.json')).resolve('vite')).href)
  const built = await build({ root: DESKTOP, logLevel: 'silent', build: { write: false } })
  const held = new Map()
  for (const output of [built].flat()) {
    for (const chunk of output.output) {
      if (chunk.type !== 'chunk') continue
      for (const [id, { renderedLength }] of Object.entries(chunk.modules)) {
        const name = /\/src\/lib\/([^/]+)\//.exec(id.replace(/\\/g, '/'))?.[1]
        if (name && renderedLength > 0) held.set(name, (held.get(name) ?? 0) + renderedLength)
      }
    }
  }
  return held
}
const AI = [
  'ai-chat',
  'ai-sidebar',
  'ai-providers',
  'agents',
  'mcp-servers',
  'agent-verbs',
  'agent-host',
  'agent-docs',
  'agent-protocol',
]
const LEFT = JSON.parse(readFileSync(join(DESKTOP, 'left-out.json'), 'utf8'))
export const KEPT_OUT = Object.fromEntries(Object.entries(LEFT).map(([app, names]) => [app, [...AI, ...names]]))
export async function check(app) {
  const kept = KEPT_OUT[app]
  if (!kept) return [`${app} has no list of modules to keep out`]
  try {
    const held = await modulesOf(app)
    return kept.filter((name) => held.has(name)).map((name) => `${app} carries ${name} (${held.get(name)} bytes)`)
  } catch (error) {
    return [`${app} does not build: ${error instanceof Error ? error.message : String(error)}`]
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, app = 'notes'] = process.argv.slice(2)
  if (mode === '--check') {
    const problems = await check(app)
    for (const problem of problems) console.error(problem)
    if (!problems.length) console.log(`${app} carries none of: ${KEPT_OUT[app].join(', ')}`)
    process.exit(problems.length ? 1 : 0)
  } else if (mode === '--list') {
    const held = await modulesOf(app)
    for (const [name, bytes] of [...held].sort((a, b) => b[1] - a[1])) console.log(`${name} ${bytes}`)
  } else {
    console.error('usage: node scripts/app-modules.mjs (--check | --list) [app]')
    process.exit(2)
  }
}
