import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { commandRowsLoaded, registerCommand, registerCommandRows } from '@orden/contracts'

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
})
const { appCommands, blockCommands, blockRows, paletteCommands, runRow } = await import('../src/api')
const HERE = join(import.meta.dirname, '..')
const SRC = join(HERE, 'src')
function sources(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|svelte)$/.test(name) && !name.includes('.test.') ? [path] : []
  })
}
const row = (id: string, label: string, run: () => void = () => undefined) => ({ id, label, run })
describe('the module stands on its own', () => {
  test('no file under src names a feature or a content module: their rows and runs are registered', () => {
    const named = sources(SRC).filter((file) =>
      /\/(?:agent-docs|agents|ai-chat|ai-providers|chats-client|dictation|export|import|pages|pass-sync|plane|scratchpad|terminal|time|views|web-tab)\/src\//.test(
        readFileSync(file, 'utf8'),
      ),
    )
    expect(named).toEqual([])
  })
})
describe('the rows', () => {
  test('a feature’s rows show once loaded, where its place is', async () => {
    expect(appCommands().some((one) => one.id === 'web-reload')).toBe(false)
    const unregister = registerCommandRows('web', () => Promise.resolve(() => [row('web-reload', 'Reload')]))
    await commandRowsLoaded()
    expect(appCommands().find((one) => one.id === 'web-reload')?.label).toBe('Reload')
    unregister()
    expect(appCommands().some((one) => one.id === 'web-reload')).toBe(false)
  })
  test('the palette folds the export formats into one row but keeps the page setup', async () => {
    const unregister = registerCommandRows('export', () =>
      Promise.resolve(() => [row('export-pdf', 'Export as PDF'), row('page-setup', 'Page setup')]),
    )
    await commandRowsLoaded()
    const ids = (rows: { id: string }[]) => rows.map((one) => one.id)
    expect(ids(appCommands())).toEqual(expect.arrayContaining(['export-pdf', 'page-setup']))
    expect(ids(paletteCommands())).toContain('page-setup')
    expect(ids(paletteCommands())).not.toContain('export-pdf')
    unregister()
  })
  test('a recorded block joins the blocks and the slash rows', async () => {
    const unregister = registerCommandRows('record', () =>
      Promise.resolve(() => [{ ...row('record', 'Record'), byHand: true }]),
    )
    await commandRowsLoaded()
    const block = blockCommands().find((one) => one.id === 'record')
    expect(block?.byHand).toBe(true)
    expect(blockRows().map((one) => one.label)).toContain('Record')
    unregister()
  })
  test('a row of a feature runs the command the feature registered', async () => {
    const ran: string[] = []
    const unregister = registerCommand('app.quick-question', () => Promise.resolve(() => void ran.push('asked')))
    expect(await runRow('quick-question')).toBe(true)
    await vi.waitFor(() => expect(ran).toEqual(['asked']))
    unregister()
    expect(await runRow('nothing-like-it')).toBe(false)
  })
})
