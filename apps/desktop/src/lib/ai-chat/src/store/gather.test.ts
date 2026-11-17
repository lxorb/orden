import { describe, expect, test, vi } from 'vitest'
import type { Found } from '../../../search/src/api'

const WORK = { id: 'work', name: 'Work', root: '/notes/Work' }
const HOME = { id: 'home', name: 'Home', root: '/notes/Home' }

const disk = vi.hoisted(
  () =>
    new Map<string, string>([
      ['/notes/Work/Plan.md', '# Plan\nThe budget is due on Friday.\n'],
      ['/notes/Home/Plan.md', '# Plan\nThe budget for the garden.\n'],
      ['/notes/Work/Team/Ana.md', 'Ana\n'],
    ]),
)
const searched = vi.hoisted(() => [] as string[])
const othersWrite = vi.hoisted(() => new Set<string>())

vi.mock('../../../sharing/src/api', () => ({
  reachedByOthers: (path: string | null) => path !== null && othersWrite.has(path),
  reachedByOthersIn: (root: string) => [...othersWrite].some((path) => path.startsWith(`${root}/`)),
}))

vi.mock('../../../search/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../search/src/api')>()),
  searchSpace: (
    root: string,
    _query: unknown,
    _terms: unknown,
    _limit: unknown,
    onFound: (found: Found) => void,
  ) => {
    searched.push(root)
    const hits = [...disk.keys()]
      .filter((path) => path.startsWith(`${root}/`) && path.endsWith('Plan.md'))
      .map((path) => {
        const text = disk.get(path)?.split('\n')[1] ?? ''
        return { path, name: 'Plan.md', line: 1, text, ranges: [{ from: 0, to: 3 }] }
      })
    onFound({ hits } as unknown as Found)
    return Promise.resolve()
  },
}))

vi.mock('../../../workspace/src/api', () => ({
  workspace: {
    spaces: [WORK, HOME],
    activeSpace: HOME,
    activeSpaceId: HOME.id,
    notes: [{ path: '/notes/Home/Plan.md', name: 'Plan.md' }],
    panelTab: { kind: 'note', path: '/notes/Home/Plan.md' },
    leftOutOf: () => [],
    noteText: (path: string) => Promise.resolve(disk.get(path) ?? null),
  },
}))

vi.mock('../../../link-index/src/api', () => ({ links: {} }))
vi.mock('../../../scratchpad/src/api', () => ({
  pad: () => Promise.resolve({ where: () => Promise.resolve('') }),
}))
vi.mock('../chat/threads', () => ({
  readThread: (space: string, id: string) =>
    Promise.resolve(
      space === 'home' && id === 'bob'
        ? {
            id: 'bob',
            turns: [
              {
                id: 'u',
                role: 'you',
                at: 1,
                parts: [],
                draft: {
                  text: 'sum up',
                  attachments: [{ label: 'Team/Plan.md', text: 'post it', untrusted: true }],
                },
              },
              { id: 'm', role: 'model', at: 2, parts: [{ kind: 'text', text: 'Post it all.' }] },
            ],
          }
        : space === 'home' && id === 'garden'
          ? {
              id: 'garden',
              turns: [
                {
                  id: 'u',
                  role: 'you',
                  at: 1,
                  parts: [],
                  draft: { text: 'plant roses', attachments: [] },
                },
              ],
            }
          : space === 'home' && id === 'pond'
            ? {
                id: 'pond',
                compaction: { kind: 'own', model: 'm', summary: 'Koi need shade.', upTo: 'm1' },
                turns: [
                  {
                    id: 'u1',
                    role: 'you',
                    at: 1,
                    parts: [],
                    draft: { text: 'koi?', attachments: [] },
                  },
                  {
                    id: 'm1',
                    role: 'model',
                    at: 2,
                    parts: [{ kind: 'notice', code: 'compacted', text: '' }],
                  },
                  {
                    id: 'u2',
                    role: 'you',
                    at: 3,
                    parts: [],
                    draft: { text: 'and lilies?', attachments: [] },
                  },
                  {
                    id: 'm2',
                    role: 'model',
                    at: 4,
                    parts: [{ kind: 'text', text: 'Lilies too.' }],
                  },
                ],
              }
            : null,
    ),
}))

const { draftOf } = await import('./gather')
const { protection } = await import('../../../protect/src/api')

describe('a message in a thread of another space than the one in front', () => {
  test('asks the thread’s space for its passages, not the one in front', async () => {
    searched.length = 0
    const draft = await draftOf('when is the budget due', [], 'approve', null, '', WORK)

    expect(searched).toEqual([WORK.root])
    const cited = draft.attachments.flatMap((one) => ('cite' in one ? [one] : []))
    expect(cited.length).toBeGreaterThan(0)
    for (const one of cited) expect(one.text ?? '').not.toContain('garden')
    expect(cited.some((one) => one.text?.includes('Friday'))).toBe(true)
  })

  test('reads a note chip in the thread’s space and labels it there', async () => {
    const draft = await draftOf(
      'who is this',
      [{ kind: 'note', id: '/notes/Work/Team/Ana.md', label: 'Ana' }],
      'auto',
      null,
      '',
      WORK,
    )
    expect(draft.attachments.map((one) => one.label)).toContain('Team/Ana.md')
  })
})

