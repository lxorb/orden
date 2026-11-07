import { beforeEach, expect, test, vi } from 'vitest'

const disk = vi.hoisted(() => ({ native: false, files: new Set<string>() }))

vi.mock('./tauri', async (original) => ({
  ...(await original<typeof import('./tauri')>()),
  get isNative() {
    return disk.native
  },
  invoke: (command: string, args: { path?: string } = {}) => {
    const there = args.path !== undefined && disk.files.has(args.path)
    if (command === 'file_stamp')
      return Promise.resolve(disk.native && there ? { modified: 1, len: 4 } : null)
    if (command === 'path_exists') return Promise.resolve(there)
    if (command === 'read_tree') return Promise.reject(new Error('no folder'))
    return Promise.resolve(null)
  },
}))

vi.mock('./surfaces.svelte', () => ({ undoToastNotice: { ask: () => Promise.resolve() } }))

const { unread } = await import('./unread.svelte')

beforeEach(() => {
  unread.dismiss()
  disk.files = new Set(['/space/Broken.pdf'])
})

test('a file that is there and would not read is said so in the browser too', async () => {
  disk.native = false
  expect(await unread.there('/space/Broken.pdf')).toBe(true)
  expect(unread.shown).toBe(true)
})

test('and in the app', async () => {
  disk.native = true
  expect(await unread.there('/space/Broken.pdf')).toBe(true)
  expect(unread.shown).toBe(true)
})

test('a file that is not there at all is not said to be unreadable', async () => {
  disk.native = false
  expect(await unread.there('/space/Gone.pdf')).toBe(false)
  expect(unread.shown).toBe(false)
})
