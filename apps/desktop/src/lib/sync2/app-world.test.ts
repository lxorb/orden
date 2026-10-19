import { describe, expect, test, vi } from 'vitest'

/** The disk the v2 engine is handed in the browser, which keeps no stamps:
 *  `file_stamp` answers null for every path there (web/commands.ts). Asked by a stamp
 *  alone, every file read as not there, and a note deleted on another device was
 *  never deleted in the browser. */

const notes = new Map([['/s/Plan.md', '# Plan\n']])

vi.mock('../tauri', () => ({
  isNative: false,
  isDesktop: false,
  platform: () => 'web',
  joinPath: (dir: string, name: string) => `${dir}/${name}`,
  invoke: (command: string, args?: { path?: string }) => {
    const path = args?.path ?? ''
    if (command === 'file_stamp') return Promise.resolve(null)
    if (command === 'path_exists') return Promise.resolve(notes.has(path))
    if (command === 'read_note' && notes.has(path)) return Promise.resolve(notes.get(path))
    return Promise.reject(new Error(`nothing at ${path}`))
  },
}))
vi.mock('../api', () => ({ api: {}, BASE: '' }))
vi.mock('../link-index.svelte', () => ({ links: { noteSaved: () => undefined } }))
vi.mock('../space-watch', () => ({ scanSpace: () => Promise.resolve([]) }))

const { appWorld } = await import('./app-world')

describe("the browser's disk, as the v2 engine sees it", () => {
  const telling = {} as Parameters<typeof appWorld>[1]

  test('has a note that is there, and not one that is not', async () => {
    const { disk } = appWorld(() => null, telling)

    expect(await disk.exists('/s/Plan.md')).toBe(true)
    expect(await disk.exists('/s/Gone.md')).toBe(false)
  })
})
