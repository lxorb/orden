import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The marks on a PDF, through the two commands that keep them beside it.
 *
 *  The crate answers an empty sidecar for a PDF nobody has marked, and fails the
 *  read only where there is a file it will not read: one past the size it allows,
 *  one another program holds. That file is somebody's marks, and a sheet that
 *  reads as none and may be written would put the next highlight over all of them. */

const disk = { refuse: false, written: [] as string[], slow: 0 }

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (command === 'read_highlights') {
      return disk.refuse
        ? Promise.reject(new Error('could not read the sidecar'))
        : Promise.resolve(disk.written.at(-1) ?? '')
    }
    if (command === 'write_highlights') {
      return new Promise((done) =>
        setTimeout(() => {
          disk.written.push(String(args?.content))
          done(undefined)
        }, disk.slow),
      )
    }
    return Promise.resolve(undefined)
  },
}))

const { editHighlights, loadHighlights } = await import('./sidecar')
const { readSheet } = await import('./highlights')
import type { Highlight } from './highlights'

function mark(id: string): Highlight {
  return { id, page: 1, text: id, quads: [[0, 0, 1, 0, 0, 1, 1, 1]], colour: 0, created: 1 }
}

beforeEach(() => {
  disk.refuse = false
  disk.written = []
  disk.slow = 0
})

describe('the marks on a PDF', () => {
  test('start empty and are written where there are none yet', async () => {
    const sheet = await loadHighlights('/space/paper.pdf')

    expect(sheet.highlights).toEqual([])
    expect(await editHighlights('/space/paper.pdf', (now) => now)).not.toBeNull()
    expect(disk.written).toHaveLength(1)
  })

  test('are left alone where the sidecar is there and will not read', async () => {
    disk.refuse = true

    expect(await editHighlights('/space/paper.pdf', (now) => now)).toBeNull()
    expect(disk.written).toEqual([])
  })

  test('changed at once, by the viewer and by the calls of an agent, keep every change', async () => {
    disk.slow = 20
    const adding = (id: string) =>
      editHighlights('/space/paper.pdf', (now) => ({
        ...now,
        highlights: [...now.highlights, mark(id)],
      }))
    await Promise.all([adding('a'), adding('b'), adding('c')])
    await editHighlights('/space/paper.pdf', (now) => ({
      ...now,
      highlights: now.highlights.filter((one) => one.id !== 'b'),
    }))

    const kept = readSheet(disk.written.at(-1) ?? '')
    expect(kept.highlights.map((one) => one.id)).toEqual(['a', 'c'])
  })
})
