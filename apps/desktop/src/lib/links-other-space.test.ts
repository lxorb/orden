import { beforeEach, expect, test, vi } from 'vitest'
import { scanNote } from './scan-note'

/** A note of one space open while another is active (B385). Tabs are shared across
 *  spaces, so `A/Note.md` stays open after switching to B. Its `[[Plan]]` is A's Plan,
 *  not B's: resolved against the active space, a link opened B's note of the same name,
 *  and one to a note only A has was drawn as a link to nothing. */

const disk = new Map<string, string>()
const sent: { command: string; path: string; folder?: unknown }[] = []
const text = (value: unknown) => (typeof value === 'string' ? value : '')

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  invoke: (command: string, args?: Record<string, unknown>) => {
    const path = text(args?.path)
    sent.push({ command, path, folder: args?.folder })
    switch (command) {
      case 'scan_links': {
        const root = `${text(args?.root)}/`
        const inside = [...disk].filter(([one]) => one.startsWith(root))
        const own = inside.map(([one, content]) => [one.slice(root.length), content] as const)
        return Promise.resolve({
          notes: own.filter(([one]) => one.endsWith('.md')).map(([one, c]) => scanNote(one, c)),
          files: own.filter(([one]) => !one.endsWith('.md')).map(([one]) => one),
        })
      }
      case 'read_note': {
        const held = disk.get(path)
        return held === undefined ? Promise.reject(new Error(`no ${path}`)) : Promise.resolve(held)
      }
      case 'save_asset':
        return Promise.resolve('../assets/clip.pdf')
      case 'file_stamp':
        return Promise.resolve(disk.has(path) ? { modified: 1, len: 1 } : null)
      default:
        return Promise.resolve(undefined)
    }
  },
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
const { links } = await import('./link-index.svelte')
const { startup } = await import('./startup.svelte')
const { notePicture } = await import('./note-images')
const { storeBeside } = await import('./assets')
const { modes } = await import('./modes.svelte')
const { assetUrl } = await import('./tauri')
void startup.shown()

const jump = (path: string | null, target: string) => ({
  path,
  target,
  heading: null,
  block: null,
  page: null,
})

beforeEach(async () => {
  disk.clear()
  disk.set('/home/me/A/Note.md', '# Note\n\n[[Plan]] and [[Only A]]\n')
  disk.set('/home/me/A/Plan.md', '# Plan of A\n')
  disk.set('/home/me/A/Only A.md', '# Only A\n')
  disk.set('/home/me/B/Plan.md', '# Plan of B\n')
  disk.set('/home/me/A/pics/photo.png', 'png')
  workspace.spaces = [
    { id: 'a', name: 'A', root: '/home/me/A' },
    { id: 'b', name: 'B', root: '/home/me/B' },
  ]
  workspace.activeSpaceId = 'b'
  workspace.tabs = []
  await links.build('/home/me/B')
  sent.length = 0
})

test("a note of another space is handed that space's notes, and its own place in it", async () => {
  await vi.waitFor(() => {
    const index = links.index('/home/me/A/Note.md')
    expect(index.path).toBe('Note.md')
    expect(index.notes.map((one) => one.path).sort()).toEqual(['Note.md', 'Only A.md', 'Plan.md'])
  })

  // The active space's own index is as it was.
  expect(links.index('/home/me/B/Plan.md').notes.map((one) => one.path)).toEqual(['Plan.md'])
})

test('a note of another space reads its embeds from that space', async () => {
  await expect(links.index('/home/me/A/Note.md').read('Plan.md')).resolves.toBe('# Plan of A\n')
})

test("a link followed from a note of another space opens that space's note", async () => {
  await workspace.open('/home/me/A/Note.md')
  sent.length = 0

  await workspace.followLink(jump('Plan.md', 'Plan'))

  expect(workspace.active?.path).toBe('/home/me/A/Plan.md')
})

test('and one to a note that is not there yet is made in that space', async () => {
  await workspace.open('/home/me/A/Note.md')
  sent.length = 0

  await workspace.followLink(jump(null, 'Ideas'))

  expect(sent.find((one) => one.command === 'write_note')?.path).toBe('/home/me/A/Ideas.md')
})

test('a picture named bare in a note of another space is found in that space', async () => {
  links.index('/home/me/A/Note.md')
  await vi.waitFor(() =>
    expect(notePicture('photo.png', '/home/me/A/Note.md', 'Note.md')).toBe(
      assetUrl('/home/me/A/pics/photo.png'),
    ),
  )
})

test("a file kept beside a note of another space goes in that space's assets folder", async () => {
  modes.attachments = 'space'
  await storeBeside(new ArrayBuffer(1), '/home/me/A/sub/Note.md', 'clip.pdf')
  expect(sent.find((one) => one.command === 'save_asset')?.folder).toBe('../assets')
})
