import { readBase } from '@orden/bases'
import { describe, expect, test, vi } from 'vitest'

const asked: (string | null)[] = []

vi.mock('./add', () => ({
  addNote: (_base: unknown, _at: number, file: string | null) => {
    asked.push(file)
    return Promise.resolve(null)
  },
}))

const { kitFor } = await import('./kit')

describe('a database written in a note', () => {
  test('adds its notes beside the note it sits in, not in the space root', () => {
    const base = readBase(
      'filters: file.folder == this.file.folder\nviews:\n  - type: table\n    name: T\n',
    )
    const live = { base, at: 0, view: base.views[0], writtenAt: '/s/Plans/Plans.md', fixed: false }
    const kit = kitFor(live as unknown as Parameters<typeof kitFor>[0], {}, null, true)
    kit.add()
    expect(asked).toEqual(['/s/Plans/Plans.md'])
    expect(kit.file).toBeNull()
  })

  test('of tasks offers no adding, as a note added there would never show', () => {
    const base = readBase('views:\n  - type: table\n    name: T\n    orden:\n      rows: tasks\n')
    const live = { base, at: 0, view: base.views[0], writtenAt: '/s/Plans/Plans.md', fixed: false }
    const kit = kitFor(live as unknown as Parameters<typeof kitFor>[0], {}, null, true)
    expect(kit.adds).toBe(false)
  })
})
