import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { carriesAi } from '../ai-build'

const app = resolve(import.meta.dirname, '..')
const built = mkdtempSync(join(tmpdir(), 'orden-web-'))
const AI = /\/src\/lib\/(?:ai-chat|ai-sidebar|ai-providers|agents|mcp-servers)\/src\//
const WAYS_IN = [
  'ai_thread_write',
  'ai_accounts_read',
  'ai_cli_ask',
  'ai_agent_call',
  'chatgpt_sign_in',
  'anthropic-dangerous-direct-browser-access',
  'Connect an LLM to your notes',
  'LLM access',
  'Do with AI',
  'AI block',
  'Chat priorities',
  'Draft replies',
  'Add an AI provider',
]
let code: string[] = []
let sources: string[] = []
beforeAll(() => {
  execFileSync('pnpm', ['exec', 'vite', 'build', '--mode', 'web', '--sourcemap', '--outDir', built, '--emptyOutDir'], {
    cwd: app,
    stdio: 'pipe',
    shell: process.platform === 'win32',
    env: { ...process.env, NODE_ENV: 'production', TAURI_ENV_PLATFORM: '' },
  })
  const assets = join(built, 'assets')
  const names = readdirSync(assets)
  code = names.filter((one) => one.endsWith('.js')).map((one) => readFileSync(join(assets, one), 'utf8'))
  sources = names
    .filter((one) => one.endsWith('.js.map'))
    .flatMap((one) => (JSON.parse(readFileSync(join(assets, one), 'utf8')) as { sources: string[] }).sources)
}, 300_000)
afterAll(() => {
  rmSync(built, { recursive: true, force: true })
})
describe('AI on the desktop only', () => {
  test('the web and both phones build without it, every desktop with it', () => {
    expect(carriesAi('web', '')).toBe(false)
    expect(carriesAi('production', 'android')).toBe(false)
    expect(carriesAi('production', 'ios')).toBe(false)
    for (const desktop of ['windows', 'macos', 'darwin', 'linux', ''])
      expect(carriesAi('production', desktop)).toBe(true)
  })
  test('the web build carries no module of the AI', () => {
    expect(sources.length).toBeGreaterThan(100)
    expect(sources.filter((one) => AI.test(one.replace(/\\/g, '/')))).toEqual([])
  })
  test('and no way into it', () => {
    expect(code.length).toBeGreaterThan(100)
    expect(WAYS_IN.filter((word) => code.some((one) => one.includes(word)))).toEqual([])
  })
})
