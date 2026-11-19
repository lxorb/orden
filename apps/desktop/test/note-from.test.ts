import { beforeEach, describe, expect, test, vi } from 'vitest'
import { memoryStorage } from './disk'

const files = new Map<string, string>()
const share = vi.hoisted(() => ({ readOnly: false }))
const text = (value: unknown) => (typeof value === 'string' ? value : '')
vi.mock('../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/platform/src/tauri')>()),
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
vi.mock('../src/lib/sharing/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/sharing/src/sharing.svelte')>()),
  canWriteAt: (path: string) => !(share.readOnly && (path === '/space' || path.startsWith('/space/'))),
}))
vi.stubGlobal('localStorage', memoryStorage())
const { workspace } = await import('../src/lib/workspace/src/api')
const { keepInNote } = await import('../src/lib/agents/src/ui/keep')
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
