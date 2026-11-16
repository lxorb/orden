import { describe, expect, test } from 'vitest'
import { changesFor } from './apply'
import type { Hit } from '@orden/scan/search/match'
import { parseQuery } from '@orden/scan/search/query'

const ROOT = '/space'

const NOTES: Record<string, string> = {
  '/space/Work/One.md': 'alpha here\nbeta there\nalpha again\n',
  '/space/Two.md': 'alpha only\n',
  '/space/Three.md': 'Doe, John\nRoe, Jane\n',
  '/space/Docs.url': '[InternetShortcut]\r\nURL=https://svelte.dev\r\nOrden-Icon=star\r\n',
  '/space/Moved.md': 'alpha new\nalpha one\nalpha two\n',
  '/space/Plan.md': 'The quarterly plan is due.\nA plan, quarterly or not.\n',
  '/space/Tasks.md': '- [ ] The quarterly plan is due\n- [ ] A plan, quarterly or not\n',
  '/space/Review.md': '- [ ] plan the quarterly review\n',
  '/space/Budget.md': '# Budget\n\nThe quarterly plan is due.\n',
}

const textOf = (path: string) => Promise.resolve(NOTES[path] ?? null)

const hit = (path: string, line: number, text?: string): Hit => ({
  path,
  name: path.split('/').pop() ?? path,
  line,
  text: text ?? (NOTES[path]?.split('\n')[line] ?? '').trim(),
  ranges: [],
})

const changes = (query: string, hits: Hit[], replacement: string) =>
  changesFor(parseQuery(query), hits, replacement, ROOT, textOf)

describe('what a replacement would do', () => {
  test('replaces several words typed together as the words they make, not one by one', async () => {
    const made = await changes(
      'quarterly plan',
      [hit('/space/Plan.md', 0), hit('/space/Plan.md', 1)],
      'annual plan',
    )

    expect(made[0]?.after).toBe('The annual plan is due.\nA plan, quarterly or not.\n')
  })

  test('and within one side of an either-or', async () => {
    const made = await changes(
      '(quarterly plan) OR budget',
      [hit('/space/Plan.md', 0), hit('/space/Plan.md', 1)],
      'annual plan',
    )

    expect(made[0]?.after).toBe('The annual plan is due.\nA plan, quarterly or not.\n')
  })

  test.each([
    'task:quarterly plan',
    'line:quarterly plan',
    'content:quarterly content:plan',
    'content:quarterly plan',
  ])('and with %s, whose words are read one by one', async (query) => {
    const made = await changes(
      query,
      [hit('/space/Tasks.md', 0), hit('/space/Tasks.md', 1)],
      'annual plan',
    )

    expect(made[0]?.after).toBe('- [ ] The annual plan is due\n- [ ] A plan, quarterly or not\n')
  })

  test('and after a section, whose words are not on the line', async () => {
    const made = await changes(
      'section:Budget quarterly plan',
      [hit('/space/Budget.md', 2)],
      'annual plan',
    )

    expect(made[0]?.after).toBe('# Budget\n\nThe annual plan is due.\n')
  })

  test.each(['plan task:quarterly', 'plan -draft quarterly'])(
    'but not words typed apart, as in %s',
    async (query) => {
      const made = await changes(query, [hit('/space/Review.md', 0)], 'X')

      expect(made[0]?.after).toBe('- [ ] X the X review\n')
    },
  )

  test('and keeps the rest of the query as it was', async () => {
    const made = await changes('plan -draft', [hit('/space/Plan.md', 0)], 'road')

    expect(made[0]?.after).toBe('The quarterly road is due.\nA plan, quarterly or not.\n')
  })

  test('never touches a file that is not a note', async () => {
    const made = await changes('star', [hit('/space/Docs.url', 2)], 'moon')

    expect(made).toEqual([])
  })

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

  test('finds a ticked line where it went when lines came in above it', async () => {
    const made = await changes('alpha', [hit('/space/Moved.md', 0, 'alpha one')], 'gamma')

    expect(made[0]?.after).toBe('alpha new\ngamma one\nalpha two\n')
  })

  test('skips a ticked line that no longer says what the list showed', async () => {
    expect(await changes('alpha', [hit('/space/Two.md', 0, 'alpha gone')], 'gamma')).toEqual([])
  })

  test('skips a note whose words no longer match', async () => {
    expect(await changes('zeta', [hit('/space/Two.md', 0)], 'gamma')).toEqual([])
  })
})
