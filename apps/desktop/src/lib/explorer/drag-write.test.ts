import { describe, expect, test, vi } from 'vitest'

const written: { under: string; size: number; more: boolean; fresh?: boolean }[] = []
let refused = ''

vi.mock('../tauri', () => ({
  invoke: (
    command: string,
    args: { under: string; bytes: Uint8Array; more?: boolean; fresh?: boolean },
  ) => {
    if (command === 'explorer_write') {
      if (args.under.startsWith(refused) && refused) return Promise.reject(new Error('it is there'))
      written.push({
        under: args.under,
        size: args.bytes.length,
        more: args.more === true,
        ...(args.fresh ? { fresh: true } : {}),
      })
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
const record = vi.fn()
vi.mock('../workspace.svelte', () => ({ workspace: { undone: { record } } }))

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
      { under: 'film.mp4', size: WRITTEN_AT_ONCE, more: false, fresh: true },
      { under: 'film.mp4', size: WRITTEN_AT_ONCE, more: true },
      { under: 'film.mp4', size: 5, more: true },
    ])
  })

  test('that is empty is still made, and one with no pieces is read whole', async () => {
    written.length = 0
    const bare = { name: 'note.txt', arrayBuffer: () => Promise.resolve(new ArrayBuffer(3)) }
    await writeInto(view as never, [new File([], 'empty.txt'), bare], '/home/me')
    expect(written).toEqual([
      { under: 'empty.txt', size: 0, more: false, fresh: true },
      { under: 'note.txt', size: 3, more: false, fresh: true },
    ])
  })

  test('takes back with an undo only what it made, never a folder that was already there', async () => {
    written.length = 0
    record.mockClear()
    refused = 'Photos/'
    const picture = {
      name: 'a.png',
      webkitRelativePath: 'Photos/a.png',
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(2)),
    }
    await writeInto(view as never, [picture, new File([], 'b.txt')], '/home/me')
    refused = ''
    expect(written).toEqual([])
    expect(record).not.toHaveBeenCalled()
    expect(view.tell).toHaveBeenCalled()
  })
})
