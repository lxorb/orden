import { beforeEach, expect, test, vi } from 'vitest'

/** F2 on an online terminal's tab in a space shared to be read. Its name is its file's,
 *  which the space keeps, so the rename is refused; opening the name field first only
 *  lost what was typed into it. The field is not opened at all. */

const readOnly = vi.hoisted(() => new Set<string>())
vi.mock('../sharing.svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sharing.svelte')>()),
  canWriteAt: (path: string) =>
    ![...readOnly].some((root) => path === root || path.startsWith(`${root}/`)),
}))

function memoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}
vi.stubGlobal('localStorage', memoryStorage())

const { workspace } = await import('../workspace.svelte')
const { NoteDoc, Tab } = await import('../workspace/documents.svelte')
const { renameFromTab } = await import('./ops')

function terminalAt(path: string) {
  const note = new NoteDoc(
    { kind: 'terminal', path, name: 'Shell.term', text: '', dirty: false },
    () => undefined,
  )
  const tab = new Tab(note, 'pane')
  workspace.tabs = [tab]
  return tab
}

beforeEach(() => {
  readOnly.clear()
  workspace.spaces = [{ id: 'theirs', name: 'Theirs', root: '/theirs' }]
  workspace.activeSpaceId = 'theirs'
})

test('an online terminal in a space shared to be read opens no name field', () => {
  readOnly.add('/theirs')
  const tab = terminalAt('/theirs/Shell.term')

  renameFromTab(tab.id)

  expect(tab.naming).toBe(false)
})

test('one in a space that may be written in does', () => {
  const tab = terminalAt('/theirs/Shell.term')

  renameFromTab(tab.id)

  expect(tab.naming).toBe(true)
})