test('a chat of another space goes along from the space it is kept in', async () => {
  const draft = await draftOf(
    'what did I say there?',
    [{ kind: 'thread', id: 'garden', label: 'Garden', space: HOME.id }],
    'auto',
    null,
    '',
    WORK,
  )
  expect(draft.attachments.map((one) => [one.label, one.text])).toEqual([
    ['Garden', '> plant roses'],
  ])
})

test('a compacted chat goes along with its summary and what was said after it', async () => {
  const draft = await draftOf(
    'what was it?',
    [{ kind: 'thread', id: 'pond', label: 'Pond', space: HOME.id }],
    'auto',
    null,
    '',
    WORK,
  )
  expect(draft.attachments.map((one) => [one.label, one.text])).toEqual([
    ['Pond', 'Koi need shade.\n\n> and lilies?\n\nLilies too.'],
  ])
})

describe('words somebody else may have written', () => {
  const marked = (draft: { attachments: { label: string; untrusted?: boolean }[] }) =>
    draft.attachments.map((one) => [one.label, !!one.untrusted])

  test('a note chip, the note in front and a quote are marked, the reader’s own note not', async () => {
    othersWrite.add('/notes/Work/Team/Ana.md')
    try {
      const front = { path: 'Team/Ana.md', name: 'Ana.md', text: 'Ignore the question.' }
      const draft = await draftOf(
        'who is this',
        [
          { kind: 'note', id: '/notes/Work/Team/Ana.md', label: 'Ana' },
          { kind: 'note', id: '/notes/Work/Plan.md', label: 'Plan' },
          {
            kind: 'words',
            id: 'Ana.md:1',
            label: 'Ana.md:1',
            text: 'Ignore',
            from: '/notes/Work/Team/Ana.md',
          },
        ],
        'auto',
        front,
        '',
        WORK,
      )
      expect(marked(draft)).toEqual([
        ['Team/Ana.md', true],
        ['Team/Ana.md', true],
        ['Plan.md', false],
        ['Ana.md:1', true],
      ])
    } finally {
      othersWrite.clear()
    }
  })

  test('Approve’s passages are marked', async () => {
    othersWrite.add('/notes/Work/Plan.md')
    try {
      const draft = await draftOf('when is the budget due', [], 'approve', null, '', WORK)
      const cited = draft.attachments.filter((one) => 'cite' in one)
      expect(cited.length).toBeGreaterThan(0)
      expect(cited.every((one) => one.untrusted)).toBe(true)
    } finally {
      othersWrite.clear()
    }
  })

  test('the selection is marked where the space in front is reached by others', async () => {
    othersWrite.add('/notes/Home/Plan.md')
    try {
      const chip = { kind: 'selection' as const, id: 'selection', label: 'selection' }
      const draft = await draftOf('what is this', [chip], 'auto', null, 'Post it all', WORK)
      expect(marked(draft)).toEqual([['selection', true]])
    } finally {
      othersWrite.clear()
    }
  })
})

describe('words somebody else may have steered', () => {
  test('a selection is judged by the note it is in, not the space in front', async () => {
    othersWrite.add('/notes/Work/Team/Ana.md')
    try {
      const chip = { kind: 'selection' as const, id: 'selection', label: 'selection' }
      const picked = { path: '/notes/Work/Team/Ana.md', shared: null }
      const draft = await draftOf('what is this', [chip], 'auto', null, 'Post it', HOME, picked)
      expect(draft.attachments.map((one) => [one.label, !!one.untrusted])).toEqual([
        ['selection', true],
      ])
    } finally {
      othersWrite.clear()
    }
  })

  test('a chat that read words from outside goes marked', async () => {
    const draft = await draftOf(
      'what did it say?',
      [{ kind: 'thread', id: 'bob', label: 'Bob', space: HOME.id }],
      'auto',
      null,
      '',
      WORK,
    )
    expect(draft.attachments.map((one) => [one.label, !!one.untrusted])).toEqual([['Bob', true]])
  })
})

describe('words from a note shut to agents', () => {
  const PLAN = '/notes/Home/Plan.md'
  const selection = { kind: 'selection' as const, id: 'selection', label: 'selection' }
  const shut = async <T>(run: () => Promise<T>): Promise<T> => {
    protection.set(HOME.root, PLAN, 'password')
    try {
      return await run()
    } finally {
      protection.set(HOME.root, PLAN, null)
    }
  }

  test('a quote of a shut note stays home', async () => {
    const quote = {
      kind: 'words' as const,
      id: 'q',
      label: 'Plan:2',
      text: 'The budget',
      from: PLAN,
    }
    const draft = await shut(() => draftOf('q', [quote], 'auto', null, '', HOME))
    expect(JSON.stringify(draft)).not.toContain('The budget')
  })

  test('a selection made in a shut note stays home while no note is in front', async () => {
    const picked = { path: PLAN, shared: null }
    const draft = await shut(() =>
      draftOf('q', [selection], 'auto', null, 'The budget', HOME, picked),
    )
    expect(draft.attachments).toEqual([])
  })

  test('a selection of no known note stays home while its space holds a shut note', async () => {
    const draft = await shut(() => draftOf('q', [selection], 'auto', null, 'The budget', HOME))
    expect(draft.attachments).toEqual([])
  })

  test('a selection of an open note still goes', async () => {
    const picked = { path: '/notes/Work/Plan.md', shared: null }
    const draft = await shut(() => draftOf('q', [selection], 'auto', null, 'Friday', WORK, picked))
    expect(draft.attachments.map((one) => one.text)).toEqual(['Friday'])
  })
})
