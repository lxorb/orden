import { describe, expect, test } from 'vitest'
import { changesFor } from './apply'
import type { Hit } from './match'
import { parseQuery } from './query'

const ROOT = '/space'

const NOTES: Record<string, string> = {
  '/space/Work/One.md': 'alpha here\nbeta there\nalpha again\n',
  '/space/Two.md': 'alpha only\n',
  '/space/Three.md': 'Doe, John\nRoe, Jane\n',
}

const textOf = (path: string) => Promise.resolve(NOTES[path] ?? null)

const hit = (path: string, line: number): Hit => ({
  path,
  name: path.split('/').pop() ?? path,
  line,
  text: '',
  ranges: [],
})

const changes = (query: string, hits: Hit[], replacement: string) =>
  changesFor(parseQuery(query), hits, replacement, ROOT, textOf)

describe('what a replacement would do', () => {
  test('reads each note once, however many of its lines were ticked', async () => {
    const made = await changes(
      'alpha',
      [hit('/space/Work/One.md', 0), hit('/space/Work/One.md', 2)],
      'gamma',
    )

    expect(made).toHaveLength(1)
    expect(made[0]?.after).toBe('gamma here\nbeta there\ngamma again\n')
  })

  test('leaves the lines nobody ticked alone', async () => {
    const made = await changes('alpha', [hit('/space/Work/One.md', 2)], 'gamma')

    expect(made[0]?.after).toBe('alpha here\nbeta there\ngamma again\n')
  })

  test('keeps what the note said, for the snapshot and the undo', async () => {
    const made = await changes('alpha', [hit('/space/Two.md', 0)], 'gamma')

    expect(made[0]?.before).toBe('alpha only\n')
  })

  test('touches one note per note, in the order the hits came', async () => {
    const made = await changes(
      'alpha',
      [hit('/space/Work/One.md', 0), hit('/space/Two.md', 0)],
      'gamma',
    )

    expect(made.map((one) => one.path)).toEqual(['/space/Work/One.md', '/space/Two.md'])
  })

  test('puts back what a pattern caught', async () => {
    const made = await changes(
      '/(\\w+), (\\w+)/',
      [hit('/space/Three.md', 0), hit('/space/Three.md', 1)],
      '$2 $1',
    )

    expect(made[0]?.after).toBe('John Doe\nJane Roe\n')
  })

  test('answers with the edits and the way back from them', async () => {
    const made = await changes('alpha', [hit('/space/Two.md', 0)], 'gamma')

    expect(made[0]?.edits).toEqual([{ from: 0, to: 5, insert: 'gamma' }])
    expect(made[0]?.back).toEqual([{ from: 0, to: 5, insert: 'alpha' }])
  })

  test('reads the note the operators read, so a path term still holds', async () => {
    const inside = await changes('path:Work/ alpha', [hit('/space/Work/One.md', 0)], 'gamma')
    const outside = await changes('path:Work/ alpha', [hit('/space/Two.md', 0)], 'gamma')

    expect(inside).toHaveLength(1)
    expect(outside).toHaveLength(0)
  })

  test('skips a note that has gone since the list was drawn', async () => {
    expect(await changes('alpha', [hit('/space/Missing.md', 0)], 'gamma')).toEqual([])
  })

  test('skips a note whose words no longer match', async () => {
    expect(await changes('zeta', [hit('/space/Two.md', 0)], 'gamma')).toEqual([])
  })
})
