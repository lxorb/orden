import { beforeEach, describe, expect, test, vi } from 'vitest'

/** A note made out of words from somewhere else - an AI chat saved, a web clip, a
 *  canvas card, a kept agent session - lands in the space through `noteFrom`. In a
 *  space shared with this account to be read it must land nowhere: the copy here
 *  would stop being the space's, and the sync refuses it on every pass (B269).
 *
 *  The disk is a map, and the share is one flag the sharing module answers from. */

const files = new Map<string, string>()
const share = vi.hoisted(() => ({ readOnly: false }))

const text = (value: unknown) => (typeof value === 'string' ? value : '')

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    const path = text(args?.path)
    switch (command) {
      case 'read_note': {
        const held = files.get(path)
        if (held === undefined) throw new Error(`no such note: ${path}`)
        return held
      }
      case 'write_note':
        files.set(path, text(args?.content))
        return undefined
      case 'read_tree': {
        // As the crate does: a root that is not a folder is refused.
        const root = text(args?.root)
        if (root !== '/space') throw new Error('root is not a directory')
        const children = [...files.keys()]
          .filter((one) => one.startsWith(`${root}/`))
          .map((one) => ({
            name: one.split('/').pop() ?? one,
            path: one,
            is_dir: false,
            modified: 0,
            created: 0,
            children: [],
          }))
        return { name: 'space', path: root, is_dir: true, modified: 0, created: 0, children }
      }
      case 'file_stamp':
        return files.has(path) ? { modified: 1, len: 1 } : null
      default:
        return undefined
    }
  },
}))

vi.mock('./sharing.svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sharing.svelte')>()),
  canWriteAt: (path: string) =>
    !(share.readOnly && (path === '/space' || path.startsWith('/space/'))),
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

const { workspace } = await import('./workspace.svelte')
const { keepInNote } = await import('./agents/ui/keep')

beforeEach(() => {
  files.clear()
  files.set('/space/Beta.md', '# Beta')
  share.readOnly = false
  workspace.spaces = [{ id: 's', name: 'Notes', root: '/space' }]
  workspace.activeSpaceId = 's'
  workspace.tabs = []
})

describe('a note made from other words', () => {
  test('is written in a space that can be written in', async () => {
    const path = await workspace.noteFrom('# Plan\n\nWords.\n')

    expect(path).toBe('/space/Plan.md')
    expect(files.get('/space/Plan.md')).toBe('# Plan\n\nWords.\n')
  })

  test('is written nowhere in a space shared to be read', async () => {
    share.readOnly = true

    await expect(workspace.noteFrom('# Plan\n\nWords.\n')).resolves.toBeNull()
    await expect(workspace.noteFrom('# Plan\n', '/space')).resolves.toBeNull()
    expect([...files.keys()]).toEqual(['/space/Beta.md'])
  })

  test('a kept agent session writes nothing and opens nothing there', async () => {
    share.readOnly = true
    const open = vi.spyOn(workspace, 'open')

    await keepInNote('# Session\n\nWhat the agent did.\n')

    expect([...files.keys()]).toEqual(['/space/Beta.md'])
    expect(open).not.toHaveBeenCalled()
  })
})
