import { describe, expect, test, vi } from 'vitest'
import type { Entry } from '../workspace.svelte'

/** What a copy tells, and what it writes into the copy, before anything hears it came.
 *
 *  A copied folder drawn as its note: the note inside is renamed after the copy before
 *  the folder is told, so the rows hear one new folder note and no move, which a base
 *  would take for the note it was copied from (B551). A copied note in a base that
 *  numbers its rows comes without the original's id, so the runner gives it the next and
 *  the original keeps its own: no order of paths tells a copy from its original (B552). */

const { told, disk } = vi.hoisted(() => ({
  told: [] as string[],
  disk: new Map<string, string>(),
}))

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  invoke: async (
    command: string,
    args: { from: string; to: string; path: string; content: string },
  ) => {
    if (command === 'read_note') return disk.get(args.path) ?? null
    if (command === 'write_note') {
      disk.set(args.path, args.content)
      return void told.push(`write ${args.path}`)
    }
    told.push(`${command} ${args.from} -> ${args.to}`)
  },
}))
vi.mock('./write-file', () => ({
  copyPath: async (from: string, to: string) => {
    for (const [path, text] of [...disk]) {
      if (path === from || path.startsWith(`${from}/`)) disk.set(to + path.slice(from.length), text)
    }
    told.push(`copy ${from} -> ${to}`)
  },
  writeBytes: async () => undefined,
  writeFile: async () => undefined,
}))
vi.mock('../views/copied', () => ({
  // The runner's own rule, for a space whose bases number by `id: BUG-`.
  withoutIds: (path: string, text: string) =>
    path.startsWith('/s/Bugs/') && /^id: BUG-/m.test(text) ? text.replace(/^id: .*\n/m, '') : null,
}))

const { copyRows } = await import('./copying')

const entry = (path: string, children: Entry[] = []): Entry => ({
  name: path.replace(/^.*\//, ''),
  path,
  is_dir: children.length > 0,
  modified: 0,
  created: 0,
  children,
})

function rig(entries: Entry[]) {
  told.length = 0
  return {
    undone: { record: () => undefined },
    entryAt: (path: string) => entries.find((one) => one.path === path) ?? null,
    showEntry: () => undefined,
    freshEntry: (path: string) => entry(path),
    // Taken where the copy goes beside what it copies.
    freeNameOnDisk: async (_dir: string, wanted: string) => (wanted === 'Trip' ? 'Trip x' : wanted),
    fileMoved: async (from: string, to: string) => void told.push(`moved ${from} -> ${to}`),
    fileCame: async (path: string) => void told.push(`came ${path}`),
    pageNoteForPdf: async () => null,
  }
}

describe('a copied folder note', () => {
  test('is renamed before the copy is told, and is never told as a move', async () => {
    disk.clear()
    disk.set('/s/Trip/Trip.md', '# Trip\n')
    const ws = rig([entry('/s/Trip', [entry('/s/Trip/Trip.md')])])
    await copyRows(ws as never, [{ from: '/s/Trip', into: '/s' }])

    expect(told).toEqual([
      'copy /s/Trip -> /s/Trip copy',
      'rename_note /s/Trip copy/Trip.md -> /s/Trip copy/Trip copy.md',
      'came /s/Trip copy',
    ])
  })
})

describe('a copied note in a base that numbers its rows', () => {
  test('comes without the id, so the original keeps it', async () => {
    disk.clear()
    disk.set('/s/Bugs/A.md', '---\nid: BUG-2\nstatus: Doing\n---\nText\n')
    const ws = rig([entry('/s/Bugs/A.md')])
    await copyRows(ws as never, [{ from: '/s/Bugs/A.md', into: '/s/Bugs/2025' }])

    expect(told).toEqual([
      'copy /s/Bugs/A.md -> /s/Bugs/2025/A.md',
      'write /s/Bugs/2025/A.md',
      'came /s/Bugs/2025/A.md',
    ])
    expect(disk.get('/s/Bugs/2025/A.md')).toBe('---\nstatus: Doing\n---\nText\n')
    expect(disk.get('/s/Bugs/A.md')).toContain('id: BUG-2')
  })

  test('and every note of a copied folder does too', async () => {
    disk.clear()
    disk.set('/s/Bugs/Sprint/X.md', '---\nid: BUG-3\n---\n')
    disk.set('/s/Bugs/Sprint/Deep/Y.md', '---\nid: BUG-4\n---\n')
    const ws = rig([
      entry('/s/Bugs/Sprint', [
        entry('/s/Bugs/Sprint/X.md'),
        entry('/s/Bugs/Sprint/Deep', [entry('/s/Bugs/Sprint/Deep/Y.md')]),
      ]),
    ])
    await copyRows(ws as never, [{ from: '/s/Bugs/Sprint', into: '/s/Bugs/2025' }])

    expect(disk.get('/s/Bugs/2025/Sprint/X.md')).not.toContain('BUG')
    expect(disk.get('/s/Bugs/2025/Sprint/Deep/Y.md')).not.toContain('BUG')
    expect(told.at(-1)).toBe('came /s/Bugs/2025/Sprint')
  })
})
