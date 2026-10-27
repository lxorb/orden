import { describe, expect, test, vi } from 'vitest'

/** A copied folder drawn as its note: the note inside is renamed after the copy
 *  before anything is told the folder came, so the rows hear one new folder note and
 *  no move, which a base would take for the note it was copied from (B551). */

const { told } = vi.hoisted(() => ({ told: [] as string[] }))

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  invoke: async (command: string, args: { from: string; to: string }) =>
    void told.push(`${command} ${args.from} -> ${args.to}`),
}))
vi.mock('./write-file', () => ({
  copyPath: async (from: string, to: string) => void told.push(`copy ${from} -> ${to}`),
  writeBytes: async () => undefined,
  writeFile: async () => undefined,
}))

const { copyRows } = await import('./copying')

const entry = (path: string, children: ReturnType<typeof entry>[] = []) => ({
  name: path.replace(/^.*\//, ''),
  path,
  is_dir: children.length > 0,
  modified: 0,
  created: 0,
  children,
})

describe('a copied folder note', () => {
  test('is renamed before the copy is told, and is never told as a move', async () => {
    const trip = entry('/s/Trip', [entry('/s/Trip/Trip.md')])
    const ws = {
      undone: { record: () => undefined },
      entryAt: (path: string) => (path === '/s/Trip' ? trip : null),
      showEntry: () => undefined,
      freshEntry: (path: string) => entry(path),
      freeNameOnDisk: async (_dir: string, wanted: string) =>
        wanted === 'Trip' ? 'Trip x' : wanted,
      fileMoved: async (from: string, to: string) => void told.push(`moved ${from} -> ${to}`),
      fileCame: async (path: string) => void told.push(`came ${path}`),
      pageNoteForPdf: async () => null,
    }
    await copyRows(ws as never, [{ from: '/s/Trip', into: '/s' }])

    expect(told).toEqual([
      'copy /s/Trip -> /s/Trip copy',
      'rename_note /s/Trip copy/Trip.md -> /s/Trip copy/Trip copy.md',
      'came /s/Trip copy',
    ])
  })
})
