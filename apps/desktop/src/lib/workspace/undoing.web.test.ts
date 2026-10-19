import { beforeEach, describe, expect, test, vi } from 'vitest'

/** Undoing a delete in the browser, which keeps no stamps: `file_stamp` answers null
 *  for every path there (web/commands.ts), and an undo that asked it found every
 *  name free and wrote over the note made at the old name since. */

const files = new Map<string, string>()

vi.mock('../tauri', () => ({
  isNative: false,
  invoke: (command: string, args?: Record<string, unknown>) => {
    const path = typeof args?.path === 'string' ? args.path : ''
    if (command === 'file_stamp') return Promise.resolve(null)
    if (command === 'read_note') {
      const held = files.get(path)
      return held === undefined ? Promise.reject(new Error('no such note')) : Promise.resolve(held)
    }
    if (command === 'read_asset') return Promise.reject(new Error('no such asset'))
    if (command === 'write_note') files.set(path, String(args?.content ?? ''))
    return Promise.resolve(undefined)
  },
}))

vi.mock('../link-index.svelte', () => ({ links: { noteSaved: () => undefined } }))

const { putBack } = await import('./undoing')

beforeEach(() => files.clear())

describe('a delete undone in the browser after a note took its name', () => {
  test('puts the old note back beside the new one, which keeps its words', async () => {
    files.set('/s/Plan.md', '# Plan\nwritten today\n')

    const at = await putBack({ kind: 'delete', path: '/s/Plan.md', content: '# Plan\nold\n' })

    expect(at).toBe('/s/Plan 2.md')
    expect(files.get('/s/Plan.md')).toBe('# Plan\nwritten today\n')
    expect(files.get('/s/Plan 2.md')).toBe('# Plan\nold\n')
  })
})
