import { beforeEach, describe, expect, test, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
})

vi.mock('./views/runner.svelte', () => ({}))

const written: string[] = []
vi.mock('./workspace/write-file', () => ({
  writeFile: async (path: string) => void written.push(path),
}))

const { hiddenKinds, KINDS_KEY, BASES_WORD, basesOn } = await import('./settings.svelte')
const { setWord, receive } = await import('./kind-choice')
const { generalPane } = await import('./settings/general-pane')
const { appCommands } = await import('./commands')
const { newFileRows } = await import('./row-menu')
const { openBaseFile } = await import('./views/open')
const { createDatabase } = await import('./views/new-database')
const { copiesToBase } = await import('./views/save')
const { workspace } = await import('./workspace.svelte')

beforeEach(() => {
  store.clear()
  written.length = 0
  hiddenKinds.restore()
  for (const tab of workspace.tabs.filter((one) => one.kind === 'view'))
    workspace.close(tab.id, false)
})

function field() {
  const found = generalPane()
    .groups.flatMap((group) => group.fields)
    .find((one) => one.key === 'general.databases')
  if (found?.kind !== 'switch') throw new Error('no switch for databases')
  return found
}

const palette = () => appCommands().some((one) => one.id === 'new-database')
const launcher = () => newFileRows().some((one) => one?.label === 'New database')
const opened = () => workspace.tabs.filter((one) => one.kind === 'view' && one.path === '/s/B.base')

describe('databases, until they are turned on', () => {
  test('are off, with no command, menu row, tab or new database of their own', async () => {
    expect(basesOn()).toBe(false)
    expect(field().get()).toBe(false)
    expect(field().initial).toBe(false)
    expect(palette()).toBe(false)
    expect(launcher()).toBe(false)
    expect(openBaseFile('/s/B.base')).toBeNull()
    expect(opened()).toEqual([])
    expect(copiesToBase()).toBe(false)
    await createDatabase('/s', 'Board')
    expect(written).toEqual([])
  })

  test('are there once Settings turns them on, kept for the next run, and gone again when off', () => {
    field().set(true)
    expect(basesOn()).toBe(true)
    expect(palette()).toBe(true)
    expect(launcher()).toBe(true)
    expect(openBaseFile('/s/B.base')?.kind).toBe('view')
    expect(opened()).toHaveLength(1)
    expect(JSON.parse(store.get(KINDS_KEY) ?? '[]')).toEqual([BASES_WORD])

    hiddenKinds.hidden = []
    hiddenKinds.restore()
    expect(basesOn()).toBe(true)

    field().set(false)
    expect(basesOn()).toBe(false)
    expect(palette()).toBe(false)
    expect(launcher()).toBe(false)
    expect(store.has(KINDS_KEY)).toBe(false)
  })

  test('follow the account, beside the other switches', () => {
    setWord('shown-pass', true)
    receive({ hiddenKinds: ['shown-pass', BASES_WORD] })
    expect(basesOn()).toBe(true)
    receive({ hiddenKinds: ['shown-pass'] })
    expect(basesOn()).toBe(false)
  })
})
