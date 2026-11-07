import { describe, expect, test, vi } from 'vitest'

const written: { under: string; size: number; more: boolean }[] = []

vi.mock('../tauri', () => ({
  invoke: (command: string, args: { under: string; bytes: Uint8Array; more?: boolean }) => {
    if (command === 'explorer_write') {
      written.push({ under: args.under, size: args.bytes.length, more: args.more === true })
    }
    return Promise.resolve('')
  },
  isDesktop: false,
  joinPath: (...parts: string[]) => parts.join('/'),
  platform: () => 'linux',
}))
vi.mock('./commands', () => ({
  listFolder: (path: string) =>
    Promise.resolve({ path, parent: null, own: false, spaces: false, cut: false, entries: [] }),
}))
vi.mock('./open', () => ({ inASpace: () => false }))
vi.mock('./changes', () => ({
  carry: () => Promise.resolve(),
  changeable: () => true,
  freeName: (_taken: Set<string>, name: string) => name,
  takenNames: () => new Set(),
}))
vi.mock('../workspace.svelte', () => ({ workspace: { undone: { record: vi.fn() } } }))

const { WRITTEN_AT_ONCE, writeInto } = await import('./drag')

const view = { reload: () => Promise.resolve(), tell: vi.fn() }

describe('a file from another app dropped on a file explorer', () => {
  test('is written a piece at a time, never read whole', async () => {
    written.length = 0
    const size = WRITTEN_AT_ONCE * 2 + 5
    const file = new File([new Uint8Array(size)], 'film.mp4')
    const whole = vi.spyOn(file, 'arrayBuffer')
    await writeInto(view as never, [file], '/home/me/Videos')
    expect(whole).not.toHaveBeenCalled()
    expect(written).toEqual([
      { under: 'film.mp4', size: WRITTEN_AT_ONCE, more: false },
      { under: 'film.mp4', size: WRITTEN_AT_ONCE, more: true },
      { under: 'film.mp4', size: 5, more: true },
    ])
  })

  test('that is empty is still made, and one with no pieces is read whole', async () => {
    written.length = 0
    const bare = { name: 'note.txt', arrayBuffer: () => Promise.resolve(new ArrayBuffer(3)) }
    await writeInto(view as never, [new File([], 'empty.txt'), bare], '/home/me')
    expect(written).toEqual([
      { under: 'empty.txt', size: 0, more: false },
      { under: 'note.txt', size: 3, more: false },
    ])
  })
})
