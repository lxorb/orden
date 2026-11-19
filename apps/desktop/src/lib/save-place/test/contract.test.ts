import { describe, expect, test, vi } from 'vitest'

const wrote = vi.hoisted(() => ({ times: 0 }))

vi.mock('../../workspace/src/api', () => ({
  workspace: {
    active: null,
    writeNow: () => {
      wrote.times++
      return Promise.resolve()
    },
  },
}))

const { saveFront } = await import('../src/api')
const { placesFor } = await import('../src/places')

type Entry = NonNullable<Parameters<typeof placesFor>[0]>

test('saving the tab in front writes what is open when no tab waits for a place', () => {
  saveFront()
  expect(wrote.times).toBe(1)
})

describe('where Save offers to put a tab', () => {
  const row = (path: string, children: Entry[] = []): Entry => ({
    name: path.slice(path.lastIndexOf('/') + 1),
    path,
    is_dir: children.length > 0,
    modified: 0,
    created: 0,
    children,
  })
  const tree = row('/space', [row('/space/Plan.md'), row('/space/Trips', [row('/space/Trips/a.md')])])
  const spaces = [
    { id: 's', name: 'Notes', root: '/space' },
    { id: 'w', name: 'Work', root: '/work' },
  ]

  test('everywhere a note could move to, the space first, and nowhere that cannot be written', () => {
    expect(placesFor(tree, spaces, '/space').map((one) => one.id)).toEqual([
      '/space',
      '/space/Plan',
      '/space/Trips',
      '/space/Trips/a',
      '/work',
    ])
    const writable = (path: string) => !path.startsWith('/work')
    expect(placesFor(tree, spaces, '/space', writable).map((one) => one.id)).not.toContain('/work')
  })
})
