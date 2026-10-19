import { beforeEach, describe, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({
  native: true,
  answers: new Map<string, unknown>(),
}))

vi.mock('./tauri', () => ({
  get isNative() {
    return state.native
  },
  invoke: (command: string, args?: { path?: string }) => {
    const key = `${command} ${args?.path ?? ''}`
    return state.answers.has(key)
      ? Promise.resolve(state.answers.get(key))
      : Promise.reject(new Error(`nothing at ${key}`))
  },
}))

const { onDisk } = await import('./on-disk')

beforeEach(() => state.answers.clear())

describe('a file on the disk', () => {
  test('on the desktop, is what the crate stamps', async () => {
    state.native = true
    state.answers.set('file_stamp /s/a.md', { modified: 1, len: 1 })
    state.answers.set('file_stamp /s/b.md', null)

    expect(await onDisk('/s/a.md')).toBe(true)
    expect(await onDisk('/s/b.md')).toBe(false)
  })

  // The browser answers null to every stamp, and an undo that asked it found every
  // name free and wrote over the note there.
  test('in the browser, is a note that reads or a picture whose bytes do', async () => {
    state.native = false
    state.answers.set('file_stamp /s/a.md', null)
    state.answers.set('read_note /s/a.md', '# a\n')
    state.answers.set('read_asset /s/shot.png', 'AAAA')

    expect(await onDisk('/s/a.md')).toBe(true)
    expect(await onDisk('/s/shot.png')).toBe(true)
    expect(await onDisk('/s/gone.md')).toBe(false)
  })
})
