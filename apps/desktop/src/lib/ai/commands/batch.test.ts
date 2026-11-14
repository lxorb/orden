import { expect, test, vi } from 'vitest'
import { Matcher } from '@orden/scan/search/match'
import type { Query } from '@orden/scan/search/query'
import { newThread } from '../chat/threads'
import type { Thread } from '../chat/types'
import type { Host } from './host'
import type { Ended } from './types'

const ROOT = '/vault'
const NOTES: Record<string, string> = {
  'Inbox/a.md': 'a',
  'Inbox/Deep/e.md': 'e',
  'inbox/f.md': 'f',
  'Old Inbox/b.md': 'b',
  'Projects/Inbox/c.md': 'c',
  'MyInbox/d.md': 'd',
  'Elsewhere/g.md': '#todo',
  ...Object.fromEntries(Array.from({ length: 1_200 }, (_, at) => [`Big Data/${at}.md`, 'x'])),
  'Data/real.md': 'real',
}

vi.mock('../../workspace.svelte', () => ({
  workspace: {
    spaces: [{ id: 'space', root: ROOT }],
    activeSpace: null,
    leftOutOf: () => [],
  },
}))

vi.mock('../../search/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../search/src/api')>()),
  searchSpace: (
    _root: string,
    query: Query,
    _terms: string[],
    most: number,
    onFound: (found: { hits: unknown[]; loose: unknown[] }) => void,
  ) => {
    const matcher = new Matcher(query)
    const hits = Object.entries(NOTES)
      .flatMap(([relative, body]) =>
        matcher.hits(
          { path: `${ROOT}/${relative}`, relative, name: relative.replace(/^.*\//, ''), body },
          most,
        ),
      )
      .slice(0, most)
    onFound({ hits, loose: [] })
    return Promise.resolve()
  },
}))

const { batch } = await import('./helpers')

async function batched(instruction: string): Promise<string[]> {
  const asked: string[] = []
  const ended: Ended = { stop: 'end', turn: null, usage: null }
  const host = {
    turn: (_thread: Thread, text: string) => {
      asked.push(/\[\[(.*)\]\]/.exec(text)?.[1] ?? '')
      return Promise.resolve(ended)
    },
    adopt: vi.fn(),
    touched: vi.fn(),
    line: vi.fn(),
  } as unknown as Host
  await batch(host, newThread('space', 'p', 'm'), instruction)
  return asked.sort()
}

test('/batch over Inbox/ takes only the notes in the folder Inbox', async () => {
  expect(await batched('tag every note in Inbox/ with done')).toEqual([
    'Inbox/Deep/e',
    'Inbox/a',
    'inbox/f',
  ])
})

test('/batch over a folder and a tag takes both, and only those', async () => {
  expect(await batched('tag every note in Projects/Inbox/ and #todo')).toEqual([
    'Elsewhere/g',
    'Projects/Inbox/c',
  ])
})

test('/batch over a short folder still finds it behind many paths that only contain it', async () => {
  expect(await batched('fix every note in Data/')).toEqual(['Data/real'])
})

test('/batch runs helpers of the thread, which its line opens (#1062)', async () => {
  const adopted: Thread[] = []
  const line = vi.fn()
  const ended: Ended = { stop: 'end', turn: null, usage: null }
  const host = {
    turn: () => Promise.resolve(ended),
    adopt: (thread: Thread) => adopted.push(thread),
    touched: vi.fn(),
    line,
  } as unknown as Host
  const parent = newThread('space', 'p', 'm')
  await batch(host, parent, 'tag every note in Inbox/ with done')
  expect(adopted).toHaveLength(3)
  expect(adopted.every((one) => one.parent === parent.id)).toBe(true)
  expect(line).toHaveBeenCalledWith(
    parent,
    expect.any(String),
    undefined,
    adopted.map((one) => one.id),
  )
})
