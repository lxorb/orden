import { beforeEach, expect, test, vi } from 'vitest'
import { scanNote } from './scan-note'

/** Links that follow a note renamed or moved in a space that is not the open one
 *  (B405). A rename in A undone after switching to B puts the file back, and the
 *  links that followed it have to be put back as well: rewritten against the open
 *  space, nothing was, and A's notes kept pointing at a name nothing answered to. */

const disk = vi.hoisted(() => ({ current: null as import('../../test/disk').Disk | null }))

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (!disk.current) throw new Error('no disk')
    if (command === 'scan_links') {
      const root = `${String(args?.root)}/`
      const own = [...disk.current.files]
        .filter(([path]) => path.startsWith(root))
        .map(([path, content]) => [path.slice(root.length), content] as const)
      return Promise.resolve({
        notes: own.filter(([path]) => path.endsWith('.md')).map(([p, c]) => scanNote(p, c)),
        files: own.filter(([path]) => !path.endsWith('.md')).map(([path]) => path),
      })
    }
    return disk.current.invoke(command, args)
  },
}))

const { Disk, memoryStorage } = await import('../../test/disk')
disk.current = new Disk()
vi.stubGlobal('localStorage', memoryStorage())
const { workspace } = await import('./workspace.svelte')
const { links } = await import('./link-index.svelte')
const { startup } = await import('./startup.svelte')
void startup.shown()

const files = () => disk.current?.files ?? new Map<string, string>()

beforeEach(async () => {
  files().clear()
  files().set('/A/Plan.md', '# Plan\n')
  files().set('/A/Note.md', 'see [[Plan]]\n')
  files().set('/B/Other.md', '# Other\n')
  workspace.spaces = [
    { id: 'a', name: 'A', root: '/A' },
    { id: 'b', name: 'B', root: '/B' },
  ]
  workspace.activeSpaceId = 'a'
  workspace.tabs = []
  workspace.undone.stack = []
  workspace.undone.ahead = []
  await links.build('/A')
  await workspace.loadTree()
})

test('a rename undone from another space puts the links back too', async () => {
  await workspace.rename('/A/Plan.md', 'Roadmap.md')
  expect(files().get('/A/Note.md')).toBe('see [[Roadmap]]\n')

  await workspace.selectSpace('b')
  await links.scanned()
  await workspace.undoFileAction()

  expect(files().has('/A/Plan.md')).toBe(true)
  expect(files().get('/A/Note.md')).toBe('see [[Plan]]\n')
})

test('and done again from there, they follow it again', async () => {
  await workspace.rename('/A/Plan.md', 'Roadmap.md')
  await workspace.selectSpace('b')
  await links.scanned()
  await workspace.undoFileAction()
  await workspace.redoFileAction()

  expect(files().has('/A/Roadmap.md')).toBe(true)
  expect(files().get('/A/Note.md')).toBe('see [[Roadmap]]\n')
})

test('a note of another space renamed while this one is open takes its links along', async () => {
  workspace.activeSpaceId = 'b'
  await links.build('/B')
  await workspace.loadTree()

  await workspace.rename('/A/Plan.md', 'Roadmap.md')

  expect(files().get('/A/Note.md')).toBe('see [[Roadmap]]\n')
})
