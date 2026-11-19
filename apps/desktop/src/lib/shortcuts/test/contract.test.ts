import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { registerCommand } from '@orden/contracts'

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
})
const { BY_ID, CATEGORIES, runEntry, SHORTCUTS, shortcuts } = await import('../src/api')
const HERE = join(import.meta.dirname, '..')
const SRC = join(HERE, 'src')
function sources(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|svelte)$/.test(name) && !name.includes('.test.') ? [path] : []
  })
}
describe('the module stands on its own', () => {
  test('no file under src names a feature or the tab strip: their shortcuts run as registered commands', () => {
    const named = sources(SRC).filter((file) =>
      /\/(?:web-tab|ai-chat|scratchpad|time|agents|explorer|pass-sync|tab-strip)\/src\//.test(
        readFileSync(file, 'utf8'),
      ),
    )
    expect(named).toEqual([])
  })
})
describe('the shortcuts', () => {
  test('each has its own id and a category the list names', () => {
    const ids = SHORTCUTS.map((one) => one.id)
    expect(new Set(ids).size).toBe(ids.length)
    const named = new Set(CATEGORIES.map((one) => one.id))
    expect(SHORTCUTS.filter((one) => !named.has(one.category)).map((one) => one.id)).toEqual([])
    expect(BY_ID.get('app.close')?.key).toBe('Mod-w')
  })
  test('run a feature through the command it registered', async () => {
    const ran: string[] = []
    const unregister = registerCommand('app.scratchpad', () => Promise.resolve(() => void ran.push('scratchpad')))
    const context = { palette: () => undefined, fullscreen: () => undefined }
    expect(runEntry('app.scratchpad', context)).toBe(true)
    await vi.waitFor(() => expect(ran).toEqual(['scratchpad']))
    unregister()
  })
  test('say the key a shortcut is bound to', () => {
    expect(shortcuts.keyFor('app.close')).toBe('Mod-w')
  })
})
