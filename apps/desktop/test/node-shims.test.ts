import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, vi } from 'vitest'

vi.mock('node:path', async (original) => {
  const path = await original<typeof import('node:path')>()
  return { ...path, resolve: path.win32.resolve }
})

const { shimPath, whatsappShims } = await import('../node-shims.config')

type Resolve = (source: string, importer: string) => string | null
type Transform = (code: string, id: string) => { code: string } | null

const BAILEYS = 'C:\\orden\\node_modules\\@whiskeysockets\\baileys\\lib\\Socket\\socket.js'

test('on Windows every shim has the one id the app imports it by, so no module is bundled twice', () => {
  const plugin = whatsappShims()
  const resolveId = plugin.resolveId as unknown as Resolve
  const transform = plugin.transform as unknown as Transform
  for (const source of ['ws', 'node:crypto', 'events', 'buffer', 'stream', 'pino', 'axios']) {
    const id = resolveId(source, BAILEYS)
    expect(id).not.toBeNull()
    expect(id).not.toContain('\\')
  }
  expect(resolveId('ws', BAILEYS)).toBe(shimPath('ws.ts'))
  const changed = transform(
    'const a = Buffer.from(process.env.X ?? "")\nmodule.exports = a',
    BAILEYS,
  )
  expect(changed?.code).toContain(JSON.stringify(shimPath('buffer.ts')))
  expect(changed?.code).toContain(JSON.stringify(shimPath('process.ts')))
  expect(changed?.code.split('\n').slice(0, 2).join('\n')).not.toContain('\\')
})

test('no shim pulls in the app, so prebundling the WhatsApp packages never bundles app code', () => {
  const folder = join(import.meta.dirname, '../src/lib/chats/providers/node')
  const reaching = readdirSync(folder)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .flatMap((name) =>
      readFileSync(join(folder, name), 'utf8')
        .split('\n')
        .filter((line) => /^import (?!type\b).*from '\.\.\//.test(line))
        .map((line) => `${name}: ${line}`),
    )
  expect(reaching).toEqual([])
})
