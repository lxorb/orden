import { beforeEach, describe, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({
  native: true,
  answers: new Map<string, unknown>(),
}))

vi.mock('./tauri', () => ({
  get isNative() {
    return state.native
  },
  invoke: (command: string, args?: { path?: string; root?: string }) => {
    const key = `${command} ${args?.path ?? args?.root ?? ''}`
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

  // The crate stamps no folder, so sync v2 on a desktop never removed a folder
  // deleted on another device, forgot the notes in it, and sent them up again.
  test('on the desktop, is a folder the tree reads', async () => {
    state.native = true
    state.answers.set('file_stamp /s/Work', null)
    state.answers.set('read_tree /s/Work', { is_dir: true, children: [] })
    // Only a folder's own listing says so; an answer of nothing is no folder.
    state.answers.set('read_tree /s/Odd', undefined)

    expect(await onDisk('/s/Work')).toBe(true)
    expect(await onDisk('/s/Odd')).toBe(false)
    expect(await onDisk('/s/Gone')).toBe(false)
  })

  // The browser answers null to every stamp, and an undo that asked it found every
  // name free and wrote over the note there; nothing read at a folder's own path.
  test('in the browser, is what the listing holds, folders and pictures too', async () => {
    state.native = false
    state.answers.set('file_stamp /s/a.md', null)
    state.answers.set('path_exists /s/a.md', true)
    state.answers.set('path_exists /s/Work', true)
    state.answers.set('path_exists /s/gone.md', false)

    expect(await onDisk('/s/a.md')).toBe(true)
    expect(await onDisk('/s/Work')).toBe(true)
    expect(await onDisk('/s/gone.md')).toBe(false)
    expect(await onDisk('/s/unasked.md')).toBe(false)
  })
})
